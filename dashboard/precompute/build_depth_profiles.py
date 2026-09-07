#!/usr/bin/env python
"""Stage 3. Where in the encoder each latent lives.

A crosscoder holds one decoder vector per latent per layer. The length of that vector says
how hard the latent writes into that layer's residual stream, and the angle between two
layers' vectors says whether the latent keeps one direction through the encoder. Neither
number exists for a per-layer sparse autoencoder, whose latents are separate models with no
correspondence between layers. This is the measurement the dashboard leads with.

## The scaling factors are not optional

The trained model is stored folded: the per-layer normalisation is baked into the weights.
ProtT5's residual stream grows about 600 times in magnitude from layer 1 to layer 24, so the
folded decoder norms are dominated by that growth and every latent appears to peak at the
last layer. Multiplying each layer's norm by its output scaling factor undoes this. The same
correction is used in `plot_layerwise_feature_anatomy.py` in the sparse-crosscoders-prott5
repo and in the InterPLM dashboard's cross-layer panel. The script reports the peak-layer
distribution both ways, so the size of the effect stays on the record rather than in a
comment.

Reads
-----
<checkpoint>/ae.pt                 the JumpReLU-converted crosscoder
<checkpoint>/feature_stats/max.npy per-latent maximum over the eval set; 0 means dead

Writes
------
<out>/depth_norms.npy    float32 [n_latents, n_layers]  unfolded decoder norms, raw scale
<out>/depth_cos.npy      float32 [n_latents, n_layers]  cosine to the peak layer's vector
<out>/depth_summary.csv  one row per latent: peak layer, peak norm, spread, alive
<out>/manifest.json      what was read, and the checksum of the checkpoint

Nothing here is quantised. Stage 4 packs these for the web; keeping the raw values means a
later analysis does not have to re-run the model.

Repro
-----
uv run python build_depth_profiles.py --checkpoint <dir> --out <dir>
Deterministic. No randomness, no seed.
"""

import argparse
import hashlib
import json
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import torch


def md5(path, chunk=1 << 22):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


def decoder_norms(state, unfold):
    """[n_latents, n_layers] decoder norms.

    unfold=True multiplies each layer by its output scaling factor first, which is what makes
    the numbers comparable across layers.
    """
    w = state["_W_dec_LXoDo"][:, 0, :, :]          # [n_latents, n_layers, d_model]
    norms = w.norm(dim=-1)
    if unfold and bool(state["is_folded"]):
        norms = norms * state["folded_scaling_factors_out_Xo"][0][None, :]
    return norms


def peak_histogram(norms):
    peak = norms.argmax(dim=1).numpy() + 1
    return np.bincount(peak, minlength=norms.shape[1] + 1)[1:]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", type=Path, required=True,
                    help="directory holding ae.pt and feature_stats/max.npy")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--checkpoint-file", default="ae.pt")
    ap.add_argument("--skip-checksum", action="store_true",
                    help="skip the md5 of the 1.6 GB checkpoint")
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)

    ckpt = a.checkpoint / a.checkpoint_file
    print(f"reading {ckpt}")
    state = torch.load(ckpt, map_location="cpu", weights_only=False)
    n_lat, _, n_layers, d_model = state["_W_dec_LXoDo"].shape
    folded = bool(state["is_folded"])
    print(f"{n_lat} latents, {n_layers} layers, d_model {d_model}, folded={folded}")

    w = state["_W_dec_LXoDo"][:, 0, :, :]
    norms = decoder_norms(state, unfold=True)
    folded_norms = decoder_norms(state, unfold=False)

    # Cosine between every layer's decoder vector and the peak layer's. The scaling factors
    # are positive scalars per layer, so they do not change any angle: the cosine is the same
    # folded or unfolded, and only the choice of peak layer depends on the unfolding.
    peak_idx = norms.argmax(dim=1)
    peak_vec = w[torch.arange(n_lat), peak_idx]                     # [n_latents, d_model]
    cos = torch.nn.functional.cosine_similarity(w, peak_vec[:, None, :], dim=-1)

    max_path = a.checkpoint / "feature_stats" / "max.npy"
    if max_path.exists():
        feat_max = np.load(max_path)
        alive = feat_max > 0
        print(f"alive latents: {int(alive.sum())} of {n_lat}")
    else:
        feat_max = np.full(n_lat, np.nan, dtype=np.float32)
        alive = np.ones(n_lat, bool)
        print(f"no {max_path.name}; every latent is treated as alive")

    norms_np = norms.numpy().astype(np.float32)
    cos_np = cos.numpy().astype(np.float32)
    np.save(a.out / "depth_norms.npy", norms_np)
    np.save(a.out / "depth_cos.npy", cos_np)

    # Spread: how many layers carry at least half the peak norm. A latent that lives in one
    # layer scores 1; one that is written across the whole encoder scores n_layers.
    rel = norms_np / np.maximum(norms_np.max(axis=1, keepdims=True), 1e-12)
    spread = (rel >= 0.5).sum(axis=1)

    summary = pd.DataFrame({
        "feature": np.arange(n_lat),
        "peak_layer": peak_idx.numpy() + 1,
        "peak_norm": norms_np.max(axis=1),
        "layers_at_half_peak": spread,
        "cos_layer1_to_peak": cos_np[:, 0],
        "cos_last_to_peak": cos_np[:, -1],
        "max_activation": feat_max,
        "alive": alive,
    })
    summary.to_csv(a.out / "depth_summary.csv", index=False)

    manifest = {
        "stage": "3-depth-profiles",
        "built": date.today().isoformat(),
        "checkpoint": str(ckpt),
        "checkpoint_md5": None if a.skip_checksum else md5(ckpt),
        "n_latents": int(n_lat), "n_layers": int(n_layers), "d_model": int(d_model),
        "folded": folded,
        "alive_latents": int(alive.sum()),
        "unfolded_peak_histogram": peak_histogram(norms).tolist(),
        "folded_peak_histogram": peak_histogram(folded_norms).tolist(),
    }
    (a.out / "manifest.json").write_text(json.dumps(manifest, indent=2))

    print(f"\nwrote {a.out}/")
    print("\npeak layer, alive latents only:")
    pk = summary.loc[summary.alive, "peak_layer"]
    print("  median", int(pk.median()), " range", int(pk.min()), "to", int(pk.max()))
    print("\nwhy the scaling factors matter, peak-layer counts over all latents:")
    print("  layer:   " + " ".join(f"{i + 1:>4}" for i in range(n_layers)))
    print("  unfolded " + " ".join(f"{v:>4}" for v in manifest["unfolded_peak_histogram"]))
    print("  folded   " + " ".join(f"{v:>4}" for v in manifest["folded_peak_histogram"]))


if __name__ == "__main__":
    main()
