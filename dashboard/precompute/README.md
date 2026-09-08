# Precompute

Turns the trained crosscoder, the sparse activation store and the evaluation tables into the data
tree that the site reads. Runs once per crosscoder. Nothing here runs at view time.

## Where each stage runs

Heavy stages read data that only exists on the LRZ cluster. Everything else runs on the laptop.

| Stage | Script | Runs on | Reads | Writes |
|---|---|---|---|---|
| 0. Concept categories | `build_concept_categories.py` | local | the eval pairing tables | `concept_categories.csv` |
| 1. Feature ranking | `build_feature_ranking.py` | cluster | the activation store, 208 shards | every latent-protein pair, ranked, plus the firing statistics |
| 2. Track store | `build_track_store.py` + `submit_track_store.sh` | cluster | the activation store | one file per protein, every latent that fires on it |
| 3. Depth profiles | `build_depth_profiles.py` | local | the checkpoint | 8192 x 24 decoder norms and cosine to peak |
| 4. Indexes | `build_indexes.py` | local | stages 0, 1, 3 and 5 plus the eval tables | the data contract the site reads |
| 5. Protein bundles | `build_protein_bundles.py` + `submit_protein_bundles.sh` | cluster | the eval set annotations | sequence, name, concept ranges, and the concept-to-proteins index |
| 6. Structures | `build_structures.py` + `submit_structures.sh` | cluster | AlphaFold via Foldcomp | backbone mmCIF, gzipped |

Stage 1 replaces InterPLM's `collect_feature_activations.py`, which answers the same question
by keeping the ten strongest proteins per latent plus ten sampled from each of five activation
bands. We keep every latent-protein pair instead. The complete version is 156 million pairs,
which is 625 MB at 4 bytes each, so the sampling saves little and costs the protein chooser.
The top ten is then the head of a ranked run, and an activation band is a slice of it.

The cluster is reachable as `ssh ai`. Cluster paths under
`/dss/dssfs02/lwp-dss-0001/pn67na/pn67na-dss-0000/ga25ley2/` map to the local `data/` mirror.

## Inputs

| Input | Path |
|---|---|
| Crosscoder | `model_checkpoints/crosscoder_l8192_k32_bs512_full_uniref50/jumprelu_global_10990182/` |
| Activation store | `data/crosscoder_activations/uniprotkb_modern_score345/shard_*/` |
| Concept pairings | `data/crosscoder_eval/full_uniref/normalized/uniprotkb_modern_score345/test_counts/` |
| Eval set | `data/eval_dataset/uniprotkb_modern_score345/` |

The store holds 2,068,021,126 non-zero activations over 62,655,684 residues in 208 shards, at a
mean L0 of 33.01.

## Two build sizes

The same pipeline emits either. The choice is packaging, not architecture.

- **Full.** Every latent on every protein. About 6.2 GB of tracks plus 1.6 GB of structures. For
  the laptop and for the offline copy.
- **Subset.** Sixty example proteins per feature. About 22 MB of tracks plus 0.5 GB of structures.
  For a hosted copy where disk is tight.

A track costs about 46 bytes rather than 302, because the median latent is non-zero on only 5% of
the residues of the protein where it fires hardest. Tracks are stored as the non-zero stretches.

## Reproducibility

Every stage is a script that runs end to end from its inputs. Each one records the checkpoint, the
evaluation set and the Slurm job that produced its inputs into the manifest, so any number on the
site can be traced back. The site's headline figures must reproduce the published result: 0.479
average best test F1, 187 of 408 concepts, 1020 features paired, 8128 live latents.

## The full build of 2026-09-08

The first complete run over all 208 shards. Four jobs on `lrz-cpu`, then stage 4 on the laptop.

