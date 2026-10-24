import os
import random
import struct
import uuid
import zlib

import click
from flask import current_app
from flask.cli import with_appcontext
from sqlalchemy import select

from .extensions import db
from .models import Record, User

SITE_NAMES = [
    "Mount Stromlo",
    "Lake Burley Griffin",
    "Kakadu",
    "Uluru",
    "Fraser Island",
    "Daintree",
    "Blue Mountains",
    "Great Barrier Reef",
    "Port Arthur",
    "Wilsons Promontory",
    "Kangaroo Island",
    "Rottnest Island",
    "Cradle Mountain",
    "Flinders Ranges",
    "Ningaloo",
    "Bungle Bungles",
]


def _png(rgb, size=48):
    """A small solid-colour PNG, so the seed needs no imaging library."""

    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    row = b"\x00" + bytes(rgb) * size
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(row * size))
        + chunk(b"IEND", b"")
    )


@click.command("seed-records")
@click.option(
    "--user",
    "aaf_identifier",
    default="mock!dev",
    show_default=True,
    help="AAF identifier of the user who will own the records.",
)
@click.option("--count", default=25, show_default=True, type=click.IntRange(1, 5000))
@with_appcontext
def seed_records(aaf_identifier, count):
    """Create sample records (development only)."""
    if current_app.config["APP_ENV"] == "production":
        raise click.ClickException("Refusing to seed data when APP_ENV=production.")

    user = db.session.scalar(select(User).where(User.aaf_identifier == aaf_identifier))
    if user is None:
        who = aaf_identifier.split("!")[-1]
        user = User(aaf_identifier=aaf_identifier, name=who.title(), email=f"{who}@example.test")
        db.session.add(user)
        db.session.flush()

    folder = os.path.abspath(current_app.config["UPLOAD_FOLDER"])
    os.makedirs(folder, exist_ok=True)
    rng = random.Random(aaf_identifier)  # noqa: S311 (sample data, not security)

    for i in range(1, count + 1):
        filename = f"seed-{uuid.uuid4().hex}.png"
        with open(os.path.join(folder, filename), "wb") as fh:
            fh.write(_png((rng.randrange(40, 230), rng.randrange(40, 230), rng.randrange(40, 230))))
        db.session.add(
            Record(
                user_id=user.id,
                title=f"Survey {i:04d}",
                site=rng.choice(SITE_NAMES),
                latitude=round(rng.uniform(-43.5, -10.5), 6),
                longitude=round(rng.uniform(113.0, 153.5), 6),
                image_path=filename,
            )
        )
    db.session.commit()
    click.echo(f"Created {count} records for {aaf_identifier}.")
