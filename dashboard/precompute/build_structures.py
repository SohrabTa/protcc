#!/usr/bin/env python
"""Stage 6. An AlphaFold backbone for every protein in the evaluation set.

The dashboard colours a structure by a latent's activation. That needs coordinates for all
207,463 proteins, offline, with no request to EBI at view time.

## Where the models come from

Foldcomp (Kim, Mirdita and Steinegger, Bioinformatics 39(4) 2023, btad153) encodes predicted
structures as torsion angles at about 13 bytes per residue, and publishes prebuilt databases.
`afdb_swissprot_v4` is 2.9 GB against EBI's 28.6 GB tar of the same models, and it carries an
accession index, so we extract exactly our proteins. Download it once with
`python -c "import foldcomp; foldcomp.setup('afdb_swissprot')"`.

Foldcomp has no JavaScript binding, so it cannot serve the browser. It is the source format
only; this stage decodes and rewrites.

## What we write, and what we are not writing yet

Backbone-only mmCIF, gzipped. Measured on a 366-residue model: 59.6 bytes per residue, so about
3.73 GB for the evaluation set. Mol* reads mmCIF natively.

BinaryCIF would be 25.7 bytes per residue gzipped, about 1.61 GB, and it is the format we
eventually want. It is deferred on purpose. The converter that produces it is a Node tool that
ships with Mol*, and the cluster container is a PyTorch image; the Python library `ciftools` can
encode BinaryCIF but authoring a correct `atom_site` category against it carries a validation
risk not worth taking before the viewer exists. This stage is a leaf of the pipeline, so the
format can change later without touching anything upstream. The cost of waiting is 2.1 GB.

Backbone rather than alpha carbons alone: a ribbon has to know which way the band faces at each
residue, and that comes from the four backbone atoms. Alpha carbons alone can only be drawn as a
round tube. Backbone costs about three times an alpha-carbon store and keeps the shape.

## Two traps this script handles

Foldcomp **skips ids it does not hold, with a warning**, so zipping the returned entries against
the requested list silently misaligns everything after the first miss. The accession is
therefore parsed from each entry's own title, which ends in parentheses, and checked against the
request.

The database keys are full file names such as `AF-P0CW76-F1-model_v4.pdb`, and the model version
is part of the key. They are read from the `.lookup` file rather than constructed, so a database
built on a different AlphaFold release still resolves.

Reads
-----
<db>, <db>.lookup     the Foldcomp database and its accession index
<protein_ids>         protein_ids.json from stage 1 or stage 5, the accessions to extract
<shard_index>         optional, stage 2's shard_index.json, to group the output like the tracks

Writes
------
<out>/structures/<first two characters>/<accession>.cif.gz
<out>/tars/shard_<i>.tar    when --shard-index is given
<out>/missing.txt           accessions with no model, one per line
<out>/manifest.json

Repro
-----
uv run python build_structures.py --db <path>/afdb_swissprot --protein-ids <path> --out <dir>
Deterministic, no randomness, no seed.
"""

import argparse
import gzip
import io
import json
import re
import tarfile
import time
from datetime import date
from pathlib import Path

BACKBONE = ("N", "CA", "C", "O")
ACC_IN_TITLE = re.compile(r"\(([A-Z0-9]+)\)\s*$")

CIF_HEADER = """data_{acc}
#
_entry.id {acc}
#
loop_
_atom_site.group_PDB
_atom_site.id
_atom_site.type_symbol
_atom_site.label_atom_id
_atom_site.label_comp_id
_atom_site.label_asym_id
_atom_site.label_seq_id
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
_atom_site.occupancy
_atom_site.B_iso_or_equiv
_atom_site.pdbx_PDB_model_num
"""


