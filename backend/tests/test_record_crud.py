import io
import os

import pytest
from helpers import sign_in
from PIL import Image
from sqlalchemy.exc import OperationalError

from app.cli import _png
from app.extensions import db
from app.models import Record, User
from app.uploads import MAX_IMAGE_BYTES

PNG = _png((200, 30, 30))


def _jpeg():
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (10, 120, 200)).save(buf, "JPEG")
    return buf.getvalue()


JPEG = _jpeg()
GOOD = {"title": "Lake survey", "site": "Lake Burley Griffin", "latitude": "-35.2809", "longitude": "149.13"}


def make_user(sub):
    user = User(aaf_identifier=sub, name=sub, email=f"{sub}@example.test")
    db.session.add(user)
    db.session.commit()
    return user


@pytest.fixture
def alice(client):
    user = make_user("alice")
    sign_in(client, user)
    return user


def files_in(app):
    folder = app.config["UPLOAD_FOLDER"]
    return sorted(os.listdir(folder)) if os.path.isdir(folder) else []


def form(data=None, image=("a.png", PNG), **overrides):
    body = dict(GOOD if data is None else data)
    body.update(overrides)
    body = {k: v for k, v in body.items() if v is not None}
    if image is not None:
        body["image"] = (io.BytesIO(image[1]), image[0])
    return body


def create(client, **kw):
    return client.post("/api/records", data=form(**kw), content_type="multipart/form-data")


def update(client, record_id, **kw):
    return client.put(f"/api/records/{record_id}", data=form(**kw), content_type="multipart/form-data")


def existing_record(app, client, **kw):
    res = create(client, **kw)
    assert res.status_code == 201, res.get_json()
    return res.get_json()["record"]


# --- auth ------------------------------------------------------------------


@pytest.mark.parametrize(
    "method,path",
    [
        ("post", "/api/records"),
        ("get", "/api/records/1"),
        ("put", "/api/records/1"),
        ("delete", "/api/records/1"),
    ],
)
def test_requires_login(client, method, path):
    assert getattr(client, method)(path).status_code == 401


# --- create ----------------------------------------------------------------


def test_create_saves_record_and_file(app, client, alice):
    res = create(client)
    assert res.status_code == 201
    body = res.get_json()["record"]
    assert body["title"] == "Lake survey" and body["site"] == "Lake Burley Griffin"
    assert body["latitude"] == -35.2809 and body["longitude"] == 149.13
    record = db.session.get(Record, body["id"])
    assert record.user_id == alice.id
    assert record.image_path.endswith(".png") and len(record.image_path) == 36
    assert files_in(app) == [record.image_path]


def test_create_stores_jpeg_with_jpg_extension(app, client, alice):
    create(client, image=("photo.jpeg", JPEG))
    assert files_in(app)[0].endswith(".jpg")


def test_create_ignores_client_file_name_and_owner(app, client, alice):
    bob = make_user("bob")
    res = create(client, image=("../../evil.png", PNG), user_id=str(bob.id))
    assert res.status_code == 201
    assert db.session.get(Record, res.get_json()["record"]["id"]).user_id == alice.id
    assert all(".." not in f and "evil" not in f for f in files_in(app))


def test_create_trims_text(client, alice):
    body = existing_record(None, client, title="  Padded  ")
    assert body["title"] == "Padded"


@pytest.mark.parametrize("field", ["title", "site", "latitude", "longitude"])
def test_create_requires_each_field(app, client, alice, field):
    res = create(client, **{field: None})
    assert res.status_code == 400
    assert res.get_json()["errors"] == {field: "This field is required."}
    assert files_in(app) == [] and db.session.query(Record).count() == 0


def test_create_requires_image(app, client, alice):
    res = create(client, image=None)
    assert res.status_code == 400
    assert res.get_json()["errors"] == {"image": "This field is required."}


def test_blank_text_is_rejected(client, alice):
    assert "title" in create(client, title="   ").get_json()["errors"]


def test_text_length_limit(client, alice):
    assert create(client, title="x" * 200).status_code == 201
    res = create(client, site="x" * 201)
    assert res.status_code == 400 and "site" in res.get_json()["errors"]


@pytest.mark.parametrize("value", ["90", "-90", "0", "45.1234567"])
def test_valid_latitudes(client, alice, value):
    assert create(client, latitude=value).status_code == 201


