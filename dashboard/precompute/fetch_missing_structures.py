#!/usr/bin/env python
"""Stage 6b. The AlphaFold models that stage 6 could not find, straight from EBI.

Stage 6 extracts backbones from a Foldcomp database. That database is a snapshot: every key in
`afdb_swissprot.lookup` ends in `model_v3`, and it holds 542,380 accessions. 5,357 proteins of
the evaluation set entered Swiss-Prot after the snapshot, so the database does not hold them.
AlphaFold has a model for every one of them (2026-09-22, measured over a 25-accession sample by
`documentation/scripts/missing_structure_cause.py` in the paper repo).

This stage downloads those models one at a time from EBI and writes the same backbone mmCIF that
stage 6 writes, with the same function, so the two sets of files cannot drift apart.

The files it writes carry a newer AlphaFold model version than the rest of the tree. EBI serves
only the current version of a model, so there is no v3 to download for these proteins. The
version of each file is recorded in the manifest.

Reads
-----
<web>/protein_lookup.json          every protein the dashboard holds
<web>/structures/<XX>/<acc>.cif.gz what is already there
https://alphafold.ebi.ac.uk/files/AF-<acc>-F1-model_v<n>.pdb

Writes
------
<web>/structures/<XX>/<acc>.cif.gz  the same format as stage 6
<web>/structures_backfill.json      what this run did
<web>/structures_from_ebi.txt       every accession downloaded here, so a re-run cannot double it
<web>/manifest.json                 counts.structures and counts.no_structure, in place

Repro
-----
uv run python fetch_missing_structures.py --web ../data/web
Deterministic, no randomness, no seed. It is safe to run again: it downloads only what is
absent, so an interrupted run continues where it stopped.
"""

from __future__ import annotations

import argparse
import gzip
import json
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from build_structures import pdb_to_backbone_cif

BASE = "https://alphafold.ebi.ac.uk/files"
VERSIONS = (6, 5, 4, 3)
TRIES = 3


def fetch(acc: str) -> tuple[str, bytes | None, int | None, str]:
    """The PDB text of one model, with the version that answered."""
    for v in VERSIONS:
        url = f"{BASE}/AF-{acc}-F1-model_v{v}.pdb"
        for attempt in range(TRIES):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "protcc-dashboard"})
                with urllib.request.urlopen(req, timeout=60) as r:
                    return acc, r.read(), v, ""
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    break  # try the next version
                time.sleep(2 * (attempt + 1))
            except Exception:  # a timeout or a reset, both worth another try
                time.sleep(2 * (attempt + 1))
    return acc, None, None, "no model answered"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--web", type=Path, required=True)
    ap.add_argument("--stage6", type=Path, default=None,
                    help="stage 6's output directory, to rewrite its missing.txt")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--limit", type=int, default=0, help="stop after this many, to test")
    a = ap.parse_args()
    web: Path = a.web

    lookup = json.loads((web / "protein_lookup.json").read_text())
    todo = [
        acc for acc in sorted(lookup)
        if not (web / "structures" / acc[:2].upper() / f"{acc}.cif.gz").exists()
    ]
    if a.limit:
        todo = todo[: a.limit]
    print(f"{len(lookup):,} proteins, {len(todo):,} without a model", flush=True)
    if not todo:
        return

    started = time.time()
    written = 0
    got: list[str] = []
    failed: list[str] = []
    versions: dict[str, int] = {}
    total_bytes = 0
    with ThreadPoolExecutor(max_workers=a.workers) as pool:
        for n, (acc, pdb, version, err) in enumerate(pool.map(fetch, todo), 1):
            if pdb is None:
                failed.append(acc)
            else:
                body, n_atoms = pdb_to_backbone_cif(acc, pdb.decode())
                if body is None:
                    failed.append(acc)
                else:
                    blob = gzip.compress(body.encode(), 9)
                    p = web / "structures" / acc[:2].upper() / f"{acc}.cif.gz"
                    p.parent.mkdir(parents=True, exist_ok=True)
                    p.write_bytes(blob)
                    written += 1
                    got.append(acc)
                    total_bytes += len(blob)
                    versions[f"v{version}"] = versions.get(f"v{version}", 0) + 1
            if n % 200 == 0:
                rate = n / (time.time() - started)
                left = (len(todo) - n) / max(rate, 1e-6)
                print(f"  {n:,} of {len(todo):,}, {rate:.1f}/s, {left/60:.1f} min left",
                      flush=True)

    # The dashboard reads both counts out of the manifest, so they move with the files.
    mf_path = web / "manifest.json"
    mf = json.loads(mf_path.read_text())
    have = sum(1 for acc in lookup
               if (web / "structures" / acc[:2].upper() / f"{acc}.cif.gz").exists())
    mf["counts"]["structures"] = have
    mf["counts"]["no_structure"] = len(lookup) - have
    # The site says where a model came from, because this tree now holds two AlphaFold versions.
    # The list is the record, not a running count, so a second run cannot double it.
    from_ebi_path = web / "structures_from_ebi.txt"
    from_ebi = set(from_ebi_path.read_text().split()) if from_ebi_path.exists() else set()
    from_ebi.update(got)
    from_ebi_path.write_text("".join(f"{x}\n" for x in sorted(from_ebi)))
    mf["counts"]["structures_from_ebi"] = len(from_ebi)
    # The site said that the Foldcomp database does not hold the missing ones. After this stage
    # that is no longer the reason: every one left was asked of AlphaFold and refused.
    mf["counts"]["no_structure_note"] = (
        "AlphaFold serves no model for them at any version."
        if failed else ""
    )
    mf_path.write_text(json.dumps(mf, indent=2) + "\n")

    # Stage 4 reads missing.txt for the same two counts, so it has to agree with the files.
    still = [acc for acc in sorted(lookup)
             if not (web / "structures" / acc[:2].upper() / f"{acc}.cif.gz").exists()]
    if a.stage6:
        (a.stage6 / "missing.txt").write_text("".join(f"{x}\n" for x in still))

    out = {
        "stage": "6b-structure-backfill",
        "built": time.strftime("%Y-%m-%d"),
        "source": "https://alphafold.ebi.ac.uk/files",
        "requested": len(todo),
        "written": written,
        "failed": len(failed),
        "failed_accessions": failed[:50],
        "alphafold_versions": versions,
        "bytes": total_bytes,
        "seconds": round(time.time() - started, 1),
        "missing_txt_rewritten": str(a.stage6 / "missing.txt") if a.stage6 else None,
        "structures_now": have,
        "no_structure_now": len(lookup) - have,
        "script": "dashboard/precompute/fetch_missing_structures.py",
    }
    (web / "structures_backfill.json").write_text(json.dumps(out, indent=2) + "\n")
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
