"""Pydantic request/response models for the face service."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

from app.config import MAX_DECODED_IMAGE_BYTES

MAX_BASE64_IMAGE_CHARS = 4 * ((MAX_DECODED_IMAGE_BYTES + 2) // 3) + 256


class FaceImagesRequest(BaseModel):
    """Base64 image payloads. Field names are a fixed API contract:

    `document_face` is the ID-card portrait, `selfie` the selfie.
    Transport is base64 only - never URLs - to keep PII out of logs and
    intermediate proxies.
    """

    document_face: str = Field(min_length=1, max_length=MAX_BASE64_IMAGE_CHARS)
    selfie: str = Field(min_length=1, max_length=MAX_BASE64_IMAGE_CHARS)


class QualityItem(BaseModel):
    quality: Literal["HIGH", "LOW"]
    reason: Literal[
        "ok",
        "face_resolution_too_small",
        "blurry",
        "no_face",
        "error",
    ]
    face_width_px: Optional[int] = None
    laplacian_variance: Optional[float] = None
    action: Literal["OK", "NEEDS_REVIEW"]


class QualityResponse(BaseModel):
    document: QualityItem
    selfie: QualityItem


class CompareResponse(BaseModel):
    match: bool
    similarity: Optional[float] = None
    confidence: Optional[Literal["high", "low"]] = None
    quality_document: Literal["HIGH", "LOW"]
    quality_selfie: Literal["HIGH", "LOW"]
    action: Literal["MATCHED", "NO_MATCH", "NEEDS_REVIEW"]
    reasons: dict[
        Literal["document", "selfie"],
        Literal[
            "ok",
            "face_resolution_too_small",
            "blurry",
            "no_face",
            "error",
        ],
    ]
