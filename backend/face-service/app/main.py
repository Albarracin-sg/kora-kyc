"""Koa face verification service (FastAPI).

Standalone by design: the NestJS backend consumes it only when the external
face-service provider is explicitly selected.
All image transport is base64 (never URLs) to keep PII out of logs and
proxies.  No request body, image, embedding or base64 content is ever
logged.  Decoded image buffers are dropped as soon as they are used.

Error handling is fail-closed: request-time failures return HTTP 200
with `action: "NEEDS_REVIEW"` / `reason: "error"` (a degraded compare
can never approve).  500 is reserved for health/config failures.
"""
from __future__ import annotations

from secrets import compare_digest
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException

from app.config import get_settings
from app.face_service import assess_image, finalize_compare, get_analyzer
from app.quality import decode_base64_image, error_verdict
from app.schemas import CompareResponse, FaceImagesRequest, QualityResponse

app = FastAPI(
    title="Koa Face Service",
    version="0.1.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


def require_api_key(x_api_key: str = Header(default="")) -> None:
    """Require the configured X-API-Key for biometric processing endpoints."""
    settings = get_settings()
    if not settings.face_api_key:
        raise HTTPException(status_code=503, detail="face service authentication is not configured")
    if not compare_digest(
        x_api_key.encode("utf-8"), settings.face_api_key.encode("utf-8")
    ):
        raise HTTPException(
            status_code=401,
            detail="invalid or missing X-API-Key",
        )


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/face/quality", response_model=QualityResponse, dependencies=[Depends(require_api_key)])
def face_quality(payload: FaceImagesRequest) -> dict:
    settings = get_settings()

    def _assess(payload_str: str) -> dict:
        try:
            image = decode_base64_image(payload_str)
            verdict, _ = assess_image(
                get_analyzer(),
                image,
                blur_threshold=settings.blur_threshold,
                min_face_width_px=settings.min_face_width_px,
            )
            del image
            return verdict
        except Exception:
            return error_verdict()

    return {"document": _assess(payload.document_face), "selfie": _assess(payload.selfie)}


@app.post("/face/compare", response_model=CompareResponse, dependencies=[Depends(require_api_key)])
def face_compare(payload: FaceImagesRequest) -> dict:
    settings = get_settings()

    try:
        analyzer = get_analyzer()
    except Exception:
        # Model unavailable (e.g. insightface not installed): fail closed
        # for both images rather than approving anything by degradation.
        analyzer = None

    def _load(payload_str: str):
        if analyzer is None:
            return error_verdict(), None
        try:
            image = decode_base64_image(payload_str)
            verdict, face = assess_image(
                analyzer,
                image,
                blur_threshold=settings.blur_threshold,
                min_face_width_px=settings.min_face_width_px,
            )
            del image
            return verdict, face
        except Exception:
            return error_verdict(), None

    document_quality, document_face = _load(payload.document_face)
    selfie_quality, selfie_face = _load(payload.selfie)
    return finalize_compare(
        document_quality=document_quality,
        selfie_quality=selfie_quality,
        document_face=document_face,
        selfie_face=selfie_face,
        match_threshold=settings.match_threshold,
        high_confidence_threshold=settings.high_confidence_threshold,
    )
