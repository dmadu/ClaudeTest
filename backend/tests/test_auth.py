import time

import jwt
import pytest

from app import create_app
from app.aaf import ATTRIBUTES_CLAIM
from app.auth import login_required
from app.config import TestConfig
from app.extensions import db
from app.models import UsedToken, User


def make_token(secret=None, **overrides):
    now = int(time.time())
    claims = {
        "iss": TestConfig.AAF_ISSUER,
        "aud": TestConfig.AAF_AUDIENCE,
        "iat": now,
        "nbf": now,
        "exp": now + 60,
        "jti": f"jti-{time.time_ns()}",
        "typ": "authnresponse",
        "sub": "https://rapid.test.aaf.edu.au!https://records.example.test!abc",
        ATTRIBUTES_CLAIM: {"displayname": "Ada Lovelace", "mail": "ada@uni.example.edu"},
    }
    claims.update(overrides)
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, secret or TestConfig.AAF_SECRET, algorithm="HS256")


def post_assertion(client, token):
    return client.post("/api/auth/callback", data={"assertion": token})


def assert_login_error(res, code="invalid"):
    assert res.status_code == 303
    assert res.headers["Location"] == f"/login?error={code}"


def logout(client):
    token = client.get("/api/auth/me").get_json()["csrf_token"]
    return client.post("/api/auth/logout", headers={"X-CSRF-Token": token})


def logged_in_user(client):
    return client.get("/api/auth/me").get_json()["user"]


def test_login_redirects_to_rapid_connect(client):
    res = client.get("/api/auth/login")
    assert res.status_code == 302
    assert res.headers["Location"] == TestConfig.AAF_RAPID_CONNECT_URL


def test_login_unavailable_when_not_configured():
    class NoUrl(TestConfig):
        AAF_RAPID_CONNECT_URL = ""

    app = create_app(NoUrl)
    res = app.test_client().get("/api/auth/login")
    assert res.headers["Location"] == "/login?error=unavailable"


def test_valid_assertion_logs_in_and_redirects_to_dashboard(client):
    res = post_assertion(client, make_token())
    assert res.status_code == 303
    assert res.headers["Location"] == "/dashboard"
    user = logged_in_user(client)
    assert user["name"] == "Ada Lovelace"
    assert user["email"] == "ada@uni.example.edu"


def test_session_cookie_is_http_only_and_lax(client):
    res = post_assertion(client, make_token())
    cookie = res.headers["Set-Cookie"]
    assert "HttpOnly" in cookie
    assert "SameSite=Lax" in cookie


def test_same_subject_reuses_user_and_updates_details(client):
    post_assertion(client, make_token())
    logout(client)
    post_assertion(
        client,
        make_token(**{ATTRIBUTES_CLAIM: {"displayname": "Ada King", "mail": "ada@new.example.edu"}}),
    )
    assert db.session.query(User).count() == 1
    assert logged_in_user(client)["name"] == "Ada King"
    assert logged_in_user(client)["email"] == "ada@new.example.edu"


def test_different_subjects_create_different_users(client):
    post_assertion(client, make_token(sub="a"))
    logout(client)
    post_assertion(client, make_token(sub="b"))
    assert db.session.query(User).count() == 2


def test_missing_attributes_still_logs_in(client):
    res = post_assertion(client, make_token(**{ATTRIBUTES_CLAIM: None}))
    assert res.headers["Location"] == "/dashboard"
    assert logged_in_user(client) is not None


@pytest.mark.parametrize(
    "overrides",
    [
        {"exp": int(time.time()) - 3600, "iat": int(time.time()) - 7200, "nbf": int(time.time()) - 7200},
        {"nbf": int(time.time()) + 3600},
        {"aud": "https://someone-else.example"},
        {"iss": "https://evil.example"},
        {"typ": "something-else"},
        {"typ": None},
        {"sub": None},
        {"jti": None},
    ],
    ids=[
        "expired",
        "not-yet-valid",
        "wrong-audience",
        "wrong-issuer",
        "wrong-typ",
        "no-typ",
        "no-sub",
        "no-jti",
    ],
)
def test_bad_claims_are_rejected(client, overrides):
    res = post_assertion(client, make_token(**overrides))
    assert_login_error(res)
    assert logged_in_user(client) is None
    assert db.session.query(User).count() == 0


def test_wrong_signing_secret_is_rejected(client):
    assert_login_error(post_assertion(client, make_token(secret="x" * 40)))
    assert logged_in_user(client) is None


