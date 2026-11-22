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

## Host the dashboard

Follow [`dashboard/deploy/RUNBOOK.md`](dashboard/deploy/RUNBOOK.md). It has the steps for a person or
for an agent: one `docker compose up -d`, with a check for each step. The data comes from a
Zenodo record, and the site needs no GPU and no backend.

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
`crosscoder_l8192_k32_bs512_full_uniref50/jumprelu_global_10990182`. Since 2026-11-22 the
dashboard shows it on Swiss-Prot 2026_04 (487,776 proteins) with the cluster split: clusters at
30 % sequence identity and the per-half rule, 765 concepts. It gets 261 [256, 264] of 765 concepts
identified, 0.4119 [0.4117, 0.4170] average best test F1 and 1,058 [1,042, 1,063] latents paired
(F1 job `5915084`, bootstrap job `5915364`, doc 14 of the paper repo). Releases up to 2026-10-26.2
showed the annotation-score {3,4,5} set (0.479, 187 of 408 concepts, 1020 latents).
