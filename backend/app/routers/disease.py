from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

from ..core.security import require_prediction_api_key
from ..services import img_inference

router = APIRouter(prefix="", tags=["disease-prediction"], dependencies=[Depends(require_prediction_api_key)])

_ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/jpg", "image/webp"}
_MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # 5 MB cap to avoid huge payloads


@router.post("", summary="Predict plant disease from an image")
async def predict_disease(
    file: UploadFile = File(...),
    top_k: int = Query(3, ge=1, description="Number of top classes to return"),
    include_raw: bool = Query(False, description="Include full probability vector"),
):
    if file.content_type not in _ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Upload a JPEG, PNG, or WebP image")

    payload = await file.read()
    if len(payload) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image too large (max 5 MB)")

    try:
        prediction = img_inference.predict_image(payload, top_k=top_k, include_raw=include_raw)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive logging spot
        raise HTTPException(status_code=500, detail="Prediction failed") from exc

    return {
        "filename": file.filename,
        **prediction,
    }
