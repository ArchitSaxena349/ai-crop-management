from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def load_model_metadata(metadata_path: Path) -> dict[str, Any] | None:
    if not metadata_path.exists():
        return None
    try:
        with metadata_path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, dict):
            return data
    except Exception:
        return None
    return None
