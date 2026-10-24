import io

import pytest
from helpers import CSRF, sign_in
from PIL import Image
from test_auth import make_token, post_assertion

from app import create_app
from app.config import TestConfig
from app.extensions import db
from app.models import Record, User

CONTACT = {"name": "Ada", "email": "ada@example.com", "message": "Hello"}


def make_user(sub="alice"):
    user = User(aaf_identifier=sub, name=sub, email=f"{sub}@example.test")
    db.session.add(user)
    db.session.commit()
    return user


def png_bytes(size=(8, 8), mode="RGB"):
    buf = io.BytesIO()
    Image.new(mode, size).save(buf, "PNG")
    return buf.getvalue()


def build_app(tmp_path, **overrides):
    class Config(TestConfig):
        UPLOAD_FOLDER = str(tmp_path / "uploads")

    for key, value in overrides.items():
        setattr(Config, key, value)
    app = create_app(Config)
    ctx = app.app_context()
    ctx.push()
    db.create_all()
    return app, ctx


@pytest.fixture
def signed_in(app):
    """A client that is signed in but does NOT send the CSRF token."""
    client = app.test_client()
    sign_in(client, make_user())
    del client.environ_base["HTTP_X_CSRF_TOKEN"]
    return client


# --- CSRF ------------------------------------------------------------------


@pytest.mark.parametrize(
    "method,path",
    [
        ("post", "/api/records"),
        ("put", "/api/records/1"),
        ("delete", "/api/records/1"),
        ("post", "/api/auth/logout"),
        ("post", "/api/contact"),
    ],
)
def test_signed_in_write_without_token_is_forbidden(signed_in, method, path):
    res = (
        getattr(signed_in, method)(path, json=CONTACT)
        if path == "/api/contact"
        else getattr(signed_in, method)(path)
    )
    assert res.status_code == 403
    assert "CSRF" in res.get_json()["message"]


def test_wrong_token_is_forbidden(signed_in):
    res = signed_in.post("/api/auth/logout", headers={"X-CSRF-Token": "guess"})
    assert res.status_code == 403
    assert signed_in.get("/api/auth/me").get_json()["user"] is not None


def test_token_of_the_same_length_but_different_is_forbidden(signed_in):
    res = signed_in.post("/api/auth/logout", headers={"X-CSRF-Token": "x" * len(CSRF)})
    assert res.status_code == 403


def test_correct_token_is_accepted(signed_in):
    assert signed_in.post("/api/auth/logout", headers={"X-CSRF-Token": CSRF}).status_code == 204


def test_reads_do_not_need_a_token(signed_in):
    assert signed_in.get("/api/records").status_code == 200
    assert signed_in.get("/api/auth/me").status_code == 200


def test_anonymous_writes_are_not_csrf_checked(client):
    assert client.post("/api/contact", json=CONTACT).status_code == 201
    assert client.post("/api/records").status_code == 401  # login required, not CSRF


def test_aaf_callback_is_exempt_even_when_signed_in(signed_in):
    res = post_assertion(signed_in, make_token(sub="someone-else"))
    assert res.status_code == 303 and res.headers["Location"] == "/dashboard"


def test_me_returns_the_session_token(client):
    post_assertion(client, make_token())
    body = client.get("/api/auth/me").get_json()
    assert len(body["csrf_token"]) >= 32
    assert client.get("/api/auth/me").get_json()["csrf_token"] == body["csrf_token"]


def test_each_login_gets_a_new_token(client):
    post_assertion(client, make_token(sub="a"))
    first = client.get("/api/auth/me").get_json()["csrf_token"]
    post_assertion(client, make_token(sub="a"))
    assert client.get("/api/auth/me").get_json()["csrf_token"] != first


def test_old_session_without_token_gets_one_from_me(app):
    client = app.test_client()
    with client.session_transaction() as s:
        s["user_id"] = make_user().id
    token = client.get("/api/auth/me").get_json()["csrf_token"]
    assert token
    assert client.post("/api/auth/logout", headers={"X-CSRF-Token": token}).status_code == 204


