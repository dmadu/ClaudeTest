from datetime import UTC, datetime

from .extensions import db


def _now():
    return datetime.now(UTC)


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    aaf_identifier = db.Column(db.String(255), unique=True, nullable=False)
    name = db.Column(db.String(255))
    email = db.Column(db.String(255))
    created_at = db.Column(db.DateTime(timezone=True), default=_now, nullable=False)

    records = db.relationship("Record", back_populates="user", cascade="all, delete-orphan")


class Record(db.Model):
    __tablename__ = "records"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    site = db.Column(db.String(200), nullable=False)
    latitude = db.Column(db.Numeric(9, 6), nullable=False)
    longitude = db.Column(db.Numeric(9, 6), nullable=False)
    image_path = db.Column(db.String(500), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=_now, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=_now, onupdate=_now, nullable=False)

    user = db.relationship("User", back_populates="records")

    # One per sortable column, led by user_id because every query is for a single user's records.
    __table_args__ = (
        db.Index("ix_records_user_created", "user_id", "created_at"),
        db.Index("ix_records_user_latitude", "user_id", "latitude"),
        db.Index("ix_records_user_longitude", "user_id", "longitude"),
        db.Index("ix_records_user_title_lower", "user_id", db.text("lower(title)")),
        db.Index("ix_records_user_site_lower", "user_id", db.text("lower(site)")),
    )


class ContactMessage(db.Model):
    __tablename__ = "contact_messages"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(255), nullable=False)
    message = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=_now, nullable=False)


class UsedToken(db.Model):
    """AAF assertion ids (jti) already accepted, so an assertion cannot be replayed."""

    __tablename__ = "used_tokens"

    jti = db.Column(db.String(255), primary_key=True)
    expires_at = db.Column(db.DateTime(timezone=True), nullable=False, index=True)
