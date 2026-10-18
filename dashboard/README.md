# ProtCC feature dashboard

A static site that shows what the crosscoder learned. No backend, no GPU, no live inference. Every
value it displays is computed once by [`precompute/`](precompute/) and shipped as data files.

Roadmap item `DEP-01`. Running the crosscoder on a sequence the evaluation never saw is `DEP-02`
and is out of scope here.

## Why static

The two kinds of "feature activations on a protein" split cleanly. The proteins that activate a
feature are a fixed, known set, so their per-residue activations can be computed once. An arbitrary
pasted sequence needs the model in the loop. The first is the whole dashboard; the second is v2.

Decided at the 2026-07-07 meeting, recorded in the paper repo under
`notes/meetings/2026-07-07.md`.

## Layout

```
dashboard/
├── precompute/     Python. Turns the checkpoint, the activation store and the eval tables
│                   into the data tree the site reads.
├── web/            The site. Plain TypeScript, one bundle, no framework.
└── data/           The output of precompute. Not in git; rebuilt or synced.
```

## What it shows

Three ways in, over one set of data.

- **By concept.** Which Swiss-Prot concepts the crosscoder detects, grouped by biological family,
  and which latents detect each one.
- **By feature.** What one latent responds to, where in the 24 encoder layers it lives, and the
  proteins it fires on.
- **By protein.** Which latents fire where along one protein of the evaluation set.

## Every number comes from the data

The site prints only numbers of the crosscoder and eval set that the data tree describes, and the text reads them from the data: the header from the manifest, the sentences from `web/src/facts.ts`. A number typed into a sentence can belong to another crosscoder, eval set or counting rule and stay there unseen. `npm run build` runs `web/tools/check-numbers.mjs` first, and it fails when a measured number is typed into the site text.

The concepts and latents come from the eval tables by design. Stage 4 reads InterPLM's own pairings (`heldout_top_pairings.csv` for each concept's pick and Best F1, `heldout_all_top_pairings.csv` for every pair) and computes no pairing of its own.

## Offline

The site is meant to run with no network at all, from a folder or a USB drive. Fonts, the structure
viewer and every data file ship with it. Nothing is fetched at view time.
