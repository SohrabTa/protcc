#!/bin/bash
#SBATCH -p lrz-cpu
#SBATCH --qos=cpu
#SBATCH -t 4:00:00
#SBATCH --mem=64G
#SBATCH -o /dss/dssfs02/lwp-dss-0001/pn67na/pn67na-dss-0000/ga25ley2/logs/protcc/feature_ranking_%j.out
#SBATCH -e /dss/dssfs02/lwp-dss-0001/pn67na/pn67na-dss-0000/ga25ley2/logs/protcc/feature_ranking_%j.err

# Stage 1 of the dashboard precompute: for every latent, every protein it fires
# on, ranked by peak activation. One pass over the 208-shard store.
#
# No GPU. The store already holds the crosscoder output, so there is no model to
# run: this is a group-by-maximum over 2.07 billion sparse values. --qos=cpu is
# required, not cosmetic; the default QOS is gpu and submitting to lrz-cpu under
# it fails at once with "Invalid qos specification".
#
# Reuses the InterPLM venv rather than building its own. The script needs only
# numpy, scipy and pandas, all of which that venv already has, and building a
# second venv on the shared DSS filesystem is slow enough to have eaten a whole
# walltime once (job 5763181, see InterPLM commit 0d3f175).

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
OUT_DIR="${OUT_DIR:-/workspace/data/protcc_dashboard/${EVALSET}/ranking}"

# The divisor must be the maxima computed over THIS store. Reading the raw scale,
# or a normalization built on a different evaluation set, is the mistake that cost
# a third of the F1 in August (roadmap PP-02f).
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
     bash -c "if .venv/bin/python -c 'import numpy, scipy, pandas' 2>/dev/null; then \
       echo 'venv: reusing /workspace/InterPLM/.venv'; \
     else \
       echo 'ERROR: /workspace/InterPLM/.venv is missing numpy, scipy or pandas' >&2; exit 1; \
     fi && \
     .venv/bin/python /workspace/protcc/dashboard/precompute/build_feature_ranking.py \
       --acts-dir ${ACTS_DIR} \
       --feature-max ${FEATURE_MAX} \
       --out ${OUT_DIR}"

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
echo "Feature ranking finished at $(date)"
echo "Total duration: $((DURATION / 3600))h $((DURATION % 3600 / 60))m $((DURATION % 60))s"
