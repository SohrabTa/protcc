#!/usr/bin/env python
"""Stage 4. The files the site actually loads.

Stages 0 to 3, 5 and 6 each produce one kind of fact. This stage joins them into the data
contract the browser reads, and it is the last thing that touches the numbers: after this the
site only renders.

## What the browser fetches, and when

    manifest.json          once     provenance and the headline figures
    concepts.json          once     every concept with a paired latent, with the pairings
                                 inline
    features.json          once     every live latent, enough to draw the feature map
    depth.bin              once     24 decoder norms and 24 cosines per latent
    concept_proteins.bin   once     which proteins carry each concept
    protein_lookup.json    once     accession to global index and shard, for the search box
    feature/<id>.bin       per view the proteins one latent fires on, ranked
    proteins/shard_<n>.json per view the sequence, name and annotation ranges of 1000 proteins

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
<pairings>/heldout_{top,all_top}_pairings.csv from the 30 % identity cluster split
<concept-rule> per_concept.tsv with counts for each half and the per_half_rule flag
<bootstrap> crosscoder and baseline 95 % intervals for the cluster split and per-half rule
<neuron-bootstrap> neuron 95 % intervals for the same split and rule
The per-half rule is RULE_MIN_RESIDUES and RULE_MIN_DOMAINS below, checked against the flag.
The rule excludes amino-acid concepts. The crosscoder points must match the headline.
<training-config> experiment_config.yaml of the last training job, optional, with
<training-corpus> manifest.json of the UniRef50 chunks it trained on. Refused when the two disagree
                  on the batch size or the length cut, or when the latent count is not the headline's.

Writes
------
<out>/ as listed above

Repro
-----
uv run python build_indexes.py --stage0 … --stage1 … --stage3 … --pairings … \
  --concept-rule … --bootstrap … --neuron-bootstrap … \
  --training-config … --training-corpus … --out …
Deterministic, no randomness, no seed.
"""

import argparse
import json
import os
import re
import struct
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

RULE_MIN_RESIDUES = 750
RULE_MIN_DOMAINS = 12.5

MAGIC_RANK, MAGIC_DEPTH, MAGIC_CONCEPT = 0x50435231, 0x50434431, 0x50434331


def q255(a):
    return np.clip(np.rint(np.asarray(a, dtype=np.float64) * 255), 0, 255).astype(np.uint8)


def add_comparison(manifest, bootstrap_path, neuron_path):
    """Check the cluster split inputs and add the three models with 95 % intervals."""
    bootstrap = json.loads(bootstrap_path.read_text())
    neurons = json.loads(neuron_path.read_text())
    crosscoder = bootstrap["models"]["crosscoder"]["rules"]["per_half_rule"]
    headline = manifest["headline"]
    metrics = ("avg_best_test_f1", "concepts_identified", "features_paired", "concepts_scored")
    for metric in metrics:
        point = crosscoder["levels"]["domain"][metric]["point"]
        if metric == "avg_best_test_f1":
            point = round(point, 4)
        if point != headline[metric]:
            raise SystemExit(f"{bootstrap_path} has a different {metric}: {point}")
    if crosscoder["concepts_in_rule"] != headline["concepts_total"]:
        raise SystemExit(f"{bootstrap_path} has a different concepts_in_rule")
    if neurons["concepts_in_rule"] != headline["concepts_total"] or neurons["rule"] != "per_half_rule":
        raise SystemExit(f"{neuron_path} has a different concept rule")

    levels_by_model = {
        "crosscoder": crosscoder["levels"],
        "baseline_model": bootstrap["models"]["baseline"]["rules"]["per_half_rule"]["levels"],
        "neurons": neurons["models"]["neurons"]["subsets"]["all"]["levels"],
    }
    manifest["comparison"] = {
        model: {
            level: {
                metric: [round(levels[level][metric][key], 4) if metric == "avg_best_test_f1"
                         else int(levels[level][metric][key])
                         for key in ("point", "ci95_low", "ci95_high")]
                for metric in metrics
            }
            for level in ("domain", "residue")
        }
        for model, levels in levels_by_model.items()
    }
    proteins_test = int(bootstrap["proteins_per_shard"]["total"])
    manifest["eval"] = {
        "name": "Swiss-Prot 2026_04",
        "split": "cluster",
        "identity_pct": 30,
        "rule_min_residues": RULE_MIN_RESIDUES,
        "rule_min_domains": RULE_MIN_DOMAINS,
        "proteins_valid": (None if manifest["partial"]
                           else manifest["counts"]["proteins"] - proteins_test),
        "proteins_test": proteins_test,
    }


class _ConfigLoader(yaml.SafeLoader):
    """A safe loader that also reads the Python tuple the trainer writes for the Adam betas."""


_ConfigLoader.add_constructor(
    "tag:yaml.org,2002:python/tuple", lambda loader, node: tuple(loader.construct_sequence(node))
)