def test_token_is_not_given_to_visitors(client):
    assert client.get("/api/auth/me").get_json()["csrf_token"] is None


# --- headers and errors ----------------------------------------------------


def test_security_headers_on_api_responses(client):
    res = client.get("/api/health")
    assert res.headers["X-Content-Type-Options"] == "nosniff"
    assert res.headers["X-Frame-Options"] == "DENY"
    assert res.headers["Referrer-Policy"] == "same-origin"
    assert "frame-ancestors 'none'" in res.headers["Content-Security-Policy"]
    assert "camera=()" in res.headers["Permissions-Policy"]
    assert res.headers["Cache-Control"] == "no-store"
    assert "Strict-Transport-Security" not in res.headers


STRONG_KEY = "k" * 40


def test_hsts_only_in_production(tmp_path):
    app, ctx = build_app(tmp_path, APP_ENV="production", SECRET_KEY=STRONG_KEY)
    try:
        res = app.test_client().get("/api/health")
        assert "max-age=" in res.headers["Strict-Transport-Security"]
    finally:
        ctx.pop()


def test_image_responses_are_sandboxed_and_not_marked_no_store(app, client):
    user = make_user()
    sign_in(client, user)
    import os

    os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)
    with open(os.path.join(app.config["UPLOAD_FOLDER"], "a.png"), "wb") as fh:
        fh.write(png_bytes())
    record = Record(user_id=user.id, title="t", site="s", latitude=1, longitude=1, image_path="a.png")
    db.session.add(record)
    db.session.commit()
    res = client.get(f"/api/records/{record.id}/image")
    assert "sandbox" in res.headers["Content-Security-Policy"]
    assert "no-store" not in res.headers["Cache-Control"]


def test_unknown_api_path_is_json_404(client):
    res = client.get("/api/does-not-exist")
    assert res.status_code == 404 and res.is_json and "message" in res.get_json()


def test_wrong_method_is_json_405(client):
    res = client.delete("/api/health")
    assert res.status_code == 405 and res.is_json


def test_non_api_404_is_not_forced_to_json(client):
    assert not client.get("/nothing-here").is_json


def test_unexpected_errors_do_not_leak_details(app):
    app.config["PROPAGATE_EXCEPTIONS"] = False

    @app.get("/api/_boom")
    def boom():
        raise RuntimeError("database password is hunter2")

    res = app.test_client().get("/api/_boom")
    assert res.status_code == 500
    assert "hunter2" not in res.get_data(as_text=True)
    assert res.get_json()["message"]


# --- rate limiting ---------------------------------------------------------


def test_contact_is_rate_limited(tmp_path):
    app, ctx = build_app(tmp_path, RATELIMIT_ENABLED=True)
    try:
        client = app.test_client()
        codes = [client.post("/api/contact", json=CONTACT).status_code for _ in range(7)]
        assert codes == [201] * 5 + [429] * 2
        res = client.post("/api/contact", json=CONTACT)
        assert res.is_json and res.get_json()["message"]
    finally:
        ctx.pop()


def test_callback_is_rate_limited(tmp_path):
    app, ctx = build_app(tmp_path, RATELIMIT_ENABLED=True)
    try:
        client = app.test_client()
        codes = [client.post("/api/auth/callback", data={"assertion": "x"}).status_code for _ in range(12)]
        assert codes == [303] * 12  # the last two are redirected to the login page
        res = client.post("/api/auth/callback", data={"assertion": "x"})
        assert res.headers["Location"] == "/login?error=ratelimited"
    finally:
        ctx.pop()


def test_login_start_is_rate_limited(tmp_path):
    app, ctx = build_app(tmp_path, RATELIMIT_ENABLED=True)
    try:
        client = app.test_client()
        codes = [client.get("/api/auth/login").status_code for _ in range(22)]
        assert codes[:20] == [302] * 20 and codes[20:] == [303, 303]
        res = client.get("/api/auth/login")
        assert res.headers["Location"] == "/login?error=ratelimited"
    finally:
        ctx.pop()


