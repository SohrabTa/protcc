#!/bin/bash
# Unpack the stage 2 track store into the tree the site reads.
#
# Stage 2 writes one tar for each of the 208 shards, because 207,463 small files
# move over the network far slower than 208 large ones. The tars already carry the
# tracks/<XX>/<acc>.bin layout that data.ts fetches, so this only extracts them.
#
# Reads   <store>/tars/shard_*.tar   from build_track_store.py --tar-per-shard
# Writes  <out>/tracks/<XX>/<acc>.bin
#
# Usage: ./unpack_tracks.sh <store-dir> <web-data-dir>

set -euo pipefail

STORE="${1:?usage: unpack_tracks.sh <store-dir> <web-data-dir>}"
OUT="${2:?usage: unpack_tracks.sh <store-dir> <web-data-dir>}"

mkdir -p "${OUT}"
n=0
for tar in "${STORE}"/tars/shard_*.tar; do
  tar xf "${tar}" -C "${OUT}"
  n=$((n + 1))
  [ $((n % 25)) -eq 0 ] && echo "  ${n} shards"
done

echo "unpacked ${n} shards into ${OUT}/tracks"
echo "  $(find "${OUT}/tracks" -name '*.bin' | wc -l | tr -d ' ') track files"
echo "  $(du -sh "${OUT}/tracks" | cut -f1) on disk"
