from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..core.security import require_prediction_api_key
from ..services.irrigation_inference import predict_irrigation
from .iot import get_latest_sensor_payload_snapshot

router = APIRouter(prefix="", tags=["smart-irrigation"], dependencies=[Depends(require_prediction_api_key)])


class IrrigationInput(BaseModel):
    soil_moisture: float = Field(..., ge=0, le=100)
    temperature: float = Field(..., ge=-40, le=80)
    humidity: float = Field(..., ge=0, le=100)
    sunlight: float = Field(..., ge=0)
    rainfall: float = Field(..., ge=0)
    soil_type: str = Field(..., min_length=1)
    crop_stage: str = Field(..., min_length=1)
    crop: Optional[str] = None


class IrrigationFromIotInput(BaseModel):
    soil_moisture: Optional[float] = Field(None, ge=0, le=100)
    temperature: Optional[float] = Field(None, ge=-40, le=80)
    humidity: Optional[float] = Field(None, ge=0, le=100)
    sunlight: Optional[float] = Field(None, ge=0)
    rainfall: Optional[float] = Field(None, ge=0)
    soil_type: str = Field(..., min_length=1)
    crop_stage: str = Field(..., min_length=1)
    crop: Optional[str] = None


@router.post("/recommend", summary="Recommend whether irrigation should start")
def recommend_irrigation(payload: IrrigationInput):
    result = predict_irrigation(payload.model_dump(exclude_none=True))
    if payload.crop:
        result["crop"] = payload.crop
    return {"status": "success", **result}


@router.post("/recommend-from-iot", summary="Recommend irrigation using latest IoT reading and manual overrides")
def recommend_irrigation_from_iot(payload: IrrigationFromIotInput):
    latest = get_latest_sensor_payload_snapshot()
    if latest is None:
        raise HTTPException(status_code=404, detail="No sensor reading available yet")

    features = {
        "soil_moisture": payload.soil_moisture if payload.soil_moisture is not None else latest.get("soil_moisture_pct"),
        "temperature": payload.temperature if payload.temperature is not None else latest.get("temperature_c"),
        "humidity": payload.humidity if payload.humidity is not None else latest.get("humidity_pct"),
        "sunlight": payload.sunlight if payload.sunlight is not None else latest.get("light_lux") or 0,
        "rainfall": payload.rainfall if payload.rainfall is not None else latest.get("rainfall_mm") or 0,
        "soil_type": payload.soil_type,
        "crop_stage": payload.crop_stage,
    }

    missing = [key for key, value in features.items() if value is None]
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Missing required values for irrigation recommendation: {', '.join(missing)}",
        )

    result = predict_irrigation(features)
    if payload.crop:
        result["crop"] = payload.crop
    result["sensor_context"] = latest
    return {"status": "success", **result}