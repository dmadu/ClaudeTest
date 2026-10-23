import re

from flask import Blueprint, jsonify, request

from ..extensions import db
from ..models import ContactMessage

bp = Blueprint("contact", __name__)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
LIMITS = {"name": 100, "email": 255, "message": 2000}


def validate(data):
    errors = {}
    values = {}
    for field in ("name", "email", "message"):
        raw = data.get(field)
        value = raw.strip() if isinstance(raw, str) else ""
        values[field] = value
        if not value:
            errors[field] = "This field is required."
        elif len(value) > LIMITS[field]:
            errors[field] = f"Must be at most {LIMITS[field]} characters."
    if "email" not in errors and not EMAIL_RE.match(values["email"]):
        errors["email"] = "Enter a valid email address."
    return values, errors


@bp.post("/contact")
def create_contact_message():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify(errors={"_": "Request body must be JSON."}), 400

    values, errors = validate(data)
    if errors:
        return jsonify(errors=errors), 400

    db.session.add(ContactMessage(**values))
    db.session.commit()
    return jsonify(message="Thank you, your message has been sent."), 201
