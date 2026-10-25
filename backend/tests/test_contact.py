from app.extensions import db
from app.models import ContactMessage

VALID = {"name": "Ada", "email": "ada@example.com", "message": "Hello there"}


def test_health(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.get_json() == {"status": "ok", "database": "ok"}


def test_contact_saves_message(client):
    res = client.post("/api/contact", json=VALID)
    assert res.status_code == 201
    saved = db.session.execute(db.select(ContactMessage)).scalar_one()
    assert (saved.name, saved.email, saved.message) == ("Ada", "ada@example.com", "Hello there")


def test_contact_trims_whitespace(client):
    res = client.post("/api/contact", json={**VALID, "name": "  Ada  "})
    assert res.status_code == 201
    assert db.session.execute(db.select(ContactMessage)).scalar_one().name == "Ada"


def test_contact_requires_all_fields(client):
    res = client.post("/api/contact", json={})
    assert res.status_code == 400
    assert set(res.get_json()["errors"]) == {"name", "email", "message"}


def test_contact_rejects_bad_email(client):
    res = client.post("/api/contact", json={**VALID, "email": "not-an-email"})
    assert res.status_code == 400
    assert "email" in res.get_json()["errors"]


def test_contact_rejects_too_long(client):
    res = client.post("/api/contact", json={**VALID, "message": "x" * 2001})
    assert res.status_code == 400
    assert "message" in res.get_json()["errors"]


def test_contact_rejects_non_json(client):
    res = client.post("/api/contact", data="name=Ada", content_type="text/plain")
    assert res.status_code == 400
    assert db.session.execute(db.select(ContactMessage)).first() is None


def test_contact_rejects_non_string_values(client):
    res = client.post("/api/contact", json={**VALID, "name": 123})
    assert res.status_code == 400
    assert "name" in res.get_json()["errors"]
