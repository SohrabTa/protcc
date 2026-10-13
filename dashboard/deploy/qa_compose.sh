#!/usr/bin/env bash
# End-to-end test of the compose setup, against a local copy of a data release.
#
#   ./qa_compose.sh ../data/release qa.log
#
# It copies this folder and the site code into a temporary folder, with the data-release.json of
# the release, and runs everything there under its own project name and volume. So the .env, the
# volume and the containers of a real host on this machine stay untouched. A local web server
# gives the parts to the fetch container, so the test does not depend on Zenodo.
#
# Each check prints one line "QA PASS ..." or "QA FAIL ...". The exit code is 1 when a check
# failed. The last lines give the numbers that RUNBOOK.md quotes: the times, the size of the
# volume and the sizes of the images.
#
# Checks, in order:
#   1. A first start with an empty volume: the build, the fetch of every part, and the start of web
#   2. web becomes healthy
#   3. The smoke test on the host, and on the network of the containers
#   4. A second start fetches nothing
#   5. VERIFY=1 after one deleted file fetches only the part of that file, and the file is back
#   6. Behind nginx under /protcc/: the redirect and the smoke test
#   7. The default BIND_ADDRESS answers on 127.0.0.1 and not on the LAN address
#   8. A part that the server does not have fails at once, with "not found"
#   9. A wrong checksum fails the start, and web does not start
#
# Needs: docker with compose, python3, curl, rsync. On Linux the LAN check uses `hostname -I`.

set -uo pipefail

REL=$(cd "${1:?usage: qa_compose.sh <release dir> [log file]}" && pwd)
LOG=${2:-qa_compose.log}
HERE=$(cd "$(dirname "$0")" && pwd)
P=protcc-qa
PORT=8090
PROXY_PORT=8091
MIRROR_PORT=8765
WORK=$(mktemp -d)
FAILED=0

exec > >(tee "$LOG") 2>&1

say() { echo "$(date +%H:%M:%S)  $*"; }
pass() { say "QA PASS  $*"; }
fail() { say "QA FAIL  $*"; FAILED=1; }
dc() { docker compose -p "$P" "$@"; }

