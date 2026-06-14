"""create sensor readings table

Revision ID: 20260315_0001
Revises:
Create Date: 2026-03-15
"""

from alembic import op
import sqlalchemy as sa


revision = "20260315_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sensor_readings",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("device_id", sa.String(length=120), nullable=False),
        sa.Column("ingested_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("temperature_c", sa.Float(), nullable=False),
        sa.Column("humidity_pct", sa.Float(), nullable=False),
        sa.Column("soil_moisture_raw", sa.Integer(), nullable=False),
        sa.Column("soil_moisture_pct", sa.Float(), nullable=False),
        sa.Column("soil_temperature_c", sa.Float(), nullable=True),
        sa.Column("light_lux", sa.Float(), nullable=True),
        sa.Column("pressure_hpa", sa.Float(), nullable=True),
        sa.Column("rainfall_mm", sa.Float(), nullable=True),
        sa.Column("rain_detected", sa.Boolean(), nullable=True),
        sa.Column("gas_ppm", sa.Float(), nullable=True),
        sa.Column("ec_us_cm", sa.Float(), nullable=True),
        sa.Column("ph_value", sa.Float(), nullable=True),
        sa.Column("nitrogen_ppm", sa.Float(), nullable=True),
        sa.Column("phosphorus_ppm", sa.Float(), nullable=True),
        sa.Column("potassium_ppm", sa.Float(), nullable=True),
        sa.Column("battery_v", sa.Float(), nullable=True),
    )
    op.create_index("ix_sensor_readings_device_id", "sensor_readings", ["device_id"])
    op.create_index("ix_sensor_readings_ingested_at_utc", "sensor_readings", ["ingested_at_utc"])


def downgrade() -> None:
    op.drop_index("ix_sensor_readings_ingested_at_utc", table_name="sensor_readings")
    op.drop_index("ix_sensor_readings_device_id", table_name="sensor_readings")
    op.drop_table("sensor_readings")
