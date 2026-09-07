#!/usr/bin/env python
"""Stage 5. What each protein is, and where its Swiss-Prot annotations sit.

The track store says where a latent fires. This stage supplies what it fires *on*: the
sequence, the protein's name, and the residue ranges Swiss-Prot annotates, so the dashboard can
draw the ground truth under a latent's activation and let the reader judge the pairing.

It also builds the reverse index the concept page needs. Asking "show me another protein that
carries this domain" means going from a concept to its proteins, which no other stage answers.

## Two decisions worth knowing

**The `amino_acid_*` columns are excluded.** The annotation matrix has 701 columns and 21 of
them are residue identity, `amino_acid_A` through `amino_acid_Other`. Keeping them would be
expensive and pointless: alanine occurs in almost every protein at scattered positions, so the
run-length encoding degenerates and the index would list every protein for every residue type.
The sequence already carries that information, and the dashboard can derive it for free.

**Protein order is taken from the activation store, not from the annotation files.** Stages 1
and 2 index proteins by their position in the store, so this stage must agree or every global
index is wrong. The script asserts the two orders match rather than assuming it; they do, on
every shard checked so far, but a silent disagreement here would be very hard to find later.

Reads
-----
<acts_dir>/shard_*/meta.json                  the canonical protein order and boundaries
<ann_dir>/shard_*/aa_concepts.npz             per-residue concept labels, CSR
<ann_dir>/shard_*/aa_metadata.csv             residue to protein, used only to verify the order
<ann_dir>/shard_*/protein_data.tsv            name, length, sequence, AlphaFold cross-reference
<ann_dir>/uniprotkb_aa_concepts_columns.txt   one concept name per column

Writes
------
<out>/proteins/shard_<i>.json   per protein: name, length, sequence, concept ranges
<out>/concept_offsets.npy       int64  [n_concepts + 1]
<out>/concept_protein.npy       uint32 [n_pairs]   which proteins carry each concept
<out>/concepts.txt              the concept names this index is aligned to
<out>/protein_ids.json          accession per global index, same order as stage 1
<out>/manifest.json

Repro
-----
uv run python build_protein_bundles.py --acts-dir <store> --ann-dir <annotations> --out <dir>
Add --shards 104 to smoke test. Deterministic, no randomness, no seed.
"""

import argparse
import json
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import scipy.sparse as sp

AA_PREFIX = "amino_acid_"


def shard_indices(acts_dir):
    out = []
    for d in Path(acts_dir).glob("shard_*"):
        if (d / "meta.json").exists():
            out.append(int(d.name.split("_")[1]))
    return sorted(out)


