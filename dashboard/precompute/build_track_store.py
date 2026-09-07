#!/usr/bin/env python
"""Stage 2. Every latent that fires on a protein, and where along it.

## What this is

The activation store is organised by shard and then by residue: 208 files, each a sparse
matrix of residues against latents. That shape suits the evaluation, which sweeps all latents
over all residues. It does not suit a dashboard, which asks about one protein at a time and
must not read 8.8 GB to answer.

This stage rewrites the same numbers one protein per file. Nothing is dropped and nothing is
sampled. A protein's residues all live in one shard, so each file is complete after its shard
is read, and the pass never holds more than one shard in memory.

## Why one file per protein

The alternative is a bundle per shard with byte-range requests, which is smaller on disk and
faster to copy. It also requires a web server that honours range requests, and the dashboard
has to work from a folder with no server at all. So: one file per protein, about 31 kB each,
nested two levels by accession so no directory holds more than a few hundred entries.

That costs about 207,000 files and roughly 6.5 GB. Two hundred thousand small files is the
workload a shared parallel filesystem handles worst, and it is slow to copy one by one, so
`--tar-per-shard` writes one uncompressed tar per shard instead. The tar holds the same
nested paths, so untarring the 208 archives over one directory reproduces the tree exactly.
Use it on the cluster; use loose files locally.

## The format

Little-endian throughout. A residue-major sparse row layout, the same shape the source has,
with the values quantised.

    uint32  magic        0x50435431, "PCT1"
    uint32  n_residues   L, the protein length
    uint32  n_nonzero    nnz
    uint32  reserved     0
    uint32  indptr[L+1]  where each residue's entries start
    uint16  latent[nnz]  latent index, 0 to 8191
    uint8   value[nnz]   activation, see below

`value` is the activation divided by that latent's maximum over the whole evaluation set,
scaled to 0 to 255. A stored value is never 0: anything that fired but rounds below 1/255 is
clamped to 1, so a weak activation stays distinguishable from an absent one.

To read latent f on this protein, walk the rows and keep entries where `latent == f`. A
300-residue protein holds about 9,900 entries, so the scan costs nothing.

Reads
-----
<acts_dir>/shard_*/{acts.npz, meta.json}
<feature_max>                              feature_stats/max.npy, the per-latent divisor

Writes
------
<out>/tracks/<first two characters>/<accession>.bin
<out>/shard_index.json    which accessions came from which shard
<out>/manifest.json

Repro
-----
uv run python build_track_store.py --acts-dir <store> --feature-max <max.npy> --out <dir>
Add --shards 104 to build one shard for local work. Deterministic, no randomness, no seed.
"""

import argparse
import io
import json
import struct
import tarfile
import time
from datetime import date
from pathlib import Path

import numpy as np
import scipy.sparse as sp

MAGIC = 0x50435431


def shard_indices(acts_dir):
    out = []
    for d in Path(acts_dir).glob("shard_*"):
        if (d / "acts.npz").exists() and (d / "meta.json").exists():
            out.append(int(d.name.split("_")[1]))
    return sorted(out)


def encode_protein(indptr, latent, value):
    return b"".join((
        struct.pack("<IIII", MAGIC, len(indptr) - 1, len(latent), 0),
        indptr.astype("<u4").tobytes(),
        latent.astype("<u2").tobytes(),
        value.astype("<u1").tobytes(),
    ))


def rel_path(pid):
    return f"tracks/{pid[:2].upper()}/{pid}.bin"


def add_to_tar(tar, pid, blob, mtime):
    info = tarfile.TarInfo(rel_path(pid))
    info.size = len(blob)
    info.mtime = mtime
    info.mode = 0o644
    tar.addfile(info, io.BytesIO(blob))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--acts-dir", type=Path, required=True)
    ap.add_argument("--feature-max", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--shards", type=int, nargs="*", default=None)
    ap.add_argument("--tar-per-shard", action="store_true",
                    help="write one uncompressed tar per shard instead of loose files; use "
                         "this on the cluster, where 207,000 small files are a problem")
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    if a.tar_per_shard:
        (a.out / "tars").mkdir(exist_ok=True)
    else:
        (a.out / "tracks").mkdir(exist_ok=True)

    feat_max = np.load(a.feature_max)
    divisor = np.maximum(feat_max, 1e-9)
    shards = a.shards if a.shards else shard_indices(a.acts_dir)
    print(f"{len(feat_max)} latents, {len(shards)} shards")

    shard_index, total_bytes, total_nnz, total_res, n_written = {}, 0, 0, 0, 0

    for n, s in enumerate(shards):
        d = a.acts_dir / f"shard_{s}"
        acts = sp.load_npz(d / "acts.npz").tocsr()
        meta = json.load(open(d / "meta.json"))
        ids, bnd = meta["protein_ids"], meta["boundaries"]

        # One scale conversion for the whole shard, then slice per protein. The CSR
        # column index is the latent, so the divisor is indexed by acts.indices.
        val = acts.data / divisor[acts.indices]
        q = np.clip(np.rint(val * 255), 1, 255).astype(np.uint8)

        tar = tarfile.open(a.out / "tars" / f"shard_{s}.tar", "w") if a.tar_per_shard else None
        mtime = int(time.time())
        for pid, (lo, hi) in zip(ids, bnd):
            start, end = acts.indptr[lo], acts.indptr[hi]
            indptr = acts.indptr[lo:hi + 1] - start
            blob = encode_protein(indptr, acts.indices[start:end], q[start:end])
            if tar is not None:
                add_to_tar(tar, pid, blob, mtime)
            else:
                p = a.out / rel_path(pid)
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(blob)
            total_bytes += len(blob)
            total_nnz += end - start
            n_written += 1
        if tar is not None:
            tar.close()

        shard_index[str(s)] = ids
        total_res += meta["n_residues"]
        if n % 20 == 0 or n == len(shards) - 1:
            print(f"  shard {s:>3} ({n + 1}/{len(shards)})  {n_written:>7,} proteins  "
                  f"{total_bytes / 1e9:>5.2f} GB")

    (a.out / "shard_index.json").write_text(json.dumps(shard_index))
    manifest = {
        "stage": "2-track-store",
        "built": date.today().isoformat(),
        "format": "PCT1",
        "layout": "tar-per-shard" if a.tar_per_shard else "files",
        "acts_dir": str(a.acts_dir),
        "feature_max": str(a.feature_max),
        "shards": len(shards),
        "partial": a.shards is not None,
        "n_proteins": n_written,
        "n_residues": int(total_res),
        "n_nonzero": int(total_nnz),
        "bytes": int(total_bytes),
    }
    (a.out / "manifest.json").write_text(json.dumps(manifest, indent=2))

    print(f"\nwrote {a.out}/{'tars' if a.tar_per_shard else 'tracks'}/")
    print(f"  {n_written:,} proteins, {total_nnz:,} non-zeros, {total_bytes / 1e9:.2f} GB")
    print(f"  mean {total_bytes / max(n_written, 1) / 1e3:.1f} kB per protein")


if __name__ == "__main__":
    main()
