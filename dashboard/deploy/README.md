# Hosting the dashboard

The dashboard is a static site. It has no backend, no database and no server code. Everything a
reader sees is a file, so hosting it is two jobs: put the data tree on the host, then serve a
folder. This folder does both with `docker compose`.

```bash
cp .env.example .env      # put the Zenodo record id in it
docker compose up -d      # the first start downloads about 11.5 GB
```

The site then answers on port 8080. Change `PORT` in `.env` to move it.

## What the two containers do

| Container | What it is | When it runs |
|---|---|---|
| `fetch-data` | A Python script with no dependencies. It downloads four tar archives from Zenodo and unpacks them into a named volume. | On every `up`, and it exits at once when the data is already current. |
| `web` | nginx over the built site. The data volume is mounted read-only under `/data`. | After `fetch-data` succeeds. |

Compose waits with `condition: service_completed_successfully`, so the site never starts over a
half-written data tree. A failed download leaves the old site running and the new one down.

## The first start, and every start after it

The first start downloads about 11.5 GB and unpacks 423,258 files. On a 100 Mbit line that is
about 20 minutes, and the unpack is limited by the disk.

Every later start reads `/data/.release.json`, compares it against `data-release.json`, finds
every part current and exits. Measured: under one second. So `docker compose up -d` after a
reboot or an image update costs nothing.

A part is compared by its sha256, so a new data release replaces only the parts that changed.

| Variable | What it does |
|---|---|
| `ZENODO_RECORD` | The record id. It overrides the one in `data-release.json`. |
| `PORT` | The port the site answers on. 8080 by default. |
| `FORCE=1` | Fetch every part again, whatever the marker says. |
| `VERIFY=1` | Count the files of every part against the release. This is the check to run after a disk problem, because a tar that ends early leaves a tree that looks right. |
| `BASE_URL` | Read the parts from somewhere else, for a mirror or for a test. |

Examples:

```bash
VERIFY=1 docker compose up fetch-data     # check the tree, repair what is short
FORCE=1 docker compose up fetch-data      # fetch everything again
docker compose logs -f fetch-data         # watch a download
```

## Disk

| | |
|---|---:|
| the volume, unpacked | about 11.5 GB |
| downloaded during the first start | about 11.5 GB |
| the two images | about 80 MB |

Nothing else grows. The data tree is immutable for a release, and nginx writes no access log for
`/data/`.

## Publishing a new data release

Run this where the built tree is, not on the server.

```bash
./make_release.sh ../data/web /tmp/protcc-release
```

It writes four archives and a `data-release.json`. Upload the four archives to one Zenodo record,
put the record id into that file, and copy it here beside `docker-compose.yml`. The next
`docker compose up -d` on any host picks up the change and fetches only the parts whose checksum
moved.

The four parts follow the shape of the tree:

| Part | Holds | About |
|---|---|---:|
| `indexes.tar.gz` | the small files the site reads first, and the 208 protein bundles | 110 MB |
| `feature.tar` | one ranking file for each of the 8,128 live latents | 920 MB |
| `tracks.tar` | the per-residue activations, one file per protein | 6.4 GB |
| `structures.tar` | the AlphaFold backbones, one gzipped mmCIF per protein | 4.1 GB |

Only the index bundle is compressed. The other three are already binary or already gzipped, so
compressing them costs an hour and saves almost nothing.

## Two rules in the nginx config that matter

**A missing data file must answer 404.** The routes of the site fall back to `index.html`,
because the router is hash-based and a deep link has to resolve. A blanket fallback also catches
`/data/…`, and a missing data file then answers 200 with HTML. The page reports a parse error and
nobody looks for the missing file. So `/data/` has its own rule with `try_files $uri =404`.

**A `.cif.gz` is served as `application/gzip`, never with `Content-Encoding: gzip`.** The page
decompresses those files itself. With the header, the browser would decompress them first and the
page would then try to decompress plain text.

## What this does not do

The site loads three fonts from Google. That is the one request it makes to anything outside the
host, and it is not needed for the site to work. Vendoring them is open work.

There is no TLS here and no name. Put this behind whatever already terminates TLS on the host.
The container answers plain HTTP on one port and holds no state beyond the data volume.

## When something is wrong

| What you see | What it is |
|---|---|
| `lists no parts` | `data-release.json` is still the placeholder. Publish a release first. |
| `No Zenodo record id` | `ZENODO_RECORD` is empty and the release file carries no id. |
| `checksum is …, the release says …` | The download was truncated or the record changed. The script retries three times, then exits non-zero and the web container does not start. |
| `manifest counts.proteins is …` | The archives and `data-release.json` are from different builds. |
| The site loads but every panel is empty | The data volume is not mounted. Check `docker compose config`. |