| Stage | Job | Elapsed | Result |
|---|---|---:|---|
| 1. Feature ranking | `5776292` | 8m 11s | 1011 MB, 157,392,198 latent-protein pairs |
| 2. Track store | `5776341` | 5m 29s | 6.2 GB, 2,068,021,126 non-zeros over 62,655,684 residues |
| 5. Protein bundles | `5776352` | 3m 18s | 105 MB, 627,067 concept-protein pairs, 680 concepts kept |
| 6. Structures | `5776353` | 1m 1s | failed, see below |
| 6. Structures | `5777472` | 1h 32m | 202,106 structures, 3.90 GB, mean 19.3 kB |
| 4. Indexes | local | 6.9s | 952.3 MB, 8128 feature files, `partial: false` |

Stage 2's non-zero count matches the store's own count to the digit, so it read every shard.
Stage 6 found no AlphaFold model for 5357 accessions, listed in `missing.txt`, and 202,106 plus 5357 is the full 207,463.
Stage 4 reproduces the published headline: 0.4794 average best test F1, 187 of 408 concepts,
1020 features paired, 8128 of 8192 latents alive.

Two bugs surfaced in this run, both in the submit scripts and both now fixed.

**Stage 6 could not install foldcomp.** The InterPLM venv is a `uv` venv and carries no `pip`, so
`python -m pip install foldcomp` failed at once. The script now tries `uv pip install` first, falls
back to `ensurepip`, and then imports the module to make sure that the install worked.

**Stage 5 wrote into the wrong directory.** `submit_protein_bundles.sh` set `OUT_DIR` twice, and
the second line used `${OUT_DIR:-...}` after the variable already held a value, so it did nothing.
Stage 5 wrote into `ranking/` and overwrote stage 1's `manifest.json`. No array was lost, and the
stage 5 manifest carries the same `partial: false`, so stage 4 read the right flag. But the
provenance of stage 1 is gone from that run. **The 2026-09-08 outputs of stages 1 and 5 both live
in `ranking/`.** Give `build_indexes.py` the same path for `--stage1` and `--stage5`.

## Unpacking the tracks

Stage 2 writes one tar for each shard, because 207,463 small files move over the network far
slower than 208 large ones. The tars already carry the `tracks/<XX>/<acc>.bin` layout that the
site fetches, so `unpack_tracks.sh <store-dir> <web-data-dir>` only extracts them.

## Stage 6 ships mmCIF, not BinaryCIF, for now

Gzipped backbone mmCIF is 59.6 bytes per residue, about 3.73 GB for the evaluation set.
BinaryCIF would be 25.7, about 1.61 GB, and Mol* reads both. BinaryCIF is deferred because the
converter that produces it ships with Mol* as a Node tool while the cluster container is a
PyTorch image, and authoring the category by hand against the Python `ciftools` library carries a
validation risk not worth taking before the viewer exists. Stage 6 is a leaf, so the format can
change without touching anything upstream. The cost of waiting is 2.1 GB.

## What the site loads

Stage 4 is the last thing that touches a number. Everything after it only renders.

| File | Fetched | Holds |
|---|---|---|
| `manifest.json` | once | provenance and the headline figures |
| `concepts.json` | once | all 408 concepts, with their paired latents inline |
| `features.json` | once | every live latent, enough to draw the feature map |
| `depth.bin` | once | 24 decoder norms and 24 cosines per latent |
| `concept_proteins.bin` | once | which proteins carry each concept |
| `protein_lookup.json` | once | accession to global index and shard, for search |
| `feature/<id>.bin` | per view | the proteins one latent fires on, ranked |
| `proteins/shard_<i>.json` | per view | sequence, name and annotation ranges (stage 5) |
| `tracks/<XX>/<acc>.bin` | per view | every latent that fires on one protein (stage 2) |

The "once" column comes to a few megabytes, so the site holds it in memory. Only the per-latent
and per-protein files are fetched on demand, because the ranked protein list runs to 207,463 rows
for the most common latent.

A tree built from a subset of shards carries `"partial": true` in its manifest and must not be
published.
