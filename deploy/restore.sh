#!/bin/sh
# Puts the database and the uploaded images back from a backup folder.
#
#   deploy/restore.sh <backup folder> [--yes]
#
# The site is stopped while this runs, and everything saved since the backup is replaced by what the
# backup holds. A fresh backup of the current state is taken first, so this can be undone.
. "$(dirname "$0")/lib.sh"

FOLDER=${1:-}
[ -n "$FOLDER" ] || die "usage: deploy/restore.sh <backup folder> [--yes]   (folders are in $BACKUP_PATH)"
case "$FOLDER" in /*) ;; *) [ -d "$BACKUP_PATH/$FOLDER" ] && FOLDER=$BACKUP_PATH/$FOLDER || FOLDER=$(cd "$FOLDER" 2>/dev/null && pwd) ;; esac
[ -f "$FOLDER/database.dump" ] && [ -f "$FOLDER/uploads.tar.gz" ] || die "$FOLDER is not a complete backup (needs database.dump and uploads.tar.gz)"

info "Checking the backup files against their checksums"
(cd "$FOLDER" && grep -E '^[0-9a-f]{64} ' MANIFEST | sha256sum -c -) || die "the backup is damaged, nothing was changed"
cat "$FOLDER/MANIFEST" | grep -E '^(created_utc|database_tables|upload_files)='

if [ "${2:-}" != "--yes" ]; then
    printf 'This replaces the current database and images with this backup. Type "restore" to continue: '
    read -r answer
    [ "$answer" = "restore" ] || die "cancelled, nothing was changed"
fi

export APP_VERSION=${APP_VERSION:-$(tail -n 1 "$HISTORY" 2>/dev/null | awk '{print $2}')}
export APP_VERSION=${APP_VERSION:-latest}

info "Starting the database if needed"
$COMPOSE up -d db
i=0; until $COMPOSE exec -T db pg_isready -q; do i=$((i + 1)); [ "$i" -lt 30 ] || die "the database did not start"; sleep 2; done

info "Taking a safety backup of the current state"
SAFETY=$(backup_now) || die "the safety backup failed, so nothing was changed"

info "Stopping the site"
$COMPOSE stop proxy backend

info "Restoring the database"
$COMPOSE run --rm --no-deps -v "$FOLDER:/restore:ro" backup sh -c \
    'pg_restore --clean --if-exists --no-owner --dbname "$PGDATABASE" /restore/database.dump'

info "Restoring the images"
# Runs as the app's own unprivileged user, so the restored files belong to it and no extra rights are needed.
$COMPOSE run --rm --no-deps -v "$FOLDER:/restore:ro" --entrypoint sh backend -c \
    'find /app/uploads -mindepth 1 -delete && tar -xzf /restore/uploads.tar.gz -C /app/uploads'

info "Starting the site"
$COMPOSE up -d
wait_healthy || die "restored, but the site is not healthy: $COMPOSE logs --tail 100 backend proxy"

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) restore ${APP_VERSION} $(basename "$FOLDER")" >> "$HISTORY"
info "Restored from $FOLDER. Backup of the state before the restore: $SAFETY"
