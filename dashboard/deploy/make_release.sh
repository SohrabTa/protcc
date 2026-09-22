#!/usr/bin/env bash
# Pack the data tree into the four archives that go to Zenodo, and write data-release.json.
#
# Run this on the machine that holds the built tree, not on the server. It reads
# dashboard/data/web and writes to an output folder you name. The output is what you upload, and
# data-release.json is what the fetch container reads to know what to pull and what it should be.
#
#   ./make_release.sh ../data/web /tmp/protcc-release
#
# The four parts follow the shape of the tree, not an even split. Three of them are already
# binary or already gzipped, so only the index bundle is compressed. Compressing the rest costs
# an hour and saves almost nothing.
#
# After the upload, put the record id into data-release.json or into .env, and the fetch
# container needs nothing else.

set -euo pipefail

WEB=${1:?usage: make_release.sh <data/web> <output dir>}
OUT=${2:?usage: make_release.sh <data/web> <output dir>}
RELEASE=${RELEASE:-$(date +%Y-%m-%d)}

# macOS tar writes AppleDouble files for extended attributes, which land in the archive and then
# on the server. This turns that off.
export COPYFILE_DISABLE=1

if [ ! -f "$WEB/manifest.json" ]; then
  echo "$WEB holds no manifest.json, so it is not a built data tree." >&2
  exit 1
fi

mkdir -p "$OUT"
echo "Release $RELEASE from $WEB into $OUT"

# The small files the site reads before anything else, plus the protein bundles.
INDEX_ITEMS=(
  manifest.json concepts.json features.json concept_columns.json concept_coverage.bin
  concept_coverage.json concept_proteins.bin depth.bin latent_locality.bin latent_locality.json
  protein_lookup.json proteins
)
for extra in structures_backfill.json structures_from_ebi.txt; do
  [ -e "$WEB/$extra" ] && INDEX_ITEMS+=("$extra")
done

echo "  indexes.tar.gz"
tar -C "$WEB" -czf "$OUT/indexes.tar.gz" "${INDEX_ITEMS[@]}"
for part in feature tracks structures; do
  echo "  $part.tar"
  tar -C "$WEB" -cf "$OUT/$part.tar" "$part"
done

python3 - "$WEB" "$OUT" "$RELEASE" <<'PY'
import hashlib, json, sys
from pathlib import Path

web, out, release = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]

def sha256(path):
    h = hashlib.sha256()
    with path.open('rb') as fh:
        for block in iter(lambda: fh.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()

def files_in(root):
    return sum(1 for p in root.rglob('*') if p.is_file())

# The index bundle covers several folders, so its count is everything outside the other three.
parts = {}
big = ['feature', 'tracks', 'structures']
for name in big:
    archive = out / f'{name}.tar'
    parts[archive.name] = {
        'dir': name,
        'bytes': archive.stat().st_size,
        'files': files_in(web / name),
        'sha256': sha256(archive),
    }
# The index bundle carries the top-level files and the protein bundles. It counts the folder it
# owns, and its loose files are listed by name, because a count of "." would also count the
# other three parts.
index = out / 'indexes.tar.gz'
parts[index.name] = {
    'dir': 'proteins',
    'bytes': index.stat().st_size,
    'files': files_in(web / 'proteins'),
    'sha256': sha256(index),
}

counts = json.loads((web / 'manifest.json').read_text())['counts']
doc = {
    'release': release,
    'zenodo_record': '',
    'source': 'dashboard/deploy/make_release.sh',
    'expect': {k: counts[k] for k in ('proteins', 'structures') if k in counts},
    'expect_files': sorted(f.name for f in web.iterdir() if f.is_file()),
    'parts': parts,
}
(out / 'data-release.json').write_text(json.dumps(doc, indent=2) + '\n')
total = sum(p['bytes'] for p in parts.values())
print(f"  {len(parts)} parts, {total / 1e9:.1f} GB, {sum(p['files'] for p in parts.values()):,} files")
print(f"  wrote {out / 'data-release.json'}")
PY

echo
echo "Next: upload the four archives to one Zenodo record, then put the record id into"
echo "data-release.json or into .env, and copy data-release.json beside docker-compose.yml."
