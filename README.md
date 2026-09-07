# ProtCC

Code for *Disentangling and interpreting internal representations of ProtT5 using sparse
crosscoders*, a Guided Research project at TU Munich.

We train a sparse crosscoder (BatchTopK, 8192 latents, k = 32) on the residual stream of all 24
encoder layers of ProtT5 (`Rostlab/prot_t5_xl_uniref50`), then pair its latents with Swiss-Prot
concepts by per-residue F1 following the InterPLM method.

## What is in here

| Folder | Holds |
|---|---|
| [`dashboard/`](dashboard/) | The feature dashboard: a static site over precomputed crosscoder data, plus the pipeline that produces that data. Roadmap item `DEP-01`. |

More folders follow as the paper's experiment code moves here.

## What is not in here

The training runs, the evaluation pipeline and the experiment write-ups live in the working tree
next to the data:

- `repos/crosscode` — crosscoder training
- `repos/InterPLM` — the evaluation pipeline (embed, encode, normalize, eval, collect)
- `repos/sparse-crosscoders-prott5` — project glue and the ProteinGym analyses
- `repos/interpreting-plms-with-sparse-crosscoders-paper` — the paper, and `documentation/` as the
  record of what we ran and found

## The model this code serves

The preprint default is the full-UniRef50 crosscoder,
`crosscoder_l8192_k32_bs512_full_uniref50/jumprelu_global_10990182`, evaluated on the
annotation-score {3,4,5} Swiss-Prot set: 0.479 average best test F1, 187 of 408 concepts
identified, 1020 features paired, 8128 of 8192 latents alive.
