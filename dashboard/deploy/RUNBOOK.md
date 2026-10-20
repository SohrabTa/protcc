# Runbook: host the ProtCC Latent Browser

This runbook is for the operator of the Biocentral server at the Rostlab, or for an agent that works
for the operator. Do the steps in order. Each step ends with a check.

The result is a public HTTPS address that shows the dashboard. At that address, the smoke test
prints `All checks passed.`

## What you host

The dashboard is a static web site. It has no backend, no database, no GPU, and no user data.
Docker Compose runs two containers:

| Container | What it does |
|---|---|
| `fetch-data` | It downloads the data release from Zenodo into a Docker volume, then it stops. At each later start, it compares checksums and stops in less than 1 second. |
| `web` | nginx. It serves the site and the data volume on `127.0.0.1:8080`, as plain HTTP. |

The data release is Zenodo record [23335033](https://zenodo.org/records/23335033): 33 parts,
8.6 GB, and 423,258 files. `data-release.json` in this folder gives the record id, and the name, the size
and the sha256 of each part.

Your reverse proxy terminates TLS and forwards the requests to `127.0.0.1:8080`.

## Rules for an agent

1. Do the steps in order. Do the check of a step before you start the next step.
2. When a check fails, stop and report: the step, the command, and the last 30 lines of its
   output. Fix a fault only when the table [When a check fails](#when-a-check-fails) names it.
3. Do not change files in the data volume by hand.
4. Do not run `docker compose down -v` or `docker volume rm`, unless the operator tells you to. The
   two commands delete the data (12.4 GB on the disk), and the next start downloads it again.
5. Do not change `data-release.json`. It must be the same as the file in the repository.
6. Do not set `BIND_ADDRESS=0.0.0.0`, unless the reverse proxy runs on a different machine.

## 1. Examine the host

| What | Command | Pass |
|---|---|---|
| Docker Engine | `docker version --format '{{.Server.Version}}'` | A version number, and no error |
| Docker Compose | `docker compose version` | A version line. The old `docker-compose` (version 1) is not tested. |
| Disk | `df -h "$(docker info --format '{{.DockerRootDir}}')"` | At least 20 GB available |
| The port | `ss -ltn \| grep ':8080 '` | No output. If 8080 is in use, use another port in step 3. |
| Zenodo | `curl -sS -o /dev/null -w '%{http_code}\n' https://zenodo.org/api/records/23335033` | `200` |

The host must connect to these addresses over HTTPS:

- `github.com`, for the code
- `registry-1.docker.io` and its CDN, for the base images `node:22-alpine`, `nginx:1.27-alpine`
  and `python:3.12-alpine`
- `registry.npmjs.org`, because the build of the web image runs `npm ci`
- `zenodo.org`, for the data

## 2. Get the code

```bash
git clone https://github.com/SohrabTa/protcc.git
cd protcc/dashboard/deploy
git rev-parse --short HEAD
```

Check: the folder holds `docker-compose.yml`, `data-release.json` and this file. Write down the
commit that `git rev-parse` gives. You need it for the report in step 7.

## 3. Configure

```bash
cp .env.example .env
```

Change `PORT` in `.env` only if 8080 is in use. Do not change the other values.

Check: `docker compose config --quiet` prints nothing and exits with 0.

## 4. Start

The first start runs for a long time. Use a terminal that stays open when your SSH connection
stops, for example `tmux`.

```bash
docker compose up -d
```

The command waits until the data is in place. To watch the download, use a second terminal:

```bash
docker compose logs -f fetch-data
```

The first start does these things:

1. Compose builds two images, together about 165 MB. The web image runs `npm ci` and the build
   of the site.
2. `fetch-data` downloads the 33 parts from Zenodo, 8 at a time, and unpacks them into
   the volume `protcc-dashboard_dashboard-data`. Each 30 seconds, it writes one line with the
   progress.
3. `web` starts when `fetch-data` stopped without an error.

One connection to Zenodo moved about 0.3 to 0.4 MB/s on 2026-10-13. Together, 8 connections moved
3.7 MB/s from a home line and 8.9 MB/s from the LRZ cluster. From these rates, we estimate 15 to 40
minutes for the 8.6 GB. The fetch tries each part up to 5 times. When a part fails 5 times, the
start stops, and `web` does not start.

When the start stops, or when your SSH connection stops before the end, run `docker compose up -d`
again. The parts that arrived are recorded, so it downloads only the parts that are missing.

Check, when `docker compose up -d` is complete:

- `docker compose logs fetch-data` has the line `207,463 proteins, 207,459 structures, … GB free.`
- The log ends with `Release 2026-10-20 is in place, … GB in … min.`
- `docker compose ps -a` shows `fetch-data` as `Exited (0)` and `web` as `healthy`. The health
  check needs up to 40 seconds after the start of `web`.

## 5. Do the smoke test on the host

With Python 3.9 or later on the host:

```bash
python3 fetch/smoke_test.py http://127.0.0.1:8080/
```

Without Python on the host, the fetch image runs the same test on the network of the containers:

```bash
docker compose run --rm --no-deps --entrypoint python fetch-data /app/smoke_test.py http://web/
```

Check: each line starts with `PASS`, and the last line is `All checks passed.` The exit code is 0.

## 6. Connect the reverse proxy

Agree on the public address with the operator. There are two forms:

- A host name of its own, for example `https://protcc.example.org/`
- A path under a host name that exists, for example `https://biocentral.rostlab.org/protcc/`

The site uses relative paths. So it works under a path, if the proxy removes the path prefix and
the address ends with a slash. We tested the nginx configuration below with nginx 1.27 on
2026-10-13, with the path `/protcc/`:

```nginx
# Inside the server block of the existing HTTPS host.
location = /protcc {
    absolute_redirect off;
    return 301 /protcc/;
}
location /protcc/ {
    # The slash at the end of the address removes the prefix /protcc/.
    proxy_pass http://127.0.0.1:8080/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

For a host name of its own, use `location / { proxy_pass http://127.0.0.1:8080; }` in that server
block.

For a different proxy, configure the same three things:

- Forward to `http://127.0.0.1:8080/`, without the path prefix.
- Send `/protcc` to `/protcc/` with a redirect.
- Do not change the answers. The smoke test finds a proxy that changes the type of a `.cif.gz`
  file or that answers a missing file with 200.

Check:

```bash
python3 fetch/smoke_test.py https://biocentral.rostlab.org/protcc/
```

The last line must be `All checks passed.` Then open the address in a browser:

- The home page shows three panels.
- Open the latent page `#/latent/2358` (add it to the address). After a few seconds, the panel
  "Which residues" shows a 3D model.

## 7. Report

Report these items to the operator:

- The public address
- The commit from step 2
- The release from the log, `2026-10-20`
- The output of the smoke test against the public address
- The output of `docker compose ps -a`

## Operations

| Task | Command | Notes |
|---|---|---|
| Show the state | `docker compose ps -a` | `web` must be `healthy`. |
| Show the logs | `docker compose logs --tail 100 web` | nginx writes no access log for `/data/`. |
| Restart after a reboot | Nothing | `web` has `restart: unless-stopped`. Docker must start at boot: `systemctl is-enabled docker` gives `enabled`. `fetch-data` does not run after a reboot, and it is not necessary. |
| Get a new version of the code | `git pull && docker compose up -d --build` | `fetch-data` finds the data current in less than 1 second. |
| Get a new data release | `git pull && docker compose up -d` | A new `data-release.json` arrives with the code. `fetch-data` downloads only the parts whose checksum changed. |
| Examine the data | `VERIFY=1 docker compose up fetch-data` | It counts the files of each part and downloads again each part that has too few. Do this after a disk fault. A tar that stops early leaves a tree that looks correct, and only the count finds it. |
| Download all the data again | `FORCE=1 docker compose up fetch-data` | 8.6 GB |
| Stop the site | `docker compose stop` | The data stays. |
| Remove the containers | `docker compose down` | The data stays in the volume. |

CAUTION: `docker compose down -v` also deletes the data volume (12.4 GB on the disk). The next
start downloads all of it again. Use this command only when the operator wants to remove the
site.

Settings in `.env`:

| Setting | Default | What it does |
|---|---|---|
| `PORT` | `8080` | The port on the host |
| `BIND_ADDRESS` | `127.0.0.1` | The address on the host. `0.0.0.0` answers on all interfaces. |
| `ZENODO_RECORD` | empty | Overrides the record in `data-release.json` |
| `PARALLEL` | `8` | The number of parts that download at the same time |
| `BASE_URL` | empty | Downloads the parts from a different server, for example a mirror |
| `FORCE`, `VERIFY` | `0` | Give them on the command line, as in the table above. Do not put them in `.env`. |

## When a check fails

| What you see | What it is | What to do |
|---|---|---|
| `attempt 1 of 5 failed: HTTP Error 502` or `504` | Zenodo is overloaded. On 2026-10-13 this occurred many times. | Nothing. The script tries again. If the part fails 5 times, wait one hour and run `docker compose up -d` again. It downloads only the missing parts. |
| `not found. Check ZENODO_RECORD and data-release.json.` | The record does not have this file. | Make sure that `.env` sets no `ZENODO_RECORD`, and that `git status` shows no change to `data-release.json`. |
| `checksum is …, the release says …` | The download is incomplete, or the record does not match the release file. | The script tries again. If it fails 5 times, stop and report. |
| `No Zenodo record id` | `data-release.json` has no record id. | Run `git pull`. If the problem stays, stop and report. |
| `lists no parts` | `data-release.json` is the placeholder of an old commit. | Run `git pull`. |
| `manifest counts.proteins is …` | The parts come from two different releases. | `FORCE=1 docker compose up fetch-data` |
| `web` stays `unhealthy` | nginx does not answer on its own port. | Stop and report, with `docker inspect --format '{{json .State.Health}}' $(docker compose ps -q web)`. |
| The smoke test fails at the host, but passes with `http://web/` | The port setting is wrong. | Compare `docker compose port web 80` with the address of the test. |
| The smoke test fails only behind the proxy | The proxy configuration is wrong. | Compare it with step 6. A missing slash at the end of `proxy_pass` is the most frequent cause. |
| The site loads, but each panel is empty | The data volume is not mounted. | Stop and report, with `docker compose config`. |

## What leaves the host

The containers download only at a start. When a person opens the site, the browser of that person
loads three fonts from `fonts.googleapis.com` and `fonts.gstatic.com` (`web/index.html`). The site
works without them. All other requests go to the host itself.

Examine with your data-protection contact whether the fonts from Google are permitted on a
university site. To serve the fonts from the host is open work in the project (`DEP-01g`).

## What we tested

`qa_compose.sh` in this folder runs these checks end to end, against a local copy of the release.
On 2026-10-13, on macOS 26.6.2 with Docker Desktop 29.8.0 and Docker Compose 5.5.1, all 12 checks
passed. The log is `qa/qa_compose_2026-10-13.log` in this folder. The checks:

- A first start with an empty volume: 227 s
- The health check of `web`, the smoke test from the host and from the network of the containers
- A second start: 0.75 s, with no download
- `VERIFY=1` after we deleted one file: it downloaded only the part of that file again
- The nginx configuration of step 6 under `/protcc/`: the redirect and the smoke test
- The default `BIND_ADDRESS`: the site answered on `127.0.0.1` and not on the LAN address
- A part that the server does not have: the fetch stopped at once with "not found"
- A wrong checksum: the start failed, and `web` did not start

In a browser, the latent page and the concept page showed the 3D model, directly and under
`/protcc/`. The download from Zenodo itself is not tested yet, because the record is a draft until
it is published.

We did not test a Linux host, Podman, or rootless Docker.

## Contact

Sohrab Tawana. Open an issue in [SohrabTa/protcc](https://github.com/SohrabTa/protcc/issues).
