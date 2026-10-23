# Site Records

See [requirement.md](requirement.md) and [development_plan.md](development_plan.md).

Stack: React (Vite), Flask, PostgreSQL, SQLAlchemy, Docker.

## Run with Docker

```bash
cp .env.example .env   # then edit the secrets
docker compose up --build
```

- Frontend: http://localhost:5173
- API health check: http://localhost:5001/api/health

The backend applies database migrations on start.

## Run without Docker

Backend (needs a PostgreSQL database; set `DATABASE_URL`):

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/flask --app wsgi db upgrade
.venv/bin/flask --app wsgi run --debug
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

## Tests

```bash
cd backend && .venv/bin/python -m pytest
cd frontend && npm test
```

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

## Status

- Phase 1 (public site, navigation, contact form): done.
- Phase 2 (AAF login, sessions, protected dashboard): done. The dashboard is a placeholder.
- Phase 3 (records table): not started.
