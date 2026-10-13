#!/usr/bin/env python3
"""Upload a data release to a Zenodo draft, and publish it only when asked.

`make_release.sh` writes the archives and a `data-release.json`. This script puts them into one
Zenodo draft, sets the metadata from `zenodo-metadata.json`, and writes the record id into the
`data-release.json` of the release. The fetch container reads that id.

Every step is safe to run again. The script compares the files of the draft with the local files
by name and md5. It uploads a file that is missing, replaces a file whose md5 differs, and leaves
a file that matches. So an upload that stops halfway continues with `--draft <id>`.

Publishing is a separate call, because it cannot be undone: Zenodo gives the record a DOI, and its
files never change after that. A later release goes into a new version of the record.

    # a new record, as a draft
    python3 zenodo_upload.py ../data/release
    # continue a draft that stopped halfway
    python3 zenodo_upload.py ../data/release --draft 1234567
    # a new version of a published record, as a draft
    python3 zenodo_upload.py ../data/release --new-version-of 1234567
    # publish the draft, after a person checked it on zenodo.org
    python3 zenodo_upload.py ../data/release --draft 1234567 --publish

An upload to Zenodo moved about 0.3 MB/s on 2026-10-13. Parallel uploads did not add up: with 2
or 3 at the same time, one of them failed each time, and the total stayed under 0.5 MB/s. With 6,
almost all failed with 502. So PARALLEL is 1 by default, and the 8.6 GB of a release take about
8 hours. On the same day Zenodo also answered many requests with 502 or 504, so each file gets
RETRIES attempts, 8 by default, with a longer wait after each failure. Downloads are different:
they add up, and the fetch container uses 8 at a time.

The token is a Zenodo personal access token with the scopes deposit:write and deposit:actions,
in the file that ZENODO_TOKEN_FILE names (~/.zenodo-token by default). The script never prints
it and never puts it on a command line, because a command line is visible to every user of the
machine. ZENODO_URL selects another instance, for example https://sandbox.zenodo.org for a test.

UPLOAD_INTERFACE, for example en14, keeps the upload on one network interface: curl is bound to
it, and before each file the script makes sure that every address of Zenodo routes through it. A
laptop with a VPN or a company tailnet thus never sends a private upload through that network.

Reads
-----
<release>/data-release.json   the parts of the release and their checksums
<release>/<part>              the archives
zenodo-metadata.json          beside this script: title, creators, license, description

Writes
------
<release>/data-release.json   the same file, with zenodo_record set to the draft id
the Zenodo draft              the archives, data-release.json, and the metadata
"""

from __future__ import annotations

import argparse
import functools
import hashlib
import json
import os
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ZENODO = os.environ.get("ZENODO_URL", "https://zenodo.org").rstrip("/")
TOKEN_FILE = Path(os.environ.get("ZENODO_TOKEN_FILE", Path.home() / ".zenodo-token"))
METADATA = Path(__file__).with_name("zenodo-metadata.json")
PARALLEL = max(1, int(os.environ.get("PARALLEL", "1")))
RETRIES = max(1, int(os.environ.get("RETRIES", "8")))
INTERFACE = os.environ.get("UPLOAD_INTERFACE", "")


class ZenodoError(Exception):
    """A call that Zenodo refused, or that did not get an answer."""


def say(msg: str) -> None:
    print(f"{time.strftime('%H:%M:%S')}  {msg}", flush=True)


def wait(attempt: int) -> None:
    """1, 2, 4, 8 and then 15 minutes: a service under load needs minutes, not seconds."""
    time.sleep(60 * min(15, 2 ** (attempt - 1)))


@functools.cache
def token() -> str:
    try:
        value = TOKEN_FILE.read_text().strip()
    except OSError:
        sys.exit(f"No token in {TOKEN_FILE}. Make one on {ZENODO}/account/settings/applications/.")
    if not value:
        sys.exit(f"{TOKEN_FILE} is empty.")
    return value


