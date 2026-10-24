# Security and quality checklist (Phase 5)

Each item says what was done and how it was checked. Items marked **Phase 6** need the production
setup (HTTPS proxy, production containers) and are not done yet.

The final sign-off is for the project owner: tick the boxes at the end once you have read the
limitations.

## Authentication (FR-4 to FR-9)

| Check | Result | Evidence |
|---|---|---|
| Assertions must be signed HS256 JWTs. Unsigned (`alg: none`), wrong secret, expired, not-yet-valid, wrong issuer, wrong audience, wrong type, missing subject or id are rejected | Done | `tests/test_auth.py` |
| An assertion can be used once (replay protection through the `jti`) | Done | `test_replayed_assertion_is_rejected` |
| A failed login leaves the current session untouched; a new login replaces the old session | Done | `tests/test_auth.py` |
| The mock login is off unless `AAF_MOCK=true`, and the app will not start with it on when `APP_ENV=production` | Done | `test_mock_refused_in_production`, `test_mock_login_disabled_by_default` |
| Production start-up refuses missing AAF settings and the default `SECRET_KEY` | Done | `test_production_requires_aaf_settings` |

## Sessions and CSRF (NFR-1)

| Check | Result | Evidence |
|---|---|---|
| Session cookie is `HttpOnly` and `SameSite=Lax`; `Secure` is set by `SESSION_COOKIE_SECURE=true` | Done in code. Turn the flag on in production | `test_session_cookie_is_http_only_and_lax`; confirmed in a browser that JavaScript cannot read the cookie |
| Signed-in users must send a per-session CSRF token on every POST, PUT and DELETE; wrong or missing tokens get 403. The AAF callback is exempt (it is authenticated by the signed assertion) | Done | `tests/test_security.py`, Playwright "write without the CSRF token is refused" |
| The token is renewed at every login and is never given to visitors | Done | `test_each_login_gets_a_new_token`, `test_token_is_not_given_to_visitors` |
| Sessions last 8 hours | Done | `PERMANENT_SESSION_LIFETIME` |

## Authorisation (NFR-1)

| Check | Result | Evidence |
|---|---|---|
| Every record query filters by the signed-in user. Another user's record gives 404 for read, edit, delete and image | Done | `tests/test_records.py`, `tests/test_record_crud.py`, Playwright "users cannot see or open each other's records" |
| A user cannot delete or change a record by guessing its id, even with a valid session and CSRF token | Done | same |

## Input handling

| Check | Result | Evidence |
|---|---|---|
| All fields are validated on the server (lengths, number format and ranges, no `NaN`, `Infinity`, `1e2` or `1_0`) | Done | `tests/test_record_crud.py` |
| Sort column, order and page size come from fixed lists, so user input never reaches the SQL | Done | `test_invalid_query_is_rejected` (includes an injection attempt) |
| Database access goes through SQLAlchemy with bound parameters | Done | code review |
| React escapes everything it displays; there is no `dangerouslySetInnerHTML` | Done | code review (`grep` finds none) |

## Uploads (NFR-2)

| Check | Result | Evidence |
|---|---|---|
| Only JPEG and PNG, decided from the file's bytes, not its name or the browser's claim | Done | `tests/test_record_crud.py` (GIF, SVG, HTML, PDF and WebP renamed to `.png` are refused) |
| The whole picture is decoded, so a damaged or truncated file, or a valid header followed by garbage, is refused | Done | `tests/test_security.py`. This also caught a broken test image of my own during the end-to-end run |
| Images over 50 megapixels are refused before decoding, so a small file that expands hugely cannot exhaust memory | Done | `test_huge_dimensions_are_rejected_before_decoding` |
| 5 MB limit for the image, and a 5.5 MB limit for the whole request (answered with JSON) | Done in Flask. **Phase 6**: also set `client_max_body_size 6m;` on the proxy | `test_image_at_the_size_limit_is_accepted`, `test_huge_request_is_rejected_with_json` |
| Stored under a random name outside the code folder; the client's file name is ignored | Done | `test_create_ignores_client_file_name_and_owner` |
| Served only to the owner, with `nosniff` and a sandboxing CSP, so an upload can never run as a page | Done | `test_image_responses_are_sandboxed_and_not_marked_no_store` |
| Path traversal in a stored name cannot read or delete files outside the upload folder | Done | `test_image_path_cannot_escape_upload_folder`, `test_delete_never_removes_files_outside_upload_folder` |
| Failed saves leave no orphan files; replacing or deleting removes the old file | Done | `test_database_failure_leaves_no_orphan_file`, `test_update_failure_keeps_old_image_and_removes_new` |

## Headers, errors and rate limits

