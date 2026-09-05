"""Face image quality assessment (the quality gate).

The rule engine (`evaluate_face_quality`) is pure logic: it takes the
detection geometry and the blur metric as inputs and never imports
opencv, numpy or insightface, so it can be unit-tested without any
model weights or heavy dependencies.  Image decoding and the
Laplacian-variance blur metric live behind lazy imports.

Fail-closed by design: when the sharpness of an image cannot be
verified, or geometry is missing, the verdict is LOW.
"""
from __future__ import annotations

import base64
import binascii
from typing import Any, Optional

from app.config import DEFAULT_BLUR_THRESHOLD, DEFAULT_MIN_FACE_WIDTH_PX, MAX_DECODED_IMAGE_BYTES

REASON_OK = "ok"
REASON_RESOLUTION = "face_resolution_too_small"
REASON_BLURRY = "blurry"
REASON_NO_FACE = "no_face"
REASON_ERROR = "error"


def _verdict(
    quality: str,
    reason: str,
    face_width_px: Optional[int],
    laplacian_variance: Optional[float],
) -> dict:
    return {
        "quality": quality,
        "reason": reason,
        "face_width_px": face_width_px,
        "laplacian_variance": laplacian_variance,
        "action": "OK" if quality == "HIGH" else "NEEDS_REVIEW",
    }


def evaluate_face_quality(
    *,
    face_detected: bool,
    face_width_px: Optional[float] = None,
    laplacian_variance: Optional[float] = None,
    blur_threshold: float = DEFAULT_BLUR_THRESHOLD,
    min_face_width_px: int = DEFAULT_MIN_FACE_WIDTH_PX,
) -> dict:
    """Evaluate the quality verdict for one face image.

    Rules, in order:
    1. No detectable face                    -> no_face / LOW
    2. Detected but missing geometry         -> error / LOW (cannot assess)
    3. Face width strictly < min_width_px    -> face_resolution_too_small / LOW
    4. Variance missing or below threshold   -> blurry / LOW (fail-closed)
    5. Otherwise                             -> ok / HIGH
    """
    if not face_detected:
        return _verdict("LOW", REASON_NO_FACE, None, _as_float(laplacian_variance))
    if face_width_px is None:
        return _verdict("LOW", REASON_ERROR, None, _as_float(laplacian_variance))
    width = int(round(face_width_px))
    if width < min_face_width_px:
        return _verdict("LOW", REASON_RESOLUTION, width, _as_float(laplacian_variance))
    if laplacian_variance is None:
        # Cannot prove the image is sharp enough -> fail closed.
        return _verdict("LOW", REASON_BLURRY, width, None)
    variance = float(laplacian_variance)
    if variance < blur_threshold:
        return _verdict("LOW", REASON_BLURRY, width, variance)
    return _verdict("HIGH", REASON_OK, width, variance)


def _as_float(value: Optional[float]) -> Optional[float]:
    return None if value is None else float(value)


def error_verdict() -> dict:
    """Generic fail-closed verdict used when a request cannot be processed."""
    return _verdict("LOW", REASON_ERROR, None, None)


def decode_base64_image(payload: str) -> Any:
    """Decode a base64 image payload into a BGR numpy array (via cv2).

    Raises ValueError with a generic message on malformed input; the
    payload content is never echoed back.  URLs are rejected: the API
    contract transports images as base64 only (PII privacy).
    """
    if not isinstance(payload, str) or not payload.strip():
        raise ValueError("empty image payload")
    data = payload.strip()
    lowered = data.lower()
    if lowered.startswith("http://") or lowered.startswith("https://"):
        raise ValueError("URL transport is not allowed; send base64 only")
    # Tolerate an explicit data-URL prefix defensively.
    if lowered.startswith("data:"):
        _, _, data = data.partition(",")
        if not data:
            raise ValueError("invalid image payload")
    # Strip any whitespace a client may have inserted (e.g. line wraps).
    compact = "".join(data.split())
    if not compact:
        raise ValueError("empty image payload")
    try:
        raw = base64.b64decode(compact, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("invalid base64 image payload") from exc
    if not raw:
        raise ValueError("empty image payload")
    if len(raw) > MAX_DECODED_IMAGE_BYTES:
        raise ValueError("image payload too large")
    try:
        import cv2
        import numpy as np
    except ImportError as exc:  # pragma: no cover - deployment issue
        raise ValueError("image decoding unavailable on this deployment") from exc
    arr = np.frombuffer(raw, dtype=np.uint8)
    image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    del raw, arr
    if image is None or image.size == 0:
        raise ValueError("unable to decode image data")
    return image


def compute_laplacian_variance(image_bgr: Any) -> Optional[float]:
    """Blur metric: variance of the Laplacian over the grayscale image.

    Returns None when the image is too small to compute, or when cv2 is
    not available (callers then fail closed).
    """
    try:
        import cv2
    except ImportError:  # pragma: no cover - deployment issue
        return None
    try:
        gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
        if gray.shape[0] < 3 or gray.shape[1] < 3:
            return None
        return float(cv2.Laplacian(gray, cv2.CV_64F).var())
    except cv2.error:  # pragma: no cover - defensive
        return None