def api(method: str, path: str, body: dict | None = None) -> dict | list:
    """One JSON call to the deposit API. `path` is relative to /api, or a full URL.

    A call that changes nothing, or that gives the same result when sent twice, is sent again on
    a 5xx answer. A POST is not, because a second POST can make a second draft.
    """
    url = path if path.startswith("http") else f"{ZENODO}/api{path}"
    data = json.dumps(body).encode() if body is not None else None
    tries = 1 if method == "POST" else 4
    for attempt in range(1, tries + 1):
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", f"Bearer {token()}")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=180) as response:
                raw = response.read()
            return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as err:
            detail = f"{method} {url}: {err.code} {err.read().decode(errors='replace')[:300]}"
            if err.code < 500 or attempt == tries:
                raise ZenodoError(detail) from err
        except (urllib.error.URLError, OSError) as err:
            detail = f"{method} {url}: {err}"
            if attempt == tries:
                raise ZenodoError(detail) from err
        say(f"  {detail.splitlines()[0][:160]}, trying again")
        wait(attempt)
    raise AssertionError("unreachable")


def route_interface(address: str) -> str:
    """The interface that the routing table gives for `address`, from route (macOS) or ip (Linux)."""
    if sys.platform == "darwin":
        family = "-inet6" if ":" in address else "-inet"
        out = subprocess.run(["route", "-n", "get", family, address],
                             capture_output=True, text=True, check=False).stdout
        found = re.search(r"interface: (\S+)", out)
    else:
        out = subprocess.run(["ip", "route", "get", address],
                             capture_output=True, text=True, check=False).stdout
        found = re.search(r" dev (\S+)", out)
    return found.group(1) if found else "unknown"


def check_route() -> None:
    """With UPLOAD_INTERFACE, make sure that every address of Zenodo routes through it.

    curl is bound to the interface, so an upload cannot move to another one. The JSON calls follow
    the routing table, so this runs before each file: when a VPN or an exit node takes the route,
    the script stops, and it sends nothing another way.
    """
    if not INTERFACE:
        return
    host = urllib.parse.urlparse(ZENODO).hostname
    addresses = {info[4][0] for info in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)}
    wrong = {a: i for a in sorted(addresses) if (i := route_interface(a)) != INTERFACE}
    if wrong:
        raise ZenodoError(f"Not every address of {host} routes through {INTERFACE}: {wrong}")


@functools.cache
def md5(path: Path) -> str:
    """The files do not change during a run, so each file is read once."""
    h = hashlib.md5()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 22), b""):
            h.update(block)
    return h.hexdigest()


def draft_files(deposition_id: int) -> dict[str, dict]:
    return {f["filename"]: f for f in api("GET", f"/deposit/depositions/{deposition_id}/files")}


def put(bucket: str, path: Path) -> str:
    """Stream one file into the bucket with curl, which copes with a large body better than
    urllib. The token goes to curl on stdin, not on its command line. Returns an error, or an
    empty string."""
    config = f'header = "Authorization: Bearer {token()}"\n'
    cmd = [
        "curl", "--fail-with-body", "--silent", "--show-error", "--config", "-",
        *(["--interface", INTERFACE] if INTERFACE else []),
        "--upload-file", str(path), f"{bucket}/{path.name}", "--output", "/dev/null",
        "--write-out", "%{http_code} %{speed_upload}",
    ]
    done = subprocess.run(cmd, input=config.encode(), capture_output=True, check=False)
    if done.returncode != 0:
        code = done.stdout.decode().split(" ")[0]
        return f"HTTP {code}, curl exit {done.returncode}"
    rate = float(done.stdout.decode().split(" ")[1]) / 1e6
    say(f"  {path.name} is in the draft, {path.stat().st_size / 1e6:.0f} MB at {rate:.2f} MB/s")
    return ""


def upload(deposition_id: int, bucket: str, path: Path) -> str:
    """Put one file into the draft, with RETRIES attempts. Returns an error, or an empty string."""
    error = ""
    for attempt in range(1, RETRIES + 1):
        check_route()
        error = put(bucket, path)
        if not error:
            return ""
        # A gateway timeout can come after Zenodo stored the file, so look before sending again.
        try:
            remote = draft_files(deposition_id).get(path.name)
            if remote and remote["checksum"].removeprefix("md5:") == md5(path):
                say(f"  {path.name} is in the draft, although the upload answered {error}")
                return ""
            if remote:
                api("DELETE", remote["links"]["self"])
        except ZenodoError as err:
            error = f"{error}, then {err}"
        say(f"  {path.name}: attempt {attempt} of {RETRIES} failed: {error}")
        if attempt < RETRIES:
            wait(attempt)
    return error


