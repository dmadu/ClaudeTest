# Development Plan

Based on [requirement.md](requirement.md).

**Stack:** React (frontend), Flask (backend API), PostgreSQL, SQLAlchemy ORM, Docker. Authentication uses AAF Rapid Connect (OIDC/JWT). Images are stored on local disk. All secrets are kept in environment variables.

## Phase overview

| Phase | Name | Outcome | Requirements covered |
|-------|------|---------|----------------------|
| 0 | Project setup | Repo, Docker environment and empty app skeletons run locally | NFR-1 (secrets) |
| 1 | Public site and navigation | Home, About, Contact pages with the top menu | FR-1, FR-2, FR-31, FR-32, FR-33 |
| 2 | AAF authentication | Users sign in and out and land on a protected dashboard | FR-3 to FR-9 |
| 3 | Records: read-only dashboard | Paginated, sortable table of the user's own records | FR-10 to FR-16 |
| 4 | Records: add, edit, delete | Full record management with image upload | FR-17 to FR-30 |
| 5 | Hardening and quality | Security, accessibility, performance and test coverage | NFR-1 to NFR-5 |
| 6 | Deployment and release | Production-ready containers and release | All |

Each phase ends with a working, demonstrable build. Phases 1 and 2 can overlap once Phase 0 is done, because the public pages do not depend on login.

---

## Phase 0: Project setup

**Goal:** A developer can clone the repo and run the whole stack with one command.

Tasks:

- Create the repository layout: `backend/` (Flask), `frontend/` (React), `docker-compose.yml`, `.env.example`, `.gitignore`.
- Flask app factory with configuration read from environment variables, a health check endpoint (`/api/health`), and CORS settings for the frontend.
- SQLAlchemy and Alembic (Flask-Migrate) configured against PostgreSQL.
- Create the `User` and `Record` models and the first migration (see section 5 of the requirements).
- React app (Vite) with React Router and an API client module.
- Docker Compose services: `frontend`, `backend`, `db` (PostgreSQL), with a volume for the database and a volume for uploaded images.
- Linting and formatting: Ruff/Black for Python, ESLint/Prettier for JavaScript. Test runners: pytest, Vitest.
- A short README with setup steps.

Done when:

- `docker compose up` starts all three services.
- The frontend shows a placeholder page and the backend health check returns OK.
- The migration creates both tables in PostgreSQL.

## Phase 1: Public site and navigation

**Goal:** Visitors can browse the public pages.

Tasks:

- Shared layout with the top menu: Home, About, Contact, Login (FR-1).
- Home page that introduces the site and links to Login (FR-2, FR-31).
- About page (FR-32).
- Contact page with a form: Name, email and message. This is a change from FR-33, see "Points to confirm".
- Backend `POST /api/contact` endpoint that validates input and stores the message in a `ContactMessage` table. Sending email is a later decision.
- Responsive layout for desktop and mobile (NFR-3).

Done when:

- All menu items navigate to their pages.
- The contact form validates input, shows field errors and shows a success message after submit.

## Phase 2: AAF authentication

**Goal:** Users sign in with AAF and reach a protected dashboard.

Tasks:

- Register the service with AAF Rapid Connect (test federation first) and record the callback URL and shared secret in environment variables.
- Backend:
  - `GET /api/auth/login` redirects the user to AAF Rapid Connect.
  - `POST /api/auth/callback` receives the signed JWT from AAF, verifies the signature, issuer, audience, expiry and nonce, and rejects invalid tokens.
  - Create the `User` on first login, or update the name and email on later logins, using the AAF unique identifier.
  - Start a session. Use an HTTP-only, secure, same-site cookie.
  - `GET /api/auth/me` returns the current user. `POST /api/auth/logout` ends the session.
  - A login-required decorator for protected endpoints (FR-8).
- Frontend:
  - Auth context that loads the current user on start.
  - The Login menu item starts the AAF flow. After login, the menu shows the user's name, a Dashboard link and Logout (FR-3, FR-5, FR-9).
  - Protected route wrapper that redirects visitors to Login (FR-8).
  - Redirect to the dashboard after login (FR-6) and a clear message after a failed or cancelled login (FR-7).
  - Placeholder dashboard page.
- Local development: a mock AAF mode, enabled only by an environment flag, so developers can test without access to the federation.

Done when:

- A user can sign in through the AAF test federation, see the dashboard and sign out.
- A visitor who opens the dashboard URL is sent to Login.
- Tampered or expired tokens are rejected (covered by tests).

## Phase 3: Records, read-only dashboard

**Goal:** A signed-in user sees their own records in a paginated, sortable table.

Tasks:

