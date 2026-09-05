"""Runtime configuration for the Koa face service.

Values are read from environment variables once (lazily) and every
variable has a documented default, so the service runs out of the box.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache

DEFAULT_MATCH_THRESHOLD = 0.40
DEFAULT_HIGH_CONFIDENCE_THRESHOLD = 0.60
# Calibrated from a real phone selfie: its raw Laplacian variance was
# 38.2, and the previous 50.0 floor wrongly flagged it `blurry`.  The
# 25.0 floor keeps genuinely out-of-focus images (variance well below
# 15-20) failing closed, while passing a normal phone selfie.
DEFAULT_BLUR_THRESHOLD = 25.0
DEFAULT_MIN_FACE_WIDTH_PX = 100
DEFAULT_MODEL_NAME = "buffalo_l"
DEFAULT_DET_SIZE = (640, 640)
MAX_DECODED_IMAGE_BYTES = 15 * 1024 * 1024  # 15 MiB decoded payload cap


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_det_size(raw: str, default=DEFAULT_DET_SIZE):
    parts = [part.strip() for part in raw.split(",")]
    if len(parts) != 2:
        return default
    try:
        return (int(parts[0]), int(parts[1]))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    match_threshold: float
    high_confidence_threshold: float
    blur_threshold: float
    min_face_width_px: int
    model_name: str
    model_root: str
    det_size: tuple
    max_image_bytes: int
    face_api_key: str


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings(
        match_threshold=_env_float("FACE_MATCH_THRESHOLD", DEFAULT_MATCH_THRESHOLD),
        high_confidence_threshold=_env_float(
            "FACE_HIGH_CONFIDENCE_THRESHOLD", DEFAULT_HIGH_CONFIDENCE_THRESHOLD
        ),
        blur_threshold=_env_float("FACE_BLUR_THRESHOLD", DEFAULT_BLUR_THRESHOLD),
        min_face_width_px=_env_int("FACE_MIN_WIDTH_PX", DEFAULT_MIN_FACE_WIDTH_PX),
        model_name=os.getenv("INSIGHTFACE_MODEL", DEFAULT_MODEL_NAME),
        model_root=os.path.expanduser(os.getenv("INSIGHTFACE_ROOT", "~/.insightface")),
        det_size=_env_det_size(os.getenv("FACE_DET_SIZE", "640,640")),
        max_image_bytes=MAX_DECODED_IMAGE_BYTES,
        face_api_key=os.getenv("FACE_API_KEY", "").strip(),
    )
