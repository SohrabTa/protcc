#!/bin/bash
# Unpack a per-shard tar store into the tree the site reads.
#
# Stages 2 and 6 each write one tar for each of the 208 shards, because 200,000
# small files move over the network far slower than 208 large ones. The tars
# already carry the layout the site fetches, tracks/<XX>/<acc>.bin and
# structures/<XX>/<acc>.cif.gz, so this only extracts them.
#
# Reads   <store>/tars/shard_*.tar
# Writes  <out>/<whatever the tars carry>
#
# Usage: ./unpack_tars.sh <store-dir> <web-data-dir>

set -euo pipefail

STORE="${1:?usage: unpack_tars.sh <store-dir> <web-data-dir>}"
OUT="${2:?usage: unpack_tars.sh <store-dir> <web-data-dir>}"

mkdir -p "${OUT}"
n=0
for tar in "${STORE}"/tars/shard_*.tar; do
  tar xf "${tar}" -C "${OUT}"
  n=$((n + 1))
  [ $((n % 25)) -eq 0 ] && echo "  ${n} shards"
done

echo "unpacked ${n} shards into ${OUT}"
du -sh "${OUT}" | cut -f1 | sed 's/^/  /;s/$/ on disk/'