def test_unsigned_token_is_rejected(client):
    now = int(time.time())
    token = jwt.encode(
        {
            "iss": TestConfig.AAF_ISSUER,
            "aud": TestConfig.AAF_AUDIENCE,
            "iat": now,
            "nbf": now,
            "exp": now + 60,
            "jti": "j",
            "typ": "authnresponse",
            "sub": "s",
        },
        None,
        algorithm="none",
    )
    assert_login_error(post_assertion(client, token))


def test_garbage_and_missing_assertion_rejected(client):
    assert_login_error(post_assertion(client, "not-a-jwt"))
    assert_login_error(client.post("/api/auth/callback"))


def test_replayed_assertion_is_rejected(client):
    token = make_token()
    assert post_assertion(client, token).headers["Location"] == "/dashboard"
    logout(client)
    assert_login_error(post_assertion(client, token))
    assert logged_in_user(client) is None


def test_expired_used_tokens_are_purged(client):
    post_assertion(client, make_token())
    db.session.query(UsedToken).update({"expires_at": db.func.datetime("2000-01-01")})
    db.session.commit()
    post_assertion(client, make_token(sub="other"))
    assert db.session.query(UsedToken).count() == 1


def test_failed_login_keeps_existing_session_unchanged(client):
    post_assertion(client, make_token(sub="a"))
    assert_login_error(post_assertion(client, "bad"))
    assert logged_in_user(client) is not None


def test_new_login_replaces_previous_session(client):
    post_assertion(client, make_token(sub="a", **{ATTRIBUTES_CLAIM: {"displayname": "A"}}))
    post_assertion(client, make_token(sub="b", **{ATTRIBUTES_CLAIM: {"displayname": "B"}}))
    assert logged_in_user(client)["name"] == "B"


def test_me_when_logged_out(client):
    res = client.get("/api/auth/me")
    assert res.status_code == 200
    assert res.get_json() == {"user": None, "csrf_token": None}


def test_logout_ends_session(client):
    post_assertion(client, make_token())
    assert logout(client).status_code == 204
    assert logged_in_user(client) is None


def test_session_for_deleted_user_is_logged_out(client):
    post_assertion(client, make_token())
    db.session.query(User).delete()
    db.session.commit()
    assert logged_in_user(client) is None


def test_login_required_blocks_and_allows(app, client):
    @app.get("/api/_protected")
    @login_required
    def protected():
        return {"ok": True}

    assert client.get("/api/_protected").status_code == 401
    post_assertion(client, make_token())
    assert client.get("/api/_protected").status_code == 200


# --- mock mode -------------------------------------------------------------


class MockConfig(TestConfig):
    AAF_MOCK = True
    AAF_RAPID_CONNECT_URL = ""


@pytest.fixture
def mock_client():
    app = create_app(MockConfig)
    with app.app_context():
        db.create_all()
        yield app.test_client()
        db.drop_all()


def test_mock_login_disabled_by_default(client):
    assert client.get("/api/auth/mock-login").status_code == 404


def test_mock_flow_goes_through_real_verification(mock_client):
    assert mock_client.get("/api/auth/login").headers["Location"] == "/api/auth/mock-login"
    page = mock_client.get("/api/auth/mock-login?user=alice")
    assert page.status_code == 200
    html = page.get_data(as_text=True)
    token = html.split('name="assertion" value="')[1].split('"')[0]
    res = mock_client.post("/api/auth/callback", data={"assertion": token})
    assert res.headers["Location"] == "/dashboard"
    assert mock_client.get("/api/auth/me").get_json()["user"]["name"] == "Alice"


def test_mock_users_are_separate(mock_client):
    for who in ("alice", "bob"):
        html = mock_client.get(f"/api/auth/mock-login?user={who}").get_data(as_text=True)
        token = html.split('name="assertion" value="')[1].split('"')[0]
        mock_client.post("/api/auth/callback", data={"assertion": token})
        logout(mock_client)
    assert db.session.query(User).count() == 2


def test_mock_rejects_odd_user_names(mock_client):
    assert mock_client.get("/api/auth/mock-login?user=<script>").status_code == 400


def test_mock_refused_in_production():
    class Prod(MockConfig):
        APP_ENV = "production"

    with pytest.raises(RuntimeError, match="AAF_MOCK"):
        create_app(Prod)


def test_production_requires_aaf_settings():
    class Prod(TestConfig):
        APP_ENV = "production"
        AAF_SECRET = ""

    with pytest.raises(RuntimeError, match="AAF_SECRET"):
        create_app(Prod)
