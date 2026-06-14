"""Inference helpers for crop yield prediction."""

from __future__ import annotations

import os
import pickle
from functools import lru_cache
from pathlib import Path
from typing import Dict

import pandas as pd

from .model_registry import load_model_metadata

_CURRENT_FILE = Path(__file__).resolve()
_BACKEND_DIR = _CURRENT_FILE.parents[2]
_REPO_DIR = _CURRENT_FILE.parents[3]

_PREFERRED_MODEL_PATH = _BACKEND_DIR / "models" / "yield_model.pkl"
_PREFERRED_METADATA_PATH = _BACKEND_DIR / "models" / "yield_model_metadata.json"
_LEGACY_MODEL_PATH = _REPO_DIR / "yieldPrediction" / "yieldPrediction" / "yield_model.pkl"


@lru_cache(maxsize=1)
def _load_model():
    override = os.getenv("YIELD_MODEL_PATH")
    model_path = Path(override) if override else (_PREFERRED_MODEL_PATH if _PREFERRED_MODEL_PATH.exists() else _LEGACY_MODEL_PATH)

    if not model_path.exists():
        raise FileNotFoundError(f"Yield model file not found at {model_path}")

    with model_path.open("rb") as handle:
        model = pickle.load(handle)

    return model, model_path


def _resolve_metadata_path() -> Path:
    override = os.getenv("YIELD_MODEL_METADATA_PATH")
    if override:
        return Path(override)
    return _PREFERRED_METADATA_PATH


def predict_yield(features: Dict[str, float]) -> Dict[str, object]:
    model, model_path = _load_model()
    frame = pd.DataFrame([features])
    prediction = model.predict(frame)

    predicted_value = float(prediction[0])
    return {
        "predicted_yield": predicted_value,
        "predicted_yield_label": f"{round(predicted_value, 2)} Tons per Hectare",
        "input_summary": features,
        "model_path": str(model_path),
        "model_metadata": load_model_metadata(_resolve_metadata_path()),
    }
