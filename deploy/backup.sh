#!/bin/sh
# Backs up the database and the uploaded images.
#
#   backup.sh once   take one backup now
#   backup.sh loop   take one now, then one every BACKUP_INTERVAL_HOURS (the "backup" service)
#
# Each backup is a folder /backups/<UTC time>/ holding database.dump, uploads.tar.gz and MANIFEST.
# The folder only appears once both files are written and checked, so a half-finished backup is
# never mistaken for a good one. Connection settings come from the standard PG* variables.
set -eu

BACKUP_DIR=${BACKUP_DIR:-/backups}
UPLOADS_DIR=${UPLOADS_DIR:-/uploads}
KEEP_DAYS=${BACKUP_KEEP_DAYS:-14}
MIN_KEEP=${BACKUP_MIN_KEEP:-3}
INTERVAL_HOURS=${BACKUP_INTERVAL_HOURS:-24}

log() { echo "[backup $(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

backup_once() {
    ts=$(date -u +%Y%m%dT%H%M%SZ)
    work="$BACKUP_DIR/.partial-$ts"
    mkdir -p "$work"
    trap 'rm -rf "$work"' EXIT

    pg_dump --format=custom --no-owner --file "$work/database.dump"
    tar -C "$UPLOADS_DIR" -czf "$work/uploads.tar.gz" .

    # Prove both files can be read back before calling this a backup.
    tables=$(pg_restore --list "$work/database.dump" | grep -c ' TABLE ' || true)
    files=$(tar -tzf "$work/uploads.tar.gz" | grep -vc '/$' || true)
    if [ "$tables" -lt 1 ]; then
        log "ERROR: the database dump has no tables"; return 1
    fi

    {
        echo "created_utc=$ts"
        echo "database_tables=$tables"
        echo "upload_files=$files"
        (cd "$work" && sha256sum database.dump uploads.tar.gz)
    } > "$work/MANIFEST"

    mv "$work" "$BACKUP_DIR/$ts"
    trap - EXIT
    touch /tmp/last_backup_ok
    log "OK $BACKUP_DIR/$ts ($tables tables, $files upload files)"
    prune
}

# Delete backups older than KEEP_DAYS, but always keep the newest MIN_KEEP.
prune() {
    ls -1d "$BACKUP_DIR"/20*T*Z 2>/dev/null | sort -r | tail -n +"$((MIN_KEEP + 1))" | while read -r dir; do
        if [ -n "$(find "$dir" -maxdepth 0 -mtime +"$KEEP_DAYS")" ]; then
            rm -rf "$dir" && log "removed old backup $dir"
        fi
    done
}

case "${1:-once}" in
    once) backup_once ;;
    loop)
        while true; do
            backup_once || log "ERROR: backup failed, will try again next time"
            sleep "$((INTERVAL_HOURS * 3600))"
        done
        ;;
    *) echo "usage: backup.sh once|loop" >&2; exit 2 ;;
esac