cleanup() {
  cd "$WORK/dashboard/deploy" 2>/dev/null && dc down -v >/dev/null 2>&1
  docker rm -f "$P-proxy" >/dev/null 2>&1
  [ -n "${MIRROR_PID:-}" ] && kill "$MIRROR_PID" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

say "Release $(python3 -c "import json;print(json.load(open('$REL/data-release.json'))['release'])") from $REL"
say "Code from $(git -C "$HERE" rev-parse --short HEAD), with the changes of the working tree"
say "Docker $(docker version --format '{{.Server.Version}}'), $(docker compose version)"

# The deploy folder and the site code, without the data tree and the build output.
mkdir -p "$WORK/dashboard"
rsync -a --exclude data --exclude node_modules --exclude dist --exclude __pycache__ \
  --exclude .env "$HERE/../deploy" "$HERE/../web" "$WORK/dashboard/"
cp "$HERE/../.dockerignore" "$WORK/dashboard/" 2>/dev/null
cp "$REL/data-release.json" "$WORK/dashboard/deploy/data-release.json"
cd "$WORK/dashboard/deploy"
printf 'BASE_URL=http://host.docker.internal:%s\nPORT=%s\n' "$MIRROR_PORT" "$PORT" > .env
# host.docker.internal exists on Docker Desktop. On Linux this line adds it.
cat > docker-compose.override.yml <<'YML'
services:
  fetch-data:
    extra_hosts:
      - "host.docker.internal:host-gateway"
YML

python3 -m http.server "$MIRROR_PORT" --bind 127.0.0.1 --directory "$REL" >/dev/null 2>&1 &
MIRROR_PID=$!
sleep 1

health() {
  local t0=$SECONDS s
  while [ $((SECONDS - t0)) -lt 120 ]; do
    s=$(docker inspect -f '{{.State.Health.Status}}' "$P-web-1" 2>/dev/null)
    [ "$s" = healthy ] && { echo $((SECONDS - t0)); return 0; }
    sleep 1
  done
  echo "never, last state $s"
  return 1
}

# 1. The first start.
dc down -v >/dev/null 2>&1
t0=$SECONDS
if dc up -d --build >/dev/null 2>"$WORK/up.err"; then
  pass "first start with an empty volume: $((SECONDS - t0)) s"
else
  fail "first start: $(tail -3 "$WORK/up.err")"
fi
dc logs --no-log-prefix fetch-data | tail -3

# 2. Health.
if h=$(health); then pass "web is healthy $h s after the first start"; else fail "web healthy: $h"; fi

# 3. The smoke test, from the host and from the network of the containers.
if python3 fetch/smoke_test.py "http://127.0.0.1:$PORT/" > "$WORK/smoke.log"; then
  pass "smoke test from the host: $(tail -1 "$WORK/smoke.log")"
else
  fail "smoke test from the host:"; grep FAIL "$WORK/smoke.log"
fi
if dc run --rm --no-deps --entrypoint python fetch-data /app/smoke_test.py http://web/ \
    > "$WORK/smoke2.log" 2>/dev/null; then
  pass "smoke test on the network of the containers: $(tail -1 "$WORK/smoke2.log")"
else
  fail "smoke test on the network of the containers:"; grep FAIL "$WORK/smoke2.log"
fi

# 4. A second start.
t0=$(python3 -c 'import time;print(time.time())')
dc up -d >/dev/null 2>&1
t1=$(python3 -c 'import time;print(time.time())')
if dc logs --no-log-prefix --tail 2 fetch-data | grep -q "is current"; then
  pass "second start: $(python3 -c "print(f'{$t1 - $t0:.2f}')") s, nothing to fetch"
else
  fail "second start fetched something"
fi

# 5. VERIFY repairs one deleted file.
f=$(docker run --rm -v "${P}_dashboard-data:/data" alpine sh -c \
  'f=$(ls /data/tracks/Q9 | head -1); rm "/data/tracks/Q9/$f"; echo "$f"')
VERIFY=1 dc up fetch-data > "$WORK/verify.log" 2>&1
fetched=$(grep -cE '\.tar(\.gz)? is in place' "$WORK/verify.log")
back=$(docker run --rm -v "${P}_dashboard-data:/data" alpine sh -c "test -f /data/tracks/Q9/$f && echo yes")
if [ "$fetched" = 1 ] && [ "$back" = yes ]; then
  pass "VERIFY=1 after deleting tracks/Q9/$f: $fetched part fetched again, the file is back"
else
  fail "VERIFY=1: $fetched parts fetched, file back: ${back:-no}"
fi

# 6. Behind nginx under /protcc/, with the snippet of RUNBOOK.md step 6 (the upstream is the
# container name here, because the proxy runs in a container on the same network).
docker rm -f "$P-proxy" >/dev/null 2>&1
cat > "$WORK/proxy.conf" <<'NGINX'
server {
  listen 80;
  location = /protcc {
    absolute_redirect off;
    return 301 /protcc/;
  }
  location /protcc/ {
    proxy_pass http://web:80/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
NGINX
docker run -d --rm --name "$P-proxy" --network "${P}_default" -p "127.0.0.1:$PROXY_PORT:80" \
  -v "$WORK/proxy.conf:/etc/nginx/conf.d/default.conf:ro" nginx:1.27-alpine >/dev/null
sleep 2
loc=$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' "http://127.0.0.1:$PROXY_PORT/protcc")
if [ "$loc" = "301 http://127.0.0.1:$PROXY_PORT/protcc/" ]; then
  pass "the proxy sends /protcc to /protcc/"
else
  fail "the proxy redirect: $loc"
fi
if python3 fetch/smoke_test.py "http://127.0.0.1:$PROXY_PORT/protcc/" > "$WORK/smoke3.log"; then
  pass "smoke test behind nginx under /protcc/: $(tail -1 "$WORK/smoke3.log")"
else
  fail "smoke test behind nginx:"; grep FAIL "$WORK/smoke3.log"
fi

# 7. The site answers on the loopback address only.
lan=$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | cut -d' ' -f1)
code=$(curl -sS -m 5 -o /dev/null -w '%{http_code}' "http://$lan:$PORT/" 2>/dev/null)
if [ "$(docker port "$P-web-1" 80)" = "127.0.0.1:$PORT" ] && [ "$code" = 000 ]; then
  pass "the port is 127.0.0.1:$PORT, and $lan:$PORT does not answer"
else
  fail "the port: $(docker port "$P-web-1" 80), $lan:$PORT answered $code"
fi

# 8. A part that the server does not have fails at once.
python3 - "$REL/data-release.json" "$WORK/missing.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
d["parts"]["no-such-part.tar"] = {"dir": "feature", "bytes": 1, "files": 0, "sha256": "0" * 64}
json.dump(d, open(sys.argv[2], "w"))
PY
t0=$SECONDS
dc run --rm --no-deps -v "$WORK/missing.json:/release/data-release.json:ro" fetch-data \
  > "$WORK/missing.log" 2>&1
rc=$?
if [ $rc -ne 0 ] && grep -q "not found" "$WORK/missing.log"; then
  pass "a part that the server does not have: exit $rc after $((SECONDS - t0)) s, \"not found\""
else
  fail "a missing part: exit $rc"; tail -3 "$WORK/missing.log"
fi

# 9. A wrong checksum stops the start, and web does not start.
cp data-release.json "$WORK/good.json"
python3 - <<'PY'
import json
d = json.load(open("data-release.json"))
d["parts"]["indexes.tar.gz"]["sha256"] = "0" * 64
json.dump(d, open("data-release.json", "w"))
PY
dc rm -sf web >/dev/null 2>&1
RETRIES=2 dc up -d > "$WORK/bad.log" 2>&1
rc=$?
running=$(docker inspect -f '{{.State.Running}}' "$P-web-1" 2>/dev/null || echo none)
if [ $rc -ne 0 ] && [ "$running" != true ]; then
  pass "a wrong checksum: up exits $rc, and web does not run"
else
  fail "a wrong checksum: up exit $rc, web running: $running"
fi
cp "$WORK/good.json" data-release.json
dc up -d >/dev/null 2>&1
if h=$(health); then pass "after the repair of the release file, web is healthy again"; else fail "web after the repair"; fi

# The numbers that RUNBOOK.md quotes.
kib=$(docker run --rm -v "${P}_dashboard-data:/data" alpine du -sk /data | cut -f1)
say "volume: $kib KiB, $(python3 -c "print(f'{$kib * 1024 / 1e9:.1f}')") GB"
for s in web fetch-data; do
  say "image $s: $(docker image inspect -f '{{.Size}}' "$P-$s" | python3 -c 'import sys;print(f"{int(sys.stdin.read())/1e6:.1f} MB")')"
done

if [ $FAILED -eq 0 ]; then say "QA: all checks passed."; else say "QA: a check failed."; fi
exit $FAILED
