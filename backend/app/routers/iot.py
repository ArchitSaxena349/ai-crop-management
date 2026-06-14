from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, desc

from ..core.db import SessionLocal
from ..db_models import SensorReadingRecord
from ..core.security import require_iot_api_key
from ..services.yield_inference import predict_yield

router = APIRouter(prefix="", tags=["iot"], dependencies=[Depends(require_iot_api_key)])
logger = logging.getLogger(__name__)


class SensorReading(BaseModel):
    device_id: str = Field(..., min_length=1)
    temperature_c: float = Field(..., ge=-40, le=80)
    humidity_pct: float = Field(..., ge=0, le=100)
    soil_moisture_raw: int = Field(..., ge=0, le=1023)
    soil_temperature_c: Optional[float] = Field(None, ge=-40, le=100)
    light_lux: Optional[float] = Field(None, ge=0)
    pressure_hpa: Optional[float] = Field(None, ge=300, le=1200)
    rainfall_mm: Optional[float] = Field(None, ge=0)
    rain_detected: Optional[bool] = None
    gas_ppm: Optional[float] = Field(None, ge=0)
    ec_us_cm: Optional[float] = Field(None, ge=0)
    ph_value: Optional[float] = Field(None, ge=0, le=14)
    nitrogen_ppm: Optional[float] = Field(None, ge=0)
    phosphorus_ppm: Optional[float] = Field(None, ge=0)
    potassium_ppm: Optional[float] = Field(None, ge=0)
    battery_v: Optional[float] = Field(None, ge=0)


class YieldFromSensorInput(BaseModel):
    Nitrogen: Optional[float] = Field(None, ge=0)
    Phosphorus: Optional[float] = Field(None, ge=0)
    Potassium: Optional[float] = Field(None, ge=0)
    pH: Optional[float] = Field(None, ge=0, le=14)
    Rainfall: Optional[float] = Field(None, ge=0)
    Temperature: Optional[float] = None
    Humidity: Optional[float] = None


_latest_sensor_payload: dict | None = None


def _raw_to_percent(raw_value: int) -> float:
    # Typical FC-28 style sensors output lower values for wetter soil.
    # This linear mapping is a practical default and can be calibrated later.
    wet_raw = 300
    dry_raw = 900
    clamped = max(wet_raw, min(dry_raw, raw_value))
    moisture = (dry_raw - clamped) / (dry_raw - wet_raw) * 100.0
    return round(moisture, 2)


def _pick_value(primary, sensor_payload: dict | None, key: str):
    if primary is not None:
        return primary
    if sensor_payload is not None:
        return sensor_payload.get(key)
    return None


_PERSISTED_FIELDS = (
    "device_id",
    "temperature_c",
    "humidity_pct",
    "soil_moisture_raw",
    "soil_moisture_pct",
    "soil_temperature_c",
    "light_lux",
    "pressure_hpa",
    "rainfall_mm",
    "rain_detected",
    "gas_ppm",
    "ec_us_cm",
    "ph_value",
    "nitrogen_ppm",
    "phosphorus_ppm",
    "potassium_ppm",
    "battery_v",
)


def _to_record_payload(payload: dict, ingested_at: datetime) -> SensorReadingRecord:
    data = {field: payload.get(field) for field in _PERSISTED_FIELDS}
    return SensorReadingRecord(ingested_at_utc=ingested_at, **data)


def _to_api_payload(record: SensorReadingRecord) -> dict:
    return {
        "device_id": record.device_id,
        "temperature_c": record.temperature_c,
        "humidity_pct": record.humidity_pct,
        "soil_moisture_raw": record.soil_moisture_raw,
        "soil_moisture_pct": record.soil_moisture_pct,
        "soil_temperature_c": record.soil_temperature_c,
        "light_lux": record.light_lux,
        "pressure_hpa": record.pressure_hpa,
        "rainfall_mm": record.rainfall_mm,
        "rain_detected": record.rain_detected,
        "gas_ppm": record.gas_ppm,
        "ec_us_cm": record.ec_us_cm,
        "ph_value": record.ph_value,
        "nitrogen_ppm": record.nitrogen_ppm,
        "phosphorus_ppm": record.phosphorus_ppm,
        "potassium_ppm": record.potassium_ppm,
        "battery_v": record.battery_v,
        "ingested_at_utc": record.ingested_at_utc.isoformat(),
    }


def _persist_sensor_reading(payload: dict, ingested_at: datetime) -> bool:
    try:
        with SessionLocal() as session:
            session.add(_to_record_payload(payload, ingested_at))
            retention_days = int(os.getenv("SENSOR_RETENTION_DAYS", "30"))
            if retention_days > 0:
                cutoff = datetime.now(timezone.utc).timestamp() - (retention_days * 24 * 60 * 60)
                cutoff_dt = datetime.fromtimestamp(cutoff, tz=timezone.utc)
                session.execute(delete(SensorReadingRecord).where(SensorReadingRecord.ingested_at_utc < cutoff_dt))
            session.commit()
        return True
    except Exception:
        logger.exception("Failed to persist sensor reading")
        return False