- Backend `GET /api/records` with query parameters `page`, `page_size` (default 10), `sort` and `order`. Only whitelisted sort columns are accepted. The query always filters by the current user (FR-16). The response includes the records and the total count (FR-11).
- Serve images through an authenticated endpoint, `GET /api/records/<id>/image`, that checks ownership.
- Seed script that creates sample records for development.
- Frontend dashboard:
  - Table with columns Title, Site, Latitude, Longitude, Image thumbnail and Actions (FR-14).
  - Clickable column headers that toggle ascending and descending order and show the active sort (FR-13).
  - Pagination controls and the total record count (FR-11, FR-12).
  - Empty state that points to the Add button (FR-15).
  - Loading and error states.
- Keep page, sort and order in the URL so a refresh keeps the view.

Done when:

- Sorting and pagination work on the server for every column.
- A user never sees another user's records (covered by tests).
- A seeded list of 1,000 records loads in under 2 seconds (NFR-4).

## Phase 4: Records, add, edit and delete

**Goal:** A user can fully manage their records, including images.

Tasks:

- Backend:
  - `POST /api/records` (multipart) creates a record.
  - `GET /api/records/<id>` returns one record.
  - `PUT /api/records/<id>` updates a record. The image is optional, and the old image is replaced and removed when a new one is sent (FR-24).
  - `DELETE /api/records/<id>` deletes the record and its image file (FR-29).
  - Validation as in FR-19: title and site up to 200 characters, latitude -90 to 90, longitude -180 to 180.
  - Upload handling (NFR-2): check the file extension and the real file type, enforce the 5 MB limit, generate a random file name, and store the file in the upload volume outside the code path.
  - Ownership check on every endpoint. A record that belongs to another user returns 404.
- Frontend:
  - Add button on the dashboard that opens the form (FR-17, FR-18).
  - One shared form component for Add and Edit, with field-level errors, an image preview and a Cancel action (FR-20, FR-22, FR-23).
  - Edit action prefills the form (FR-23).
  - Delete action with a confirmation dialog (FR-27, FR-28).
  - Confirmation messages after add, edit and delete, and a refreshed table (FR-21, FR-26, FR-30).

Done when:

- The full flow works: Login, Dashboard, Add, Edit, Delete, Dashboard.
- Invalid input and invalid files are rejected on both the client and the server.
- Deleting a record removes its image file from disk.

## Phase 5: Hardening and quality

**Goal:** The application meets the non-functional requirements.

Tasks:

- Security review (NFR-1): CSRF protection for cookie-based sessions, secure cookie flags, security headers, rate limiting on login and contact endpoints, and no secrets in the repository.
- Upload safety review (NFR-2): path traversal checks, content-type checks, and file size limits at the web server as well as in Flask.
- Accessibility pass (NFR-5): labelled fields, keyboard navigation, focus handling in dialogs, colour contrast and image alt text. Run an automated check (axe) and a manual keyboard test.
- Responsive check on common phone and desktop sizes (NFR-3).
- Performance check (NFR-4): database index on `records.user_id` and the sortable columns, and a load test with 1,000 records.
- Tests:
  - Backend unit and API tests with pytest, including authorisation tests between two users.
  - Frontend component tests with Vitest and Testing Library.
  - One end-to-end test (Playwright) for the main flow, using the mock AAF mode.
- Continuous integration that runs lint and tests on every push.

Done when:

- The tests and linters pass in CI.
- The accessibility check shows no serious issues.
- The security checklist is signed off.

## Phase 6: Deployment and release

**Goal:** The application runs in a production environment.

Tasks:

- Production Dockerfiles: multi-stage build for the frontend (static files served by Nginx) and Gunicorn for Flask.
- Production Compose file or equivalent, with HTTPS (reverse proxy and certificates), persistent volumes for PostgreSQL and uploads, and automated backups of both.
- Production environment variables and secret handling.
- Register the production URL and callback with AAF Rapid Connect.
- Run database migrations on release.
- Logging and basic monitoring, and a documented rollback step.
- User acceptance test on the production environment.

Done when:

- The site is available over HTTPS and sign-in works with the production AAF registration.
- A backup and restore of the database and uploads has been tested.

---

## Points to confirm

1. **Contact form.** The requirements still say in FR-33 that a contact form is out of scope, but section 7 now says contact form submission is included (Name, email and message). This plan follows section 7. FR-33 should be updated to match.
2. **Contact messages.** The plan stores them in the database. Do you also want them emailed to an address?
3. **AAF registration.** It can take time to get access to the AAF test federation. Start the registration during Phase 0, so Phase 2 is not blocked.
4. **Image storage.** Local disk uploads live in a Docker volume. If the app later runs on more than one server, this needs to move to shared or object storage.
5. **Session approach.** The plan uses a server-side cookie session after the AAF token is verified. Tell me if you prefer to keep the JWT in the browser instead.
