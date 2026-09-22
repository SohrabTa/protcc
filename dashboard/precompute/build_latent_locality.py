#!/usr/bin/env python
"""Stage 8. Does a latent read a stretch of the chain, or a site in the fold?

The letter row and the structure view each answer half of this question. A latent that fires on
residues 40 to 60 reads a stretch, and the letter row shows it. A latent that fires on residues
12, 88 and 140 looks like scatter on the letter row, and can still be reading one pocket, because
the chain folds and brings those residues together.

The dashboard measured this in the browser, one latent at a time, over the proteins the reader
waited for. That answers the question for one latent and cannot place it against the others. This
stage measures every live latent once, so the site can draw all of them at once and mark the one
on screen.

## The two numbers

For one latent on one protein, take every pair of residues it fires on above 0.3 of its own
maximum.

    sequence spread = the median of |i - j| over those pairs
    spatial spread  = the median distance between their alpha carbons

Neither means anything alone, because a 90-residue protein puts everything near everything. Each
is divided by the same median over pairs drawn from the whole protein. Both are then 1 when the
firing residues are spread like the protein itself, and below 1 when they are closer.

Per latent, the reported value is the median of each ratio over the proteins measured.

    sequence below 0.7                    reads one stretch of the chain
    sequence 0.7 or more, spatial < 0.7   reads one site in the fold
    both 0.7 or more                      reads no single place

The middle case is the one no other view can show. Latent 1531, paired with
`Motif_Histidine box-3`, sits there: histidine boxes coordinate a di-iron centre, so they are far
apart in sequence and together in space.

## Which proteins

The strongest proteins in the latent's own ranking that have both a track and a structure. That
is a biased sample by construction, and the site says so. A random sample of everything the
latent touches would mostly be proteins where it fires too weakly to clear the cut at all.

Reads
-----
<web>/features.json            the live latents
<web>/feature/<id>.bin         PCR1, the ranked proteins of each latent
<web>/protein_lookup.json      accession -> [protein index, shard]
<web>/tracks/<XX>/<acc>.bin    PCT1, the per-residue activations
<web>/structures/<XX>/<acc>.cif.gz   the AlphaFold backbone

Writes
------
<web>/latent_locality.bin      PCL1, two float32 arrays and one count, indexed by latent id
<web>/latent_locality.json     the manifest for this stage

The layout, little-endian:

    latent_locality.bin  "PCL1"  uint32 magic, uint32 n_latents, uint32 threshold, uint32 reserved,
                                 float32 seq[n_latents], float32 space[n_latents],
                                 uint16 measured[n_latents]

A latent with no measurement stores NaN in both arrays and 0 in `measured`.

Repro
-----
uv run --with numpy python build_latent_locality.py --web ../data/web --proteins 20
Deterministic: the baseline pairs come from a fixed seed, logged in the manifest.
"""

from __future__ import annotations

import argparse
import gzip
import json
import struct
import time
from pathlib import Path

import numpy as np

MAGIC_RANK = 0x50435231  # PCR1
MAGIC_TRACK = 0x50435431  # PCT1
MAGIC_LOCALITY = 0x5043_4C31  # PCL1

THRESHOLD = 76  # 0.3 of a latent's own maximum, the cut every other view uses
MIN_FIRING = 6
MIN_PAIRS = 10
BASE_PAIRS = 4000
SEED = 0x9E3779B9


def read_ranking(path: Path) -> tuple[np.ndarray, np.ndarray]:
    raw = path.read_bytes()
    magic, n = struct.unpack_from("<II", raw, 0)
    if magic != MAGIC_RANK:
        raise SystemExit(f"{path}: expected magic {MAGIC_RANK:#x}, read {magic:#x}")
    return (
        np.frombuffer(raw, dtype="<u4", count=n, offset=8),
        np.frombuffer(raw, dtype=np.uint8, count=n, offset=8 + 4 * n),
    )


def read_track(path: Path) -> tuple[int, np.ndarray, np.ndarray, np.ndarray]:
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


def read_backbone(path: Path) -> tuple[np.ndarray, np.ndarray] | None:
    """label_seq_id and coordinates of each alpha carbon, from stage 6's rows."""
    if not path.exists():
        return None
    resi: list[int] = []
    xyz: list[tuple[float, float, float]] = []
    with gzip.open(path, "rt") as fh:
        for line in fh:
            if not line.startswith("ATOM "):
                continue
            f = line.split()
            if len(f) < 11 or f[3] != "CA":
                continue
            resi.append(int(f[6]))
            xyz.append((float(f[7]), float(f[8]), float(f[9])))
    if len(resi) < 12:
        return None
    return np.asarray(resi, dtype=np.int32), np.asarray(xyz, dtype=np.float32)


class Cache:
    """A small store of parsed structures and baselines, keyed by accession."""

    def __init__(self, limit: int) -> None:
        self.limit = limit
        self.store: dict[str, object] = {}

    def get(self, key: str, make):
        hit = self.store.get(key)
        if hit is not None:
            return hit if hit != "miss" else None
        value = make()
        if len(self.store) >= self.limit:
            self.store.clear()
        self.store[key] = value if value is not None else "miss"
        return value


def protein_baseline(resi: np.ndarray, xyz: np.ndarray) -> tuple[float, float] | None:
    """The same two medians over pairs drawn from the whole protein."""
    n = len(resi)
    rng = np.random.default_rng(SEED)
    a = rng.integers(0, n, BASE_PAIRS)
    b = rng.integers(0, n, BASE_PAIRS)
    keep = a != b
    a, b = a[keep], b[keep]
    if len(a) < 50:
        return None
    seq = float(np.median(np.abs(resi[a].astype(np.int64) - resi[b].astype(np.int64))))
    space = float(np.median(np.linalg.norm(xyz[a] - xyz[b], axis=1)))
    if seq <= 0 or space <= 0:
        return None
    return seq, space


