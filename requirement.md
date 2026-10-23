# Requirements

## 1. Overview

A website where authenticated users manage their own records. Users sign in through AAF (Australian Access Federation), then view, add, edit and delete records from a dashboard. Each record has a title, a site, geographic coordinates and an image.

## 2. Users

| Role | Description |
|------|-------------|
| Visitor | Not signed in. Can see the public pages (Home, About, Contact) and sign in. |
| Authenticated user | Signed in through AAF. Can manage their own records. |

## 3. Functional Requirements

### 3.1 Navigation (top menu)

- **FR-1** Every page shows a top menu with these items: **Home**, **About**, **Contact** and **Login**.
- **FR-2** Home is the landing page.
- **FR-3** After login, the **Login** item is replaced by the user's identity and a **Logout** action. The menu also links to the Dashboard.

### 3.2 Authentication

- **FR-4** Users sign in with **AAF**. The website does not store passwords.
- **FR-5** The Login menu item starts the AAF sign-in flow.
- **FR-6** After a successful sign-in, the user is redirected to the **Dashboard**.
- **FR-7** If sign-in fails or is cancelled, the user returns to the public site and sees a clear message.
- **FR-8** The Dashboard and all record operations require a signed-in user. Unauthenticated requests are redirected to Login.
- **FR-9** Users can sign out, which ends their session.

### 3.3 Dashboard

- **FR-10** The dashboard shows a table of the records the signed-in user has uploaded.
- **FR-11** The dashboard shows the total number of the user's records.
- **FR-12** The table is **paginated**. The page size is fixed or selectable (default 10).
- **FR-13** Every column header supports **sorting** (ascending and descending). The active sort column and direction are shown.
- **FR-14** The table columns are: Title, Site, Latitude, Longitude, Image (thumbnail) and Actions (Edit, Delete).
- **FR-15** When the user has no records, the dashboard shows an empty state that points to the Add button.
- **FR-16** A user sees only their own records.

### 3.4 Add record

- **FR-17** The dashboard has an **Add** button.
- **FR-18** The Add button opens a **form** to create a record.
- **FR-19** The form fields are:

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| Title | Text | Yes | Non-empty, max 200 characters |
| Site | Text | Yes | Non-empty, max 200 characters |
| Latitude | Decimal number | Yes | Between -90 and 90 |
| Longitude | Decimal number | Yes | Between -180 and 180 |
| Image | File upload | Yes | Image types only (JPEG, PNG), max size 5 MB |

- **FR-20** The form validates input and shows errors next to each field.
- **FR-21** After a successful submit, the record is saved, the user returns to the dashboard and sees a confirmation message.
- **FR-22** The user can cancel the form and return to the dashboard without saving.

### 3.5 Edit record

- **FR-23** Each row has an **Edit** action that opens the same form, filled with the record's current values.
- **FR-24** The user can replace the image. If they do not choose a new one, the existing image is kept.
- **FR-25** The same validation rules as Add apply.
- **FR-26** After a successful save, the user returns to the dashboard and sees a confirmation message.

### 3.6 Delete record

- **FR-27** Each row has a **Delete** action.
- **FR-28** Delete asks for confirmation before it removes the record.
- **FR-29** Deleting a record also removes its stored image.
- **FR-30** After deletion, the table refreshes and shows a confirmation message.

### 3.7 Public pages

- **FR-31** **Home** introduces the website and links to Login.
- **FR-32** **About** describes the website.
- **FR-33** **Contact** gives contact details. A contact form is out of scope unless added later.

## 4. Non-Functional Requirements

- **NFR-1 Security:** Authentication uses AAF. Sessions are protected, and the site is served over HTTPS. Users can read and change only their own records, and the server enforces this.
- **NFR-2 Upload safety:** The server checks file type and size, and stores uploads outside the code path under generated file names.
- **NFR-3 Usability:** Pages work on desktop and mobile screen sizes.
- **NFR-4 Performance:** The dashboard loads in under 2 seconds for up to 1,000 records per user. Sorting and pagination are done on the server.
- **NFR-5 Accessibility:** The site aims for WCAG 2.1 AA, including labelled form fields, keyboard operation and image alt text.

## 5. Data Model

**User** (identified by the AAF identity)

| Field | Notes |
|-------|-------|
| id | Primary key |
| aaf_identifier | Unique identifier from AAF |
| name, email | From AAF attributes |

**Record**

| Field | Type | Notes |
|-------|------|-------|
| id | Integer / UUID | Primary key |
| user_id | Foreign key | Owner of the record |
| title | String | |
| site | String | |
| latitude | Decimal | -90 to 90 |
| longitude | Decimal | -180 to 180 |
| image_path | String | Location of the stored image |
| created_at, updated_at | Timestamp | |

## 6. Pages and Flows

| Page | Access | Purpose |
|------|--------|---------|
| Home | Public | Landing page |
| About | Public | Information |
| Contact | Public | Contact details |
| Login | Public | Starts the AAF sign-in |
| Dashboard | Signed in | Paginated, sortable table of records |
| Add record | Signed in | Form to create a record |
| Edit record | Signed in | Form to update a record |

Main flow: Home → Login (AAF) → Dashboard → Add / Edit / Delete → Dashboard.

## 7. Assumptions and Open Questions

- AAF is integrated through AAF Rapid Connect (OIDC/JWT). 
- A user can only access their own records. No admin role is specified.
- Image limits (JPEG/PNG, 5 MB) are proposed defaults and can be changed.
- Image storage (local disk)
- The technology stack is React frontend, Flask backend, PostgreSQL database, SQLAlchemy ORM,Docker.
- Latitude and longitude are entered manually. A map picker is out of scope for now.
- Contact form submission with Name, email and message.
- All secrets are stored in environment variables.

## 8. Out of Scope

- Sign-in methods other than AAF
- Sharing records between users
- Bulk upload or export
- Map display
