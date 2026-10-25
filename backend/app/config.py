import os
from datetime import timedelta


def _flag(name, default=False):
    return os.environ.get(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


class Config:
    APP_ENV = os.environ.get("APP_ENV", "development")
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-only-change-me")
    SQLALCHEMY_DATABASE_URI = os.environ.get(
        "DATABASE_URL", "postgresql+psycopg://records:records@localhost:5432/records"
    )
    CORS_ORIGINS = [
        o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()
    ]
    UPLOAD_FOLDER = os.environ.get("UPLOAD_FOLDER", "uploads")

    # Session cookie
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = _flag("SESSION_COOKIE_SECURE")
    PERMANENT_SESSION_LIFETIME = timedelta(hours=8)

    # AAF Rapid Connect
    AAF_RAPID_CONNECT_URL = os.environ.get("AAF_RAPID_CONNECT_URL", "")
    AAF_SECRET = os.environ.get("AAF_SECRET", "")
    AAF_ISSUER = os.environ.get("AAF_ISSUER", "https://rapid.test.aaf.edu.au")
    AAF_AUDIENCE = os.environ.get("AAF_AUDIENCE", "")
    # Local development only: sign in without AAF. Refused when APP_ENV=production.
    AAF_MOCK = _flag("AAF_MOCK")

    # Where the browser is sent after login. Empty means same origin.
    FRONTEND_URL = os.environ.get("FRONTEND_URL", "").rstrip("/")

    # How long browsers must insist on HTTPS (seconds), sent in production. 0 switches it off, which
    # is only for a rehearsal on localhost: browsers remember HSTS per host name, whatever the port.
    HSTS_MAX_AGE = int(os.environ.get("HSTS_MAX_AGE", "31536000"))

    # Number of reverse proxies in front of the app (0 = none). Needed so rate limits see the
    # real client address instead of the proxy's.
    PROXY_HOPS = int(os.environ.get("PROXY_HOPS", "0"))

    RATELIMIT_ENABLED = _flag("RATELIMIT_ENABLED", True)
    RATELIMIT_STORAGE_URI = os.environ.get("RATELIMIT_STORAGE_URI", "memory://")
    RATELIMIT_HEADERS_ENABLED = True


class TestConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite://"
    SECRET_KEY = "test-secret-key"  # noqa: S105 (tests only)
    AAF_RAPID_CONNECT_URL = "https://rapid.test.aaf.edu.au/jwt/authnrequest/research/abc123"
    AAF_SECRET = "test-aaf-shared-secret-0123456789abcdef"  # noqa: S105 (tests only)
    AAF_ISSUER = "https://rapid.test.aaf.edu.au"
    AAF_AUDIENCE = "https://records.example.test"
    AAF_MOCK = False
    FRONTEND_URL = ""
    RATELIMIT_ENABLED = False
