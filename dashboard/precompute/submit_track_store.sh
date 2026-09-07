#!/bin/bash
#SBATCH -p lrz-cpu
#SBATCH --qos=cpu
#SBATCH -t 8:00:00
#SBATCH --mem=32G
#SBATCH -o /dss/dssfs02/lwp-dss-0001/pn67na/pn67na-dss-0000/ga25ley2/logs/protcc/track_store_%j.out
#SBATCH -e /dss/dssfs02/lwp-dss-0001/pn67na/pn67na-dss-0000/ga25ley2/logs/protcc/track_store_%j.err

# Stage 2 of the dashboard precompute: the activation store rewritten one
# protein per file, so the dashboard can open a protein without reading 8.8 GB.
#
# No GPU, and no dependency on stage 1. Both read the same store and neither
# reads the other's output, so they can run at the same time.
#
# --tar-per-shard is set on purpose. The tree is about 207,000 files of 31 kB,
# which is the access pattern a shared parallel filesystem handles worst, and
# copying it file by file to the laptop would take far longer than moving 208
# archives. Untar all of them over one directory to get the tree back.

set -euo pipefail

CONTAINER="${RERUN_CONTAINER:-/dss/dsshome1/08/ga25ley2/nvidia+pytorch+25.12-py3.sqsh}"
INTERPLM_DIR="/dss/dsshome1/08/ga25ley2/code/InterPLM"
CROSSCODE_DIR="/dss/dsshome1/08/ga25ley2/code/crosscode"
PROTCC_DIR="/dss/dsshome1/08/ga25ley2/code/protcc"
CKPT_DIR="/dss/dssfs02/lwp-dss-0001/pn67na/pn67na-dss-0000/ga25ley2/model_checkpoints"
DATA_DIR="/dss/dssfs02/lwp-dss-0001/pn67na/pn67na-dss-0000/ga25ley2/data"

MOUNTS="${INTERPLM_DIR}:/workspace/InterPLM"
MOUNTS="${MOUNTS},${CROSSCODE_DIR}:/workspace/crosscode"
MOUNTS="${MOUNTS},${PROTCC_DIR}:/workspace/protcc"
MOUNTS="${MOUNTS},${CKPT_DIR}:/workspace/model_checkpoints"
MOUNTS="${MOUNTS},${DATA_DIR}:/workspace/data"

EVALSET="${EVALSET:-uniprotkb_modern_score345}"
SAE_DIR="${SAE_DIR:-/workspace/model_checkpoints/crosscoder_l8192_k32_bs512_full_uniref50/jumprelu_global_10990182}"
ACTS_DIR="/workspace/data/crosscoder_activations/${EVALSET}"
OUT_DIR="${OUT_DIR:-/workspace/data/protcc_dashboard/${EVALSET}/tracks}"

# The same divisor stage 1 uses, and for the same reason: the store is on the raw
# scale, and the evaluation numbers are on the normalized one (roadmap PP-02f).
FEATURE_MAX="${SAE_DIR}/feature_stats/max.npy"

export UV_LINK_MODE=copy

echo "Store        : ${ACTS_DIR}"
echo "Divisor      : ${FEATURE_MAX}"
echo "Output       : ${OUT_DIR}"
echo "Starting on $(hostname) at $(date)"
START_TIME=$(date +%s)

srun --container-image="${CONTAINER}" \
     --container-mounts="${MOUNTS}" \
     --container-workdir="/workspace/InterPLM" \
     bash -c "if .venv/bin/python -c 'import numpy, scipy' 2>/dev/null; then \
       echo 'venv: reusing /workspace/InterPLM/.venv'; \
     else \
       echo 'ERROR: /workspace/InterPLM/.venv is missing numpy or scipy' >&2; exit 1; \
     fi && \
     .venv/bin/python /workspace/protcc/dashboard/precompute/build_track_store.py \
       --acts-dir ${ACTS_DIR} \
       --feature-max ${FEATURE_MAX} \
       --out ${OUT_DIR} \
       --tar-per-shard"

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
echo "Track store finished at $(date)"
echo "Total duration: $((DURATION / 3600))h $((DURATION % 3600 / 60))m $((DURATION % 60))s"
