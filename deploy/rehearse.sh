#!/bin/sh
# Rehearses a production deployment on this machine and checks that it, and the operations
# around it, really work. Nothing here touches the development stack or a real deployment: it uses
# its own Docker project, volumes, secrets and backup folder, and removes them at the end.
#
#   deploy/rehearse.sh           run everything, then tear down
#   KEEP=1 deploy/rehearse.sh    leave the stack running afterwards (look at https://localhost)
#
# Needs: Docker, Node (for the Playwright smoke tests) and ports 80 and 443 free.
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
export COMPOSE_PROJECT_NAME=site-records-rehearsal
export ENV_FILE=$ROOT/.env.rehearsal

gen() { python3 -c "import secrets; print(secrets.token_urlsafe($1))"; }
AAF_SECRET=$(gen 32)

cat > "$ENV_FILE" <<ENV
SITE_ADDRESS=localhost
HSTS_MAX_AGE=0
POSTGRES_DB=records
POSTGRES_USER=records
POSTGRES_PASSWORD=$(gen 24)
SECRET_KEY=$(gen 48)
AAF_ISSUER=https://rapid.test.aaf.edu.au
AAF_RAPID_CONNECT_URL=https://rapid.test.aaf.edu.au/jwt/authnrequest/research/rehearsal
AAF_SECRET=$AAF_SECRET
AAF_AUDIENCE=https://localhost
BACKUP_DIR=./backups-rehearsal
BACKUP_INTERVAL_HOURS=24
ENV

. "$ROOT/deploy/lib.sh"