@pytest.mark.parametrize(
    "value",
    [
        "90.1",
        "-90.000001",
        "91",
        "1000",
        "abc",
        "1e2",
        "NaN",
        "Infinity",
        "1_0",
        "--1",
        "1,5",
        " ",
        "9" * 400,
    ],
)
def test_invalid_latitudes(client, alice, value):
    res = create(client, latitude=value)
    assert res.status_code == 400
    assert "latitude" in res.get_json()["errors"]


@pytest.mark.parametrize(
    "value,ok", [("180", True), ("-180", True), ("180.1", False), ("-181", False), ("x", False)]
)
def test_longitude_range(client, alice, value, ok):
    assert (create(client, longitude=value).status_code == 201) == ok


def test_coordinates_are_stored_to_six_decimals(client, alice):
    body = existing_record(None, client, latitude="-35.12345678")
    assert body["latitude"] == -35.123457


def test_errors_for_several_fields_at_once(client, alice):
    res = create(client, title="", latitude="x", image=("a.png", b"nope"))
    assert set(res.get_json()["errors"]) == {"title", "latitude", "image"}


@pytest.mark.parametrize(
    "name,data",
    [
        ("text.png", b"just text pretending to be a png"),
        ("anim.gif", b"GIF89a" + b"\x00" * 20),
        ("vector.svg", b"<svg xmlns='http://www.w3.org/2000/svg'></svg>"),
        ("page.png", b"<html><script>alert(1)</script></html>"),
        ("doc.pdf", b"%PDF-1.4"),
        ("webp.png", b"RIFF\x00\x00\x00\x00WEBP"),
    ],
)
def test_non_jpeg_png_is_rejected_whatever_the_name(app, client, alice, name, data):
    res = create(client, image=(name, data))
    assert res.status_code == 400
    assert res.get_json()["errors"]["image"] == "Image must be a JPEG or PNG file."
    assert files_in(app) == []


def test_empty_image_is_rejected(client, alice):
    res = create(client, image=("a.png", b""))
    assert res.status_code == 400
    assert "image" in res.get_json()["errors"]


def test_image_at_the_size_limit_is_accepted(client, alice):
    data = PNG + b"\x00" * (MAX_IMAGE_BYTES - len(PNG))
    assert len(data) == MAX_IMAGE_BYTES
    assert create(client, image=("big.png", data)).status_code == 201


def test_image_just_over_the_limit_is_rejected(app, client, alice):
    data = PNG + b"\x00" * (MAX_IMAGE_BYTES + 1 - len(PNG))
    res = create(client, image=("big.png", data))
    assert res.status_code == 400
    assert res.get_json()["errors"]["image"] == "Image must be 5 MB or smaller."
    assert files_in(app) == []


def test_huge_request_is_rejected_with_json(app, client, alice):
    res = create(client, image=("huge.png", PNG + b"\x00" * (8 * 1024 * 1024)))
    assert res.status_code == 413
    assert res.get_json()["errors"]["image"] == "Image must be 5 MB or smaller."
    assert files_in(app) == []


def test_database_failure_leaves_no_orphan_file(app, client, alice, monkeypatch):
    def boom():
        raise OperationalError("insert", {}, Exception("db down"))

    monkeypatch.setattr(db.session, "commit", boom)
    with pytest.raises(OperationalError):
        create(client)
    assert files_in(app) == []


# --- read ------------------------------------------------------------------


def test_get_one(app, client, alice):
    created = existing_record(app, client)
    res = client.get(f"/api/records/{created['id']}")
    assert res.status_code == 200
    assert res.get_json()["record"] == created


def test_get_other_users_record_is_404(app, client, alice):
    bob = make_user("bob")
    record = Record(user_id=bob.id, title="t", site="s", latitude=1, longitude=1, image_path="x.png")
    db.session.add(record)
    db.session.commit()
    assert client.get(f"/api/records/{record.id}").status_code == 404


def test_get_unknown_is_404(client, alice):
    assert client.get("/api/records/9999").status_code == 404


# --- update ----------------------------------------------------------------


def test_update_text_keeps_image(app, client, alice):
    created = existing_record(app, client)
    before = files_in(app)
    res = update(client, created["id"], image=None, title="Renamed", latitude="10.5")
    assert res.status_code == 200
    body = res.get_json()["record"]
    assert body["title"] == "Renamed" and body["latitude"] == 10.5
    assert body["image_url"] == created["image_url"]
    assert files_in(app) == before


