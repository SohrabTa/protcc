#!/usr/bin/env python
"""Stage 1. For every latent, every protein it fires on, ranked.

## Why this exists

The activation store already holds everything: 2,068,021,126 non-zero values over 62,655,684
residues. What it does not hold is an answer to "which proteins does latent 1819 fire on
hardest", because answering that means sorting 207,463 proteins, and the browser cannot read
8.8 GB to do it. This stage is that sort, done once.

It is an index into the data, not a sample of it. InterPLM's `collect_feature_activations.py`
solves the same problem by keeping the top ten proteins per latent plus ten sampled from each
of five activation bands. We keep all of them instead: the top ten is the head of this list,
and any band is a slice of it. Measured on shard 104 and scaled, the complete version costs
about 156 million latent-protein pairs, which is 625 MB at 4 bytes each. Sampling saves
little and costs the protein chooser.

## What a row means

One row is one (latent, protein) pair where the latent fires at all, carrying two numbers:

  value  the largest activation the latent reaches on that protein, as a share of the largest
         it reaches anywhere in the evaluation set, so 255 marks the single strongest protein
  cover  the share of that protein's residues the latent is active on, at --threshold

Rows are grouped by latent and sorted within a latent by value, descending, so the dashboard
reads the head of a run and stops.

## Scale

Activations in the store are raw. Dividing by `feature_stats/max.npy` puts them on the same
[0, 1] display scale the evaluation used. Reading the raw scale by mistake is the bug that
cost a third of the F1 in August, so the divisor is required, not optional, and the manifest
records which file it came from.

Reads
-----
<acts_dir>/shard_*/{acts.npz, meta.json}   the sparse activation store
<feature_max>                              feature_stats/max.npy, the per-latent divisor

Writes
------
<out>/rank_offsets.npy   int64  [n_latents + 1]   start of each latent's run
<out>/rank_protein.npy   uint32 [n_pairs]         global protein index
<out>/rank_value.npy     uint8  [n_pairs]         peak activation on that protein
<out>/rank_cover.npy     uint8  [n_pairs]         share of the protein it covers
<out>/protein_ids.json          [n_proteins]      accession per global index
<out>/feature_stats.csv                           the per-latent aggregates
<out>/manifest.json

Repro
-----
uv run python build_feature_ranking.py --acts-dir <store> --feature-max <max.npy> --out <dir>
Add --shards 104 to smoke test one shard. Deterministic. No randomness, no seed.
"""

import argparse
import json
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import scipy.sparse as sp


def shard_indices(acts_dir):
    out = []
    for d in Path(acts_dir).glob("shard_*"):
        if (d / "acts.npz").exists() and (d / "meta.json").exists():
            out.append(int(d.name.split("_")[1]))
    return sorted(out)


