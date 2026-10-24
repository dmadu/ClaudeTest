import re
import secrets
import time
from datetime import UTC, datetime
from html import escape

import jwt
from flask import Blueprint, current_app, jsonify, redirect, request, session
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from ..aaf import ATTRIBUTES_CLAIM, InvalidAssertion, verify_assertion
from ..auth import current_user
from ..extensions import db, limiter
from ..models import UsedToken, User

bp = Blueprint("auth", __name__)

MOCK_USER_RE = re.compile(r"^[a-z0-9]{1,20}$")


def _frontend(path):
    return f"{current_app.config['FRONTEND_URL']}{path}"


def _login_error(code):
    return redirect(_frontend(f"/login?error={code}"), 303)


def _too_many_sign_ins(_limit):
    # These are browser navigations, so show the login page with a message, not raw JSON.
    return _login_error("ratelimited")


def _consume_jti(identity):
    """Record the assertion id. Returns False if it was already used."""
    db.session.execute(delete(UsedToken).where(UsedToken.expires_at < datetime.now(UTC)))
    db.session.add(UsedToken(jti=identity.jti, expires_at=identity.expires_at))
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return False
    return True


def _upsert_user(identity):
    def find():
        return db.session.execute(
            select(User).where(User.aaf_identifier == identity.subject)
        ).scalar_one_or_none()

    user = find()
    if user is None:
        user = User(aaf_identifier=identity.subject, name=identity.name, email=identity.email)
        db.session.add(user)
        try:
            db.session.commit()
            return user
        except IntegrityError:  # a parallel first login created it
            db.session.rollback()
            user = find()
    if identity.name:
        user.name = identity.name
    if identity.email:
        user.email = identity.email
    db.session.commit()
    return user


def _user_json(user):
    return {"id": user.id, "name": user.name, "email": user.email}


@bp.get("/login")
@limiter.limit("20 per minute", on_breach=_too_many_sign_ins)
def login():
    if current_app.config["AAF_MOCK"]:
        return redirect("/api/auth/mock-login")
    url = current_app.config["AAF_RAPID_CONNECT_URL"]
    if not url:
        current_app.logger.error("AAF_RAPID_CONNECT_URL is not configured")
        return _login_error("unavailable")
    return redirect(url)


@bp.post("/callback")
@limiter.limit("10 per minute", on_breach=_too_many_sign_ins)
def callback():
    token = request.form.get("assertion")
    if not token:
        return _login_error("invalid")

    cfg = current_app.config
    try:
        identity = verify_assertion(
            token,
            secret=cfg["AAF_SECRET"],
            issuer=cfg["AAF_ISSUER"],
            audience=cfg["AAF_AUDIENCE"],
        )
    except InvalidAssertion as exc:
        current_app.logger.warning("Rejected AAF assertion: %s", exc)
        return _login_error("invalid")

    if not _consume_jti(identity):
        current_app.logger.warning("Rejected replayed AAF assertion")
        return _login_error("invalid")

    user = _upsert_user(identity)
    session.clear()
    session["user_id"] = user.id
    session["csrf"] = secrets.token_urlsafe(32)
    session.permanent = True
    return redirect(_frontend("/dashboard"), 303)


@bp.get("/me")
def me():
    user = current_user()
    if user is None:
        return jsonify(user=None, csrf_token=None)
    if not session.get("csrf"):
        session["csrf"] = secrets.token_urlsafe(32)
    return jsonify(user=_user_json(user), csrf_token=session["csrf"])


@bp.post("/logout")
def logout():
    session.clear()
    return "", 204


@bp.get("/mock-login")
def mock_login():
    """Development stand-in for AAF. Posts a signed assertion to the real callback."""
    cfg = current_app.config
    if not cfg["AAF_MOCK"]:
        return jsonify(message="Not found."), 404

    who = request.args.get("user", "dev").lower()
    if not MOCK_USER_RE.match(who):
        return jsonify(message="user must be 1-20 letters or digits."), 400

    now = int(time.time())
    assertion = jwt.encode(
        {
            "iss": cfg["AAF_ISSUER"],
            "aud": cfg["AAF_AUDIENCE"],
            "iat": now,
            "nbf": now,
            "exp": now + 60,
            "jti": f"mock-{who}-{time.time_ns()}",
            "typ": "authnresponse",
            "sub": f"mock!{who}",
            ATTRIBUTES_CLAIM: {"displayname": who.title(), "mail": f"{who}@example.test"},
        },
        cfg["AAF_SECRET"],
        algorithm="HS256",
    )
    page = (
        "<!doctype html><title>Mock AAF sign-in</title>"
        '<form id="f" method="post" action="/api/auth/callback">'
        f'<input type="hidden" name="assertion" value="{escape(assertion)}">'
        "<noscript><button>Continue</button></noscript></form>"
        "<script>document.getElementById('f').submit()</script>"
    )
    return (
        page,
        200,
        {"Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; form-action 'self'"},
    )