def add_training(manifest, config_path, corpus_path):
    """How the crosscoder was trained: the model it read, the corpus, and the training settings.

    The header and the method page print these, so they come from the files of the training run.
    The config and the corpus manifest must describe the same run, and the run must have the
    latent count of the headline.
    """
    cfg = yaml.load(config_path.read_text(), Loader=_ConfigLoader)
    corpus = json.loads(corpus_path.read_text())
    loader = cfg["data"]["token_sequence_loader"]
    train = cfg["train"]
    n_latents = cfg["crosscoder"]["n_latents"]
    if corpus["batch_size"] != train["batch_size"] or corpus["max_length"] != loader["max_sequence_length"]:
        raise SystemExit(f"{corpus_path} does not describe the corpus of {config_path}")
    if n_latents != manifest["headline"]["latents_total"]:
        raise SystemExit(f"{config_path} trained {n_latents} latents, not the headline's")
    manifest["training"] = {
        "model": cfg["data"]["activations_harvester"]["llms"][0]["hf_model_name"],
        "corpus": "UniRef50",
        "corpus_release": re.search(r"release-([^/]+)", corpus["input"]).group(1),
        "max_length": corpus["max_length"],
        "sequences": corpus["total_sequences_kept"],
        "residues": corpus["total_residues_kept"],
        "layers": len(cfg["hookpoints"]),
        "latents": n_latents,
        "k": cfg["crosscoder"]["k"],
        "sparsity": train["topk_style"],
        "batch_size": train["batch_size"],
        "k_aux": train["k_aux"],
        "lambda_aux": train["lambda_aux"],
    }
    manifest["sources"]["training_config"] = os.path.relpath(config_path)
    manifest["sources"]["training_corpus"] = os.path.relpath(corpus_path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage0", type=Path, required=True, help="concept_categories.csv")
    ap.add_argument("--stage1", type=Path, required=True, help="the ranking directory")
    ap.add_argument("--stage3", type=Path, required=True, help="the depth directory")
    ap.add_argument("--stage5", type=Path, default=None, help="the protein bundle directory")
    ap.add_argument("--stage6", type=Path, default=None,
                    help="the structure directory, read only for its missing.txt count")
    ap.add_argument("--pairings", type=Path, required=True, help="the cluster-split pairing directory")
    ap.add_argument("--concept-rule", type=Path, required=True,
                    help="per_concept.tsv with counts and the per_half_rule flag")
    ap.add_argument("--bootstrap", type=Path, required=True,
                    help="crosscoder and baseline bootstrap intervals for the cluster split")
    ap.add_argument("--neuron-bootstrap", type=Path, required=True,
                    help="neuron bootstrap intervals for the cluster split")
    ap.add_argument("--training-config", type=Path, default=None,
                    help="experiment_config.yaml of the last training job")
    ap.add_argument("--training-corpus", type=Path, default=None,
                    help="manifest.json of the training corpus chunks")
    ap.add_argument("--eval-set", default=None,
                    help="the evaluation set name for manifest.json; derived from stage 1's "
                         "acts_dir when absent")
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()
    (a.out / "feature").mkdir(parents=True, exist_ok=True)

    cats = pd.read_csv(a.stage0, keep_default_na=False).set_index("concept")
    best = pd.read_csv(a.pairings / "heldout_top_pairings.csv", index_col=0)
    allp = pd.read_csv(a.pairings / "heldout_all_top_pairings.csv")
    # The dashboard reports the 30 % identity cluster split with the per-half rule.
    # A concept has a page only when heldout_top_pairings.csv has a row for it.
    best = best[~best["concept"].astype(str).str.startswith("amino_acid_")]
    allp = allp[~allp["concept"].astype(str).str.startswith("amino_acid_")]
    rule = pd.read_csv(a.concept_rule, sep="\t")
    passes = ((rule.valid_residues > RULE_MIN_RESIDUES) | (rule.valid_domains > RULE_MIN_DOMAINS)) & (
        (rule.test_residues > RULE_MIN_RESIDUES) | (rule.test_domains > RULE_MIN_DOMAINS)
    )
    mismatch = passes != rule.per_half_rule
    if mismatch.any():
        names = rule.loc[mismatch, "concept"].astype(str).tolist()
        raise SystemExit(f"{a.concept_rule} has inconsistent per_half_rule flags: {names}")
    rule_set = set(rule.loc[
        passes & ~rule.concept.astype(str).str.contains("amino_acid", case=False, regex=False),
        "concept",
    ].astype(str))
    best = best[best.concept.astype(str).isin(rule_set)]
    allp = allp[allp.concept.astype(str).isin(rule_set)]

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
            # The latent the validation half chose, as in the paper: Best F1 is its score on the
            # held-out half, so the two always belong together. It is one of the paired latents
            # for every concept that has any. On the score-{3,4,5} set, the highest held-out F1
            # picked another latent for 27 of the 187 identified concepts.
            chosen = int(r.feature)
            row["bf"] = chosen if chosen in set(g.feature.astype(int)) else int(g.feature.iloc[0])
            # latent, F1 per domain, precision, recall per residue, recall per domain, cut. The
            # recall per domain makes the gap between the two recalls readable on the site: the
            # median pairing recalls 98% of the regions and 3% of their residues. The cut is the
            # share of the latent's maximum that the pairing search chose for this pair. The
            # concept page counts a residue as fired on with this cut, so its counts agree
            # with the scores in the same table.
            row["feats"] = [[int(x.feature), round(float(x.f1_per_domain), 4),
                             round(float(x.precision), 4), round(float(x.recall), 4),
                             round(float(x.recall_per_domain), 4),
                             round(float(x.threshold_pct), 2)]
                            for x in g.itertuples()]
        if name in carriers:
            lo, hi = carriers[name]
            row["po"] = [lo, hi]
            row["npr"] = hi - lo
        concepts.append(row)
    (a.out / "concepts.json").write_text(json.dumps(concepts, separators=(",", ":")))

    # ---- protein_lookup.json and the bundles ----------------------------
    # The site fetches proteins/shard_<n>.json directly, so the bundles are copied in
    # rather than left in the stage 5 directory. That keeps the web tree self-contained:
    # one directory holds everything the browser asks for, and nothing else.
    shard_of = {}
    n_bundles = 0
    if a.stage5 and (a.stage5 / "proteins").exists():
        (a.out / "proteins").mkdir(exist_ok=True)
        for p in (a.stage5 / "proteins").glob("shard_*.json"):
            s = int(p.stem.split("_")[1])
            text = p.read_text()
            for pid in json.loads(text)["proteins"]:
                shard_of[pid] = s
            (a.out / "proteins" / p.name).write_text(text)
            n_bundles += 1
    lookup = {pid: [i, shard_of.get(pid, -1)] for i, pid in enumerate(protein_ids)}
    (a.out / "protein_lookup.json").write_text(json.dumps(lookup, separators=(",", ":")))

    # ---- how many proteins have a structure -------------------------------
    n_no_structure = 0
    if a.stage6 and (a.stage6 / "missing.txt").exists():
        n_no_structure = sum(
            1 for line in (a.stage6 / "missing.txt").read_text().splitlines() if line.strip()
        )

    # ---- manifest --------------------------------------------------------
    identified = int(allp.concept.nunique())
    if a.eval_set:
        eval_set = a.eval_set
    else:
        acts = json.loads((a.stage1 / "manifest.json").read_text()).get("acts_dir", "")
        eval_set = os.path.basename(acts.rstrip("/")) or "unknown"
    manifest = {
        "stage": "4-indexes",
        "built": date.today().isoformat(),
        "partial": partial,
        "crosscoder": "crosscoder_l8192_k32_bs512_full_uniref50/jumprelu_global_10990182",
        "eval_set": eval_set,
        "headline": {
            "avg_best_test_f1": round(float(best.f1_per_domain.mean()), 4),
            "concepts_total": len(rule_set),
            "concepts_scored": len(best),
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
            # Stage 6 lists the accessions it could not extract. Every protein in this evaluation
            # set carries an AlphaFoldDB cross-reference, so a miss means the Foldcomp database
            # we extract from does not hold that model, not that no model exists.
            "structures": len(protein_ids) - n_no_structure,
            "no_structure": n_no_structure,
        },
        "sources": {"pairings": os.path.relpath(a.pairings),
                    "concept_rule": os.path.relpath(a.concept_rule),
                    "bootstrap": os.path.relpath(a.bootstrap),
                    "neuron_bootstrap": os.path.relpath(a.neuron_bootstrap),
                    "stage1": str(a.stage1), "stage3": str(a.stage3),
                    "stage5": str(a.stage5) if a.stage5 else None,
                    "stage6": str(a.stage6) if a.stage6 else None},
    }
    add_comparison(manifest, a.bootstrap, a.neuron_bootstrap)
    if a.training_config and a.training_corpus:
        add_training(manifest, a.training_config, a.training_corpus)
    (a.out / "manifest.json").write_text(json.dumps(manifest, indent=2))

    total = sum(p.stat().st_size for p in a.out.rglob("*") if p.is_file())
    print(f"wrote {a.out}/")
    if partial:
        print("  PARTIAL: stage 1 covered a subset of shards. Do not publish this tree.")
    h = manifest["headline"]
    print(f"  headline: {h['avg_best_test_f1']} avg best test F1, "
          f"{h['concepts_identified']} of {h['concepts_total']} concepts, "
          f"{h['concepts_scored']} concepts scored, "
          f"{h['features_paired']} features paired, "
          f"{h['latents_alive']} of {h['latents_total']} latents alive")
    print(f"  {len(concepts)} concepts, {len(feats)} live latents, {n_files} feature files, "
          f"{n_bundles} protein bundles")
    print(f"  {total / 1e6:.1f} MB on disk")


if __name__ == "__main__":
    main()
