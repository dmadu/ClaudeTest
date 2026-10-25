#!/bin/sh
# Deploys a new version: backup, build, migrate, start, check.
#
#   deploy/release.sh <version>      for example: deploy/release.sh 1.0.0
#
# On the first run the stack is created. On later runs the old version keeps its images, so
# deploy/rollback.sh can go back to it.
. "$(dirname "$0")/lib.sh"

VERSION=${1:-}
[ -n "$VERSION" ] || die "usage: deploy/release.sh <version>"
export APP_VERSION=$VERSION

info "Checking the settings in $ENV_FILE"
$COMPOSE config -q || die "the env file is missing a required value (see the message above)"

BACKUP_NAME=""
if db_running; then
    info "Taking a backup before the release"
    BACKUP_NAME=$(backup_now) || die "the pre-release backup failed, so nothing was changed"
else
    info "First deployment: no database yet, so no pre-release backup"
fi

info "Building version $VERSION"
$COMPOSE build

PREVIOUS=$(tail -n 1 "$HISTORY" 2>/dev/null | awk '{print $2}' || true)

info "Starting version $VERSION (database migrations run first)"
if ! $COMPOSE up -d --remove-orphans; then
    echo >&2
    echo "The release did not start. To go back:" >&2
    [ -n "$PREVIOUS" ] && echo "  deploy/rollback.sh $PREVIOUS" >&2
    [ -n "$BACKUP_NAME" ] && echo "  deploy/restore.sh $BACKUP_PATH/$BACKUP_NAME   (only if the data must go back too)" >&2
    exit 1
fi

if ! wait_healthy; then
    echo >&2
    echo "Version $VERSION started but is not healthy. Look at:  $COMPOSE logs --tail 100 backend proxy" >&2
    [ -n "$PREVIOUS" ] && echo "To go back:  deploy/rollback.sh $PREVIOUS" >&2
    exit 1
fi

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $VERSION ${PREVIOUS:--} ${BACKUP_NAME:--}" >> "$HISTORY"
$COMPOSE ps
info "Version $VERSION is live. Pre-release backup: ${BACKUP_NAME:-none (first deployment)}"
