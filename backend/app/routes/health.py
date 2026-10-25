from flask import Blueprint, current_app, jsonify
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from ..extensions import db

bp = Blueprint("health", __name__)


@bp.get("/health")
def health():
    """For uptime monitors and container health checks. 503 when the database cannot be reached."""
    try:
        db.session.execute(text("SELECT 1"))
    except SQLAlchemyError:
        current_app.logger.exception("Health check: the database is unreachable")
        return jsonify(status="error", database="unavailable"), 503
    return jsonify(status="ok", database="ok")
