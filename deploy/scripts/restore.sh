#!/usr/bin/env bash
#
# Restores a backup, and verifies the restore rather than assuming it.
#
#   deploy/scripts/restore.sh backups/20260907T120000Z mongodb://127.0.0.1:27017/hadiya-restore-test
#
# The target URI is a required argument with no default, and that is the whole
# safety design of this script: there is no way to run it and accidentally
# restore over the live database, because the live database is never what it
# reaches for on its own. It also refuses a target whose name matches the
# database recorded in the backup unless `--force` is given.
#
# Use it two ways:
#
#   * **A drill.** Restore last night's backup into a scratch database, let the
#     verification below run, then drop it. A backup nobody has restored is a
#     hope, not a backup. `docs/deployment.md` asks for this monthly.
#   * **A real recovery.** Same command, pointed at the real database, with the
#     API stopped first so nothing writes underneath the restore.
set -euo pipefail

SOURCE="${1:-}"
TARGET_URI="${2:-}"
FORCE="${3:-}"

if [[ -z "${SOURCE}" || -z "${TARGET_URI}" ]]; then
  cat >&2 <<'USAGE'
Usage: restore.sh <backup-directory> <target-mongo-uri> [--force]

The target URI is required on purpose: this script will not choose a database
for you, so it cannot pick the live one by accident.
USAGE
  exit 1
fi

[[ -f "${SOURCE}/mongo.archive.gz" ]] || {
  echo "No mongo.archive.gz in ${SOURCE}." >&2
  exit 1
}

command -v mongorestore >/dev/null 2>&1 || {
  echo "mongorestore is not installed (apt install mongodb-database-tools)." >&2
  exit 1
}

TARGET_DB="$(printf '%s' "${TARGET_URI}" | sed -E 's#^.*/([^/?]+)(\?.*)?$#\1#')"
BACKUP_DB="$(grep -E '^database:' "${SOURCE}/manifest.txt" 2>/dev/null | awk '{print $2}' || echo '')"

if [[ -n "${BACKUP_DB}" && "${TARGET_DB}" == "${BACKUP_DB}" && "${FORCE}" != "--force" ]]; then
  cat >&2 <<EOF
The target database is "${TARGET_DB}", which is the one this backup came from.
That is a real recovery, not a drill. Stop the API first, then re-run with
--force as the third argument.
EOF
  exit 1
fi

echo "[$(date -u +%FT%TZ)] restoring ${SOURCE} into database \"${TARGET_DB}\""

gzip -t "${SOURCE}/mongo.archive.gz" || {
  echo "The archive is corrupt; nothing was restored." >&2
  exit 1
}

# The connection URI must not carry a database path here. mongorestore reads a
# database in the URI as `--db`, which conflicts with the namespace remapping
# below and silently restores nothing: it prints "0 document(s) restored
# successfully" and exits zero. So the host is passed on its own and the target
# database is named only by --nsTo.
TARGET_HOST="$(printf '%s' "${TARGET_URI}" | sed -E 's#(mongodb(\+srv)?://[^/]+)/.*#\1#')"

# --drop replaces the target's collections. Safe here because the target is
# always named explicitly and is checked above.
mongorestore --uri="${TARGET_HOST}" --gzip --archive="${SOURCE}/mongo.archive.gz" \
  --drop --nsFrom="${BACKUP_DB:-*}.*" --nsTo="${TARGET_DB}.*" --quiet

echo "[$(date -u +%FT%TZ)] database restored; verifying"

# The verification is the point. A restore that ran without error can still
# have produced an empty database — a wrong namespace, an archive from a
# different deployment — and the way to find out is to look.
node "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/verify-restore.mjs" "${TARGET_URI}"

if [[ -f "${SOURCE}/storage.tar.gz" ]]; then
  echo
  echo "Stored files are in ${SOURCE}/storage.tar.gz."
  echo "Unpack them over STORAGE_LOCAL_DIR when recovering for real:"
  echo "  tar -xzf ${SOURCE}/storage.tar.gz -C <parent of STORAGE_LOCAL_DIR>"
fi

echo "[$(date -u +%FT%TZ)] restore complete."
