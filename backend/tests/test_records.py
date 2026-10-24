import os
from datetime import UTC, datetime, timedelta

import pytest
from helpers import sign_in

from app.cli import _png
from app.extensions import db
from app.models import Record, User


def make_user(sub, name=None):
    user = User(aaf_identifier=sub, name=name or sub, email=f"{sub}@example.test")
    db.session.add(user)
    db.session.commit()
    return user


def add_record(user, i=1, **overrides):
    base = datetime(2025, 1, 1, tzinfo=UTC)
    values = dict(
        user_id=user.id,
        title=f"Title {i}",
        site=f"Site {i}",
        latitude=-30 + i,
        longitude=140 + i,
        image_path=f"img{i}.png",
        created_at=base + timedelta(minutes=i),
    )
    values.update(overrides)
    record = Record(**values)
    db.session.add(record)
    db.session.commit()
    return record


def login(client, user):
    sign_in(client, user)


def titles(res):
    return [r["title"] for r in res.get_json()["records"]]


@pytest.fixture
def alice(client):
    user = make_user("alice")
    login(client, user)
    return user


def test_list_requires_login(client):
    assert client.get("/api/records").status_code == 401


def test_image_requires_login(client):
    assert client.get("/api/records/1/image").status_code == 401


def test_list_json_shape(client, alice):
    record = add_record(alice, 1, latitude=-35.123456, longitude=149.5)
    body = client.get("/api/records").get_json()
    assert body["total"] == 1 and body["page"] == 1 and body["page_size"] == 10 and body["pages"] == 1
    item = body["records"][0]
    assert item["id"] == record.id
    assert item["title"] == "Title 1" and item["site"] == "Site 1"
    assert item["latitude"] == -35.123456 and item["longitude"] == 149.5
    assert item["image_url"] == f"/api/records/{record.id}/image?v=img1"
    assert "image_path" not in item and "user_id" not in item


def test_only_own_records_are_listed(client, alice):
    bob = make_user("bob")
    add_record(alice, 1, title="mine")
    add_record(bob, 2, title="not mine")
    res = client.get("/api/records")
    assert titles(res) == ["mine"]
    assert res.get_json()["total"] == 1


def test_empty_list(client, alice):
    body = client.get("/api/records").get_json()
    assert body["records"] == [] and body["total"] == 0 and body["pages"] == 0


def test_default_order_is_newest_first(client, alice):
    for i in (1, 2, 3):
        add_record(alice, i)
    assert titles(client.get("/api/records")) == ["Title 3", "Title 2", "Title 1"]


def test_pagination(client, alice):
    for i in range(1, 26):
        add_record(alice, i)
    first = client.get("/api/records?page=1&page_size=10").get_json()
    last = client.get("/api/records?page=3&page_size=10").get_json()
    beyond = client.get("/api/records?page=4&page_size=10").get_json()
    assert first["total"] == 25 and first["pages"] == 3 and len(first["records"]) == 10
    assert len(last["records"]) == 5
    assert beyond["records"] == [] and beyond["pages"] == 3
    seen = [r["id"] for p in (1, 2, 3) for r in client.get(f"/api/records?page={p}").get_json()["records"]]
    assert len(seen) == len(set(seen)) == 25


@pytest.mark.parametrize("size", [10, 25, 50, 100])
def test_allowed_page_sizes(client, alice, size):
    assert client.get(f"/api/records?page_size={size}").get_json()["page_size"] == size


def test_sort_by_text_is_case_insensitive(client, alice):
    for title in ("banana", "Apple", "cherry"):
        add_record(alice, title=title)
    assert titles(client.get("/api/records?sort=title&order=asc")) == ["Apple", "banana", "cherry"]
    assert titles(client.get("/api/records?sort=title&order=desc")) == ["cherry", "banana", "Apple"]


def test_sort_by_site(client, alice):
    add_record(alice, 1, title="a", site="Zeta")
    add_record(alice, 2, title="b", site="Alpha")
    assert titles(client.get("/api/records?sort=site&order=asc")) == ["b", "a"]


