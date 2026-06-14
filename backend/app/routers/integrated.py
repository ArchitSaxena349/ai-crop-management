from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile

from ..core.security import require_prediction_api_key
from ..services import img_inference
from ..services.yield_inference import predict_yield

router = APIRouter(prefix="", tags=["integrated-prediction"], dependencies=[Depends(require_prediction_api_key)])

_ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/jpg", "image/webp"}
_MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # 5 MB cap to avoid huge payloads


@router.post("", summary="Run disease and yield predictions together")
async def predict_integrated(
    file: UploadFile = File(...),
    Nitrogen: float = Form(...),
    Phosphorus: float = Form(...),
    Potassium: float = Form(...),
    Temperature: float = Form(...),
    Humidity: float = Form(...),
    pH: float = Form(...),
    Rainfall: float = Form(...),
    top_k: int = Query(3, ge=1, description="Number of top disease classes to return"),
    include_raw: bool = Query(False, description="Include full disease probability vector"),
):
    if file.content_type not in _ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Upload a JPEG, PNG, or WebP image")

    payload = await file.read()
    if len(payload) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image too large (max 5 MB)")

    if Humidity < 0 or Humidity > 100:
        raise HTTPException(status_code=422, detail="Humidity must be between 0 and 100")
    if pH < 0 or pH > 14:
        raise HTTPException(status_code=422, detail="pH must be between 0 and 14")

    yield_features = {
        "Nitrogen": Nitrogen,
        "Phosphorus": Phosphorus,
        "Potassium": Potassium,
        "Temperature": Temperature,
        "Humidity": Humidity,
        "pH": pH,
        "Rainfall": Rainfall,
    }

    try:
        disease_prediction = img_inference.predict_image(payload, top_k=top_k, include_raw=include_raw)
        yield_prediction = predict_yield(yield_features)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive runtime guard
        raise HTTPException(status_code=500, detail="Integrated prediction failed") from exc

    return {
        "status": "success",
        "filename": file.filename,
        "disease_prediction": disease_prediction,
        "yield_prediction": yield_prediction,
    }
