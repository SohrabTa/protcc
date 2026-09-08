#!/bin/bash
#SBATCH -p lrz-cpu
#SBATCH --qos=cpu
#SBATCH -t 4:00:00
#SBATCH --mem=64G
#SBATCH -o /dss/dssfs02/lwp-dss-0001/pn67na/pn67na-dss-0000/ga25ley2/logs/protcc/protein_bundles_%j.out
#SBATCH -e /dss/dssfs02/lwp-dss-0001/pn67na/pn67na-dss-0000/ga25ley2/logs/protcc/protein_bundles_%j.err

# Stage 5 of the dashboard precompute: sequence, name and Swiss-Prot annotation
# ranges per protein, plus the reverse index from a concept to its proteins.
#
# No GPU, and no dependency on stages 1 or 2. It reads the evaluation set's
# annotations and takes the protein order from the store's meta.json only, so it
# can run at any time. --qos=cpu is required; the default QOS is gpu and
# submitting to lrz-cpu under it fails at once.

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
ANN_DIR="/workspace/data/eval_dataset/${EVALSET}/processed_annotations"
# Stage 5 has its own directory. Job 5776352 wrote into ranking/ instead, because this
# line was a second ${OUT_DIR:-...} after the variable was already set, so it did nothing.
OUT_DIR="${OUT_DIR:-/workspace/data/protcc_dashboard/${EVALSET}/proteins}"

export UV_LINK_MODE=copy

echo "Store        : ${ACTS_DIR}"
echo "Annotations  : ${ANN_DIR}"
echo "Output       : ${OUT_DIR}"
echo "Starting on $(hostname) at $(date)"
START_TIME=$(date +%s)

srun --container-image="${CONTAINER}" \
     --container-mounts="${MOUNTS}" \
     --container-workdir="/workspace/InterPLM" \
     bash -c ".venv/bin/python /workspace/protcc/dashboard/precompute/build_protein_bundles.py \
       --acts-dir ${ACTS_DIR} \
       --ann-dir ${ANN_DIR} \
       --out ${OUT_DIR}"

END_TIME=$(date +%s)
echo "Protein bundles finished at $(date)"
echo "Total duration: $(( (END_TIME-START_TIME) / 60 ))m"
