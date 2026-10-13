#!/usr/bin/env bash
# Pack the data tree into the archives that go to Zenodo, and write data-release.json.
#
# Run this on the machine that holds the built tree, not on the server. It reads
# dashboard/data/web and writes to an output folder you name. The output is what you upload, and
# data-release.json is what the fetch container reads to know what to pull and what it should be.
#
#   ./make_release.sh ../data/web ../data/release
#
# The parts follow the shape of the tree. The index files and the protein bundles go into one
# archive, and the latent rankings into one. The residue tracks and the structures are split into
# parts of at most PART_MB megabytes before compression (400 by default), each a group of whole
# two-character subfolders. Zenodo gives one connection about 0.35 MB/s, so a 6.8 GB archive is
# five hours in one stream, and the fetch container downloads small parts in parallel instead.
#
# Every part is gzipped. Measured on 2026-10-13 with gzip -6: a part of the tracks shrinks to
# 0.600 of its size, the rankings to 0.448, and a part of the structures to 0.923, although the
# structures are gzipped files already. An upload to Zenodo moves about 0.3 MB/s, so each GB that
# compression saves is about one hour of upload.
#
# After the upload (zenodo_upload.py), the record id is in data-release.json. Copy that file
# beside docker-compose.yml, and the fetch container needs nothing else.

set -euo pipefail

WEB=${1:?usage: make_release.sh <data/web> <output dir>}
OUT=${2:?usage: make_release.sh <data/web> <output dir>}
RELEASE=${RELEASE:-$(date +%Y-%m-%d)}
PART_MB=${PART_MB:-400}

# macOS tar writes AppleDouble files for extended attributes, which land in the archive and then
# on the server. This turns that off.
export COPYFILE_DISABLE=1

if [ ! -f "$WEB/manifest.json" ]; then
  echo "$WEB holds no manifest.json, so it is not a built data tree." >&2
  exit 1
fi

mkdir -p "$OUT"
echo "Release $RELEASE from $WEB into $OUT, split parts of at most $PART_MB MB"

python3 - "$WEB" "$OUT" "$RELEASE" "$PART_MB" <<'PY'
import hashlib, json, subprocess, sys
from pathlib import Path

web, out, release, part_mb = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3], int(sys.argv[4])
limit = part_mb * 1_000_000

# The small files the site reads before anything else, plus the protein bundles.
INDEX_ITEMS = [
    'manifest.json', 'concepts.json', 'features.json', 'concept_columns.json',
    'concept_coverage.bin', 'concept_coverage.json', 'concept_proteins.bin', 'depth.bin',
    'latent_locality.bin', 'latent_locality.json', 'protein_lookup.json', 'proteins',
]
INDEX_ITEMS += [x for x in ('structures_backfill.json', 'structures_from_ebi.txt')
                if (web / x).exists()]

def files_in(root):
    return [p for p in root.rglob('*') if p.is_file()]

def sha256(path):
    h = hashlib.sha256()
    with path.open('rb') as fh:
        for block in iter(lambda: fh.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()

def tar(archive, items):
    """tar into gzip -n, not tar -z. bsdtar -z writes the time of packing into the gzip header,
    so a second run gave other bytes for the same tree (tested 2026-10-13). Then every checksum
    changes, the upload replaces every part, and every host downloads everything again."""
    print(f'  {archive.name}', flush=True)
    with archive.open('wb') as out_file:
        pack = subprocess.Popen(['tar', '-C', str(web), '-cf', '-', *items],
                                stdout=subprocess.PIPE)
        subprocess.run(['gzip', '-6', '-n'], stdin=pack.stdout, stdout=out_file, check=True)
        pack.stdout.close()
        if pack.wait() != 0:
            raise SystemExit(f'tar failed for {archive.name}')

def groups(folder):
    """Whole subfolders in name order, packed until the next one would pass the limit."""
    out, current, size = [], [], 0
    for sub in sorted(p for p in (web / folder).iterdir() if p.is_dir()):
        n = sum(f.stat().st_size for f in files_in(sub))
        if current and size + n > limit:
            out.append(current)
            current, size = [], 0
        current.append(sub.name)
        size += n
    if current:
        out.append(current)
    return out

parts = {}
def record(archive, folder, members, files):
    parts[archive.name] = {
        'dir': folder,
        **({'members': members} if members else {}),
        'bytes': archive.stat().st_size,
        'files': files,
        'sha256': sha256(archive),
    }

# The index bundle carries the top-level files and the protein bundles. It counts the folder it
# owns, and its loose files are listed under expect_files, because a count of "." would also
# count every other part.
index = out / 'indexes.tar.gz'
tar(index, INDEX_ITEMS)
record(index, 'proteins', None, len(files_in(web / 'proteins')))

feature = out / 'feature.tar.gz'
tar(feature, ['feature'])
record(feature, 'feature', None, len(files_in(web / 'feature')))

for folder in ('tracks', 'structures'):
    for i, members in enumerate(groups(folder)):
        archive = out / f'{folder}-{i:02d}.tar.gz'
        tar(archive, [f'{folder}/{m}' for m in members])
        record(archive, folder, members,
               sum(len(files_in(web / folder / m)) for m in members))

# A part of an older layout must not stay in the folder and get uploaded with the new ones.
for stale in sorted(set(p.name for p in out.glob('*.tar*')) - set(parts)):
    print(f'  removing {stale}, which is not part of this release')
    (out / stale).unlink()

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
biggest = max(p['bytes'] for p in parts.values())
print(f"  {len(parts)} parts, {total / 1e9:.1f} GB, the largest {biggest / 1e6:.0f} MB, "
      f"{sum(p['files'] for p in parts.values()):,} files")
print(f"  wrote {out / 'data-release.json'}")
PY

echo
echo "Next: python3 zenodo_upload.py $OUT, then copy $OUT/data-release.json beside"
echo "docker-compose.yml and commit it."
