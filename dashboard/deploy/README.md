# Host the dashboard

The dashboard is a static site. It has no backend, no database and no server code. Each thing that
a reader sees is a file, so hosting has two tasks: put the data tree on the host, then serve a
folder. This folder does the two tasks with `docker compose`.

To host the site, follow [RUNBOOK.md](RUNBOOK.md). It gives the steps, a check for each step,
the operations, and what to do when a check fails. This README is for the maintainer of the
data release.

## The files in this folder

| File | What it is |
|---|---|
| `RUNBOOK.md` | The steps for a host, for a person or for an agent |
| `docker-compose.yml` | The two containers and the data volume |
| `.env.example` | The settings of a host |
| `data-release.json` | The release that a host fetches: the Zenodo record, and the size, file count and sha256 of each part |
| `fetch/fetch_data.py` | The setup container. It puts the data tree into the volume, and it does nothing when the tree is current. |
| `fetch/smoke_test.py` | The check of a running site, with the requests that a browser makes |
| `web/` | The nginx image that builds the site and serves it |
| `make_release.sh` | It packs a built data tree into the parts of a release. |
| `zenodo_upload.py` | It uploads a release to a Zenodo draft, and publishes it only when you ask. |
| `zenodo-metadata.json` | The title, creators, license and description of the Zenodo record |

## How the two containers work

| Container | What it is | When it runs |
|---|---|---|
| `fetch-data` | A Python script with no dependencies. It downloads the parts from Zenodo and unpacks them into a named volume. | At each `up`. It stops at once when the data is current. |
| `web` | nginx over the built site. The data volume is mounted read-only under `/data`. | After `fetch-data` stopped without an error |

Compose waits with `condition: service_completed_successfully`. Thus the site never starts over a
data tree that is half written. A failed download leaves the old site running and the new one
down.

The fetch is idempotent by checksum. Each unpacked part writes its sha256 into
`/data/.release.json`. A later start compares that file with `data-release.json` and fetches only
the parts whose checksum changed. When no part changed, the start takes less than 1 second.

## The parts of a release

Zenodo gave one connection about 0.3 to 0.4 MB/s on 2026-10-13, from a home line and from the
LRZ cluster. Parallel downloads add up: 8 together moved 3.72 MB/s from the Mac and 8.93 MB/s from
LRZ. Parallel uploads do not: with 2 or 3 at the same time, one of them failed each time. Thus a
release has many small parts. The fetch container downloads 8 of them at a time, and
`zenodo_upload.py` uploads one at a time, with retries.

| Part | Holds |
|---|---|
| `indexes.tar.gz` | The small files that the site reads first, and the 208 protein bundles |
| `feature.tar.gz` | One ranking file for each of the 8,128 live latents |
| `tracks-NN.tar.gz` | The per-residue activations, one file per protein, in groups of whole two-character subfolders of at most about 400 MB before compression |
| `structures-NN.tar.gz` | The AlphaFold backbones, one gzipped mmCIF per protein, grouped in the same way |

Each part is gzipped. We measured gzip -6 on one part of each kind on 2026-10-13. It shrank a part
of the tracks to 0.600 of its size, the rankings to 0.448, and a part of the structures to 0.923. An
upload moves about 0.3 MB/s, so each GB that compression saves is about one hour of upload.

The release of 2026-10-13 has 33 parts and 423,258 files: 8.6 GB to download, and 12.4 GB on the
disk after the unpack. Its largest part is `structures-10.tar.gz` with 480 MB. `make_release.sh`
packed it in 6 min 45 s.

## Publish a new data release

Do this on the machine that holds the built tree, not on the server.

```bash
./make_release.sh ../data/web ../data/release
python3 zenodo_upload.py ../data/release --new-version-of <record id>
```

`zenodo_upload.py` needs a Zenodo token with the scopes `deposit:write` and `deposit:actions` in
`~/.zenodo-token`. It makes a draft, uploads the parts, sets the metadata, and writes the draft id
into `../data/release/data-release.json`. When an upload stops, run it again with
`--draft <id>`, and it uploads only what is missing. On a laptop with a VPN or a company tailnet,
set `UPLOAD_INTERFACE` to the interface of the home line, for example `UPLOAD_INTERFACE=en14`.
Then the upload cannot go through the VPN or the tailnet.

Examine the draft on zenodo.org. Then publish it. You cannot undo a publication.

```bash
python3 zenodo_upload.py ../data/release --draft <id> --publish
cp ../data/release/data-release.json .
```

Commit `data-release.json`. The next `git pull && docker compose up -d` on a host fetches only the
parts whose checksum changed.

## Two rules in the nginx configuration

A missing data file must answer 404. The routes of the site fall back to `index.html`, because the
router uses the hash and a deep link must resolve. A fallback for all paths also catches
`/data/…`, and a missing data file then answers 200 with HTML. The page then reports a parse
error, and nobody looks for the missing file. Thus `/data/` has its own rule with
`try_files $uri =404`.

A `.cif.gz` file goes out as `application/gzip`, never with `Content-Encoding: gzip`. The page
unpacks these files itself. With the header, the browser would unpack them first, and the page
would then try to unpack plain text.

The health check asks `127.0.0.1`, not `localhost`. In the nginx image, `localhost` resolves to
`::1`, and nginx listens only on IPv4. With `localhost`, the check failed, and `web` was
`unhealthy` while it served the site (measured on 2026-10-13).
