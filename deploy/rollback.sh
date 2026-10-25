#!/bin/sh
# Goes back to a version that was released earlier on this server.
#
#   deploy/rollback.sh <version>
#
# This switches the code only. If the release you are leaving changed the database layout, the older
# code cannot use it: the script detects that, changes nothing, and tells you to restore the
# pre-release backup with deploy/restore.sh instead (the backup name is in .release-history).
. "$(dirname "$0")/lib.sh"

VERSION=${1:-}
[ -n "$VERSION" ] || die "usage: deploy/rollback.sh <version>   (releases so far are listed in $HISTORY)"
export APP_VERSION=$VERSION

for image in site-records-backend site-records-proxy; do
    docker image inspect "$image:$VERSION" >/dev/null 2>&1 \
        || die "there is no image $image:$VERSION on this server, so it cannot be started without building it"
done

info "Checking that version $VERSION works with the current database"
if ! $COMPOSE run --rm migrate; then
    echo >&2
    echo "Version $VERSION cannot use the current database (it is newer than that code knows)." >&2
    echo "Nothing was changed. Restore the backup taken just before the release that changed it:" >&2
    echo "  deploy/restore.sh <backup folder>     then run  deploy/rollback.sh $VERSION  again" >&2
    echo "Backups: $BACKUP_PATH   Releases: $HISTORY" >&2
    exit 1
fi

info "Starting version $VERSION"
$COMPOSE up -d --no-build --remove-orphans
wait_healthy || die "version $VERSION started but is not healthy: $COMPOSE logs --tail 100 backend proxy"

CURRENT=$(tail -n 1 "$HISTORY" 2>/dev/null | awk '{print $2}' || true)
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $VERSION ${CURRENT:--} rollback" >> "$HISTORY"
$COMPOSE ps
info "Rolled back to version $VERSION"