def group_max_and_count(key, value, above):
    """Per unique key: the largest value, and how many entries clear the threshold.

    `key` is sorted in place by the caller's argsort. Grouping by sort plus reduceat
    beats np.maximum.at by a wide margin at 10 million entries per shard.
    """
    order = np.argsort(key, kind="stable")
    k, v, a = key[order], value[order], above[order]
    starts = np.flatnonzero(np.r_[True, k[1:] != k[:-1]])
    return k[starts], np.maximum.reduceat(v, starts), np.add.reduceat(a, starts)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--acts-dir", type=Path, required=True)
    ap.add_argument("--feature-max", type=Path, required=True,
                    help="feature_stats/max.npy from the normalize stage")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--threshold", type=float, default=0.05,
                    help="a residue counts as covered above this share of the latent maximum; "
                         "0.05 is the InterPLM collect default")
    ap.add_argument("--shards", type=int, nargs="*", default=None,
                    help="run a subset, for a smoke test")
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)

    feat_max = np.load(a.feature_max)
    n_lat = len(feat_max)
    divisor = np.maximum(feat_max, 1e-9)
    shards = a.shards if a.shards else shard_indices(a.acts_dir)
    print(f"{n_lat} latents, {int((feat_max > 0).sum())} alive, {len(shards)} shards")

    protein_ids, protein_len = [], []
    parts_f, parts_p, parts_v, parts_c = [], [], [], []
    total_nnz = total_res = 0

    for n, s in enumerate(shards):
        d = a.acts_dir / f"shard_{s}"
        acts = sp.load_npz(d / "acts.npz").tocoo()
        meta = json.load(open(d / "meta.json"))
        bnd = meta["boundaries"]
        base = len(protein_ids)                       # global index of this shard's first protein
        protein_ids.extend(meta["protein_ids"])
        protein_len.extend(b - x for x, b in bnd)

        pidx = np.empty(meta["n_residues"], dtype=np.int64)
        for i, (x, b) in enumerate(bnd):
            pidx[x:b] = base + i

        val = acts.data / divisor[acts.col]
        key = pidx[acts.row] * n_lat + acts.col
        k, vmax, ncov = group_max_and_count(key, val, (val > a.threshold).astype(np.int32))

        parts_f.append((k % n_lat).astype(np.uint16))
        parts_p.append((k // n_lat).astype(np.uint32))
        parts_v.append(np.clip(np.rint(vmax * 255), 0, 255).astype(np.uint8))
        lens = np.asarray(protein_len, dtype=np.float64)[(k // n_lat)]
        parts_c.append(np.clip(np.rint(ncov / lens * 255), 0, 255).astype(np.uint8))

        total_nnz += acts.nnz
        total_res += meta["n_residues"]
        if n % 20 == 0 or n == len(shards) - 1:
            pairs = sum(len(p) for p in parts_f)
            print(f"  shard {s:>3} ({n + 1}/{len(shards)})  "
                  f"{len(protein_ids):>7,} proteins  {pairs:>12,} pairs")

    feature = np.concatenate(parts_f)
    protein = np.concatenate(parts_p)
    value = np.concatenate(parts_v)
    cover = np.concatenate(parts_c)
    del parts_f, parts_p, parts_v, parts_c

    # Group by latent, and within a latent put the strongest protein first.
    order = np.lexsort((-value.astype(np.int16), feature))
    feature, protein, value, cover = (x[order] for x in (feature, protein, value, cover))
    counts = np.bincount(feature, minlength=n_lat)
    offsets = np.zeros(n_lat + 1, dtype=np.int64)
    np.cumsum(counts, out=offsets[1:])

    np.save(a.out / "rank_offsets.npy", offsets)
    np.save(a.out / "rank_protein.npy", protein)
    np.save(a.out / "rank_value.npy", value)
    np.save(a.out / "rank_cover.npy", cover)
    (a.out / "protein_ids.json").write_text(json.dumps(protein_ids))

    n_prot = len(protein_ids)
    stats = pd.DataFrame({
        "feature": np.arange(n_lat),
        "n_proteins": counts,
        "pct_proteins": counts / n_prot * 100,
        "mean_pct_within_protein": [
            (cover[offsets[i]:offsets[i + 1]].mean() / 255 * 100) if counts[i] else 0.0
            for i in range(n_lat)],
        "max_activation": feat_max,
        "alive": feat_max > 0,
    })
    stats.to_csv(a.out / "feature_stats.csv", index=False)

    manifest = {
        "stage": "1-feature-ranking",
        "built": date.today().isoformat(),
        "acts_dir": str(a.acts_dir),
        "feature_max": str(a.feature_max),
        "threshold": a.threshold,
        "shards": len(shards),
        "partial": a.shards is not None,
        "n_latents": int(n_lat),
        "n_proteins": int(n_prot),
        "n_residues": int(total_res),
        "n_nonzero": int(total_nnz),
        "n_pairs": int(len(feature)),
        "bytes_on_disk": int(offsets.nbytes + protein.nbytes + value.nbytes + cover.nbytes),
    }
    (a.out / "manifest.json").write_text(json.dumps(manifest, indent=2))

    alive = stats[stats.alive]
    print(f"\nwrote {a.out}/")
    print(f"  {len(feature):,} latent-protein pairs, "
          f"{manifest['bytes_on_disk'] / 1e6:.0f} MB")
    print(f"  proteins per live latent: median {alive.n_proteins.median():.0f}, "
          f"p90 {alive.n_proteins.quantile(0.9):.0f}, max {alive.n_proteins.max():,}")
    print(f"  latents that fire on nothing: {int((counts == 0).sum())}")


if __name__ == "__main__":
    main()
