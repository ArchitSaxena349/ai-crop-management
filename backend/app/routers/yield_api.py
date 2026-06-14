from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..core.security import require_prediction_api_key
from ..services.yield_inference import predict_yield

router = APIRouter(prefix="", tags=["yield-prediction"], dependencies=[Depends(require_prediction_api_key)])


class YieldInput(BaseModel):
    Nitrogen: float = Field(..., ge=0)
    Phosphorus: float = Field(..., ge=0)
    Potassium: float = Field(..., ge=0)
    Temperature: float
    Humidity: float = Field(..., ge=0, le=100)
    pH: float = Field(..., ge=0, le=14)
    Rainfall: float = Field(..., ge=0)


@router.post("", summary="Predict crop yield")
def predict_yield_endpoint(data: YieldInput):
    try:
        result = predict_yield(data.model_dump())
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive runtime guard
        raise HTTPException(status_code=500, detail="Yield prediction failed") from exc

    return {
        "status": "success",
        **result,
    }
