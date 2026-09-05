"""Quality-gate tests - pure rule logic with synthetic inputs.

No model weights, no heavy dependencies (opencv/numpy tests are gated
behind importorskip).
"""
import base64

import pytest

from app.quality import (
    DEFAULT_BLUR_THRESHOLD,
    DEFAULT_MIN_FACE_WIDTH_PX,
    compute_laplacian_variance,
    decode_base64_image,
    evaluate_face_quality,
)


def _high(width=150, variance=120.0):
    return evaluate_face_quality(
        face_detected=True, face_width_px=width, laplacian_variance=variance
    )


def test_no_face_is_low():
    v = evaluate_face_quality(face_detected=False, laplacian_variance=300.0)
    assert v["quality"] == "LOW"
    assert v["reason"] == "no_face"
    assert v["face_width_px"] is None
    assert v["action"] == "NEEDS_REVIEW"


def test_face_below_min_width_is_low():
    # The exact case this service exists for: ~95px ID-portrait faces.
    v = evaluate_face_quality(
        face_detected=True, face_width_px=95.0, laplacian_variance=200.0
    )
    assert v["quality"] == "LOW"
    assert v["reason"] == "face_resolution_too_small"
    assert v["face_width_px"] == 95
    assert v["action"] == "NEEDS_REVIEW"


def test_min_width_boundary_is_high():
    # Spec: face < 100px wide is LOW; exactly 100px is accepted.
    v = evaluate_face_quality(
        face_detected=True, face_width_px=100.0, laplacian_variance=200.0
    )
    assert v["quality"] == "HIGH"
    assert v["reason"] == "ok"


def test_blurry_is_low():
    v = evaluate_face_quality(
        face_detected=True, face_width_px=220.0, laplacian_variance=12.0
    )
    assert v["quality"] == "LOW"
    assert v["reason"] == "blurry"
    assert v["action"] == "NEEDS_REVIEW"


def test_blur_threshold_is_configurable():
    v = evaluate_face_quality(
        face_detected=True,
        face_width_px=220.0,
        laplacian_variance=60.0,
        blur_threshold=50.0,
    )
    assert v["quality"] == "HIGH"
    v2 = evaluate_face_quality(
        face_detected=True,
        face_width_px=220.0,
        laplacian_variance=60.0,
        blur_threshold=100.0,
    )
    assert v2["quality"] == "LOW"
    assert v2["reason"] == "blurry"


def test_missing_variance_fails_closed():
    # Cannot prove sharpness -> LOW (fail closed, never approve by
    # degradation).
    v = evaluate_face_quality(
        face_detected=True, face_width_px=150.0, laplacian_variance=None
    )
    assert v["quality"] == "LOW"
    assert v["reason"] == "blurry"


def test_detected_without_geometry_is_error():
    v = evaluate_face_quality(
        face_detected=True, face_width_px=None, laplacian_variance=120.0
    )
    assert v["quality"] == "LOW"
    assert v["reason"] == "error"


def test_ok_is_high():
    assert _high() == {
        "quality": "HIGH",
        "reason": "ok",
        "face_width_px": 150,
        "laplacian_variance": 120.0,
        "action": "OK",
    }


# --- base64 transport guards (no cv2 required for these) ---


def test_decode_rejects_url_transport():
    with pytest.raises(ValueError):
        decode_base64_image("https://example.com/photo.jpg")


def test_decode_rejects_empty_payload():
    with pytest.raises(ValueError):
        decode_base64_image("   ")


def test_decode_rejects_invalid_base64():
    with pytest.raises(ValueError):
        decode_base64_image("!!!not-base64!!!")


# --- cv2-backed helpers (skip cleanly when opencv is unavailable) ---


def test_laplacian_variance_sharp_vs_flat():
    pytest.importorskip("cv2")
    np = pytest.importorskip("numpy")

    flat = np.zeros((64, 64, 3), dtype=np.uint8)
    assert compute_laplacian_variance(flat) < DEFAULT_BLUR_THRESHOLD

    rows = np.arange(64) // 8
    cols = np.arange(64) // 8
    grid = ((rows[:, None] + cols[None, :]) % 2) * 255
    checker = np.stack([grid] * 3, axis=-1).astype(np.uint8)
    assert compute_laplacian_variance(checker) >= DEFAULT_BLUR_THRESHOLD
    # Sanity on the calibrated value: a flat image must stay far below.
    assert compute_laplacian_variance(flat) < 15.0


def test_decode_base64_roundtrip():
    pytest.importorskip("cv2")
    np = pytest.importorskip("numpy")

    img = np.full((32, 32, 3), 128, dtype=np.uint8)
    ok, buf = pytest.importorskip("cv2").imencode(".jpg", img)
    assert ok
    b64 = base64.b64encode(buf.tobytes()).decode("ascii")

    decoded = decode_base64_image(b64)
    assert decoded.shape == (32, 32, 3)

    # Explicit data-URL prefix is tolerated defensively.
    decoded2 = decode_base64_image("data:image/jpeg;base64," + b64)
    assert decoded2.shape == (32, 32, 3)