def runs_from_positions(pos):
    """[3,4,5,9,10] -> [[3,5],[9,10]]. Positions are 0-based and sorted."""
    out, start, prev = [], pos[0], pos[0]
    for p in pos[1:]:
        if p != prev + 1:
            out.append([int(start), int(prev)])
            start = p
        prev = p
    out.append([int(start), int(prev)])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--acts-dir", type=Path, required=True)
    ap.add_argument("--ann-dir", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--shards", type=int, nargs="*", default=None)
    a = ap.parse_args()
    (a.out / "proteins").mkdir(parents=True, exist_ok=True)

    names = (a.ann_dir / "uniprotkb_aa_concepts_columns.txt").read_text().split("\n")
    names = [n for n in names if n.strip()]
    keep = np.array([not n.startswith(AA_PREFIX) for n in names])
    kept_names = [n for n, k in zip(names, keep) if k]
    col_to_kept = np.full(len(names), -1, dtype=np.int32)
    col_to_kept[np.flatnonzero(keep)] = np.arange(len(kept_names))
    print(f"{len(names)} concept columns, {len(kept_names)} kept, "
          f"{len(names) - len(kept_names)} dropped as {AA_PREFIX}*")

    shards = a.shards if a.shards else shard_indices(a.acts_dir)
    protein_ids, pairs_c, pairs_p = [], [], []
    n_runs = total_bytes = 0

    for n, s in enumerate(shards):
        meta = json.load(open(a.acts_dir / f"shard_{s}" / "meta.json"))
        ids, bnd = meta["protein_ids"], meta["boundaries"]
        base = len(protein_ids)

        ann_shard = a.ann_dir / f"shard_{s}"
        ann = sp.load_npz(ann_shard / "aa_concepts.npz").tocoo()
        info = pd.read_csv(ann_shard / "protein_data.tsv", sep="\t").set_index("Entry")

        # The orders must agree, or every global protein index is wrong.
        am = pd.read_csv(ann_shard / "aa_metadata.csv", usecols=["Entry"])
        if am.Entry.drop_duplicates().tolist() != ids:
            raise SystemExit(f"shard {s}: annotation order differs from the activation store")
        if ann.shape[0] != meta["n_residues"]:
            raise SystemExit(f"shard {s}: {ann.shape[0]} annotated residues against "
                             f"{meta['n_residues']} in the store")

        pidx = np.empty(meta["n_residues"], dtype=np.int64)
        offset = np.empty(meta["n_residues"], dtype=np.int64)
        for i, (lo, hi) in enumerate(bnd):
            pidx[lo:hi] = i
            offset[lo:hi] = lo

        m = keep[ann.col]
        prot = pidx[ann.row[m]]
        conc = col_to_kept[ann.col[m]]
        resi = ann.row[m] - offset[ann.row[m]]          # position within the protein
        order = np.lexsort((resi, conc, prot))
        prot, conc, resi = prot[order], conc[order], resi[order]
        starts = np.flatnonzero(np.r_[True, (prot[1:] != prot[:-1]) | (conc[1:] != conc[:-1])])
        ends = np.r_[starts[1:], len(prot)]

        per_protein = {pid: {} for pid in ids}
        for st, en in zip(starts, ends):
            p, c = int(prot[st]), int(conc[st])
            r = runs_from_positions(resi[st:en])
            per_protein[ids[p]][str(c)] = r
            n_runs += len(r)
            pairs_c.append(c)
            pairs_p.append(base + p)

        out = {"shard": s, "proteins": {}}
        for pid, (lo, hi) in zip(ids, bnd):
            row = info.loc[pid] if pid in info.index else None
            seq = str(row["Sequence"]) if row is not None else ""
            if len(seq) != hi - lo:
                raise SystemExit(f"shard {s}: {pid} sequence is {len(seq)} against {hi - lo}")
            out["proteins"][pid] = {
                "n": (str(row["Protein names"])[:120] if row is not None else pid),
                "l": hi - lo,
                "s": seq,
                "c": per_protein[pid],
                "af": bool(row is not None and pd.notna(row.get("AlphaFoldDB"))),
            }
        blob = json.dumps(out, separators=(",", ":"))
        (a.out / "proteins" / f"shard_{s}.json").write_text(blob)
        total_bytes += len(blob)
        protein_ids.extend(ids)

        if n % 20 == 0 or n == len(shards) - 1:
            print(f"  shard {s:>3} ({n + 1}/{len(shards)})  {len(protein_ids):>7,} proteins  "
                  f"{total_bytes / 1e6:>7.1f} MB")

    # Reverse index: concept -> the proteins carrying it.
    conc = np.asarray(pairs_c, dtype=np.int64)
    prot = np.asarray(pairs_p, dtype=np.uint32)
    order = np.lexsort((prot, conc))
    conc, prot = conc[order], prot[order]
    counts = np.bincount(conc, minlength=len(kept_names))
    offsets = np.zeros(len(kept_names) + 1, dtype=np.int64)
    np.cumsum(counts, out=offsets[1:])
    np.save(a.out / "concept_offsets.npy", offsets)
    np.save(a.out / "concept_protein.npy", prot)
    (a.out / "concepts.txt").write_text("\n".join(kept_names))
    (a.out / "protein_ids.json").write_text(json.dumps(protein_ids))

    manifest = {
        "stage": "5-protein-bundles",
        "built": date.today().isoformat(),
        "acts_dir": str(a.acts_dir), "ann_dir": str(a.ann_dir),
        "shards": len(shards), "partial": a.shards is not None,
        "n_proteins": len(protein_ids),
        "n_concept_columns": len(names),
        "n_concepts_kept": len(kept_names),
        "dropped_prefix": AA_PREFIX,
        "n_concept_protein_pairs": int(len(prot)),
        "n_annotation_runs": int(n_runs),
        "bundle_bytes": int(total_bytes),
    }
    (a.out / "manifest.json").write_text(json.dumps(manifest, indent=2))

    nz = counts[counts > 0]
    print(f"\nwrote {a.out}/")
    print(f"  bundles: {total_bytes / 1e6:.1f} MB over {len(shards)} shards")
    print(f"  {len(prot):,} concept-protein pairs, {n_runs:,} annotation runs")
    print(f"  concepts present: {len(nz)} of {len(kept_names)}; "
          f"proteins per concept median {int(np.median(nz)) if len(nz) else 0}, "
          f"max {int(nz.max()) if len(nz) else 0}")


if __name__ == "__main__":
    main()
