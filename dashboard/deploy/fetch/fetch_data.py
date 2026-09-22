#!/usr/bin/env python
"""Put the dashboard's data tree in /data, and do nothing when it is already there.

The dashboard is a static site over a data tree of 11.5 GB in 423,258 files. The files never go
into the image and never into git. They live in one Zenodo record as four tar archives, and this
container unpacks them into the volume that the web container serves.

## Idempotent

After a part is unpacked, its name and its checksum go into `/data/.release.json`. On the next
start the script reads that file. A part whose recorded checksum equals the wanted checksum is
skipped without a request. When every part matches, the script prints one line and exits, so
`docker compose up` on a host that already holds the data starts the site at once.

Pass `FORCE=1` to fetch every part again. Pass `VERIFY=1` to count the files of every part
against the release, which is the check to run after a disk problem. A tar that ends early leaves
a tree that looks right, and the count is what finds it.

## Why the checksum comes after the write

A part is streamed straight from the network into tar, because holding an 11.5 GB download and
its extracted copy needs twice the disk for no gain. So the checksum is known only after the last
byte. A part that fails its checksum never reaches the record, the script exits non-zero, and the
web container does not start, because compose waits for this one to succeed.

Reads
-----
/release/data-release.json     which parts belong to this release, and their checksums
https://zenodo.org/records/<record>/files/<part>

Writes
------
/data/...                      the data tree the site reads
/data/.release.json            what this container put there

Environment
-----------
ZENODO_RECORD   the record id. It overrides the one in data-release.json.
BASE_URL        a different place to read the parts from, for a mirror or for a test.
FORCE           1 to fetch every part again.
VERIFY          1 to count the files of each part against the release.
RETRIES         attempts per part, 3 by default.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import tarfile
import time
import urllib.error
import urllib.request
from pathlib import Path

DATA = Path(os.environ.get("DATA_DIR", "/data"))
RELEASE_FILE = Path(os.environ.get("RELEASE_FILE", "/release/data-release.json"))
MARKER = DATA / ".release.json"
CHUNK = 1 << 20


class Hashing:
    """A read-only file object that hashes every byte on its way to tar."""

    def __init__(self, inner) -> None:
        self.inner = inner
        self.digest = hashlib.sha256()
        self.n = 0
        self.started = time.time()
        self.last = 0.0

    def read(self, size: int = -1) -> bytes:
        block = self.inner.read(size)
        if block:
            self.digest.update(block)
            self.n += len(block)
            now = time.time()
            if now - self.last > 10:
                self.last = now
                mb = self.n / 1e6
                rate = mb / max(now - self.started, 1e-6)
                print(f"    {mb:,.0f} MB, {rate:.0f} MB/s", flush=True)
        return block


def say(msg: str) -> None:
    print(msg, flush=True)


def load(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {}


def count_files(root: Path) -> int:
    if not root.exists():
        return 0
    return sum(1 for p in root.rglob("*") if p.is_file())


def fetch_part(url: str, want: str, retries: int) -> None:
    """Stream one archive into DATA and check what arrived."""
    last_error = ""
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "protcc-dashboard"})
            with urllib.request.urlopen(req, timeout=120) as response:
                stream = Hashing(response)
                with tarfile.open(fileobj=stream, mode="r|*") as tar:
                    # `data` refuses absolute paths, parent traversal, links and devices.
                    tar.extractall(DATA, filter="data")
                # Drain whatever tar did not read, so the checksum covers the whole file.
                while stream.read(CHUNK):
                    pass
            got = stream.digest.hexdigest()
            if got != want:
                raise ValueError(f"checksum is {got[:16]}, the release says {want[:16]}")
            return
        except (urllib.error.URLError, OSError, tarfile.TarError, ValueError) as err:
            last_error = str(err)
            say(f"    attempt {attempt} of {retries} failed: {err}")
            if attempt < retries:
                time.sleep(5 * attempt)
    raise SystemExit(f"{url}: {last_error}")


def main() -> None:
    release = load(RELEASE_FILE)
    if not release:
        raise SystemExit(f"{RELEASE_FILE} is missing or is not JSON.")
    parts: dict[str, dict] = release.get("parts") or {}
    if not parts:
        raise SystemExit(
            f"{RELEASE_FILE} lists no parts. Run make_release.sh on the built data tree, upload "
            "the archives it writes to one Zenodo record, then copy its data-release.json here."
        )
    record = os.environ.get("ZENODO_RECORD") or release.get("zenodo_record", "")
    version = release["release"]
    force = os.environ.get("FORCE") == "1"
    retries = int(os.environ.get("RETRIES", "3"))

    DATA.mkdir(parents=True, exist_ok=True)
    have = load(MARKER)
    have_parts: dict[str, str] = have.get("parts", {}) if not force else {}

    todo = [name for name, p in parts.items() if have_parts.get(name) != p["sha256"]]
    if os.environ.get("VERIFY") == "1":
        # A tar can end early and still leave a tree that looks right, so this counts the files
        # each part should have written. It walks 423,258 paths, so it is not the default.
        for name, part in parts.items():
            if name in todo:
                continue
            got = count_files(DATA / part["dir"])
            if got != part["files"]:
                say(f"  {part['dir']} holds {got:,} files, the release says {part['files']:,}")
                todo.append(name)
                have_parts.pop(name, None)
    if not todo:
        say(f"The data tree is release {version} and is current. {len(parts)} parts, nothing to do.")
        check_tree(release)
        return

    base = os.environ.get("BASE_URL", "").rstrip("/")
    if not base:
        if not record or record.startswith("<"):
            raise SystemExit(
                "No Zenodo record id. Upload the archives, then set ZENODO_RECORD in .env or "
                "write the id into data-release.json."
            )
        base = f"https://zenodo.org/records/{record}/files"
    # Zenodo answers the file itself only with this query. A plain web server does not want it.
    suffix = "?download=1" if "zenodo.org" in base else ""

    say(f"Release {version}. {len(todo)} of {len(parts)} parts to fetch into {DATA}.")
    total = sum(parts[n]["bytes"] for n in todo)
    say(f"About {total / 1e9:.1f} GB. This runs once, and a later start reuses what it wrote.")

    for name in todo:
        part = parts[name]
        url = f"{base}/{name}{suffix}"
        say(f"  {name}, {part['bytes'] / 1e9:.2f} GB")
        fetch_part(url, part["sha256"], retries)
        have_parts[name] = part["sha256"]
        MARKER.write_text(
            json.dumps({"release": version, "zenodo_record": record, "parts": have_parts}, indent=2)
            + "\n"
        )
        say(f"  {name} is in place")

    check_tree(release)
    say(f"Release {version} is in place.")


def check_tree(release: dict) -> None:
    """One look at what arrived, because a tar can succeed and still hold the wrong tree."""
    manifest = DATA / "manifest.json"
    if not manifest.exists():
        raise SystemExit(f"{manifest} is missing, so the site has no index to read.")
    mf = load(manifest)
    want = release.get("expect", {})
    counts = mf.get("counts", {})
    for key, value in want.items():
        got = counts.get(key)
        if got != value:
            raise SystemExit(f"manifest counts.{key} is {got}, the release expects {value}.")
    missing = [n for n in release.get("expect_files", []) if not (DATA / n).exists()]
    if missing:
        raise SystemExit(f"the tree is missing {len(missing)} index files, first {missing[:3]}.")
    free = shutil.disk_usage(DATA).free
    say(
        f"{counts.get('proteins', 0):,} proteins, "
        f"{counts.get('structures', 0):,} structures, {free / 1e9:.0f} GB free."
    )


if __name__ == "__main__":
    try:
        main()
    except SystemExit as err:
        if err.code not in (0, None):
            print(f"FAILED: {err}", file=sys.stderr, flush=True)
        raise