| Check | Result | Evidence |
|---|---|---|
| API responses carry `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, a CSP and `Cache-Control: no-store`; `Strict-Transport-Security` in production | Done | `tests/test_security.py`; checked live with `curl` |
| Errors under `/api` are JSON; unexpected errors give a generic message and never a stack trace or the exception text | Done | `test_unexpected_errors_do_not_leak_details` |
| Rate limits per client address: contact 5 a minute and 30 an hour, sign-in start 20 a minute, AAF callback 10 a minute. Sign-in limits send the browser to the login page with a message | Done | `tests/test_security.py`; checked live (7 contact posts gave `201 x5, 429 x2`) |
| Limits count the real client address behind a proxy (`PROXY_HOPS`), and ignore a forged `X-Forwarded-For` otherwise | Done | `test_limits_are_per_client_address_behind_a_proxy`, `test_forwarded_header_is_ignored_without_a_proxy` |
| Security headers for the web pages themselves (CSP, frame and referrer policy) | **Phase 6** (set in the production Nginx config; the Vite dev server does not send them) | |

## Secrets and configuration (NFR-1)

| Check | Result | Evidence |
|---|---|---|
| All secrets come from environment variables. `.env` is git-ignored; `.env.example` holds placeholders only | Done | `.gitignore`. A search of the source finds only the test configuration's values and the development fallbacks, which production refuses |
| Production refuses a `SECRET_KEY` that is a known placeholder (such as `change-me`) or shorter than 32 characters | Done | `test_production_refuses_weak_secret_keys` |
| Development ports (frontend, backend, database) are published on `127.0.0.1` only | Done | `docker-compose.yml`, `docker ps` |
| The Flask debugger is controlled by `FLASK_DEBUG` and must be `0` in production | Done in config. **Phase 6**: production compose sets it | |
| Python dev tools (pytest, ruff, pip-audit) are not in the runtime image | Done | `requirements.txt` vs `requirements-dev.txt` |
| Containers run as a non-root user, behind Gunicorn | **Phase 6** | |

## Dependencies

| Check | Result |
|---|---|
| `pip-audit`: no known vulnerabilities (runtime and dev) | Done. pytest was upgraded to 9 |
| `npm audit`: 0 vulnerabilities | Done. Upgraded React Router to 7, Vite to 8, Vitest to 5 and jsdom to 30 to clear 8 findings; all tests, lint and the build pass |
| Both audits run in CI on every push | Done (`.github/workflows/ci.yml`; runs once the repository is pushed to GitHub) |

## Accessibility (NFR-5) and responsive layout (NFR-3)

| Check | Result | Evidence |
|---|---|---|
| Automated axe checks: no violations on every page and state (empty, with data, errors, dialog), including **colour contrast** in light and dark mode on desktop and phone widths | Done | `e2e/a11y.spec.js` in Chrome (the checker was shown to catch a 1.91:1 contrast failure) and `src/a11y.test.jsx` |
| Keyboard: skip link first, visible focus ring on every control, dialog traps Tab and Escape returns focus to the button, sort buttons work with Enter | Done | `e2e/a11y.spec.js`, `src/a11y.test.jsx` |
| Page title changes per page; focus moves to the page heading after navigation; labels, hints and errors are linked to the fields; the table scroll area is focusable | Done | `src/security.test.jsx`, `src/a11y.test.jsx` |
| No sideways page scroll at 320, 375, 768 and 1280 px; the phone menu opens and closes; the delete dialog fits the screen | Done | `e2e/responsive.spec.js` |
| Not covered: testing with a screen reader (VoiceOver, NVDA) and with browser zoom at 200% by a person | **Open** (recommended before release) | |

## Performance (NFR-4)

Measured on PostgreSQL with 20,000 records for one user (20 times the target):

| Request | Time |
|---|---|
| First page, default order | 13 ms |
| First page sorted by title, latitude or site | 7 to 10 ms |
| 100 rows, sorted by longitude, page 200 | 17 ms |
| Last page sorted by title (the slowest case) | 37 ms |

Every sort uses an index (`user_id` plus the sort column, with `lower(...)` for text), checked with
`EXPLAIN ANALYZE`. The target is under 2 seconds for 1,000 records.

## Tests and CI

- Backend: 178 tests (`pytest`), lint and format (`ruff`).
- Frontend: 116 unit and component tests (Vitest), lint (ESLint), production build.
- End to end: 17 Playwright tests in real Chrome (login, add, sort, edit, delete, logout, validation,
  user isolation, CSRF, accessibility, responsive layout).
- CI: `.github/workflows/ci.yml` runs all of the above plus both dependency audits. It could not be
  run here (it needs GitHub), so the first push is its first real run.

## Known limitations

- **Rate limit counts live in memory, per process.** With more than one worker or server, set
  `RATELIMIT_STORAGE_URI` to Redis, or limits are applied per worker.
- **Behind a proxy, set `PROXY_HOPS=1`** (or the real number). Otherwise every visitor shares the
  proxy's address and the limits hit everyone at once.
- **AAF Rapid Connect has no `state` or nonce**, so a sign-in cannot be tied to the browser that
  started it. The single-use `jti` and the short expiry of assertions limit what an attacker can do
  with a captured one.
- **Image files are not re-encoded.** They are fully decoded to prove they are sound, then stored as
  uploaded. EXIF data (such as camera location) stays in the file.
- **End-to-end tests need the rate limit off** (`RATELIMIT_ENABLED=false docker compose up -d backend`),
  because they sign in more than ten times a minute. They create throwaway users named `mock!e2e...`.

## Sign-off

- [ ] I have read the known limitations
- [ ] Production settings (`APP_ENV=production`, strong `SECRET_KEY`, `SESSION_COOKIE_SECURE=true`,
      `PROXY_HOPS`, `FLASK_DEBUG=0`) are planned for Phase 6
- [ ] Screen reader testing is scheduled

Signed off by: ______________________  Date: ______________
