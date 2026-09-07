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
| 4. Indexes | *(to write)* | local | the eval tables, stages 0, 1 and 3 | `concepts.json`, `features.json` |
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

## Stage 6 ships mmCIF, not BinaryCIF, for now

Gzipped backbone mmCIF is 59.6 bytes per residue, about 3.73 GB for the evaluation set.
BinaryCIF would be 25.7, about 1.61 GB, and Mol* reads both. BinaryCIF is deferred because the
converter that produces it ships with Mol* as a Node tool while the cluster container is a
PyTorch image, and authoring the category by hand against the Python `ciftools` library carries a
validation risk not worth taking before the viewer exists. Stage 6 is a leaf, so the format can
change without touching anything upstream. The cost of waiting is 2.1 GB.
