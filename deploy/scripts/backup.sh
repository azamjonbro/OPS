#!/usr/bin/env bash
#
# Takes a backup of the Hadiya database and the files it refers to.
#
#   deploy/scripts/backup.sh                    # uses MONGO_URI from the .env
#   MONGO_URI=... BACKUP_DIR=/srv/backups backup.sh
#
# Two things are backed up because losing either one loses the other's meaning:
# the database rows, and the stored documents and generated images those rows
# point at. A database restored without its files gives every upload a card
# that cannot be opened.
#
# Run it from cron. Hourly is cheap for a shop's data volume; the retention
# below keeps a fortnight, which is long enough to notice a problem that
# happened over a weekend:
#
#   17 * * * * cd /srv/hadiya && deploy/scripts/backup.sh >> /var/log/hadiya-backup.log 2>&1
#
# It never writes to the database and never deletes anything outside its own
# backup directory.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# The URI is read from the environment or the deployment's .env, and is never
# echoed: it carries the database password.
if [[ -z "${MONGO_URI:-}" && -f "${REPO_ROOT}/.env" ]]; then
  MONGO_URI="$(grep -E '^MONGO_URI=' "${REPO_ROOT}/.env" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"
fi

if [[ -z "${MONGO_URI:-}" ]]; then
  echo "MONGO_URI is not set and no .env was found. Refusing to guess." >&2
  exit 1
fi

BACKUP_DIR="${BACKUP_DIR:-${REPO_ROOT}/backups}"
STORAGE_DIR="${STORAGE_LOCAL_DIR:-${REPO_ROOT}/apps/api/storage}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="${BACKUP_DIR}/${STAMP}"

command -v mongodump >/dev/null 2>&1 || {
  echo "mongodump is not installed (apt install mongodb-database-tools)." >&2
  exit 1
}

mkdir -p "${TARGET}"

echo "[$(date -u +%FT%TZ)] backing up the database"
# --gzip keeps a shop's months of conversations to a few megabytes.
mongodump --uri="${MONGO_URI}" --gzip --archive="${TARGET}/mongo.archive.gz" --quiet

if [[ -d "${STORAGE_DIR}" ]]; then
  echo "[$(date -u +%FT%TZ)] backing up stored files from ${STORAGE_DIR}"
  tar -czf "${TARGET}/storage.tar.gz" -C "$(dirname "${STORAGE_DIR}")" "$(basename "${STORAGE_DIR}")"
else
  echo "[$(date -u +%FT%TZ)] no storage directory at ${STORAGE_DIR}; skipping files"
fi

# A manifest, so a restore months later does not have to guess what this was.
# Deliberately records the database *name* and never the URI.
cat > "${TARGET}/manifest.txt" <<EOF
created:   $(date -u +%FT%TZ)
host:      $(hostname)
database:  $(printf '%s' "${MONGO_URI}" | sed -E 's#^.*/([^/?]+)(\?.*)?$#\1#')
storage:   ${STORAGE_DIR}
app:       $(git -C "${REPO_ROOT}" rev-parse --short HEAD 2>/dev/null || echo 'unknown')
EOF

# Verify the archive is readable before calling the backup a success. A
# mongodump that produced a truncated file exits zero, and a backup nobody has
# opened is a backup nobody has.
if ! gzip -t "${TARGET}/mongo.archive.gz" 2>/dev/null; then
  echo "The database archive is corrupt. Backup FAILED." >&2
  exit 1
fi

SIZE="$(du -sh "${TARGET}" | cut -f1)"
echo "[$(date -u +%FT%TZ)] backup complete: ${TARGET} (${SIZE})"

# Retention. Only ever inside BACKUP_DIR, and only directories that match the
# timestamp this script writes.
find "${BACKUP_DIR}" -mindepth 1 -maxdepth 1 -type d \
  -name '20*T*Z' -mtime "+${RETENTION_DAYS}" -print -exec rm -rf {} + \
  | sed 's/^/[retention] removed /' || true

echo "[$(date -u +%FT%TZ)] done. Restore with: deploy/scripts/restore.sh ${TARGET} <target-uri>"
