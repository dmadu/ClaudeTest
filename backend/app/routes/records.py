import math
import os
import re
from decimal import Decimal, InvalidOperation

from flask import Blueprint, current_app, g, jsonify, request, send_from_directory
from sqlalchemy import func, select
from werkzeug.exceptions import NotFound

from ..auth import login_required
from ..extensions import db
from ..models import Record
from ..uploads import read_image, remove_image, save_image

bp = Blueprint("records", __name__)

PAGE_SIZES = (10, 25, 50, 100)
DEFAULT_PAGE_SIZE = 10
SORT_COLUMNS = {
    "title": func.lower(Record.title),
    "site": func.lower(Record.site),
    "latitude": Record.latitude,
    "longitude": Record.longitude,
    "created_at": Record.created_at,
}
DEFAULT_SORT = "created_at"
DEFAULT_ORDER = "desc"


def record_json(record):
    return {
        "id": record.id,
        "title": record.title,
        "site": record.site,
        "latitude": float(record.latitude),
        "longitude": float(record.longitude),
        # The version changes with every new image, so browsers do not show a stale cached one.
        "image_url": f"/api/records/{record.id}/image?v={os.path.splitext(record.image_path)[0]}",
        "created_at": record.created_at.isoformat(),
        "updated_at": record.updated_at.isoformat(),
    }


def _int_arg(name, default, errors):
    raw = request.args.get(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        errors[name] = "Must be a whole number."
        return default


def parse_list_args():
    errors = {}
    page = _int_arg("page", 1, errors)
    page_size = _int_arg("page_size", DEFAULT_PAGE_SIZE, errors)
    sort = request.args.get("sort", DEFAULT_SORT)
    order = request.args.get("order", DEFAULT_ORDER)

    if "page" not in errors and page < 1:
        errors["page"] = "Must be 1 or more."
    if "page_size" not in errors and page_size not in PAGE_SIZES:
        errors["page_size"] = f"Must be one of {', '.join(map(str, PAGE_SIZES))}."
    if sort not in SORT_COLUMNS:
        errors["sort"] = f"Must be one of {', '.join(SORT_COLUMNS)}."
    if order not in ("asc", "desc"):
        errors["order"] = "Must be asc or desc."
    return page, page_size, sort, order, errors


@bp.get("/records")
@login_required
def list_records():
    page, page_size, sort, order, errors = parse_list_args()
    if errors:
        return jsonify(errors=errors), 400

    user_id = g.current_user.id
    total = db.session.scalar(select(func.count()).select_from(Record).where(Record.user_id == user_id))

    column = SORT_COLUMNS[sort]
    direction = column.asc() if order == "asc" else column.desc()
    # id breaks ties so pages never repeat or skip rows
    query = (
        select(Record)
        .where(Record.user_id == user_id)
        .order_by(direction, Record.id.desc() if order == "desc" else Record.id.asc())
        .limit(page_size)
        .offset((page - 1) * page_size)
    )
    records = db.session.scalars(query).all()

    return jsonify(
        records=[record_json(r) for r in records],
        total=total,
        page=page,
        page_size=page_size,
        pages=math.ceil(total / page_size),
    )


@bp.get("/records/<int:record_id>/image")
@login_required
def record_image(record_id):
    record = db.session.scalar(
        select(Record).where(Record.id == record_id, Record.user_id == g.current_user.id)
    )
    if record is None:
        raise NotFound()

    folder = os.path.abspath(current_app.config["UPLOAD_FOLDER"])
    # send_from_directory refuses paths that escape the folder
    response = send_from_directory(folder, record.image_path, max_age=0)
    response.headers["Cache-Control"] = "private, max-age=300"
    response.headers["X-Content-Type-Options"] = "nosniff"
    # Uploaded content: if it is ever opened as a page, it can run nothing and load nothing.
    response.headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox"
    return response


# --- create, read, update, delete ------------------------------------------

TEXT_LIMIT = 200
NUMBER_RE = re.compile(r"^-?\d+(\.\d+)?$")


def _text(form, name, errors):
    value = (form.get(name) or "").strip()
    if not value:
        errors[name] = "This field is required."
    elif len(value) > TEXT_LIMIT:
        errors[name] = f"Must be at most {TEXT_LIMIT} characters."
    return value


def _coordinate(form, name, limit, errors):
    raw = (form.get(name) or "").strip()
    if not raw:
        errors[name] = "This field is required."
        return None
    if not NUMBER_RE.match(raw):
        errors[name] = "Enter a number, for example -35.2809."
        return None
    value = Decimal(raw)
    if abs(value) > limit:
        errors[name] = f"Must be between -{limit} and {limit}."
        return None
    try:
        return value.quantize(Decimal("0.000001"))
    except InvalidOperation:
        errors[name] = "Enter a number, for example -35.2809."
        return None


def parse_record_form(image_required):
    """Validate the submitted form. Returns (values, image, errors)."""
    form = request.form
    errors = {}
    values = {
        "title": _text(form, "title", errors),
        "site": _text(form, "site", errors),
        "latitude": _coordinate(form, "latitude", 90, errors),
        "longitude": _coordinate(form, "longitude", 180, errors),
    }

    image = None
    upload = request.files.get("image")
    if upload is not None and upload.filename:
        image = read_image(upload, errors)
    elif image_required:
        errors["image"] = "This field is required."
    return values, image, errors


def _own_record(record_id):
    record = db.session.scalar(
        select(Record).where(Record.id == record_id, Record.user_id == g.current_user.id)
    )
    if record is None:
        raise NotFound()
    return record


def _commit_or_discard_file(new_filename):
    """Commit, and if that fails remove the file we just wrote, so no orphan is left behind."""
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        remove_image(new_filename)
        raise


@bp.post("/records")
@login_required
def create_record():
    values, image, errors = parse_record_form(image_required=True)
    if errors:
        return jsonify(errors=errors), 400

    filename = save_image(*image)
    record = Record(user_id=g.current_user.id, image_path=filename, **values)
    db.session.add(record)
    _commit_or_discard_file(filename)
    return jsonify(record=record_json(record)), 201


@bp.get("/records/<int:record_id>")
@login_required
def get_record(record_id):
    return jsonify(record=record_json(_own_record(record_id)))


@bp.put("/records/<int:record_id>")
@login_required
def update_record(record_id):
    record = _own_record(record_id)
    values, image, errors = parse_record_form(image_required=False)
    if errors:
        return jsonify(errors=errors), 400

    old_filename = None
    new_filename = None
    for field, value in values.items():
        setattr(record, field, value)
    if image:
        old_filename = record.image_path
        new_filename = save_image(*image)
        record.image_path = new_filename

    _commit_or_discard_file(new_filename)
    remove_image(old_filename)
    return jsonify(record=record_json(record))


@bp.delete("/records/<int:record_id>")
@login_required
def delete_record(record_id):
    record = _own_record(record_id)
    filename = record.image_path
    db.session.delete(record)
    db.session.commit()
    remove_image(filename)
    return "", 204
