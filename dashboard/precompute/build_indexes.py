#!/usr/bin/env python
"""Stage 4. The files the site actually loads.

Stages 0 to 3, 5 and 6 each produce one kind of fact. This stage joins them into the data
contract the browser reads, and it is the last thing that touches the numbers: after this the
site only renders.

## What the browser fetches, and when

    manifest.json          once     provenance and the headline figures
    concepts.json          once     all 408 concepts with their paired latents inline
    features.json          once     every live latent, enough to draw the feature map
    depth.bin              once     24 decoder norms and 24 cosines per latent
    concept_proteins.bin   once     which proteins carry each concept
    protein_lookup.json    once     accession to global index and shard, for the search box
    feature/<id>.bin       per view the proteins one latent fires on, ranked

Everything in the "once" column together is a few megabytes, so the site can hold it all in
memory. The per-latent files are the only thing fetched on demand, because the ranked protein
list runs to 207,463 rows for the most common latent and cannot be shipped inline.

## Binary layouts, little-endian

Three small formats. Each starts with a magic number so a truncated or mismatched file fails
loudly instead of rendering as noise.

    feature/<id>.bin   "PCR1"  uint32 magic, uint32 n,
                               uint32 protein[n], uint8 value[n], uint8 cover[n]
    depth.bin          "PCD1"  uint32 magic, uint32 n_latents, uint32 n_layers, uint32 reserved,
                               uint8 norm[n_latents * n_layers], uint8 cos[n_latents * n_layers]
    concept_proteins   "PCC1"  uint32 magic, uint32 n_concepts, uint32 n_pairs, uint32 reserved,
                               uint32 offsets[n_concepts + 1], uint32 protein[n_pairs]

`value` is the latent's peak on that protein as a share of its peak anywhere. `cover` is the
share of the protein's residues it is active on. `norm` is scaled to each latent's own peak, so
255 marks its peak layer. `cos` maps -1 to 1 onto 0 to 255, so 128 is orthogonal.

## Partial inputs

Running against one smoke-tested shard is expected while the cluster jobs queue. Every input
manifest carries a `partial` flag, and this stage propagates it: a manifest that says
`"partial": true` describes a data tree that must not be published.

Reads
-----
<stage0>/concept_categories.csv
<stage1>/{rank_*.npy, feature_stats.csv, protein_ids.json, manifest.json}
<stage3>/{depth_norms.npy, depth_cos.npy, depth_summary.csv}
<stage5>/{concept_offsets.npy, concept_protein.npy, concepts.txt}   optional
<pairings>/heldout_{top,all_top}_pairings.csv

Writes
------
<out>/ as listed above

Repro
-----
uv run python build_indexes.py --stage0 … --stage1 … --stage3 … --pairings … --out …
Deterministic, no randomness, no seed.
"""

import argparse
import json
import struct
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

MAGIC_RANK, MAGIC_DEPTH, MAGIC_CONCEPT = 0x50435231, 0x50434431, 0x50434331


