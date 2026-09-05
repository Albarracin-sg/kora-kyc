"""Pydantic request/response models for the face service."""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class FaceImagesRequest(BaseModel):
    """Base64 image payloads. Field names are a fixed API contract:

    `document_face` is the ID-card portrait, `selfie` the selfie.
    Transport is base64 only - never URLs - to keep PII out of logs and
    intermediate proxies.
    """

    document_face: str = Field(min_length=1)
    selfie: str = Field(min_length=1)


class QualityItem(BaseModel):
    quality: str
    reason: str
    face_width_px: Optional[int] = None
    laplacian_variance: Optional[float] = None
    action: str


class QualityResponse(BaseModel):
    document: QualityItem
    selfie: QualityItem


class CompareResponse(BaseModel):
    match: bool
    similarity: Optional[float] = None
    confidence: Optional[str] = None
    quality_document: str
    quality_selfie: str
    action: str
    reasons: dict[str, str]