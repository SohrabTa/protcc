#!/usr/bin/env python
"""Stage 7. How much of each annotated region the concept's latents actually cover.

The concept page lets a reader step through the proteins that carry a concept. There are up to
38,966 of them, so a stepper alone is not a way to choose. To choose, the reader needs a number
per protein, and the number they want is the one the page already prints at the bottom for the
protein on screen: the share of the annotated residues that the concept's latents fire on.

That number cannot be computed in the browser for every carrier, because it needs the full
per-residue track of each protein, which is one fetch and one decode of about 31 kB each. This
stage computes it once for all 627,067 concept-protein pairs and stores one byte per pair.

## What a byte means

`round(255 * covered / total)`, where `total` is the number of residues the concept's Swiss-Prot
annotation covers on that protein, and `covered` is how many of those residues at least one of
the concept's paired latents fires on at more than 0.3 of that latent's own maximum.

0.3 is the same cut the dashboard uses everywhere else (`locality.ts`, `structure.ts`,
`concept.ts`), so the stored number and the number the page computes live agree.

A pair whose annotation covers no residue stores 0 and is counted in the manifest. It is a real
case: a concept column can exist on a protein with an empty range list.

## Why the loop is over proteins and not over pairs

A protein carries a median of 2 concepts, so a loop over the 627,067 pairs would decode the same
track several times. The loop is inverted: every pair is bucketed by protein first, each track is
read exactly once, and the results are written back into the pair positions. The pairs also come
grouped by shard, so each of the 208 protein bundles is parsed once.

Reads
-----
<web>/concepts.json            the paired latents and the `po` slice of each concept
<web>/concept_proteins.bin     PCC1, the carriers of every concept, in pair order
<web>/concept_columns.json     which annotation column each concept occupies in a bundle
<web>/protein_lookup.json      accession -> [protein index, shard]
<web>/proteins/shard_*.json    the annotation ranges
<web>/tracks/<XX>/<acc>.bin    PCT1, the per-residue activations

Writes
------
<web>/concept_coverage.bin     PCV1, one uint8 per concept-protein pair, in pair order
<web>/concept_coverage.json    the manifest for this stage

The layout, little-endian, matching the other four formats:

    concept_coverage.bin  "PCV1"  uint32 magic, uint32 n_pairs, uint32 threshold, uint32 n_arrays,
                                  uint8 coverage[n_pairs], uint8 n_firing[n_pairs]

`coverage` is the share of the annotated residues the concept's latents read, 0 to 255.
`n_firing` is how many of the concept's latents fire on that protein at all, capped at 255. A
reader filters the carriers with it: a protein that only one of nine latents touches is a
different case from one that all nine touch. `n_arrays` says how many arrays follow, so a reader
of an older file sees 1 and stops after `coverage`.

`n_pairs` and the order are those of `concept_proteins.bin`, so a concept's slice is the same
`po` range. A pair belonging to a concept that no latent pairs with stays 0 and must not be read:
the browser knows those from `concepts.json`, where `feats` is absent.

Repro
-----
uv run --with numpy python build_concept_coverage.py --web ../data/web
"""

from __future__ import annotations

import argparse
import json
import struct
import time
from pathlib import Path

import numpy as np

MAGIC_CONCEPT = 0x50434331  # PCC1
MAGIC_TRACK = 0x50435431  # PCT1
MAGIC_COVER = 0x50435631  # PCV1

THRESHOLD = 76  # 0.3 of a latent's own maximum, the cut every other view uses
N_LATENTS = 8192


def read_concept_proteins(path: Path) -> np.ndarray:
    """The protein index of every concept-protein pair, in the order the pairs are stored."""
    raw = path.read_bytes()
    magic, n_concepts, n_pairs, _ = struct.unpack_from("<IIII", raw, 0)
    if magic != MAGIC_CONCEPT:
        raise SystemExit(f"{path}: expected magic {MAGIC_CONCEPT:#x}, read {magic:#x}")
    offset = 16 + 4 * (n_concepts + 1)
    return np.frombuffer(raw, dtype="<u4", count=n_pairs, offset=offset)


