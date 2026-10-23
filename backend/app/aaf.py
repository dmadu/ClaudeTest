"""Verification of AAF Rapid Connect assertions (HS256 JWTs)."""
from dataclasses import dataclass
from datetime import datetime, timezone

import jwt

ATTRIBUTES_CLAIM = "https://aaf.edu.au/attributes"
LEEWAY_SECONDS = 10
MAX_FIELD = 255


class InvalidAssertion(Exception):
    pass


@dataclass(frozen=True)
class Identity:
    subject: str
    jti: str
    expires_at: datetime
    name: str
    email: str


def _clean(value):
    if isinstance(value, list):
        value = value[0] if value else ""
    return value.strip()[:MAX_FIELD] if isinstance(value, str) else ""


def verify_assertion(token, *, secret, issuer, audience):
    if not secret or not audience:
        raise InvalidAssertion("AAF verification is not configured")
    try:
        claims = jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            audience=audience,
            issuer=issuer,
            leeway=LEEWAY_SECONDS,
            options={"require": ["exp", "iat", "nbf", "iss", "aud", "jti", "sub"]},
        )
    except jwt.PyJWTError as exc:
        raise InvalidAssertion(str(exc)) from exc

    if claims.get("typ") != "authnresponse":
        raise InvalidAssertion("unexpected token type")

    subject = _clean(claims["sub"])
    jti = _clean(claims["jti"])
    if not subject or not jti:
        raise InvalidAssertion("missing subject or token id")

    attributes = claims.get(ATTRIBUTES_CLAIM)
    if not isinstance(attributes, dict):
        attributes = {}

    return Identity(
        subject=subject,
        jti=jti,
        expires_at=datetime.fromtimestamp(claims["exp"], tz=timezone.utc),
        name=_clean(attributes.get("displayname") or attributes.get("cn")),
        email=_clean(attributes.get("mail")),
    )
