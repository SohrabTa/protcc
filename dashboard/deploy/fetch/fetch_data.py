#!/usr/bin/env python
"""Put the dashboard's data tree in /data, and do nothing when it is already there.

The dashboard is a static site over a data tree of 12.4 GB in 423,258 files. The files never go
into the image and never into git. They live in one Zenodo record as tar archives, and this
container unpacks them into the volume that the web container serves.

## Idempotent

After a part is unpacked, its name and its checksum go into `/data/.release.json`. On the next
start the script reads that file. A part whose recorded checksum equals the wanted checksum is
skipped without a request. When every part matches, the script prints one line and exits, so
`docker compose up` on a host that already holds the data starts the site at once.

Pass `FORCE=1` to fetch every part again. Pass `VERIFY=1` to count the files of every part
against the release, which is the check to run after a disk problem. A tar that ends early leaves
a tree that looks right, and the count is what finds it.

## Many parts, in parallel

On 2026-10-13 one connection to Zenodo moved about 0.3 to 0.4 MB/s, and some connections stalled
for 20 s. Eight connections together moved 3.72 MB/s from a home line and 8.93 MB/s from the LRZ
cluster. So the release has about 30 gzipped parts of at most about 400 MB before compression, and
the script fetches PARALLEL of them at a time, the largest first. A part that fails costs one part
again, not the 6.8 GB of all residue tracks. A connection that stalls for 120 s counts as a failed
attempt.

## Why the checksum comes after the write

A part is streamed straight from the network into tar, because holding the download and its
extracted copy needs twice the disk for no gain. So the checksum is known only after the last
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
PARALLEL        parts fetched at the same time, 8 by default.
RETRIES         attempts per part, 5 by default.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import tarfile
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

DATA = Path(os.environ.get("DATA_DIR", "/data"))
RELEASE_FILE = Path(os.environ.get("RELEASE_FILE", "/release/data-release.json"))
MARKER = DATA / ".release.json"
CHUNK = 1 << 20


class Progress:
    """The bytes of all parts together, printed every 30 seconds, because eight parts that each
    print their own line make a log that nobody can read."""

    def __init__(self, total: int, parts: int) -> None:
        self.total = total
        self.parts = parts
        self.done_bytes = 0
        self.done_parts = 0
        self.started = time.time()
        self.last = time.time()
        self.lock = threading.Lock()

    def add(self, n: int) -> None:
        with self.lock:
            self.done_bytes += n
            now = time.time()
            if now - self.last < 30:
                return
            self.last = now
            rate = self.done_bytes / 1e6 / max(now - self.started, 1e-6)
            say(f"    {self.done_bytes / 1e9:.2f} of {self.total / 1e9:.2f} GB, "
                f"{rate:.1f} MB/s, {self.done_parts} of {self.parts} parts in place")

    def part_done(self) -> None:
        with self.lock:
            self.done_parts += 1

    def forget(self, n: int) -> None:
        """A failed attempt: its bytes come again with the next attempt."""
        with self.lock:
            self.done_bytes -= n


class Hashing:
    """A read-only file object that hashes every byte on its way to tar."""

    def __init__(self, inner, progress: Progress) -> None:
        self.inner = inner
        self.progress = progress
        self.digest = hashlib.sha256()
        self.n = 0

    def read(self, size: int = -1) -> bytes:
        block = self.inner.read(size)
        if block:
            self.digest.update(block)
            self.n += len(block)
            self.progress.add(len(block))
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


def part_files(part: dict) -> int:
    """The files of one part in the tree. A part of a split folder owns only its subfolders."""
    root = DATA / part["dir"]
    members = part.get("members")
    if not members:
        return count_files(root)
    return sum(count_files(root / m) for m in members)


def fetch_part(name: str, url: str, want: str, retries: int, progress: Progress) -> None:
    """Stream one archive into DATA and check what arrived."""
    last_error = ""
    for attempt in range(1, retries + 1):
        stream = None
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "protcc-dashboard"})
            with urllib.request.urlopen(req, timeout=120) as response:
                stream = Hashing(response, progress)
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
            # A 404 means that the record does not hold this file, so no retry can fetch it. The
            # record id or the release file is wrong, and five attempts would only hide that.
            if isinstance(err, urllib.error.HTTPError) and err.code == 404:
                raise RuntimeError(
                    f"{url}: not found. Check ZENODO_RECORD and data-release.json."
                ) from err
            last_error = str(err)
            if stream is not None:
                progress.forget(stream.n)
            say(f"  {name}: attempt {attempt} of {retries} failed: {err}")
            if attempt < retries:
                time.sleep(15 * attempt)
    raise RuntimeError(f"{url}: {last_error}")


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
    retries = int(os.environ.get("RETRIES", "5"))
    parallel = max(1, int(os.environ.get("PARALLEL", "8")))

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
            got = part_files(part)
            if got != part["files"]:
                say(f"  {name} holds {got:,} files in the tree, the release says "
                    f"{part['files']:,}")
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

    # The largest first, so that the longest download does not start last.
    todo.sort(key=lambda n: -parts[n]["bytes"])
    total = sum(parts[n]["bytes"] for n in todo)
    say(f"Release {version}. {len(todo)} of {len(parts)} parts to fetch into {DATA}, "
        f"{parallel} at a time.")
    say(f"About {total / 1e9:.1f} GB. This runs once, and a later start reuses what it wrote.")

    # The top folders exist before the threads start. Two threads that both create `tracks/` as
    # the parent of their first file would otherwise race, and one of them would fail.
    for name in todo:
        (DATA / parts[name]["dir"]).mkdir(parents=True, exist_ok=True)

    progress = Progress(total, len(todo))
    marker_lock = threading.Lock()

    def one(name: str) -> None:
        part = parts[name]
        fetch_part(name, f"{base}/{name}{suffix}", part["sha256"], retries, progress)
        progress.part_done()
        with marker_lock:
            have_parts[name] = part["sha256"]
            MARKER.write_text(json.dumps(
                {"release": version, "zenodo_record": record, "parts": have_parts}, indent=2
            ) + "\n")
        say(f"  {name} is in place, {part['bytes'] / 1e9:.2f} GB")

    failed: list[str] = []
    with ThreadPoolExecutor(max_workers=parallel) as pool:
        jobs = {pool.submit(one, name): name for name in todo}
        for job in as_completed(jobs):
            err = job.exception()
            if err is not None:
                failed.append(jobs[job])
                say(f"  {jobs[job]} failed: {err}")
    if failed:
        raise SystemExit(
            f"{len(failed)} of {len(todo)} parts failed: {', '.join(sorted(failed))}. The parts "
            "that arrived are recorded, so the next start fetches only these."
        )

    check_tree(release)
    elapsed = time.time() - progress.started
    say(f"Release {version} is in place, {total / 1e9:.1f} GB in {elapsed / 60:.0f} min.")


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
