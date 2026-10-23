from flask import Flask
from flask_cors import CORS

from .config import Config
from .extensions import db, migrate


def _check_aaf_config(app):
    cfg = app.config
    if cfg["AAF_MOCK"]:
        if cfg["APP_ENV"] == "production":
            raise RuntimeError("AAF_MOCK must not be enabled when APP_ENV=production")
        cfg["AAF_SECRET"] = cfg["AAF_SECRET"] or "dev-mock-secret-not-for-production"
        cfg["AAF_AUDIENCE"] = cfg["AAF_AUDIENCE"] or "http://localhost:5173"
    elif cfg["APP_ENV"] == "production":
        missing = [
            k for k in ("AAF_RAPID_CONNECT_URL", "AAF_SECRET", "AAF_AUDIENCE") if not cfg[k]
        ]
        if missing:
            raise RuntimeError(f"Missing AAF settings: {', '.join(missing)}")
        if cfg["SECRET_KEY"] == "dev-only-change-me":
            raise RuntimeError("SECRET_KEY must be set when APP_ENV=production")


def create_app(config_object=Config):
    app = Flask(__name__)
    app.config.from_object(config_object)

    _check_aaf_config(app)

    db.init_app(app)
    migrate.init_app(app, db)
    CORS(app, origins=app.config["CORS_ORIGINS"], resources={r"/api/*": {}})

    from . import models  # noqa: F401  (registers models with SQLAlchemy)
    from .routes.auth import bp as auth_bp
    from .routes.contact import bp as contact_bp
    from .routes.health import bp as health_bp

    app.register_blueprint(health_bp, url_prefix="/api")
    app.register_blueprint(contact_bp, url_prefix="/api")
    app.register_blueprint(auth_bp, url_prefix="/api/auth")

    return app
