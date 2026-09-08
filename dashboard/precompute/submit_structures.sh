#!/bin/bash
#SBATCH -p lrz-cpu
#SBATCH --qos=cpu
#SBATCH -t 12:00:00
#SBATCH --mem=32G
#SBATCH -o /dss/dssfs02/lwp-dss-0001/pn67na/pn67na-dss-0000/ga25ley2/logs/protcc/structures_%j.out
#SBATCH -e /dss/dssfs02/lwp-dss-0001/pn67na/pn67na-dss-0000/ga25ley2/logs/protcc/structures_%j.err

# Stage 6 of the dashboard precompute: an AlphaFold backbone for every protein in
# the evaluation set, so the dashboard can colour a structure with no network.
#
# Depends on stage 5 (or stage 1) only for protein_ids.json, the list of
# accessions to extract. Submit it with --dependency=afterok on that job.
#
# Two setup steps the job does for itself, both skipped when already done:
#
#   foldcomp is not in the InterPLM venv, so it is installed on first use. This
#   is an additive install into a venv other pipelines share; it adds a package
#   and changes none.
#
#   The Foldcomp database afdb_swissprot is 2.9 GB and is downloaded once into
#   the data filesystem, never into the home directory, whose quota a training
#   run has already filled once (insights.md, 2026-09-07).

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
BASE="/workspace/data/protcc_dashboard/${EVALSET}"
PROTEIN_IDS="${PROTEIN_IDS:-${BASE}/proteins/protein_ids.json}"
OUT_DIR="${OUT_DIR:-${BASE}/structures}"
SHARD_INDEX="${SHARD_INDEX:-${BASE}/tracks/shard_index.json}"
FOLDCOMP_DIR="/workspace/data/external/foldcomp"
DB="${FOLDCOMP_DIR}/afdb_swissprot"

export UV_LINK_MODE=copy

echo "Accessions   : ${PROTEIN_IDS}"
echo "Foldcomp db  : ${DB}"
echo "Output       : ${OUT_DIR}"
echo "Starting on $(hostname) at $(date)"
START_TIME=$(date +%s)

SHARD_ARG=""
[ -n "${SHARD_INDEX}" ] && SHARD_ARG="--shard-index ${SHARD_INDEX}"

srun --container-image="${CONTAINER}" \
     --container-mounts="${MOUNTS}" \
     --container-workdir="/workspace/InterPLM" \
     bash -c "if ! .venv/bin/python -c 'import foldcomp' 2>/dev/null; then \
       echo 'installing foldcomp into the InterPLM venv' && \
       { if command -v uv >/dev/null 2>&1; then \
           uv pip install --python /workspace/InterPLM/.venv/bin/python --quiet foldcomp; \
         else \
           .venv/bin/python -m ensurepip --upgrade >/dev/null && \
           .venv/bin/python -m pip install --quiet foldcomp; \
         fi; } && \
       .venv/bin/python -c 'import foldcomp'; \
     fi && \
     mkdir -p ${FOLDCOMP_DIR} && cd ${FOLDCOMP_DIR} && \
     if [ ! -f afdb_swissprot.lookup ]; then \
       echo 'downloading the Foldcomp Swiss-Prot database, about 2.9 GB' && \
       /workspace/InterPLM/.venv/bin/python -c \"import foldcomp; foldcomp.setup('afdb_swissprot')\"; \
     else \
       echo 'database already present'; \
     fi && \
     /workspace/InterPLM/.venv/bin/python \
       /workspace/protcc/dashboard/precompute/build_structures.py \
       --db ${DB} \
       --protein-ids ${PROTEIN_IDS} \
       --out ${OUT_DIR} ${SHARD_ARG}"

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
echo "Structures finished at $(date)"
echo "Total duration: $((DURATION / 3600))h $((DURATION % 3600 / 60))m"
