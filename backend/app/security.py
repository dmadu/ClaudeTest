"""CSRF protection, security headers and JSON error responses."""

import hmac

from flask import jsonify, request, session
from werkzeug.exceptions import HTTPException

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
# AAF posts to the callback from another site, and the signed assertion is its credential.
CSRF_EXEMPT_ENDPOINTS = {"auth.callback"}

API_CSP = "default-src 'none'; frame-ancestors 'none'"


def init_security(app):
    @app.before_request
    def csrf_protect():
        """Signed-in users must send the token from /api/auth/me on every state-changing request.

        SameSite=Lax cookies already stop most cross-site posts; this is the second layer.
        Requests with no session carry nothing an attacker could ride on, so they are not checked.
        """
        if request.method not in UNSAFE_METHODS or request.endpoint in CSRF_EXEMPT_ENDPOINTS:
            return None
        if session.get("user_id") is None:
            return None
        expected = session.get("csrf") or ""
        supplied = request.headers.get("X-CSRF-Token", "")
        if not expected or not hmac.compare_digest(expected, supplied):
            return jsonify(message="Invalid or missing CSRF token."), 403
        return None

    @app.after_request
    def security_headers(response):
        headers = response.headers
        headers.setdefault("X-Content-Type-Options", "nosniff")
        headers.setdefault("X-Frame-Options", "DENY")
        headers.setdefault("Referrer-Policy", "same-origin")
        headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        headers.setdefault("Content-Security-Policy", API_CSP)
        if response.mimetype == "application/json":
            headers.setdefault("Cache-Control", "no-store")
        if app.config["APP_ENV"] == "production":
            headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return response

    @app.errorhandler(HTTPException)
    def http_error(error):
        # Some errors carry their own response (for example a rate-limited sign-in redirect).
        if error.response is not None or not request.path.startswith("/api/"):
            return error
        return jsonify(message=error.description or error.name), error.code

    @app.errorhandler(500)
    def server_error(_error):
        # The traceback is already logged. Never send it to the client.
        return jsonify(message="Something went wrong on our side. Please try again."), 500