def test_update_with_new_image_replaces_and_removes_old(app, client, alice):
    created = existing_record(app, client)
    old = files_in(app)
    res = update(client, created["id"], image=("new.jpg", JPEG))
    assert res.status_code == 200
    new = files_in(app)
    assert len(new) == 1 and new != old and new[0].endswith(".jpg")
    assert res.get_json()["record"]["image_url"] != created["image_url"]
    assert client.get(created["image_url"].split("?")[0]).mimetype == "image/jpeg"


def test_update_validation_changes_nothing(app, client, alice):
    created = existing_record(app, client)
    before = files_in(app)
    res = update(client, created["id"], title="", image=("new.png", PNG))
    assert res.status_code == 400 and "title" in res.get_json()["errors"]
    assert files_in(app) == before
    assert client.get(f"/api/records/{created['id']}").get_json()["record"] == created


def test_update_with_bad_image_changes_nothing(app, client, alice):
    created = existing_record(app, client)
    before = files_in(app)
    res = update(client, created["id"], title="Changed", image=("x.png", b"not an image"))
    assert res.status_code == 400
    assert files_in(app) == before
    assert client.get(f"/api/records/{created['id']}").get_json()["record"]["title"] == "Lake survey"


def test_update_requires_the_text_fields(client, alice):
    created = existing_record(None, client)
    res = update(client, created["id"], image=None, site=None)
    assert res.status_code == 400 and "site" in res.get_json()["errors"]


def test_cannot_update_other_users_record(app, client, alice):
    created = existing_record(app, client)
    other = app.test_client()
    sign_in(other, make_user("bob"))
    before = files_in(app)
    res = update(other, created["id"], title="Hijacked", image=("n.png", PNG))
    assert res.status_code == 404
    assert files_in(app) == before
    assert db.session.get(Record, created["id"]).title == "Lake survey"


def test_update_failure_keeps_old_image_and_removes_new(app, client, alice, monkeypatch):
    created = existing_record(app, client)
    before = files_in(app)

    def boom():
        raise OperationalError("update", {}, Exception("db down"))

    monkeypatch.setattr(db.session, "commit", boom)
    with pytest.raises(OperationalError):
        update(client, created["id"], image=("n.png", PNG))
    assert files_in(app) == before


# --- delete ----------------------------------------------------------------


def test_delete_removes_record_and_image(app, client, alice):
    created = existing_record(app, client)
    assert client.delete(f"/api/records/{created['id']}").status_code == 204
    assert db.session.get(Record, created["id"]) is None
    assert files_in(app) == []
    assert client.get("/api/records").get_json()["total"] == 0


def test_delete_twice_is_404(app, client, alice):
    created = existing_record(app, client)
    client.delete(f"/api/records/{created['id']}")
    assert client.delete(f"/api/records/{created['id']}").status_code == 404


def test_delete_when_image_file_is_already_gone(app, client, alice):
    created = existing_record(app, client)
    os.remove(os.path.join(app.config["UPLOAD_FOLDER"], files_in(app)[0]))
    assert client.delete(f"/api/records/{created['id']}").status_code == 204


def test_cannot_delete_other_users_record(app, client, alice):
    created = existing_record(app, client)
    other = app.test_client()
    sign_in(other, make_user("bob"))
    assert other.delete(f"/api/records/{created['id']}").status_code == 404
    assert db.session.get(Record, created["id"]) is not None
    assert len(files_in(app)) == 1


def test_delete_never_removes_files_outside_upload_folder(app, client, alice, tmp_path):
    outside = tmp_path / "keep.txt"
    outside.write_text("keep me")
    record = Record(user_id=alice.id, title="t", site="s", latitude=1, longitude=1, image_path="../keep.txt")
    db.session.add(record)
    db.session.commit()
    assert client.delete(f"/api/records/{record.id}").status_code == 204
    assert outside.exists()


def test_created_record_appears_in_list_and_image_is_served(app, client, alice):
    created = existing_record(app, client)
    listed = client.get("/api/records").get_json()["records"]
    assert [r["id"] for r in listed] == [created["id"]]
    image = client.get(listed[0]["image_url"])
    assert image.status_code == 200 and image.data == PNG
