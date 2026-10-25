# Deploying Site Records

This guide takes the application from this repository to a live HTTPS site, and covers day-to-day
operation: releases, rollback, backups, monitoring and secrets.

Everything in `deploy/` was rehearsed on a laptop with `deploy/rehearse.sh` (see
[The rehearsal](#the-rehearsal)). Three things cannot be rehearsed and need you: registering with
AAF, pointing a real domain at the server, and copying backups off the server. They are marked
**You do this**.

## What runs

```
Internet ──443/80──▶ proxy (Caddy) ──▶ backend (Gunicorn + Flask) ──▶ db (PostgreSQL 16)
                      │  HTTPS, security headers,        │
                      │  serves the built React app      └──▶ uploads volume (images)
                      └─ certificates from Let's Encrypt

backup  ── every 24 h: database dump + images ──▶ ./backups/<time>/
migrate ── runs once per release, before the backend starts
```

| Service | Image | Notes |
|---|---|---|
| `proxy` | Caddy 2 with the built frontend | The only service reachable from outside (ports 80 and 443). Gets and renews its own certificates |
| `backend` | Python 3.12, Gunicorn | Not published. Runs as an unprivileged user with a read-only file system |
| `db` | PostgreSQL 16 | Not published. Data in the `db_data` volume |
| `migrate` | the backend image | Applies database migrations, then exits |
| `backup` | PostgreSQL 16 client tools | Backs up the database and the `uploads` volume |

## Before you start

**You do this**

1. **A server** (Linux) with Docker 24 or newer and the `docker compose` plugin, 2 GB of memory and
   enough disk for the database, the images and 14 days of backups.
2. **A domain name** (for example `records.example.org`) whose DNS `A` (and `AAAA`) record points at
   the server.
3. **Ports 80 and 443 open** to the internet. Port 80 is needed for the certificate check and to
   redirect `http://` to `https://`. Do not open any other port: the database and the API are not
   published.
4. **An AAF Rapid Connect registration** (next section).

### Registering with AAF

Register the service in the AAF **production** federation (`https://rapid.aaf.edu.au`). Your
organisation must be an AAF subscriber. Rehearse with the **test** federation
(`https://rapid.test.aaf.edu.au`) first; the steps are the same.

| AAF asks for | Enter |
|---|---|
| Service name | Site Records |
| Callback URL | `https://<your domain>/api/auth/callback` |
| Service URL (this becomes the *audience*) | `https://<your domain>` |
| Attributes | `displayname` and `mail` (the app shows the name and keeps the email) |

AAF then gives you a **shared secret** and an **authentication request URL** that ends in a
registration id. These go into `.env.prod` (below) as `AAF_SECRET` and `AAF_RAPID_CONNECT_URL`.
`AAF_AUDIENCE` must match the service URL exactly (no trailing slash), and `AAF_ISSUER` is
`https://rapid.aaf.edu.au` (production) or `https://rapid.test.aaf.edu.au` (test).

If sign-in later fails, the backend log says why (`Rejected AAF assertion: ...`): a wrong audience or
issuer is by far the most common cause.

## First deployment

On the server:

```bash
git clone <your repository> site-records && cd site-records
cp .env.prod.example .env.prod
chmod 600 .env.prod
```

Fill in **every** value in `.env.prod`. Generate each secret with:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

Then release:

```bash
deploy/release.sh 1.0.0
```

The script checks that no setting is missing, builds the images, starts the database, applies the
migrations, starts the API and the proxy, and waits until `https://<your domain>/api/health` answers.
The first start also takes a minute to get the certificate.

Then check it by hand (see [Acceptance checklist](#acceptance-checklist)): open the site, sign in
with AAF, add a record with an image, and look at `ls backups/` for the first backup.

The application refuses to start in production if something unsafe is configured: a weak or missing
`SECRET_KEY`, insecure cookies, the debug server, the mock login, or missing AAF settings. The
message in `docker compose logs migrate` says which.

## Secrets

- All secrets live in `.env.prod` on the server only. It is git-ignored; keep it `chmod 600`.
- Keep a copy of `.env.prod` in your password manager. **Backups do not contain it**, and without
  `POSTGRES_PASSWORD` a restored database cannot be opened by a rebuilt server.
- Never paste secrets into tickets or chat.
- **Rotating** (after a leak, or when someone with access leaves):
  - `SECRET_KEY`: change it and run `deploy/release.sh <version>`. Everyone is signed out once.
  - `AAF_SECRET`: ask AAF for a new secret, update `.env.prod`, release. Sign-in fails between AAF
    changing it and your release, so do both together.
  - `POSTGRES_PASSWORD`: run
    `docker exec -it site-records-db-1 psql -U records -c "ALTER USER records PASSWORD '<new>'"`,
    then put the same value in `.env.prod` and release.

## Releasing a new version

```bash
git pull
deploy/release.sh 1.1.0
```

What it does, in order, stopping at the first problem:

1. Checks `.env.prod` is complete.
2. **Takes a backup** (database and images). If that fails, nothing is changed.
3. Builds the new images, tagged with the version. The old images stay on the server.
4. Applies database migrations, then starts the new API and proxy. There is a short pause while the
   containers restart, so release outside busy hours.
5. Waits for the health check, and records the release in `.release-history` (time, version,
   previous version, name of the pre-release backup).

If it fails it prints the exact commands to go back.

## Rolling back

```bash
deploy/rollback.sh 1.0.0          # a version released earlier on this server
```

This switches the code back, using the images that are still on the server. Before it changes
anything it checks that the older code can still work with the current database.

- **The release had no database change:** the rollback finishes, and no data is lost.
- **The release changed the database layout:** the older code cannot use it. The script says so and
  **changes nothing**. Restore the backup that was taken just before that release (its name is in
  `.release-history`), then run the rollback again:

  ```bash
  deploy/restore.sh backups/<pre-release backup>
  deploy/rollback.sh 1.0.0
  ```

  Anything saved between the release and the restore is lost, which is why migrations that remove or
  rename columns should be released in two steps.

## Backups

The `backup` service backs up when it starts and then every `BACKUP_INTERVAL_HOURS` (default 24).
Each backup is a folder in `BACKUP_DIR` (default `./backups`):

```
backups/20261101T020000Z/
  database.dump       PostgreSQL dump (custom format)
  uploads.tar.gz      every uploaded image
  MANIFEST            time, counts and SHA-256 checksums of both files
```

- A backup only appears once both files are written and have been read back successfully.
- Backups older than `BACKUP_KEEP_DAYS` (default 14) are removed, but the newest three are always kept.
- The database and the images are backed up a moment apart, so a record added in that moment can
  lack its image after a restore. Daily backups at a quiet hour make this unlikely.
- The service is marked **unhealthy** in `docker compose ps` if there has been no good backup for two
  intervals.
- Take one by hand at any time: `docker compose -p site-records --env-file .env.prod -f docker-compose.prod.yml run --rm backup /backup.sh once`

**You do this: copy the backups to another machine.** Backups on the same server are lost with the
server. For example, from another machine, with cron:

```bash
rsync -a --delete-after server:/path/to/site-records/backups/ /safe/place/site-records-backups/
```

or with `rclone` to object storage. Check from time to time that the copy is recent.

### Restoring

```bash
ls backups/                                   # choose a folder
deploy/restore.sh backups/20261101T020000Z
```

The script checks the checksums, asks you to type `restore`, takes a safety backup of the current
state, stops the site, restores the database and the images, starts the site and waits for the
health check. Everything saved after the backup is replaced by what the backup holds. A damaged
backup is refused before anything changes.

**Test a restore** on a spare machine or with the rehearsal at least once a month; a backup that has
never been restored is only a hope.

### If the server is lost

1. Set up a new server as in [Before you start](#before-you-start) and point the domain at it.
2. Copy `.env.prod` back (from your password manager) and the latest backup folder into `backups/`.
3. `deploy/release.sh 1.0.0` to create the stack, then `deploy/restore.sh backups/<folder>`.

You lose at most the time since the last backup (a day, by default).

## Monitoring

What exists:

| What | How |
|---|---|
| Is the site up and the database reachable? | `GET https://<domain>/api/health` returns `200 {"status":"ok","database":"ok"}`, or `503` when the database cannot be reached |
| Are the containers healthy? | `docker compose ... ps` (backend, proxy and backup report health) |
| Logs | `docker compose ... logs -f backend` (Gunicorn access and application log), `logs proxy` (JSON access log), `logs migrate`. Docker keeps 5 files of 10 MB per container |
| Did backups run? | the `backup` service health, and `ls -lt backups/` |
| Certificates | Caddy renews them about 30 days before they expire and logs each attempt: `logs proxy` |

**You do this: set up an outside check.** Use any uptime service (UptimeRobot, Better Stack, your
institution's monitoring) to request `https://<domain>/api/health` every minute and alert on a
non-200 answer or a certificate with fewer than 14 days left. Nothing inside the server can tell you
that the server itself is down.

Also watch free disk space: the `db_data`, `uploads` volumes and `backups/` grow over time
(`docker system df`, `df -h`).

Not included: metrics, dashboards or alert routing. For a small internal service the health check plus
logs is usually enough; add Prometheus or a hosted service if you need more.

A shortcut for the commands above:

```bash
alias dc='docker compose -p site-records --env-file .env.prod -f docker-compose.prod.yml'
dc ps
dc logs --tail 100 backend
```

## Scaling

One Gunicorn worker with four threads comfortably serves a few hundred users. If you need more
workers or several servers, the rate limits (kept in memory) must be shared: add a Redis service, set
`RATELIMIT_STORAGE_URI=redis://redis:6379` (and add `redis` to `backend/requirements.txt`), then raise
`WEB_CONCURRENCY`. The backend refuses to start with more than one worker and in-memory limits.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `release.sh` stops with "required variable ... is missing" | a value in `.env.prod` is empty |
| The browser shows a certificate warning, or Caddy logs `challenge failed` | DNS does not point at this server yet, or port 80 or 443 is blocked |
| `502` from the site | the API is still starting or has stopped: `dc logs backend` |
| Login shows "We could not verify your sign-in" | `AAF_AUDIENCE`, `AAF_ISSUER` or `AAF_SECRET` do not match the registration, or the server clock is wrong. `dc logs backend` shows `Rejected AAF assertion: ...` |
| Login shows "Too many sign-in attempts" | more than 10 sign-ins a minute from one address (a shared office network can do this): wait a minute |
| The API container exits straight away | it refuses an unsafe setting: `dc logs backend` names it |
| Uploads fail with 413 | the image is over 5 MB |

## Acceptance checklist

Do this once on the real site after the first release, and after any change to AAF or the domain.
Use a real AAF account.

- [ ] `http://<domain>` redirects to `https://<domain>`, and the browser shows a valid certificate
- [ ] The home, About and Contact pages load, and the top menu shows Home, About, Contact and Login
- [ ] A message sent from the Contact page is accepted
- [ ] **Login** takes you to AAF, and after signing in you land on the dashboard showing your name
- [ ] Opening `/dashboard` while signed out sends you to the login page
- [ ] **Add record** works with a JPEG, then with a PNG; both thumbnails show in the table
- [ ] A text file renamed to `.png` is refused, and so is an image over 5 MB
- [ ] Sorting by each column header works, in both directions, and so does paging
- [ ] **Edit** keeps the old image when none is chosen, and replaces it when one is
- [ ] **Delete** asks first, and the record disappears
- [ ] Signing in as a second AAF user shows none of the first user's records
- [ ] **Logout** returns to the home page, and the browser Back button does not show the dashboard data
- [ ] `https://<domain>/api/health` shows `ok`
- [ ] `ls backups/` shows a backup, and the outside uptime check is reporting
- [ ] The site works on a phone, and in the browser's dark mode
- [ ] A restore from the first backup has been tried on a spare machine

## The rehearsal

```bash
deploy/rehearse.sh
```

builds the production images, starts the whole production stack on this machine (with HTTPS from
Caddy's own local certificate authority, under the name `localhost`), and checks it. It uses its own
Docker project, volumes, secrets and backup folder, never your development stack, and removes them
at the end (`KEEP=1` leaves it running at `https://localhost`). It needs ports 80 and 443 free. It cannot prove that a real Let's Encrypt certificate will be issued
for your domain (it uses Caddy's local certificate authority); that happens the first time you release
with a real `SITE_ADDRESS`.

It checks:

- the containers: running and healthy, unprivileged user, read-only file system, database and API
  not published, migrations applied, Gunicorn serving, JSON logs, log rotation
- 12 smoke tests in Chrome over HTTPS: security headers, HTTP to HTTPS redirect, deep links, the
  Content Security Policy (no violations while using the app), caching, the mock login being absent,
  the session cookie flags, forged, expired and replayed assertions, the full add, edit and delete
  journey, the upload size limit at the proxy, CSRF, and rate limits that cannot be dodged with a
  forged `X-Forwarded-For`
- the health check going to 503 when the database stops, and back to 200
- a backup, a change, and a restore that brings back the saved database rows and image files and
  removes the later ones, plus refusing a damaged backup
- a release followed by a rollback, and refusing a rollback to a version that was never built

The same script runs in CI (`.github/workflows/ci.yml`, job `rehearsal`).

## Go-live checklist

- [ ] AAF production registration done, and `AAF_*` values set
- [ ] DNS points at the server; ports 80 and 443 open and nothing else
- [ ] `.env.prod` complete, `chmod 600`, and a copy in the password manager
- [ ] `deploy/release.sh 1.0.0` finished and the acceptance checklist is ticked
- [ ] Off-server copy of `backups/` is running, and a restore has been tried
- [ ] Outside uptime check is reporting to someone who will see it
- [ ] The screen-reader check from `docs/security_checklist.md` is done
- [ ] Someone other than the person who set this up has read the rollback and restore sections
