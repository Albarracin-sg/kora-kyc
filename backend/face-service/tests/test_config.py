"""Configuration tests for the separate document and selfie quality floors."""

import pytest
from pydantic import ValidationError

from app.config import (
    DEFAULT_DOCUMENT_MIN_FACE_WIDTH_PX,
    DEFAULT_SELFIE_MIN_FACE_WIDTH_PX,
    MAX_DECODED_IMAGE_BYTES,
    get_settings,
)
from app.schemas import FaceImagesRequest, MAX_BASE64_IMAGE_CHARS


def test_document_floor_is_separate_and_selfie_floor_is_unchanged(monkeypatch):
    monkeypatch.delenv("FACE_DOCUMENT_MIN_WIDTH_PX", raising=False)
    monkeypatch.delenv("FACE_SELFIE_MIN_WIDTH_PX", raising=False)
    monkeypatch.delenv("FACE_MIN_WIDTH_PX", raising=False)
    get_settings.cache_clear()

    try:
        settings = get_settings()
        assert settings.document_min_face_width_px == DEFAULT_DOCUMENT_MIN_FACE_WIDTH_PX
        assert settings.selfie_min_face_width_px == DEFAULT_SELFIE_MIN_FACE_WIDTH_PX
        assert settings.min_face_width_px == DEFAULT_SELFIE_MIN_FACE_WIDTH_PX
    finally:
        get_settings.cache_clear()


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("FACE_BLUR_THRESHOLD", "0"),
        ("FACE_DOCUMENT_MIN_WIDTH_PX", "0"),
        ("FACE_SELFIE_MIN_WIDTH_PX", "-1"),
    ],
)
def test_rejects_quality_configuration_that_disables_the_gate(monkeypatch, key, value):
    monkeypatch.setenv(key, value)
    get_settings.cache_clear()

    try:
        with pytest.raises(ValueError, match=key):
            get_settings()
    finally:
        get_settings.cache_clear()


def test_image_request_rejects_an_overlong_encoded_payload():
    assert MAX_BASE64_IMAGE_CHARS > MAX_DECODED_IMAGE_BYTES

    with pytest.raises(ValidationError):
        FaceImagesRequest(
            document_face="a" * (MAX_BASE64_IMAGE_CHARS + 1),
            selfie="x",
        )


def test_legacy_width_setting_only_backfills_the_selfie_floor(monkeypatch):
    monkeypatch.delenv("FACE_DOCUMENT_MIN_WIDTH_PX", raising=False)
    monkeypatch.delenv("FACE_SELFIE_MIN_WIDTH_PX", raising=False)
    monkeypatch.setenv("FACE_MIN_WIDTH_PX", "120")
    get_settings.cache_clear()

    try:
        settings = get_settings()
        assert settings.document_min_face_width_px == DEFAULT_DOCUMENT_MIN_FACE_WIDTH_PX
        assert settings.selfie_min_face_width_px == 120
    finally:
        get_settings.cache_clear()


def test_explicit_selfie_floor_takes_precedence_over_legacy_setting(monkeypatch):
    monkeypatch.setenv("FACE_MIN_WIDTH_PX", "120")
    monkeypatch.setenv("FACE_SELFIE_MIN_WIDTH_PX", "100")
    monkeypatch.setenv("FACE_DOCUMENT_MIN_WIDTH_PX", "90")
    get_settings.cache_clear()

    try:
        settings = get_settings()
        assert settings.document_min_face_width_px == 90
        assert settings.selfie_min_face_width_px == 100
    finally:
        get_settings.cache_clear()
