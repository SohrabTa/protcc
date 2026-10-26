#!/usr/bin/env python3
"""Check a running dashboard from the outside, with the same requests that a browser makes.

    python3 fetch/smoke_test.py http://localhost:8080/
    python3 fetch/smoke_test.py https://biocentral.rostlab.org/protcc/

Without Python on the host, the fetch image runs it on the compose network:

    docker compose run --rm --no-deps --entrypoint python fetch-data /app/smoke_test.py http://web/

Each check prints one line, PASS or FAIL. The exit code is 0 when every check passes and 1 when
one fails, so an agent or a cron job can act on it. The script reads data-release.json for the
counts that the data tree must have: beside this script, or at /release/data-release.json in the
container.

What it checks, and why:

- The page and its JavaScript load. A wrong base path for a proxy shows here first.
- The manifest has the protein and structure counts of the release.
- Each index file of the release answers 200.
- One latent ranking, one protein bundle, one residue track and one structure answer 200.
- A structure arrives as application/gzip without Content-Encoding. The page unpacks it itself,
  and with that header the browser would unpack it first.
- A missing data file answers 404. With a blanket fallback to index.html it answers 200 with
  HTML, and the site then shows a parse error instead of the real fault.
"""

from __future__ import annotations

import gzip
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
RELEASE_FILES = [HERE.parent / "data-release.json", Path("/release/data-release.json")]

failures = 0


def report(ok: bool, what: str, detail: str = "") -> None:
    global failures
    failures += 0 if ok else 1
    print(f"{'PASS' if ok else 'FAIL'}  {what}" + (f"  ({detail})" if detail else ""), flush=True)


def get(url: str) -> tuple[int, dict[str, str], bytes]:
    """The status, the headers, and the body as the page sees it, after any Content-Encoding.

    A browser asks for gzip, so this does too: the structure check needs the server's answer to
    that request.
    """
    req = urllib.request.Request(
        url, headers={"Accept-Encoding": "gzip", "User-Agent": "protcc-smoke-test"}
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            headers = {k.lower(): v for k, v in response.headers.items()}
            body = response.read()
    except urllib.error.HTTPError as err:
        return err.code, {k.lower(): v for k, v in err.headers.items()}, b""
    except (urllib.error.URLError, OSError) as err:
        return 0, {}, str(err).encode()
    if headers.get("content-encoding") == "gzip":
        body = gzip.decompress(body)
    return response.status, headers, body


def get_json(url: str) -> object | None:
    status, _, body = get(url)
    if status != 200:
        return None
    try:
        return json.loads(body)
    except ValueError:
        return None


def release() -> dict:
    for path in RELEASE_FILES:
        if path.is_file():
            return json.loads(path.read_text())
    return {}


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__.split("\n\n")[1])
    base = sys.argv[1] if sys.argv[1].endswith("/") else sys.argv[1] + "/"
    data = base + "data/"
    rel = release()
    if not rel:
        print("WARN  no data-release.json found, so the counts are not checked")

    status, headers, body = get(base)
    page = body.decode(errors="replace")
    # The element the site mounts into, and not the title, which is wording that changes.
    report(status == 200 and 'id="app"' in page, "the page loads", f"HTTP {status}")
    scripts = [part.split('"')[0] for part in page.split('src="')[1:] if ".js" in part[:120]]
    for src in scripts:
        status, headers, _ = get(base + src.removeprefix("./"))
        report(status == 200 and "javascript" in headers.get("content-type", ""),
               f"the script {src} loads", f"HTTP {status}, {headers.get('content-type', '')}")
    if not scripts:
        report(False, "the page names its script", "no src=...js in the page")

    manifest = get_json(data + "manifest.json")
    report(isinstance(manifest, dict), "data/manifest.json is JSON")
    counts = manifest.get("counts", {}) if isinstance(manifest, dict) else {}
    for key, want in rel.get("expect", {}).items():
        report(counts.get(key) == want, f"the manifest has {key} = {want:,}",
               f"it has {counts.get(key)}")

    for name in rel.get("expect_files", []):
        status, _, _ = get(data + name)
        report(status == 200, f"data/{name}", f"HTTP {status}")

    features = get_json(data + "features.json")
    if isinstance(features, list) and features:
        fid = features[0]["f"]
        status, _, body = get(f"{data}feature/{fid}.bin")
        report(status == 200 and len(body) > 8, f"the ranking of latent {fid}", f"HTTP {status}")
    else:
        report(False, "data/features.json is a list of latents")

    lookup = get_json(data + "protein_lookup.json")
    if isinstance(lookup, dict) and lookup:
        acc, (_, shard) = next(iter(lookup.items()))
        status, _, _ = get(f"{data}proteins/shard_{shard}.json")
        report(status == 200, f"the protein bundle of {acc}", f"HTTP {status}")
        two = acc[:2].upper()
        status, _, body = get(f"{data}tracks/{two}/{acc}.bin")
        report(status == 200 and len(body) > 0, f"the residue track of {acc}", f"HTTP {status}")
        status, headers, body = get(f"{data}structures/{two}/{acc}.cif.gz")
        report(status == 200 and body[:2] == b"\x1f\x8b", f"the structure of {acc}",
               f"HTTP {status}")
        report(headers.get("content-type", "").startswith("application/gzip")
               and "content-encoding" not in headers,
               "the structure is application/gzip without Content-Encoding",
               f"{headers.get('content-type')}, encoding {headers.get('content-encoding')}")
    else:
        report(False, "data/protein_lookup.json maps proteins")

    status, headers, _ = get(data + "no-such-file.json")
    report(status == 404, "a missing data file answers 404",
           f"HTTP {status}, {headers.get('content-type', '')}")

    print(f"{'All checks passed.' if not failures else f'{failures} check(s) failed.'}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