def q255(a):
    return np.clip(np.rint(np.asarray(a, dtype=np.float64) * 255), 0, 255).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage0", type=Path, required=True, help="concept_categories.csv")
    ap.add_argument("--stage1", type=Path, required=True, help="the ranking directory")
    ap.add_argument("--stage3", type=Path, required=True, help="the depth directory")
    ap.add_argument("--stage5", type=Path, default=None, help="the protein bundle directory")
    ap.add_argument("--pairings", type=Path, required=True, help="the test_counts directory")
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()
    (a.out / "feature").mkdir(parents=True, exist_ok=True)

    cats = pd.read_csv(a.stage0).set_index("concept")
    best = pd.read_csv(a.pairings / "heldout_top_pairings.csv", index_col=0)
    allp = pd.read_csv(a.pairings / "heldout_all_top_pairings.csv")

    offsets = np.load(a.stage1 / "rank_offsets.npy")
    r_prot = np.load(a.stage1 / "rank_protein.npy")
    r_val = np.load(a.stage1 / "rank_value.npy")
    r_cov = np.load(a.stage1 / "rank_cover.npy")
    stats = pd.read_csv(a.stage1 / "feature_stats.csv")
    protein_ids = json.loads((a.stage1 / "protein_ids.json").read_text())
    m1 = json.loads((a.stage1 / "manifest.json").read_text())

    norms = np.load(a.stage3 / "depth_norms.npy")
    cos = np.load(a.stage3 / "depth_cos.npy")
    depth = pd.read_csv(a.stage3 / "depth_summary.csv")
    n_lat, n_layers = norms.shape
    partial = bool(m1.get("partial"))

    # ---- depth.bin -------------------------------------------------------
    # Quantising to a byte creates ties at the top. 334 of 8192 latents have two or
    # three layers that all round to 255, because their exact relative norms sit
    # within half a step of each other, and an argmax over the quantised curve then
    # reports whichever comes first. That is not wrong by much -- the largest exact
    # gap is 0.00196 -- but it puts the drawn maximum on a different layer from the
    # peak marker. So the true peak keeps 255 and every other layer is capped at
    # 254, which makes the file self-consistent at a cost of one step on a layer
    # that was within one step anyway.
    rel = norms / np.maximum(norms.max(axis=1, keepdims=True), 1e-12)
    qn = q255(rel)
    peak = norms.argmax(axis=1)
    tied = qn == 255
    tied[np.arange(n_lat), peak] = False
    qn[tied] = 254
    qn[np.arange(n_lat), peak] = 255
    assert (qn.argmax(axis=1) == peak).all(), "depth.bin peak disagrees with stage 3"
    with open(a.out / "depth.bin", "wb") as f:
        f.write(struct.pack("<IIII", MAGIC_DEPTH, n_lat, n_layers, 0))
        f.write(qn.tobytes())
        f.write(q255((cos + 1) / 2).tobytes())

    # ---- feature/<id>.bin ------------------------------------------------
    n_files = 0
    for fid in range(n_lat):
        lo, hi = int(offsets[fid]), int(offsets[fid + 1])
        if hi == lo:
            continue
        with open(a.out / "feature" / f"{fid}.bin", "wb") as f:
            f.write(struct.pack("<II", MAGIC_RANK, hi - lo))
            f.write(r_prot[lo:hi].astype("<u4").tobytes())
            f.write(r_val[lo:hi].tobytes())
            f.write(r_cov[lo:hi].tobytes())
        n_files += 1

    # ---- features.json ---------------------------------------------------
    best_pair = (allp.sort_values("f1_per_domain", ascending=False)
                 .drop_duplicates("feature").set_index("feature"))
    n_prot_per_feat = np.diff(offsets)
    feats = []
    for r in stats.itertuples():
        if not r.alive:
            continue
        fid = int(r.feature)
        row = {"f": fid, "pk": int(depth.peak_layer[fid]),
               "sp": int(depth.layers_at_half_peak[fid]),
               "pp": round(float(r.pct_proteins), 3),
               "pw": round(float(r.mean_pct_within_protein), 2),
               "np": int(n_prot_per_feat[fid])}
        if fid in best_pair.index:
            b = best_pair.loc[fid]
            row["c"] = b.concept
            row["f1"] = round(float(b.f1_per_domain), 4)
        feats.append(row)
    (a.out / "features.json").write_text(json.dumps(feats, separators=(",", ":")))

    # ---- concepts.json ---------------------------------------------------
    by_concept = {c: g.sort_values("f1_per_domain", ascending=False)
                  for c, g in allp.groupby("concept")}
    carriers = {}
    if a.stage5 and (a.stage5 / "concept_offsets.npy").exists():
        c_off = np.load(a.stage5 / "concept_offsets.npy")
        c_prot = np.load(a.stage5 / "concept_protein.npy")
        c_names = (a.stage5 / "concepts.txt").read_text().split("\n")
        with open(a.out / "concept_proteins.bin", "wb") as f:
            f.write(struct.pack("<IIII", MAGIC_CONCEPT, len(c_names), len(c_prot), 0))
            f.write(c_off.astype("<u4").tobytes())
            f.write(c_prot.astype("<u4").tobytes())
        carriers = {n: (int(c_off[i]), int(c_off[i + 1])) for i, n in enumerate(c_names)}
        # The protein bundles key their annotation ranges by position in this list, so the
        # site needs it to turn a concept name into the ranges a protein carries.
        (a.out / "concept_columns.json").write_text(json.dumps(c_names, separators=(",", ":")))

    concepts = []
    for r in best.itertuples():
        name = r.concept
        cat = cats.loc[name] if name in cats.index else None
        g = by_concept.get(name)
        row = {"c": name, "fld": name.split("_")[0],
               "fam": (cat.family if cat is not None else ""),
               "role": (cat.role if cat is not None else ""),
               "f1": round(float(r.f1_per_domain), 4),
               "nf": int(len(g)) if g is not None else 0}
        if g is not None and len(g):
            row["bf"] = int(g.feature.iloc[0])
            row["feats"] = [[int(x.feature), round(float(x.f1_per_domain), 4),
                             round(float(x.precision), 4), round(float(x.recall), 4)]
                            for x in g.itertuples()]
        if name in carriers:
            lo, hi = carriers[name]
            row["po"] = [lo, hi]
            row["npr"] = hi - lo
        concepts.append(row)
    (a.out / "concepts.json").write_text(json.dumps(concepts, separators=(",", ":")))

    # ---- protein_lookup.json --------------------------------------------
    shard_of = {}
    if a.stage5 and (a.stage5 / "proteins").exists():
        for p in (a.stage5 / "proteins").glob("shard_*.json"):
            s = int(p.stem.split("_")[1])
            for pid in json.loads(p.read_text())["proteins"]:
                shard_of[pid] = s
    lookup = {pid: [i, shard_of.get(pid, -1)] for i, pid in enumerate(protein_ids)}
    (a.out / "protein_lookup.json").write_text(json.dumps(lookup, separators=(",", ":")))

    # ---- manifest --------------------------------------------------------
    identified = int(allp.concept.nunique())
    manifest = {
        "stage": "4-indexes",
        "built": date.today().isoformat(),
        "partial": partial,
        "crosscoder": "crosscoder_l8192_k32_bs512_full_uniref50/jumprelu_global_10990182",
        "eval_set": "uniprotkb_modern_score345",
        "headline": {
            "avg_best_test_f1": round(float(best.f1_per_domain.mean()), 4),
            "concepts_total": int(len(best)),
            "concepts_identified": identified,
            "features_paired": int(allp.feature.nunique()),
            "latents_total": int(n_lat),
            "latents_alive": int(stats.alive.sum()),
            "layers": int(n_layers),
        },
        "counts": {
            "proteins": len(protein_ids),
            "feature_files": n_files,
            "latent_protein_pairs": int(len(r_prot)),
            "concept_protein_pairs": int(len(carriers) and sum(h - l for l, h in carriers.values())),
        },
        "sources": {"stage1": str(a.stage1), "stage3": str(a.stage3),
                    "stage5": str(a.stage5) if a.stage5 else None},
    }
    (a.out / "manifest.json").write_text(json.dumps(manifest, indent=2))

    total = sum(p.stat().st_size for p in a.out.rglob("*") if p.is_file())
    print(f"wrote {a.out}/")
    if partial:
        print("  PARTIAL: stage 1 covered a subset of shards. Do not publish this tree.")
    h = manifest["headline"]
    print(f"  headline: {h['avg_best_test_f1']} avg best test F1, "
          f"{h['concepts_identified']} of {h['concepts_total']} concepts, "
          f"{h['features_paired']} features paired, "
          f"{h['latents_alive']} of {h['latents_total']} latents alive")
    print(f"  {len(concepts)} concepts, {len(feats)} live latents, {n_files} feature files")
    print(f"  {total / 1e6:.1f} MB on disk")


if __name__ == "__main__":
    main()
