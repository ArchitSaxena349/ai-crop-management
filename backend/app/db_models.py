from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from .core.db import Base


class SensorReadingRecord(Base):
    __tablename__ = "sensor_readings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    device_id: Mapped[str] = mapped_column(String(120), index=True)
    ingested_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        index=True,
        default=lambda: datetime.now(timezone.utc),
    )

    temperature_c: Mapped[float] = mapped_column(Float)
    humidity_pct: Mapped[float] = mapped_column(Float)
    soil_moisture_raw: Mapped[int] = mapped_column(Integer)
    soil_moisture_pct: Mapped[float] = mapped_column(Float)

    soil_temperature_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    light_lux: Mapped[float | None] = mapped_column(Float, nullable=True)
    pressure_hpa: Mapped[float | None] = mapped_column(Float, nullable=True)
    rainfall_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    rain_detected: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    gas_ppm: Mapped[float | None] = mapped_column(Float, nullable=True)
    ec_us_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    ph_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    nitrogen_ppm: Mapped[float | None] = mapped_column(Float, nullable=True)
    phosphorus_ppm: Mapped[float | None] = mapped_column(Float, nullable=True)
    potassium_ppm: Mapped[float | None] = mapped_column(Float, nullable=True)
    battery_v: Mapped[float | None] = mapped_column(Float, nullable=True)