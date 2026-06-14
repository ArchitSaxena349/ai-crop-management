"""Inference helpers for the plant disease model."""

from __future__ import annotations

import io
import json
import logging
import os
from functools import lru_cache
from pathlib import Path
from typing import List, Tuple

import numpy as np
from PIL import Image

from .model_registry import load_model_metadata

logger = logging.getLogger(__name__)

_CURRENT_FILE = Path(__file__).resolve()
_BACKEND_DIR = _CURRENT_FILE.parents[2]
_REPO_DIR = _CURRENT_FILE.parents[3]

_PREFERRED_MODEL_PATH = _BACKEND_DIR / "models" / "plant_disease_prediction_model.h5"
_PREFERRED_LABELS_PATH = _BACKEND_DIR / "models" / "class_labels.json"
_PREFERRED_METADATA_PATH = _BACKEND_DIR / "models" / "disease_model_metadata.json"

_LEGACY_MODEL_PATH = _REPO_DIR / "plant_disease_prediction_model" / "plant_disease_prediction_model.h5"
_LEGACY_LABELS_PATH = _REPO_DIR / "plant_disease_prediction_model" / "class_labels.json"


def _resolve_model_path() -> Path:
    override = os.getenv("MODEL_PATH")
    if override:
        return Path(override)
    return _PREFERRED_MODEL_PATH if _PREFERRED_MODEL_PATH.exists() else _LEGACY_MODEL_PATH


def _resolve_labels_path() -> Path:
    override = os.getenv("CLASS_LABELS_PATH")
    if override:
        return Path(override)
    return _PREFERRED_LABELS_PATH if _PREFERRED_LABELS_PATH.exists() else _LEGACY_LABELS_PATH


def _resolve_metadata_path() -> Path:
    override = os.getenv("DISEASE_MODEL_METADATA_PATH")
    if override:
        return Path(override)
    return _PREFERRED_METADATA_PATH


@lru_cache(maxsize=1)
def load_model() -> tf.keras.Model:
    import tensorflow as tf
    model_path = _resolve_model_path()
    if not model_path.exists():
        raise FileNotFoundError(f"Model file not found at {model_path}")
    return tf.keras.models.load_model(model_path)


@lru_cache(maxsize=1)
def load_class_labels() -> List[str]:
    labels_path = _resolve_labels_path()
    if not labels_path.exists():
        return []
    try:
        with labels_path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, list):
            return [str(item) for item in data]
    except Exception:
        logger.warning("Failed to parse class labels from %s; falling back to index labels", labels_path)
        return []
    return []


def _infer_target_size(model: tf.keras.Model) -> Tuple[int, int]:
    shape = model.input_shape
    if isinstance(shape, list):
        shape = shape[0]
    height = int(shape[1]) if len(shape) > 1 and shape[1] else 224
    width = int(shape[2]) if len(shape) > 2 and shape[2] else 224
    return height, width


def _preprocess_image(file_bytes: bytes, target_size: Tuple[int, int]) -> np.ndarray:
    image = Image.open(io.BytesIO(file_bytes)).convert("RGB")
    image = image.resize(target_size, Image.Resampling.LANCZOS)
    array = np.asarray(image, dtype="float32") / 255.0
    array = np.expand_dims(array, axis=0)
    return array


def predict_image(file_bytes: bytes, top_k: int = 3, include_raw: bool = False):
    model = load_model()
    target_size = _infer_target_size(model)
    batch = _preprocess_image(file_bytes, (target_size[1], target_size[0]))

    raw_preds = model.predict(batch, verbose=0)

    def _as_probabilities(preds: np.ndarray) -> np.ndarray:
        import tensorflow as tf
        flat = preds.squeeze()
        if flat.ndim == 1 and flat.size > 0:
            within_bounds = np.all((flat >= 0.0) & (flat <= 1.0))
            close_to_one = abs(float(np.sum(flat)) - 1.0) < 1e-3
            if within_bounds and close_to_one:
                return flat
        return tf.nn.softmax(flat).numpy()

    probabilities = _as_probabilities(raw_preds)

    labels = load_class_labels()
    num_classes = probabilities.shape[0]
    top_k = max(1, min(top_k, num_classes))
    if labels and len(labels) == num_classes:
        class_names = labels
    else:
        class_names = [f"class_{idx}" for idx in range(num_classes)]

    top_indices = np.argsort(probabilities)[::-1][:top_k]
    results = [
        {
            "label": class_names[idx],
            "index": int(idx),
            "confidence": float(probabilities[idx]),
        }
        for idx in top_indices
    ]

    response = {
        "results": results,
        "input_size": {
            "height": target_size[0],
            "width": target_size[1],
            "channels": 3,
        },
        "model_path": str(_resolve_model_path()),
    }
    metadata = load_model_metadata(_resolve_metadata_path())
    if metadata is not None:
        response["model_metadata"] = metadata
    if include_raw:
        response["raw_probabilities"] = [float(p) for p in probabilities.tolist()]
    return response
