#!/bin/sh
# Shared by the deploy scripts. Source it:  . "$(dirname "$0")/lib.sh"
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
ENV_FILE=${ENV_FILE:-$ROOT/.env.prod}
# A fixed project name keeps this stack separate from the development one (and from rehearsals).
PROJECT=${COMPOSE_PROJECT_NAME:-site-records}

die() { echo "ERROR: $*" >&2; exit 1; }
info() { echo "==> $*"; }

[ -f "$ENV_FILE" ] || die "$ENV_FILE not found. Copy .env.prod.example to .env.prod and fill it in."

envval() { grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true; }

SITE_ADDRESS=$(envval SITE_ADDRESS)
BACKUP_DIR_SETTING=$(envval BACKUP_DIR)
BACKUP_DIR_SETTING=${BACKUP_DIR_SETTING:-./backups}
case "$BACKUP_DIR_SETTING" in
    /*) BACKUP_PATH=$BACKUP_DIR_SETTING ;;
    *) BACKUP_PATH=$ROOT/${BACKUP_DIR_SETTING#./} ;;
esac
mkdir -p "$BACKUP_PATH"

# The backup container writes as the person running these scripts, so the files are theirs.
export BACKUP_UID=${BACKUP_UID:-$(id -u)}
export BACKUP_GID=${BACKUP_GID:-$(id -g)}
export BACKUP_DIR=$BACKUP_PATH

COMPOSE="docker compose -p $PROJECT --env-file $ENV_FILE -f $ROOT/docker-compose.prod.yml"
HISTORY=$ROOT/.release-history

# Curl needs -k only for the local rehearsal, where Caddy uses its own certificate authority.
case "$SITE_ADDRESS" in
    localhost|127.*) CURL_TLS="-k" ;;
    *) CURL_TLS="" ;;
esac
HEALTH_URL=${HEALTH_URL:-https://$SITE_ADDRESS/api/health}

wait_healthy() {
    info "Waiting for $HEALTH_URL"
    i=0
    while [ "$i" -lt 60 ]; do
        # shellcheck disable=SC2086
        if curl -fsS $CURL_TLS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
            info "Healthy: $(curl -fsS $CURL_TLS --max-time 5 "$HEALTH_URL")"
            return 0
        fi
        i=$((i + 1)); sleep 2
    done
    return 1
}

db_running() { $COMPOSE ps --status running --services 2>/dev/null | grep -qx db; }

# Takes a backup now and prints its folder name. Needs the database to be running.
backup_now() {
    out=$($COMPOSE run --rm --no-deps backup /backup.sh once 2>&1) || { echo "$out" >&2; return 1; }
    echo "$out" >&2
    echo "$out" | sed -n 's#.*OK /backups/\([0-9TZ]*\) .*#\1#p' | tail -n 1
}
