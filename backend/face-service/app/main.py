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

import logging
from contextlib import asynccontextmanager
from secrets import compare_digest
from collections.abc import AsyncIterator

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.face_service import (
    IMAGE_KIND,
    assess_image,
    finalize_compare,
    get_analyzer,
    is_analyzer_ready,
    preload_analyzer,
)
from app.quality import decode_base64_image, error_verdict
from app.schemas import CompareResponse, FaceImagesRequest, QualityResponse

LOGGER = logging.getLogger("koa.face-service")


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Prepare the model before the service can become ready."""
    try:
        preload_analyzer()
    except Exception as exc:
        # Keep liveness available so the platform can report the failed
        # instance, but readiness remains 503 and biometric routes fail closed.
        LOGGER.error("InsightFace analyzer preload failed: %s", type(exc).__name__)
    yield


app = FastAPI(
    title="Koa Face Service",
    version="0.1.0",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


@app.exception_handler(RequestValidationError)
async def handle_request_validation_error(
    _request: Request,
    _exc: RequestValidationError,
) -> JSONResponse:
    """Return a generic validation error without echoing the rejected payload."""
    return JSONResponse(status_code=422, content={"detail": "invalid request payload"})


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


@app.get("/ready")
def readiness() -> JSONResponse:
    """Report readiness only after the configured model is prepared."""
    if not is_analyzer_ready():
        return JSONResponse(status_code=503, content={"status": "not_ready"})
    return JSONResponse(status_code=200, content={"status": "ready"})


@app.post("/face/quality", response_model=QualityResponse, dependencies=[Depends(require_api_key)])
def face_quality(payload: FaceImagesRequest) -> dict:
    settings = get_settings()

    def _assess(payload_str: str, image_kind: str, min_face_width_px: int) -> dict:
        try:
            image = decode_base64_image(payload_str)
            verdict, _ = assess_image(
                get_analyzer(),
                image,
                blur_threshold=settings.blur_threshold,
                min_face_width_px=min_face_width_px,
                image_kind=image_kind,
            )
            del image
            return verdict
        except Exception:
            return error_verdict()

    return {
        "document": _assess(
            payload.document_face,
            IMAGE_KIND["DOCUMENT"],
            settings.document_min_face_width_px,
        ),
        "selfie": _assess(
            payload.selfie,
            IMAGE_KIND["SELFIE"],
            settings.selfie_min_face_width_px,
        ),
    }


@app.post("/face/compare", response_model=CompareResponse, dependencies=[Depends(require_api_key)])
def face_compare(payload: FaceImagesRequest) -> dict:
    settings = get_settings()

    try:
        analyzer = get_analyzer()
    except Exception:
        # Model unavailable (e.g. insightface not installed): fail closed
        # for both images rather than approving anything by degradation.
        analyzer = None

    def _load(payload_str: str, image_kind: str, min_face_width_px: int):
        if analyzer is None:
            return error_verdict(), None
        try:
            image = decode_base64_image(payload_str)
            verdict, face = assess_image(
                analyzer,
                image,
                blur_threshold=settings.blur_threshold,
                min_face_width_px=min_face_width_px,
                image_kind=image_kind,
            )
            del image
            return verdict, face
        except Exception:
            return error_verdict(), None

    document_quality, document_face = _load(
        payload.document_face,
        IMAGE_KIND["DOCUMENT"],
        settings.document_min_face_width_px,
    )
    selfie_quality, selfie_face = _load(
        payload.selfie,
        IMAGE_KIND["SELFIE"],
        settings.selfie_min_face_width_px,
    )
    return finalize_compare(
        document_quality=document_quality,
        selfie_quality=selfie_quality,
        document_face=document_face,
        selfie_face=selfie_face,
        match_threshold=settings.match_threshold,
        high_confidence_threshold=settings.high_confidence_threshold,
    )