def _get_latest_sensor_payload() -> dict | None:
    try:
        with SessionLocal() as session:
            record = (
                session.query(SensorReadingRecord)
                .order_by(desc(SensorReadingRecord.ingested_at_utc), desc(SensorReadingRecord.id))
                .first()
            )
            if record is not None:
                return _to_api_payload(record)
    except Exception:
        logger.exception("Failed to fetch latest persisted sensor reading")

    return _latest_sensor_payload


def get_latest_sensor_payload_snapshot() -> dict | None:
    return _get_latest_sensor_payload()


@router.post("/sensors", summary="Ingest latest IoT sensor reading")
def ingest_sensor_data(payload: SensorReading):
    global _latest_sensor_payload

    reading = payload.model_dump()
    reading["soil_moisture_pct"] = _raw_to_percent(payload.soil_moisture_raw)
    ingested_at = datetime.now(timezone.utc)
    reading["ingested_at_utc"] = ingested_at.isoformat()

    _latest_sensor_payload = reading
    persisted = _persist_sensor_reading(reading, ingested_at)

    return {
        "status": "success",
        "message": "Sensor reading received",
        "reading": reading,
        "persisted": persisted,
    }


@router.get("/sensors/latest", summary="Get latest IoT sensor reading")
def get_latest_sensor_data():
    latest = _get_latest_sensor_payload()
    if latest is None:
        raise HTTPException(status_code=404, detail="No sensor reading available yet")

    return {
        "status": "success",
        "reading": latest,
    }


@router.get("/sensors/history", summary="Get persisted IoT sensor history")
def get_sensor_history(
    limit: int = Query(100, ge=1, le=500),
    device_id: str | None = Query(None),
):
    try:
        with SessionLocal() as session:
            query = session.query(SensorReadingRecord)
            if device_id:
                query = query.filter(SensorReadingRecord.device_id == device_id)

            records = (
                query.order_by(desc(SensorReadingRecord.ingested_at_utc), desc(SensorReadingRecord.id))
                .limit(limit)
                .all()
            )

        return {
            "status": "success",
            "count": len(records),
            "history": [_to_api_payload(record) for record in records],
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to fetch sensor history") from exc


@router.post("/yield-predict", summary="Predict yield using latest IoT readings")
def predict_yield_from_iot(payload: YieldFromSensorInput):
    latest_sensor_payload = _get_latest_sensor_payload()

    if latest_sensor_payload is None and (
        payload.Temperature is None
        or payload.Humidity is None
        or payload.Nitrogen is None
        or payload.Phosphorus is None
        or payload.Potassium is None
        or payload.pH is None
        or payload.Rainfall is None
    ):
        raise HTTPException(
            status_code=404,
            detail=(
                "No sensor reading available. Send /iot/sensors first or provide all yield fields "
                "(Nitrogen, Phosphorus, Potassium, Temperature, Humidity, pH, Rainfall)."
            ),
        )

    temperature = _pick_value(payload.Temperature, latest_sensor_payload, "temperature_c")
    humidity = _pick_value(payload.Humidity, latest_sensor_payload, "humidity_pct")
    nitrogen = _pick_value(payload.Nitrogen, latest_sensor_payload, "nitrogen_ppm")
    phosphorus = _pick_value(payload.Phosphorus, latest_sensor_payload, "phosphorus_ppm")
    potassium = _pick_value(payload.Potassium, latest_sensor_payload, "potassium_ppm")
    ph_value = _pick_value(payload.pH, latest_sensor_payload, "ph_value")
    rainfall = _pick_value(payload.Rainfall, latest_sensor_payload, "rainfall_mm")

    missing = []
    if temperature is None:
        missing.append("Temperature")
    if humidity is None:
        missing.append("Humidity")
    if nitrogen is None:
        missing.append("Nitrogen")
    if phosphorus is None:
        missing.append("Phosphorus")
    if potassium is None:
        missing.append("Potassium")
    if ph_value is None:
        missing.append("pH")
    if rainfall is None:
        missing.append("Rainfall")

    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Missing required values for yield prediction: {', '.join(missing)}",
        )

    features = {
        "Nitrogen": float(nitrogen),
        "Phosphorus": float(phosphorus),
        "Potassium": float(potassium),
        "Temperature": float(temperature),
        "Humidity": float(humidity),
        "pH": float(ph_value),
        "Rainfall": float(rainfall),
    }

    try:
        prediction = predict_yield(features)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive runtime guard
        raise HTTPException(status_code=500, detail="Yield prediction failed") from exc

    return {
        "status": "success",
        "source": "mixed",
        "yield_prediction": prediction,
        "sensor_context": latest_sensor_payload,
        "resolved_features": features,
    }