def sync_files(deposition: dict, wanted: list[Path]) -> None:
    """Make the files of the draft equal to `wanted`, by name and md5."""
    did = deposition["id"]
    have = draft_files(did)
    todo: list[Path] = []
    for path in wanted:
        remote = have.pop(path.name, None)
        if remote and remote["checksum"].removeprefix("md5:") == md5(path):
            continue
        if remote:
            say(f"  {path.name} differs, replacing it")
            api("DELETE", remote["links"]["self"])
        todo.append(path)
    # A file the release does not name, for example a part of an older release in a new version.
    for name, remote in have.items():
        say(f"  {name} is not in this release, removing it from the draft")
        api("DELETE", remote["links"]["self"])
    if not todo:
        say(f"  all {len(wanted)} files are in the draft already")
        return

    # The largest first, so that the longest upload does not start last.
    todo.sort(key=lambda p: -p.stat().st_size)
    total = sum(p.stat().st_size for p in todo)
    say(f"  {len(todo)} of {len(wanted)} files to upload, {total / 1e9:.1f} GB, "
        f"{PARALLEL} at a time")
    bucket = deposition["links"]["bucket"]
    with ThreadPoolExecutor(max_workers=PARALLEL) as pool:
        results = list(pool.map(lambda p: upload(did, bucket, p), todo))
    errors = {p.name: e for p, e in zip(todo, results) if e}
    if errors:
        for name, err in errors.items():
            say(f"  {name} failed: {err}")
        raise ZenodoError(f"{len(errors)} of {len(todo)} uploads failed. Run again with "
                          f"--draft {did} to upload only those.")


def check(deposition_id: int, wanted: list[Path]) -> None:
    """Compare the draft against the local files once more, after everything is in."""
    have = {n: f["checksum"].removeprefix("md5:") for n, f in draft_files(deposition_id).items()}
    bad = [p.name for p in wanted if have.get(p.name) != md5(p)]
    extra = sorted(set(have) - {p.name for p in wanted})
    if bad or extra:
        raise ZenodoError(f"The draft does not match the release: differs {bad}, extra {extra}.")
    say(f"  all {len(wanted)} files match by md5")


def run(a: argparse.Namespace) -> None:
    check_route()
    if INTERFACE:
        say(f"Every address of Zenodo routes through {INTERFACE}, and curl is bound to it.")
    release_file = a.release / "data-release.json"
    release = json.loads(release_file.read_text())
    parts = [a.release / name for name in release["parts"]]
    missing = [p.name for p in parts if not p.is_file()]
    if missing:
        sys.exit(f"{a.release} is missing {missing}.")

    if a.publish:
        if a.draft is None:
            sys.exit("--publish needs --draft <id>, so that the draft to publish is named.")
        check(a.draft, parts + [release_file])
        done = api("POST", f"/deposit/depositions/{a.draft}/actions/publish")
        say(f"Published: {done['links']['html']}, DOI {done.get('doi', '')}")
        return

    if a.draft is not None:
        deposition = api("GET", f"/deposit/depositions/{a.draft}")
    elif a.new_version_of is not None:
        made = api("POST", f"/deposit/depositions/{a.new_version_of}/actions/newversion")
        deposition = api("GET", made["links"]["latest_draft"])
    else:
        deposition = api("POST", "/deposit/depositions", {})
    if deposition.get("submitted") and deposition.get("state") == "done":
        sys.exit(f"{deposition['id']} is published. Use --new-version-of {deposition['id']}.")
    did = deposition["id"]
    say(f"Draft {did}: {ZENODO}/uploads/{did}")

    # The id goes into the release file before the upload, so the copy in the record names it.
    release["zenodo_record"] = str(did)
    release_file.write_text(json.dumps(release, indent=2) + "\n")

    sync_files(deposition, parts + [release_file])

    meta = json.loads(METADATA.read_text())["metadata"]
    meta["version"] = release["release"]
    api("PUT", f"/deposit/depositions/{did}", {"metadata": meta})
    check(did, parts + [release_file])
    say(f"Draft {did} is complete. Check it on {ZENODO}/uploads/{did}, then publish with "
        f"--draft {did} --publish.")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("release", type=Path, help="the folder that make_release.sh wrote")
    group = ap.add_mutually_exclusive_group()
    group.add_argument("--draft", type=int, help="continue this draft")
    group.add_argument("--new-version-of", type=int, help="start a new version of this record")
    ap.add_argument("--publish", action="store_true", help="publish the draft. This is final.")
    try:
        run(ap.parse_args())
    except ZenodoError as err:
        sys.exit(f"FAILED: {err}")


if __name__ == "__main__":
    main()
