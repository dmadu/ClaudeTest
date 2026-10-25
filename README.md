# Site Records

See [requirement.md](requirement.md) and [development_plan.md](development_plan.md).

Stack: React (Vite), Flask, PostgreSQL, SQLAlchemy, Docker.

## Run with Docker

```bash
cp .env.example .env   # then edit the secrets
docker compose up --build
```

- Frontend: http://localhost:5173
- API health check: http://localhost:5000/api/health

All ports are published on `127.0.0.1` only.

The backend applies database migrations on start.

## Deploy to production

HTTPS, backups, releases and rollback are covered in [docs/deployment.md](docs/deployment.md). In short:

```bash
cp .env.prod.example .env.prod      # fill in every value
deploy/release.sh 1.0.0             # backup, build, migrate, start, health check
deploy/rollback.sh 0.9.0            # back to an earlier release
deploy/restore.sh backups/<folder>  # put a backup back
deploy/rehearse.sh                  # try all of this on your own machine first
```

## Run without Docker

Backend (needs a PostgreSQL database; set `DATABASE_URL`):

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/flask --app wsgi db upgrade
.venv/bin/flask --app wsgi run --debug
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

## Tests and checks

```bash
# backend: tests, lint, format
cd backend && .venv/bin/python -m pytest && .venv/bin/ruff check . && .venv/bin/ruff format --check .

# frontend: tests, lint, build
cd frontend && npm test && npm run lint && npm run build
```

End-to-end tests (Playwright, real Chrome) drive the running app with the mock AAF login. They sign in
many times a minute, so start the backend with the sign-in rate limit off first, and turn it back on
afterwards:

```bash
RATELIMIT_ENABLED=false docker compose up -d backend
cd frontend && npm run e2e
docker compose up -d backend
```

They create throwaway users named `mock!e2e...` and clean up their own records. In CI the suite uses
Playwright's Chromium (`CI=1`). See [docs/security_checklist.md](docs/security_checklist.md) for what
Phase 5 checked and what is still open.

## Signing in

Sign-in uses AAF Rapid Connect. The browser is sent to AAF, and AAF posts a signed assertion (JWT)
back to `POST /api/auth/callback`. The backend checks the signature, issuer, audience, expiry and
token type, rejects an assertion it has already seen, creates or updates the user, and starts a
session in an HTTP-only, SameSite=Lax cookie.

### Local development (no AAF needed)

`.env.example` sets `AAF_MOCK=true`. The Login link then goes to a fake AAF page that signs a real
assertion with the shared secret and posts it to the real callback, so the same verification code
runs. Sign in as another fake user with `http://localhost:5173/api/auth/mock-login?user=bob`.
The app refuses to start with `AAF_MOCK=true` when `APP_ENV=production`.

### With the AAF test federation

1. Register the service at https://rapid.test.aaf.edu.au (AAF Rapid Connect).
   - Callback URL: `https://<your-host>/api/auth/callback` (must be HTTPS and reachable by your browser).
   - Audience / service URL: the same host, for example `https://<your-host>`.
2. Set `AAF_MOCK=false`, `AAF_RAPID_CONNECT_URL`, `AAF_SECRET` and `AAF_AUDIENCE` in `.env`.
3. For production also set `APP_ENV=production`, a strong `SECRET_KEY` and `SESSION_COOKIE_SECURE=true`.

## Image uploads

Images are stored on disk in `UPLOAD_FOLDER` (a Docker volume, `uploads`) under random names. Only JPEG and
PNG are accepted, up to 5 MB and 50 megapixels. The type is decided from the file's own bytes, not its name
or the browser's claim, and the whole picture is decoded to prove it is sound. Images are served only to the
record's owner through `/api/records/<id>/image`.

## Sample data

With `AAF_MOCK=true`, sign in once (the Login link) so the fake user exists, then create sample records:

```bash
docker compose exec backend flask --app wsgi seed-records --user mock!dev --count 25
```

Use `--count 1000` to try the table with a large list. The command refuses to run when `APP_ENV=production`.

## Status

- Phase 1 (public site, navigation, contact form): done.
- Phase 2 (AAF login, sessions, protected dashboard): done.
- Phase 3 (read-only records table: pagination, sorting, thumbnails): done.
- Phase 4 (add, edit, delete records with image upload): done.
- Phase 5 (hardening: CSRF, headers, rate limits, full image checks, accessibility, tests, CI): done. See [docs/security_checklist.md](docs/security_checklist.md).
- Phase 6 (deployment: production images, HTTPS, backups, release and rollback scripts, monitoring, rehearsal): done. See [docs/deployment.md](docs/deployment.md). Registering with AAF and pointing the real domain at the server are still yours to do.