def read_track(path: Path) -> tuple[int, np.ndarray, np.ndarray, np.ndarray]:
    """One protein's activations: the length, the row pointers, the latents and the values."""
    raw = path.read_bytes()
    magic, length, nnz, _ = struct.unpack_from("<IIII", raw, 0)
    if magic != MAGIC_TRACK:
        raise SystemExit(f"{path}: expected magic {MAGIC_TRACK:#x}, read {magic:#x}")
    o = 16
    indptr = np.frombuffer(raw, dtype="<u4", count=length + 1, offset=o)
    o += 4 * (length + 1)
    latent = np.frombuffer(raw, dtype="<u2", count=nnz, offset=o)
    o += 2 * nnz
    value = np.frombuffer(raw, dtype=np.uint8, count=nnz, offset=o)
    return length, indptr, latent, value


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--web", type=Path, required=True, help="the built web data tree")
    ap.add_argument("--limit", type=int, default=0, help="stop after this many proteins, to test")
    a = ap.parse_args()
    web: Path = a.web

    concepts = json.loads((web / "concepts.json").read_text())
    columns = json.loads((web / "concept_columns.json").read_text())
    lookup = json.loads((web / "protein_lookup.json").read_text())
    pair_protein = read_concept_proteins(web / "concept_proteins.bin")
    n_pairs = len(pair_protein)

    protein_ids: list[str] = [""] * len(lookup)
    shard_of: dict[str, int] = {}
    for acc, (idx, shard) in lookup.items():
        protein_ids[idx] = acc
        shard_of[acc] = shard

    column_of = {name: i for i, name in enumerate(columns)}

    # Every pair, bucketed by the protein it belongs to. A pair carries the position it must be
    # written back to, so the output stays in the order `concept_proteins.bin` defines.
    by_protein: dict[int, list[tuple[int, int]]] = {}
    latents_of: dict[int, np.ndarray] = {}
    column_index: dict[int, int] = {}
    skipped_no_column = 0
    for ci, c in enumerate(concepts):
        span = c.get("po")
        feats = c.get("feats") or []
        if not span or not feats:
            continue
        col = column_of.get(c["c"])
        if col is None:
            skipped_no_column += 1
            continue
        column_index[ci] = col
        latents_of[ci] = np.array([f[0] for f in feats], dtype=np.int64)
        lo, hi = span
        for pos in range(lo, hi):
            by_protein.setdefault(int(pair_protein[pos]), []).append((ci, pos))

    out = np.zeros(n_pairs, dtype=np.uint8)
    firing = np.zeros(n_pairs, dtype=np.uint8)
    done = np.zeros(n_pairs, dtype=bool)

    # A membership table rather than `np.isin`. The latent ids are small and dense, so one fancy
    # index over a boolean table of 8192 entries replaces a sort per concept per protein.
    lut = np.zeros(N_LATENTS, dtype=bool)

    order = sorted(by_protein.keys(), key=lambda p: (shard_of.get(protein_ids[p], -1), p))
    if a.limit:
        order = order[: a.limit]

    bundle_shard = -1
    bundle: dict[str, dict] = {}
    n_empty = 0
    n_missing_track = 0
    n_missing_bundle = 0
    started = time.time()

    for n_done, pidx in enumerate(order):
        acc = protein_ids[pidx]
        shard = shard_of.get(acc, -1)
        if shard < 0:
            n_missing_bundle += len(by_protein[pidx])
            continue
        if shard != bundle_shard:
            bundle = json.loads((web / "proteins" / f"shard_{shard}.json").read_text())["proteins"]
            bundle_shard = shard
        info = bundle.get(acc)
        if info is None:
            n_missing_bundle += len(by_protein[pidx])
            continue

        track_path = web / "tracks" / acc[:2].upper() / f"{acc}.bin"
        if not track_path.exists():
            n_missing_track += len(by_protein[pidx])
            continue
        length, indptr, latent, value = read_track(track_path)

        # The residue each stored entry belongs to. One array per protein, reused by every
        # concept that protein carries.
        counts = np.diff(indptr.astype(np.int64))
        resid = np.repeat(np.arange(length, dtype=np.int64), counts)
        strong = value > THRESHOLD

        for ci, pos in by_protein[pidx]:
            ranges = info.get("c", {}).get(str(column_index[ci])) or []
            total = 0
            for lo, hi in ranges:
                lo = max(0, int(lo))
                hi = min(length - 1, int(hi))
                if hi >= lo:
                    total += hi - lo + 1
            if total == 0:
                n_empty += 1
                done[pos] = True
                ids = latents_of[ci]
                lut[ids] = True
                firing[pos] = min(255, int(np.unique(latent[lut[latent] & strong]).size))
                lut[ids] = False
                continue

            ids = latents_of[ci]
            lut[ids] = True
            sel = lut[latent] & strong
            lut[ids] = False

            # How many of the concept's own latents fire anywhere on this protein, above the
            # same cut. It is the filter the concept page needs: a carrier that one of nine
            # latents touches is a different case from one that all nine touch.
            firing[pos] = min(255, int(np.unique(latent[sel]).size))

            hit = np.zeros(length, dtype=bool)
            hit[resid[sel]] = True
            covered = 0
            for lo, hi in ranges:
                lo = max(0, int(lo))
                hi = min(length - 1, int(hi))
                if hi >= lo:
                    covered += int(hit[lo : hi + 1].sum())

            out[pos] = int(round(255.0 * covered / total))
            done[pos] = True

        if (n_done + 1) % 20000 == 0:
            rate = (n_done + 1) / (time.time() - started)
            print(f"  {n_done + 1:,} of {len(order):,} proteins, {rate:.0f}/s", flush=True)

    header = struct.pack("<IIII", MAGIC_COVER, n_pairs, THRESHOLD, 2)
    (web / "concept_coverage.bin").write_bytes(header + out.tobytes() + firing.tobytes())

    filled = int(done.sum())
    manifest = {
        "stage": "7-concept-coverage",
        "built": time.strftime("%Y-%m-%d"),
        "pairs": int(n_pairs),
        "pairs_computed": filled,
        "pairs_empty_annotation": int(n_empty),
        "pairs_no_track": int(n_missing_track),
        "pairs_no_bundle": int(n_missing_bundle),
        "concepts_without_column": int(skipped_no_column),
        "threshold": THRESHOLD,
        "arrays": ["coverage", "n_firing"],
        "max_latents_firing": int(firing.max()),
        "seconds": round(time.time() - started, 1),
        "script": "dashboard/precompute/build_concept_coverage.py",
    }
    (web / "concept_coverage.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))

    nz = out[done]
    if len(nz):
        qs = np.percentile(nz.astype(np.float64) / 255.0 * 100.0, [0, 25, 50, 75, 100])
        print("coverage percentiles (0, 25, 50, 75, 100): " + ", ".join(f"{q:.1f}%" for q in qs))


if __name__ == "__main__":
    main()