def ratios(
    resi: np.ndarray, xyz: np.ndarray, base: tuple[float, float], firing: np.ndarray
) -> tuple[float, float] | None:
    """Both ratios for one latent on one protein, or None when too few residues fire."""
    idx = np.flatnonzero(firing[np.clip(resi - 1, 0, len(firing) - 1)] & (resi - 1 < len(firing)))
    if len(idx) < MIN_FIRING:
        return None
    r = resi[idx].astype(np.int64)
    p = xyz[idx]
    iu = np.triu_indices(len(idx), 1)
    if len(iu[0]) < MIN_PAIRS:
        return None
    seq = float(np.median(np.abs(r[iu[0]] - r[iu[1]])))
    space = float(np.median(np.linalg.norm(p[iu[0]] - p[iu[1]], axis=1)))
    return seq / base[0], space / base[1]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--web", type=Path, required=True)
    ap.add_argument("--proteins", type=int, default=20, help="proteins measured per latent")
    ap.add_argument("--scan", type=int, default=120, help="how far down a ranking to look")
    ap.add_argument("--paired-only", action="store_true", help="skip latents with no concept")
    ap.add_argument("--limit", type=int, default=0, help="stop after this many latents, to test")
    a = ap.parse_args()
    web: Path = a.web

    features = json.loads((web / "features.json").read_text())
    lookup = json.loads((web / "protein_lookup.json").read_text())
    protein_ids: list[str] = [""] * len(lookup)
    shard_of: dict[str, int] = {}
    for acc, (idx, shard) in lookup.items():
        protein_ids[idx] = acc
        shard_of[acc] = shard

    n_latents = max(f["f"] for f in features) + 1
    out_seq = np.full(n_latents, np.nan, dtype=np.float32)
    out_space = np.full(n_latents, np.nan, dtype=np.float32)
    out_n = np.zeros(n_latents, dtype=np.uint16)

    todo = [f for f in features if not a.paired_only or f.get("c")]
    if a.limit:
        todo = todo[: a.limit]

    structures = Cache(3000)
    started = time.time()
    n_done = 0
    for f in todo:
        fid = int(f["f"])
        try:
            prot, _val = read_ranking(web / "feature" / f"{fid}.bin")
        except (FileNotFoundError, SystemExit):
            continue

        seqs: list[float] = []
        spaces: list[float] = []
        for k in range(min(a.scan, len(prot))):
            if len(seqs) >= a.proteins:
                break
            acc = protein_ids[int(prot[k])]
            if shard_of.get(acc, -1) < 0:
                continue
            bb = structures.get(
                acc, lambda acc=acc: read_backbone(
                    web / "structures" / acc[:2].upper() / f"{acc}.cif.gz"
                )
            )
            if bb is None:
                continue
            resi, xyz = bb  # type: ignore[misc]
            base = protein_baseline(resi, xyz)
            if base is None:
                continue
            try:
                length, indptr, latent, value = read_track(
                    web / "tracks" / acc[:2].upper() / f"{acc}.bin"
                )
            except FileNotFoundError:
                continue
            sel = (latent == fid) & (value > THRESHOLD)
            if not sel.any():
                continue
            rid = np.repeat(np.arange(length), np.diff(indptr.astype(np.int64)))
            firing = np.zeros(length, dtype=bool)
            firing[rid[sel]] = True
            r = ratios(resi, xyz, base, firing)
            if r is None:
                continue
            seqs.append(r[0])
            spaces.append(r[1])

        if seqs:
            out_seq[fid] = float(np.median(seqs))
            out_space[fid] = float(np.median(spaces))
            out_n[fid] = len(seqs)

        n_done += 1
        if n_done % 200 == 0:
            rate = n_done / (time.time() - started)
            left = (len(todo) - n_done) / max(rate, 1e-6)
            print(f"  {n_done:,} of {len(todo):,} latents, {rate:.1f}/s, {left/60:.1f} min left",
                  flush=True)

    header = struct.pack("<IIII", MAGIC_LOCALITY, n_latents, THRESHOLD, 0)
    (web / "latent_locality.bin").write_bytes(
        header + out_seq.tobytes() + out_space.tobytes() + out_n.tobytes()
    )

    measured = out_n > 0
    # float64, because the browser reads these bytes into a Float32Array and compares the widened
    # double against 0.7. NumPy casts the scalar down to float32 instead, and latent 1513 sits at
    # exactly float32(0.7), so the two rules put it on different sides and the counts differ by 1.
    seq64 = out_seq.astype(np.float64)
    space64 = out_space.astype(np.float64)
    stretch = int((measured & (seq64 < 0.7)).sum())
    pocket = int((measured & (seq64 >= 0.7) & (space64 < 0.7)).sum())
    manifest = {
        "stage": "8-latent-locality",
        "built": time.strftime("%Y-%m-%d"),
        "latents": int(n_latents),
        "latents_measured": int(measured.sum()),
        "proteins_per_latent": a.proteins,
        "scan_depth": a.scan,
        "paired_only": bool(a.paired_only),
        "threshold": THRESHOLD,
        "seed": SEED,
        "reads_one_stretch": stretch,
        "reads_one_site_in_the_fold": pocket,
        "reads_no_single_place": int(measured.sum()) - stretch - pocket,
        "seconds": round(time.time() - started, 1),
        "script": "dashboard/precompute/build_latent_locality.py",
    }
    (web / "latent_locality.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