def test_limits_are_per_client_address_behind_a_proxy(tmp_path):
    app, ctx = build_app(tmp_path, RATELIMIT_ENABLED=True, PROXY_HOPS=1)
    try:
        client = app.test_client()
        a = {"X-Forwarded-For": "10.0.0.1"}
        b = {"X-Forwarded-For": "10.0.0.2"}
        assert [client.post("/api/contact", json=CONTACT, headers=a).status_code for _ in range(6)][-1] == 429
        assert client.post("/api/contact", json=CONTACT, headers=b).status_code == 201
    finally:
        ctx.pop()


def test_forwarded_header_is_ignored_without_a_proxy(tmp_path):
    app, ctx = build_app(tmp_path, RATELIMIT_ENABLED=True, PROXY_HOPS=0)
    try:
        client = app.test_client()
        codes = [
            client.post("/api/contact", json=CONTACT, headers={"X-Forwarded-For": f"10.0.0.{i}"}).status_code
            for i in range(6)
        ]
        assert codes[-1] == 429  # spoofing the header does not buy a fresh allowance
    finally:
        ctx.pop()


# --- images are fully decoded ---------------------------------------------


def upload(client, data, name="a.png"):
    return client.post(
        "/api/records",
        data={
            "title": "t",
            "site": "s",
            "latitude": "1",
            "longitude": "2",
            "image": (io.BytesIO(data), name),
        },
        content_type="multipart/form-data",
    )


@pytest.fixture
def uploader(client):
    sign_in(client, make_user())
    return client


def test_truncated_png_is_rejected(uploader):
    data = png_bytes((200, 200))
    res = upload(uploader, data[: len(data) // 2])
    assert res.status_code == 400
    assert "damaged" in res.get_json()["errors"]["image"]


def test_png_header_with_garbage_is_rejected(uploader):
    res = upload(uploader, b"\x89PNG\r\n\x1a\n" + b"garbage" * 50)
    assert res.status_code == 400
    assert "image" in res.get_json()["errors"]


def test_jpeg_header_with_garbage_is_rejected(uploader):
    res = upload(uploader, b"\xff\xd8\xff\xe0" + b"garbage" * 50, "a.jpg")
    assert res.status_code == 400


def test_huge_dimensions_are_rejected_before_decoding(uploader):
    data = png_bytes((8000, 8000), mode="1")  # tiny file, 64 megapixels
    assert len(data) < 1024 * 1024
    res = upload(uploader, data)
    assert res.status_code == 400
    assert "too large" in res.get_json()["errors"]["image"]


def test_normal_images_still_pass(uploader):
    assert upload(uploader, png_bytes((300, 200))).status_code == 201


# --- indexes ---------------------------------------------------------------


def test_sort_indexes_are_declared(app):
    # Expression indexes cannot be reflected back from SQLite, so check the model. The migration
    # is checked against PostgreSQL by hand (see docs/security_checklist.md).
    names = {ix.name for ix in Record.__table__.indexes}
    assert {
        "ix_records_user_created",
        "ix_records_user_latitude",
        "ix_records_user_longitude",
        "ix_records_user_title_lower",
        "ix_records_user_site_lower",
    } <= names


@pytest.mark.parametrize("key", ["change-me", "dev-only-change-me", "short-key", "x" * 31])
def test_production_refuses_weak_secret_keys(tmp_path, key):
    class Prod(TestConfig):
        APP_ENV = "production"
        SECRET_KEY = key

    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        create_app(Prod)


def test_production_accepts_a_strong_secret_key(tmp_path):
    app, ctx = build_app(tmp_path, APP_ENV="production", SECRET_KEY=STRONG_KEY)
    ctx.pop()
    assert app.config["APP_ENV"] == "production"
