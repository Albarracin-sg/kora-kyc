"""Runtime configuration for the Koa face service.

Values are read from environment variables once (lazily) and every
variable has a documented default, so the service runs out of the box.
"""
from __future__ import annotations

import os
import math
from dataclasses import dataclass
from functools import lru_cache

DEFAULT_MATCH_THRESHOLD = 0.72
DEFAULT_HIGH_CONFIDENCE_THRESHOLD = 0.60
# Calibrated from a real phone selfie: its raw Laplacian variance was
# 38.2, and the previous 50.0 floor wrongly flagged it `blurry`.  The
# 25.0 floor keeps genuinely out-of-focus images (variance well below
# 15-20) failing closed, while passing a normal phone selfie.
DEFAULT_BLUR_THRESHOLD = 25.0
# The shared historical floor remains the selfie floor.  The observed
# ~95px card-portrait regression gets a narrowly scoped document floor of
# 90px; it is still conservative and does not relax the selfie gate.
DEFAULT_MIN_FACE_WIDTH_PX = 100
DEFAULT_SELFIE_MIN_FACE_WIDTH_PX = DEFAULT_MIN_FACE_WIDTH_PX
DEFAULT_DOCUMENT_MIN_FACE_WIDTH_PX = 90
DEFAULT_MODEL_NAME = "buffalo_l"
DEFAULT_DET_SIZE = (640, 640)
MAX_DECODED_IMAGE_BYTES = 15 * 1024 * 1024  # 15 MiB decoded payload cap


def _env_float(
    name: str,
    default: float,
    *,
    minimum_exclusive: float | None = None,
    maximum_inclusive: float | None = None,
) -> float:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = float(raw)
    except ValueError as exc:
        raise ValueError(f"Environment variable {name} must be a finite number") from exc
    if (
        not math.isfinite(value)
        or (minimum_exclusive is not None and value <= minimum_exclusive)
        or (maximum_inclusive is not None and value > maximum_inclusive)
    ):
        raise ValueError(f"Environment variable {name} is outside the allowed range")
    return value


def _env_int(name: str, default: int, *, minimum: int | None = None) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"Environment variable {name} must be an integer") from exc
    if minimum is not None and value < minimum:
        raise ValueError(f"Environment variable {name} must be at least {minimum}")
    return value


def _env_det_size(raw: str, default=DEFAULT_DET_SIZE):
    parts = [part.strip() for part in raw.split(",")]
    if len(parts) != 2:
        raise ValueError("FACE_DET_SIZE must contain width,height")
    try:
        value = (int(parts[0]), int(parts[1]))
    except ValueError as exc:
        raise ValueError("FACE_DET_SIZE must contain positive integers") from exc
    if value[0] <= 0 or value[1] <= 0:
        raise ValueError("FACE_DET_SIZE must contain positive integers")
    return value


@dataclass(frozen=True)
class Settings:
    match_threshold: float
    high_confidence_threshold: float
    blur_threshold: float
    document_min_face_width_px: int
    selfie_min_face_width_px: int
    model_name: str
    model_root: str
    det_size: tuple
    max_image_bytes: int
    face_api_key: str

    @property
    def min_face_width_px(self) -> int:
        """Backward-compatible alias for the unchanged selfie floor."""
        return self.selfie_min_face_width_px


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    legacy_min_face_width_px = _env_int(
        "FACE_MIN_WIDTH_PX", DEFAULT_SELFIE_MIN_FACE_WIDTH_PX, minimum=1
    )
    return Settings(
        match_threshold=_env_float(
            "FACE_MATCH_THRESHOLD",
            DEFAULT_MATCH_THRESHOLD,
            minimum_exclusive=0.0,
            maximum_inclusive=1.0,
        ),
        high_confidence_threshold=_env_float(
            "FACE_HIGH_CONFIDENCE_THRESHOLD",
            DEFAULT_HIGH_CONFIDENCE_THRESHOLD,
            minimum_exclusive=0.0,
            maximum_inclusive=1.0,
        ),
        blur_threshold=_env_float(
            "FACE_BLUR_THRESHOLD", DEFAULT_BLUR_THRESHOLD, minimum_exclusive=0.0
        ),
        document_min_face_width_px=_env_int(
            "FACE_DOCUMENT_MIN_WIDTH_PX", DEFAULT_DOCUMENT_MIN_FACE_WIDTH_PX, minimum=1
        ),
        selfie_min_face_width_px=_env_int(
            "FACE_SELFIE_MIN_WIDTH_PX", legacy_min_face_width_px, minimum=1
        ),
        model_name=os.getenv("INSIGHTFACE_MODEL", DEFAULT_MODEL_NAME),
        model_root=os.path.expanduser(os.getenv("INSIGHTFACE_ROOT", "~/.insightface")),
        det_size=_env_det_size(os.getenv("FACE_DET_SIZE", "640,640")),
        max_image_bytes=MAX_DECODED_IMAGE_BYTES,
        face_api_key=os.getenv("FACE_API_KEY", "").strip(),
    )