FAILURES=0
pass() { echo "  PASS  $*"; }
fail() { echo "  FAIL  $*"; FAILURES=$((FAILURES + 1)); }
# check "description" 'shell expression' : the expression runs in this shell, so the helper functions work.
check() {
    desc=$1; shift
    if eval "$*" >/dev/null 2>&1; then pass "$desc"; else fail "$desc"; fi
}
sql() { $COMPOSE exec -T db psql -U records -d records -At -c "$1"; }
contact_count() { sql "select count(*) from contact_messages where name = '$1'"; }
users_table() { sql "select to_regclass('public.users')"; }
health_code() { curl -sk -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" || true; }

cleanup() {
    if [ "${KEEP:-0}" = "1" ]; then
        info "KEEP=1: leaving the rehearsal running at https://localhost (stop it with:  ENV_FILE=$ENV_FILE COMPOSE_PROJECT_NAME=$PROJECT $COMPOSE down -v)"
        return
    fi
    info "Tearing the rehearsal down"
    $COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true
    rm -rf "$ENV_FILE" "$BACKUP_PATH" "$HISTORY"
}
trap cleanup EXIT

echo; info "1. Release 0.6.0-rehearsal (first deployment: build, migrate, start)"
"$ROOT/deploy/release.sh" 0.6.0-rehearsal

echo; info "2. The deployed containers"
for svc in db backend proxy backup; do
    check "$svc is running" "$COMPOSE ps --status running --services | grep -qx $svc"
done
i=0; while [ "$i" -lt 30 ] && [ "$($COMPOSE ps backend proxy | grep -c '(healthy)')" != 2 ]; do i=$((i + 1)); sleep 2; done
check "backend and proxy report healthy" '[ "$($COMPOSE ps backend proxy | grep -c "(healthy)")" = 2 ]'
check "the API runs as an unprivileged user" '[ "$($COMPOSE exec -T backend id -u)" != 0 ]'
check "the API's file system is read-only" '! $COMPOSE exec -T backend touch /app/should-not-work'
check "the API can still write uploads" "$COMPOSE exec -T backend sh -c 'touch /app/uploads/.write-test && rm /app/uploads/.write-test'"
# A published port shows as "0.0.0.0:5000->5000/tcp"; an unpublished one only as "5432/tcp".
check "the database is not published on the host" '! docker ps --format "{{.Ports}}" --filter "name=$PROJECT-db" | grep -q -- "->"'
check "the API is not published on the host" '! docker ps --format "{{.Ports}}" --filter "name=$PROJECT-backend" | grep -q -- "->"'
check "only the proxy is published on the host (80 and 443)" '[ "$(docker ps --format "{{.Names}}" --filter "publish=443" | grep -c "$PROJECT")" = 1 ]'
check "migrations ran (users table exists)" '[ "$(users_table)" = users ]'
check "Gunicorn is serving (not the Flask development server)" "$COMPOSE logs backend | grep -q 'Booting worker'"
check "the proxy logs requests as JSON" "$COMPOSE logs proxy | grep -q '\"request\"'"
check "container logs are rotated" "docker inspect $PROJECT-backend-1 --format '{{.HostConfig.LogConfig.Config}}' | grep -q max-size"

echo; info "3. Smoke tests in Chrome over HTTPS (sign-in with a signed AAF assertion)"
if (cd "$ROOT/frontend" && E2E_BASE_URL=https://localhost E2E_IGNORE_HTTPS_ERRORS=1 E2E_AAF_SECRET="$AAF_SECRET" \
    E2E_AAF_AUDIENCE=https://localhost npx playwright test -c playwright.prod.config.js); then
    pass "production smoke tests"
else
    fail "production smoke tests"
fi

echo; info "4. Monitoring: the health check notices a database outage"
check "health is 200 with the database up" '[ "$(health_code)" = 200 ]'
$COMPOSE stop db >/dev/null
sleep 3
check "health is 503 with the database down" '[ "$(health_code)" = 503 ]'
$COMPOSE start db >/dev/null
i=0; while [ "$i" -lt 30 ] && [ "$(health_code)" != 200 ]; do i=$((i + 1)); sleep 2; done
check "health is 200 again once the database is back" '[ "$(health_code)" = 200 ]'

echo; info "5. Backup, then change things, then restore"
sql "insert into contact_messages (name, email, message, created_at) values ('restore-marker', 'm@example.test', 'saved in the backup', now())" >/dev/null
$COMPOSE exec -T backend sh -c 'echo before-backup > /app/uploads/restore-marker.txt'
BACKUP_NAME=$(backup_now)
check "the backup folder has a database dump, an images archive and a manifest" \
    '[ -f "$BACKUP_PATH/$BACKUP_NAME/database.dump" ] && [ -f "$BACKUP_PATH/$BACKUP_NAME/uploads.tar.gz" ] && [ -f "$BACKUP_PATH/$BACKUP_NAME/MANIFEST" ]'
sql "delete from contact_messages where name = 'restore-marker'" >/dev/null
sql "insert into contact_messages (name, email, message, created_at) values ('after-backup', 'a@example.test', 'saved after the backup', now())" >/dev/null
$COMPOSE exec -T backend sh -c 'rm /app/uploads/restore-marker.txt; echo after-backup > /app/uploads/after-backup.txt'

"$ROOT/deploy/restore.sh" "$BACKUP_NAME" --yes
check "the database row saved in the backup is back" '[ "$(contact_count restore-marker)" = 1 ]'
check "the row made after the backup is gone" '[ "$(contact_count after-backup)" = 0 ]'
check "the image file saved in the backup is back" '[ "$($COMPOSE exec -T backend cat /app/uploads/restore-marker.txt)" = before-backup ]'
check "the image file made after the backup is gone" '! $COMPOSE exec -T backend test -e /app/uploads/after-backup.txt'
check "the restore took a safety backup of the state before it" '[ "$(ls -1d "$BACKUP_PATH"/20*Z | wc -l)" -ge 2 ]'
check "the site is healthy after the restore" '[ "$(health_code)" = 200 ]'
cp -R "$BACKUP_PATH/$BACKUP_NAME" "$BACKUP_PATH/damaged"
echo x >> "$BACKUP_PATH/damaged/database.dump"
check "a damaged backup is refused" '! "$ROOT/deploy/restore.sh" "$BACKUP_PATH/damaged" --yes'
check "a refused restore leaves the data as it was" '[ "$(contact_count restore-marker)" = 1 ]'
rm -rf "$BACKUP_PATH/damaged"

echo; info "6. Release a new version, then roll back"
"$ROOT/deploy/release.sh" 0.6.1-rehearsal
check "0.6.1 is the running version" 'docker inspect "$PROJECT-backend-1" --format "{{.Config.Image}}" | grep -q 0.6.1-rehearsal'
"$ROOT/deploy/rollback.sh" 0.6.0-rehearsal
check "0.6.0 is the running version again" 'docker inspect "$PROJECT-backend-1" --format "{{.Config.Image}}" | grep -q 0.6.0-rehearsal'
check "the site is healthy after the rollback" '[ "$(health_code)" = 200 ]'
check "the data survived the release and the rollback" '[ "$(contact_count restore-marker)" = 1 ]'
check "rolling back to a version that was never built is refused" '! "$ROOT/deploy/rollback.sh" 9.9.9-never-built'

echo
if [ "$FAILURES" -eq 0 ]; then
    info "Rehearsal passed"
else
    echo "ERROR: $FAILURES check(s) failed" >&2
    exit 1
fi