def pdb_to_backbone_cif(acc, pdb):
    """The backbone atoms of one AlphaFold PDB entry, as a minimal mmCIF."""
    rows, n = [], 0
    for line in pdb.split("\n"):
        if not line.startswith("ATOM"):
            continue
        atom = line[12:16].strip()
        if atom not in BACKBONE:
            continue
        n += 1
        element = line[76:78].strip() or atom[0]
        rows.append(
            f"ATOM {n} {element} {atom} {line[17:20].strip()} A {int(line[22:26])} "
            f"{float(line[30:38]):.3f} {float(line[38:46]):.3f} {float(line[46:54]):.3f} "
            f"1.00 {float(line[60:66] or 0):.2f} 1")
    if not rows:
        return None, 0
    body = CIF_HEADER.format(acc=acc) + "\n".join(rows) + "\n#\n"
    return body, n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", type=Path, required=True,
                    help="the Foldcomp database, without a suffix")
    ap.add_argument("--protein-ids", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--shard-index", type=Path, default=None,
                    help="stage 2's shard_index.json; groups the output into one tar per shard")
    ap.add_argument("--batch", type=int, default=2000)
    ap.add_argument("--limit", type=int, default=None, help="stop early, for a smoke test")
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)

    import foldcomp

    wanted = json.loads(a.protein_ids.read_text())
    if a.limit:
        wanted = wanted[:a.limit]
    want_set = set(wanted)

    lookup = {}
    version = None
    for line in open(f"{a.db}.lookup"):
        key = line.split("\t")[1].strip()
        acc = key.split("-")[1] if key.startswith("AF-") else key
        lookup[acc] = key
        if version is None and "model_" in key:
            version = key.split("model_")[1].split(".")[0]
    print(f"database holds {len(lookup):,} accessions, AlphaFold {version}")

    missing_from_db = [p for p in wanted if p not in lookup]
    present = [p for p in wanted if p in lookup]
    print(f"requested {len(wanted):,}: {len(present):,} in the database, "
          f"{len(missing_from_db):,} absent")

    shard_of = {}
    if a.shard_index:
        for s, ids in json.loads(a.shard_index.read_text()).items():
            for pid in ids:
                shard_of[pid] = s
        (a.out / "tars").mkdir(exist_ok=True)
        tars = {}
    else:
        (a.out / "structures").mkdir(exist_ok=True)
        tars = None

    written, no_atoms, total_bytes, unexpected = 0, [], 0, 0
    mtime = int(time.time())
    returned = set()

    for i in range(0, len(present), a.batch):
        chunk = present[i:i + a.batch]
        with foldcomp.open(str(a.db), ids=[lookup[p] for p in chunk]) as db:
            for title, pdb in db:
                m = ACC_IN_TITLE.search(title.strip())
                # The accession comes from the entry, never from the request order:
                # foldcomp drops ids it does not hold and everything after would shift.
                if not m or m.group(1) not in want_set:
                    unexpected += 1
                    continue
                acc = m.group(1)
                returned.add(acc)
                body, n_atoms = pdb_to_backbone_cif(acc, pdb)
                if body is None:
                    no_atoms.append(acc)
                    continue
                blob = gzip.compress(body.encode(), 9)
                rel = f"structures/{acc[:2].upper()}/{acc}.cif.gz"
                if tars is not None:
                    s = shard_of.get(acc, "unknown")
                    if s not in tars:
                        tars[s] = tarfile.open(a.out / "tars" / f"shard_{s}.tar", "w")
                    info = tarfile.TarInfo(rel)
                    info.size, info.mtime, info.mode = len(blob), mtime, 0o644
                    tars[s].addfile(info, io.BytesIO(blob))
                else:
                    p = a.out / rel
                    p.parent.mkdir(parents=True, exist_ok=True)
                    p.write_bytes(blob)
                total_bytes += len(blob)
                written += 1
        print(f"  {min(i + a.batch, len(present)):>7,}/{len(present):,}  "
              f"written {written:>7,}  {total_bytes / 1e9:>5.2f} GB")

    if tars:
        for t in tars.values():
            t.close()

    never_returned = sorted(set(present) - returned)
    missing = sorted(set(missing_from_db) | set(never_returned) | set(no_atoms))
    (a.out / "missing.txt").write_text("\n".join(missing))

    manifest = {
        "stage": "6-structures",
        "built": date.today().isoformat(),
        "format": "backbone mmCIF, gzip",
        "deferred": "BinaryCIF, about 1.61 GB against 3.73 GB; see the module docstring",
        "db": str(a.db), "alphafold_version": version,
        "layout": "tar-per-shard" if tars is not None else "files",
        "requested": len(wanted), "written": written,
        "absent_from_db": len(missing_from_db),
        "requested_but_not_returned": len(never_returned),
        "returned_without_atoms": len(no_atoms),
        "unexpected_entries": unexpected,
        "bytes": int(total_bytes),
    }
    (a.out / "manifest.json").write_text(json.dumps(manifest, indent=2))

    print(f"\nwrote {a.out}/")
    print(f"  {written:,} structures, {total_bytes / 1e9:.2f} GB, "
          f"mean {total_bytes / max(written, 1) / 1e3:.1f} kB")
    print(f"  missing: {len(missing)} (see missing.txt)")


if __name__ == "__main__":
    main()
