"""Inference helpers for smart irrigation recommendations."""

from __future__ import annotations

import os
import pickle
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict

import pandas as pd

from .model_registry import load_model_metadata

_CURRENT_FILE = Path(__file__).resolve()
_BACKEND_DIR = _CURRENT_FILE.parents[2]

_PREFERRED_MODEL_PATH = _BACKEND_DIR / "models" / "irrigation_model.pkl"
_PREFERRED_METADATA_PATH = _BACKEND_DIR / "models" / "irrigation_model_metadata.json"


@lru_cache(maxsize=1)
def _load_model():
    override = os.getenv("IRRIGATION_MODEL_PATH")
    model_path = Path(override) if override else _PREFERRED_MODEL_PATH

    if not model_path.exists():
        raise FileNotFoundError(f"Irrigation model file not found at {model_path}")

    with model_path.open("rb") as handle:
        model = pickle.load(handle)

    return model, model_path


def _resolve_metadata_path() -> Path:
    override = os.getenv("IRRIGATION_MODEL_METADATA_PATH")
    if override:
        return Path(override)
    return _PREFERRED_METADATA_PATH


def _normalize_input(features: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "soil_moisture": float(features["soil_moisture"]),
        "temperature": float(features["temperature"]),
        "humidity": float(features["humidity"]),
        "sunlight": float(features["sunlight"]),
        "soil_type": str(features["soil_type"]).strip().lower(),
        "crop_stage": str(features["crop_stage"]).strip().lower(),
        "rainfall": float(features["rainfall"]),
    }


def predict_irrigation(features: Dict[str, Any]) -> Dict[str, Any]:
    normalized = _normalize_input(features)
    model, model_path = _load_model()

    frame = pd.DataFrame([normalized])
    frame = pd.get_dummies(frame)

    model_columns = getattr(model, "feature_names_in_", None)
    if model_columns is not None:
        frame = frame.reindex(columns=model_columns, fill_value=0)

    prediction = model.predict(frame)
    recommended = bool(int(prediction[0]) == 1)
    action = "START" if recommended else "NO NEED"

    rainfall = normalized["rainfall"]
    soil_moisture = normalized["soil_moisture"]
    if rainfall > 20:
        explanation = "Rainfall is already high, so irrigation should be delayed."
    elif soil_moisture < 15:
        explanation = "Soil moisture is critically low, so irrigation should start immediately."
    elif recommended:
        explanation = "Field conditions indicate irrigation is recommended now."
    else:
        explanation = "Current soil and weather conditions do not require irrigation yet."

    probabilities = None
    if hasattr(model, "predict_proba"):
        try:
            probabilities = model.predict_proba(frame)[0].tolist()
        except Exception:
            probabilities = None

    return {
        "irrigation_action": action,
        "recommended": recommended,
        "explanation": explanation,
        "input_summary": normalized,
        "model_path": str(model_path),
        "model_metadata": load_model_metadata(_resolve_metadata_path()),
        "raw_probabilities": probabilities,
    }
