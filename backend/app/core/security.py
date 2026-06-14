from __future__ import annotations

import os

from fastapi import Header, HTTPException


def _env_flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _extract_token(authorization: str | None, x_api_key: str | None) -> str | None:
    if x_api_key:
        return x_api_key.strip()
    if authorization:
        value = authorization.strip()
        if value.lower().startswith("bearer "):
            return value[7:].strip()
        return value
    return None


def _require_token(expected: str | None, provided: str | None, scope: str) -> None:
    if not _env_flag("API_AUTH_ENABLED", True):
        return
    if not expected:
        raise HTTPException(status_code=503, detail=f"{scope} API key is not configured")
    if not provided or provided != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")


def require_prediction_api_key(
    authorization: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None),
) -> None:
    token = _extract_token(authorization, x_api_key)
    expected = os.getenv("PREDICTION_API_KEY") or os.getenv("API_KEY")
    _require_token(expected, token, scope="Prediction")


def require_iot_api_key(
    authorization: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None),
) -> None:
    token = _extract_token(authorization, x_api_key)
    expected = os.getenv("IOT_API_KEY") or os.getenv("API_KEY")
    _require_token(expected, token, scope="IoT")
