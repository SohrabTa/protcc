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

## Offline

The site is meant to run with no network at all, from a folder or a USB drive. Fonts, the structure
viewer and every data file ship with it. Nothing is fetched at view time.
