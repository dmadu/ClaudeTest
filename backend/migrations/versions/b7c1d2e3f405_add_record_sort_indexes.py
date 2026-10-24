"""add sort indexes on records

Revision ID: b7c1d2e3f405
Revises: aecadb42ded1
"""
import sqlalchemy as sa
from alembic import op

revision = "b7c1d2e3f405"
down_revision = "aecadb42ded1"
branch_labels = None
depends_on = None


def upgrade():
    op.create_index("ix_records_user_created", "records", ["user_id", "created_at"])
    op.create_index("ix_records_user_latitude", "records", ["user_id", "latitude"])
    op.create_index("ix_records_user_longitude", "records", ["user_id", "longitude"])
    op.create_index("ix_records_user_title_lower", "records", ["user_id", sa.text("lower(title)")])
    op.create_index("ix_records_user_site_lower", "records", ["user_id", sa.text("lower(site)")])
    # Every new index starts with user_id, so the single-column one is no longer needed.
    op.drop_index("ix_records_user_id", table_name="records")


def downgrade():
    op.create_index("ix_records_user_id", "records", ["user_id"])
    op.drop_index("ix_records_user_site_lower", table_name="records")
    op.drop_index("ix_records_user_title_lower", table_name="records")
    op.drop_index("ix_records_user_longitude", table_name="records")
    op.drop_index("ix_records_user_latitude", table_name="records")
    op.drop_index("ix_records_user_created", table_name="records")