def test_sort_by_number_not_text(client, alice):
    add_record(alice, 1, title="nine", latitude=9)
    add_record(alice, 2, title="ten", latitude=10)
    add_record(alice, 3, title="neg", latitude=-20)
    assert titles(client.get("/api/records?sort=latitude&order=asc")) == ["neg", "nine", "ten"]
    assert titles(client.get("/api/records?sort=latitude&order=desc")) == ["ten", "nine", "neg"]


def test_sort_by_longitude(client, alice):
    add_record(alice, 1, title="east", longitude=150)
    add_record(alice, 2, title="west", longitude=115)
    assert titles(client.get("/api/records?sort=longitude&order=asc")) == ["west", "east"]


def test_ties_are_ordered_consistently_across_pages(client, alice):
    for i in range(1, 16):
        add_record(alice, i, site="Same")
    ids = []
    for page in (1, 2):
        body = client.get(f"/api/records?sort=site&order=asc&page={page}").get_json()
        ids += [r["id"] for r in body["records"]]
    assert len(set(ids)) == 15


@pytest.mark.parametrize(
    "query,field",
    [
        ("sort=password", "sort"),
        ("sort=title;drop table records", "sort"),
        ("sort=image_path", "sort"),
        ("order=sideways", "order"),
        ("page=0", "page"),
        ("page=-1", "page"),
        ("page=abc", "page"),
        ("page_size=7", "page_size"),
        ("page_size=100000", "page_size"),
        ("page_size=x", "page_size"),
    ],
)
def test_invalid_query_is_rejected(client, alice, query, field):
    res = client.get(f"/api/records?{query}")
    assert res.status_code == 400
    assert field in res.get_json()["errors"]


# --- images ----------------------------------------------------------------


def write_image(app, name, data=None):
    folder = app.config["UPLOAD_FOLDER"]
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, name), "wb") as fh:
        fh.write(data or _png((10, 20, 30)))


def test_owner_gets_image(app, client, alice):
    write_image(app, "a.png")
    record = add_record(alice, image_path="a.png")
    res = client.get(f"/api/records/{record.id}/image")
    assert res.status_code == 200
    assert res.mimetype == "image/png"
    assert res.data.startswith(b"\x89PNG")
    assert res.headers["X-Content-Type-Options"] == "nosniff"
    assert "private" in res.headers["Cache-Control"]


def test_other_users_image_is_404(app, client, alice):
    write_image(app, "b.png")
    bob = make_user("bob")
    record = add_record(bob, image_path="b.png")
    assert client.get(f"/api/records/{record.id}/image").status_code == 404


def test_unknown_record_image_is_404(client, alice):
    assert client.get("/api/records/9999/image").status_code == 404


def test_missing_image_file_is_404(client, alice):
    record = add_record(alice, image_path="gone.png")
    assert client.get(f"/api/records/{record.id}/image").status_code == 404


def test_image_path_cannot_escape_upload_folder(app, client, alice, tmp_path):
    (tmp_path / "secret.txt").write_text("secret")
    record = add_record(alice, image_path="../secret.txt")
    assert client.get(f"/api/records/{record.id}/image").status_code == 404


# --- seed command ----------------------------------------------------------


def test_seed_command_creates_records_and_images(app):
    runner = app.test_cli_runner()
    result = runner.invoke(args=["seed-records", "--user", "mock!demo", "--count", "12"])
    assert result.exit_code == 0, result.output
    user = db.session.query(User).filter_by(aaf_identifier="mock!demo").one()
    records = db.session.query(Record).filter_by(user_id=user.id).all()
    assert len(records) == 12
    for r in records:
        assert -90 <= r.latitude <= 90 and -180 <= r.longitude <= 180
        assert os.path.isfile(os.path.join(app.config["UPLOAD_FOLDER"], r.image_path))


def test_seed_command_reuses_existing_user(app):
    make_user("mock!demo")
    app.test_cli_runner().invoke(args=["seed-records", "--user", "mock!demo", "--count", "3"])
    assert db.session.query(User).count() == 1


def test_seed_command_refused_in_production(app):
    app.config["APP_ENV"] = "production"
    result = app.test_cli_runner().invoke(args=["seed-records", "--count", "1"])
    assert result.exit_code != 0
    assert db.session.query(Record).count() == 0
