#!/usr/bin/env bash
#
# Deploys the current checkout, and puts it back if it does not come up.
#
#   deploy/scripts/deploy.sh              # deploy origin/main
#   deploy/scripts/deploy.sh v2.1.0       # deploy a tag
#   deploy/scripts/deploy.sh --no-pull    # build and restart what is here now
#
# What it does *not* do is touch the database. No migration runs here and no
# index is created: `npm run db:indexes -w @hadiya/api` is a separate, explicit
# command, because a schema change that needs an index needs a person deciding
# when to build it. A deploy script that quietly reshapes a database is how a
# routine release becomes an outage.
#
# Rollback is by git revision. The revision that was running is recorded before
# anything changes, and restored if the new one fails its health check. That
# covers the application; it cannot undo a database change, which is the other
# reason this script does not make any.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${REPO_ROOT}"

TARGET="${1:-origin/main}"
PULL=1
[[ "${TARGET}" == "--no-pull" ]] && { PULL=0; TARGET=""; }

HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:4000/api/health/ready}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-30}"
PM2_NAME="${PM2_NAME:-hadiya-api}"
WEB_ROOT="${WEB_ROOT:-/var/www/hadiya}"

log() { echo "[$(date -u +%FT%TZ)] $*"; }
fail() { echo "[$(date -u +%FT%TZ)] ERROR: $*" >&2; exit 1; }

PREVIOUS="$(git rev-parse HEAD)"
log "currently running ${PREVIOUS}"

# --- 1. Refuse to deploy a configuration that will not run -------------------
log "checking the production configuration"
npm run --silent check:production -w @hadiya/api \
  || fail "the configuration is not production-ready; nothing was changed"

# --- 2. Fetch ---------------------------------------------------------------
if [[ "${PULL}" == "1" ]]; then
  log "fetching ${TARGET}"
  git fetch --all --tags --quiet
  git -c advice.detachedHead=false checkout --quiet "${TARGET}"
  git pull --ff-only --quiet 2>/dev/null || true
fi

NEXT="$(git rev-parse HEAD)"
log "deploying ${NEXT}"

# --- 3. Build ---------------------------------------------------------------
# `npm ci` rather than `install`: the lockfile is the contract, and a deploy is
# the last place to discover a dependency drifted.
log "installing dependencies"
npm ci --silent

log "building"
npm run build --silent || fail "the build failed; nothing was restarted and ${PREVIOUS} is still running"

# --- 4. Publish the frontend ------------------------------------------------
if [[ -d "${WEB_ROOT}" ]]; then
  log "publishing the frontend to ${WEB_ROOT}"
  # --delete removes files from the previous build, so a stale asset cannot be
  # served alongside a new index.html that does not reference it.
  rsync -a --delete apps/web/dist/ "${WEB_ROOT}/"
else
  log "no ${WEB_ROOT}; skipping the frontend (set WEB_ROOT if Nginx serves it elsewhere)"
fi

# --- 5. Restart the API -----------------------------------------------------
#
# One process, so this is a restart and not a handover: there is a gap of a
# second or two during which the API is not answering, and Nginx returns 502.
# That is the honest cost of a single-instance deployment and is documented as
# such — nothing here is zero-downtime.
log "restarting the API"
pm2 restart "${PM2_NAME}" --update-env >/dev/null 2>&1 \
  || pm2 start ecosystem.config.cjs >/dev/null \
  || fail "could not start the API under PM2"

# --- 6. Verify --------------------------------------------------------------
log "waiting for the API to report ready"
HEALTHY=0

for attempt in $(seq 1 "${HEALTH_ATTEMPTS}"); do
  if curl -fsS -m 5 "${HEALTH_URL}" >/dev/null 2>&1; then
    HEALTHY=1
    log "healthy after ${attempt} attempt(s)"
    break
  fi

  sleep 2
done

# --- 7. Roll back if it did not come up -------------------------------------
if [[ "${HEALTHY}" != "1" ]]; then
  log "the new version never became ready; rolling back to ${PREVIOUS}"
  git -c advice.detachedHead=false checkout --quiet "${PREVIOUS}"
  npm ci --silent
  npm run build --silent
  [[ -d "${WEB_ROOT}" ]] && rsync -a --delete apps/web/dist/ "${WEB_ROOT}/"
  pm2 restart "${PM2_NAME}" --update-env >/dev/null 2>&1 || true

  for attempt in $(seq 1 "${HEALTH_ATTEMPTS}"); do
    if curl -fsS -m 5 "${HEALTH_URL}" >/dev/null 2>&1; then
      fail "rolled back to ${PREVIOUS}, which is healthy. The deploy of ${NEXT} failed."
    fi

    sleep 2
  done

  fail "rolled back to ${PREVIOUS} and it is ALSO unhealthy. Investigate before deploying again."
fi

pm2 save >/dev/null 2>&1 || true

log "deployed ${NEXT} (previous ${PREVIOUS})"
log "run a smoke test:  deploy/scripts/smoke-test.sh https://your-host"
log "if a schema change needs indexes:  npm run db:indexes -w @hadiya/api"
