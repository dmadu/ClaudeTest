from flask import Flask, jsonify
from flask_cors import CORS
from werkzeug.middleware.proxy_fix import ProxyFix

from .config import Config
from .extensions import db, limiter, migrate
from .security import init_security
from .uploads import MAX_REQUEST_BYTES

# Placeholders that must never be used to sign sessions in production.
WEAK_SECRET_KEYS = {"dev-only-change-me", "change-me", "changeme", "secret"}


def _check_aaf_config(app):
    cfg = app.config
    if cfg["AAF_MOCK"]:
        if cfg["APP_ENV"] == "production":
            raise RuntimeError("AAF_MOCK must not be enabled when APP_ENV=production")
        cfg["AAF_SECRET"] = cfg["AAF_SECRET"] or "dev-mock-secret-not-for-production"
        cfg["AAF_AUDIENCE"] = cfg["AAF_AUDIENCE"] or "http://localhost:5173"
    elif cfg["APP_ENV"] == "production":
        missing = [k for k in ("AAF_RAPID_CONNECT_URL", "AAF_SECRET", "AAF_AUDIENCE") if not cfg[k]]
        if missing:
            raise RuntimeError(f"Missing AAF settings: {', '.join(missing)}")
        key = cfg["SECRET_KEY"]
        if key in WEAK_SECRET_KEYS or len(key) < 32:
            raise RuntimeError(
                "SECRET_KEY must be a random value of at least 32 characters when APP_ENV=production"
            )


def create_app(config_object=Config):
    app = Flask(__name__)
    app.config.from_object(config_object)

    _check_aaf_config(app)
    app.config["MAX_CONTENT_LENGTH"] = MAX_REQUEST_BYTES

    if app.config["PROXY_HOPS"] > 0:
        hops = app.config["PROXY_HOPS"]
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=hops, x_proto=hops, x_host=hops)

    db.init_app(app)
    migrate.init_app(app, db)
    limiter.init_app(app)
    init_security(app)
    CORS(app, origins=app.config["CORS_ORIGINS"], resources={r"/api/*": {}})

    from . import models  # noqa: F401  (registers models with SQLAlchemy)
    from .cli import seed_records
    from .routes.auth import bp as auth_bp
    from .routes.contact import bp as contact_bp
    from .routes.health import bp as health_bp
    from .routes.records import bp as records_bp

    app.register_blueprint(health_bp, url_prefix="/api")
    app.register_blueprint(contact_bp, url_prefix="/api")
    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(records_bp, url_prefix="/api")
    app.cli.add_command(seed_records)

    @app.errorhandler(413)
    def too_large(_error):
        return jsonify(errors={"image": "Image must be 5 MB or smaller."}), 413

    return app
