"""Face embedding and comparison logic.

The pure helpers (`cosine_similarity`, `select_best_face`,
`face_width_px`, `finalize_compare`) deliberately avoid importing
insightface, onnxruntime, numpy or opencv: they operate on plain
sequences and duck-typed face objects, so the unit tests run without
downloading any model weights.

The real InsightFace pipeline is prepared by `preload_analyzer()` during
application startup.  `get_analyzer()` retains a guarded lazy path for
isolated local callers and tests, never at module import time.
"""
from __future__ import annotations

import math
from threading import Lock
from dataclasses import dataclass
from typing import Any, Optional, Sequence

from app.config import (
    DEFAULT_HIGH_CONFIDENCE_THRESHOLD,
    DEFAULT_MATCH_THRESHOLD,
    get_settings,
)
from app.quality import (
    REASON_ERROR,
    REASON_NO_FACE,
    compute_laplacian_variance,
    error_verdict,
    evaluate_face_quality,
)

IMAGE_KIND = {
    "DOCUMENT": "document",
    "SELFIE": "selfie",
}
DOCUMENT_ORIENTATION_DEGREES = (0, 90, 180, 270)
DOCUMENT_DETECTION_SCALE_FACTORS = (1.0, 1.5, 2.0)

# --- Pure helpers (dependency-light, unit-testable) ---


def cosine_similarity(a: Any, b: Any) -> float:
    """Cosine similarity between two equal-length numeric sequences.

    `dot(a, b) / (||a|| * ||b||)`.  Returns 0.0 for empty, mismatched
    or zero-norm inputs (fail-closed: garbage embeddings never match).
    """
    if a is None or b is None:
        return 0.0
    n = len(a)
    if n == 0 or len(b) != n:
        return 0.0
    dot = math.fsum(a[i] * b[i] for i in range(n))
    norm_a = math.sqrt(math.fsum(x * x for x in a))
    norm_b = math.sqrt(math.fsum(x * x for x in b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


def _face_score(face: Any) -> Optional[float]:
    """Detection confidence for a face, whichever field the API exposes.

    InsightFace 1.0.1 names the detection confidence `det_score` on real
    detections (a `score` attribute is absent -> returns None).  Older
    builds / fake faces used `score`.  Reading both, preferring
    `det_score`, keeps real detections working without breaking dummies.
    """
    det = getattr(face, "det_score", None)
    if det is not None:
        try:
            score = float(det)
        except (TypeError, ValueError):
            return None
        return score if math.isfinite(score) else None
    score = getattr(face, "score", None)
    try:
        score = float(score)
    except (TypeError, ValueError):
        return None
    return score if math.isfinite(score) else None


def select_best_face(faces: Sequence[Any]) -> Optional[Any]:
    """Return the highest-scoring detection, or None when no face exists.

    Faces are ranked by their detection confidence (prefer `det_score`,
    fall back to `score` - never taken blindly in list order).
    Detections without any confidence are ignored.
    """
    best = None
    best_score = None
    for face in faces or ():
        score = _face_score(face)
        if score is None:
            continue
        if best is None or score > best_score:
            best = face
            best_score = score
    return best


def face_width_px(face: Any) -> Optional[int]:
    """Face width from the detection bounding box (x2 - x1), in pixels."""
    bbox = getattr(face, "bbox", None)
    if bbox is None or len(bbox) < 4:
        return None
    try:
        width = float(bbox[2]) - float(bbox[0])
    except (TypeError, ValueError):
        return None
    if width < 0:
        return None
    return int(round(width))


def _needs_review(
    document_quality: str,
    selfie_quality: str,
    reasons: dict,
) -> dict:
    return {
        "match": False,
        "similarity": None,
        "confidence": None,
        "quality_document": document_quality,
        "quality_selfie": selfie_quality,
        "action": "NEEDS_REVIEW",
        "reasons": reasons,
    }


def _is_high_quality(verdict: dict) -> bool:
    return (
        verdict.get("quality") == "HIGH"
        and verdict.get("reason") == "ok"
        and verdict.get("action") == "OK"
    )


def finalize_compare(
    *,
    document_quality: dict,
    selfie_quality: dict,
    document_face: Any,
    selfie_face: Any,
    match_threshold: float = DEFAULT_MATCH_THRESHOLD,
    high_confidence_threshold: float = DEFAULT_HIGH_CONFIDENCE_THRESHOLD,
) -> dict:
    """Assemble the compare result from quality verdicts and faces.

    Fail-closed: when either image is LOW quality, the embeddings are
    never read or compared - the result is NEEDS_REVIEW with
    `similarity=None`, so a degraded input can never approve a match.
    """
    reasons = {"document": document_quality["reason"], "selfie": selfie_quality["reason"]}
    if not _is_high_quality(document_quality) or not _is_high_quality(selfie_quality):
        return _needs_review(
            document_quality["quality"], selfie_quality["quality"], reasons
        )

    doc_embedding = getattr(document_face, "embedding", None)
    selfie_embedding = getattr(selfie_face, "embedding", None)
    if doc_embedding is None or selfie_embedding is None:
        reasons["document"] = REASON_NO_FACE if document_face is None else REASON_ERROR
        reasons["selfie"] = REASON_NO_FACE if selfie_face is None else REASON_ERROR
        return _needs_review("HIGH", "HIGH", reasons)

    try:
        similarity = cosine_similarity(doc_embedding, selfie_embedding)
    except (TypeError, ValueError, OverflowError):
        reasons["document"] = REASON_ERROR
        reasons["selfie"] = REASON_ERROR
        return _needs_review("HIGH", "HIGH", reasons)
    if not math.isfinite(similarity) or similarity < -1.0 or similarity > 1.0:
        reasons["document"] = REASON_ERROR
        reasons["selfie"] = REASON_ERROR
        return _needs_review("HIGH", "HIGH", reasons)
    match = similarity >= match_threshold
    confidence = "high" if similarity >= high_confidence_threshold else "low"
    return {
        "match": match,
        "similarity": similarity,
        "confidence": confidence,
        "quality_document": "HIGH",
        "quality_selfie": "HIGH",
        "action": "MATCHED" if match else "NO_MATCH",
        "reasons": reasons,
    }


# --- Glue between the detector and the quality gate ---


@dataclass(frozen=True)
class ImageAssessment:
    """The quality verdict and face produced from one chosen orientation."""

    verdict: dict
    face: Any
    orientation_degrees: int


def rotate_image(image_bgr: Any, orientation_degrees: int) -> Any:
    """Rotate an image clockwise without changing the selfie path."""
    if orientation_degrees == 0:
        return image_bgr
    try:
        import cv2
    except ImportError as exc:  # pragma: no cover - deployment issue
        raise RuntimeError("image orientation normalization unavailable") from exc

    rotation_codes = {
        90: cv2.ROTATE_90_CLOCKWISE,
        180: cv2.ROTATE_180,
        270: cv2.ROTATE_90_COUNTERCLOCKWISE,
    }
    rotation_code = rotation_codes.get(orientation_degrees)
    if rotation_code is None:
        raise ValueError("unsupported image orientation")
    return cv2.rotate(image_bgr, rotation_code)


def _orientation_candidates(image_kind: str) -> tuple[int, ...]:
    if image_kind == IMAGE_KIND["DOCUMENT"]:
        return DOCUMENT_ORIENTATION_DEGREES
    if image_kind == IMAGE_KIND["SELFIE"]:
        return (0,)
    raise ValueError("unsupported image kind")


def _assessment_rank(assessment: ImageAssessment, orientation_index: int) -> tuple:
    """Prefer a valid face, then stronger geometry/confidence, then 0°."""
    verdict = assessment.verdict
    face = assessment.face
    score = _face_score(face)
    width = face_width_px(face) if face is not None else None
    variance = verdict.get("laplacian_variance")
    finite_variance = (
        float(variance)
        if isinstance(variance, (int, float)) and math.isfinite(float(variance))
        else -1.0
    )
    return (
        int(_is_high_quality(verdict)),
        int(face is not None),
        score if score is not None else -1.0,
        width if width is not None else -1,
        finite_variance,
        -orientation_index,
    )


def _assess_orientation(
    model: Any,
    image_bgr: Any,
    orientation_degrees: int,
    *,
    blur_threshold: float,
    min_face_width_px: int,
    image_kind: str,
) -> ImageAssessment:
    oriented_image = image_bgr
    temporary_images: list[Any] = []
    try:
        oriented_image = rotate_image(image_bgr, orientation_degrees)
        scale_factors = (
            DOCUMENT_DETECTION_SCALE_FACTORS
            if image_kind == IMAGE_KIND["DOCUMENT"]
            else (1.0,)
        )
        assessments: list[ImageAssessment] = []
        for scale_factor in scale_factors:
            candidate = _scale_for_document_detection(oriented_image, scale_factor)
            if candidate is not oriented_image:
                temporary_images.append(candidate)
            faces = model.get(candidate) if model is not None else []
            best = select_best_face(faces)
            variance = compute_laplacian_variance(candidate)
            if best is None:
                verdict = evaluate_face_quality(
                    face_detected=False,
                    laplacian_variance=variance,
                    blur_threshold=blur_threshold,
                    min_face_width_px=min_face_width_px,
                )
            else:
                verdict = evaluate_face_quality(
                    face_detected=True,
                    face_width_px=face_width_px(best),
                    laplacian_variance=variance,
                    blur_threshold=blur_threshold,
                    min_face_width_px=min_face_width_px,
                )
            assessments.append(ImageAssessment(verdict, best, orientation_degrees))

        return max(assessments, key=lambda assessment: _assessment_rank(assessment, 0))
    except Exception:
        return ImageAssessment(error_verdict(), None, orientation_degrees)
    finally:
        # Face objects retain the embedding and geometry needed by the caller;
        # the temporary rotated pixel buffer is no longer needed.
        for temporary_image in temporary_images:
            del temporary_image
        if oriented_image is not image_bgr:
            del oriented_image


def _scale_for_document_detection(image_bgr: Any, scale_factor: float) -> Any:
    """Upscale small document portraits so the detector gets a second chance."""
    if scale_factor <= 1.0 or not hasattr(image_bgr, "shape"):
        return image_bgr
    try:
        import cv2

        height, width = image_bgr.shape[:2]
        if height <= 0 or width <= 0:
            return image_bgr
        max_dimension = 4096
        effective_scale = min(scale_factor, max_dimension / max(height, width))
        if effective_scale <= 1.0:
            return image_bgr
        return cv2.resize(
            image_bgr,
            None,
            fx=effective_scale,
            fy=effective_scale,
            interpolation=cv2.INTER_CUBIC,
        )
    except Exception:
        return image_bgr


def assess_image_with_orientation(
    model: Any,
    image_bgr: Any,
    *,
    blur_threshold: float,
    min_face_width_px: int,
    image_kind: str = IMAGE_KIND["DOCUMENT"],
) -> ImageAssessment:
    """Assess one image and retain the face from the selected orientation.

    Document images use a deterministic 0/90/180/270° selection.  Selfies
    deliberately use only their captured orientation.  The deterministic
    selection is shared by `/face/quality` and `/face/compare`, so a quality
    pass and the later embedding comparison cannot use different rotations.
    """
    candidates = _orientation_candidates(image_kind)
    assessments = [
        _assess_orientation(
            model,
            image_bgr,
            orientation_degrees,
            blur_threshold=blur_threshold,
            min_face_width_px=min_face_width_px,
            image_kind=image_kind,
        )
        for orientation_degrees in candidates
    ]
    return max(
        assessments,
        key=lambda assessment: _assessment_rank(
            assessment, candidates.index(assessment.orientation_degrees)
        ),
    )


def assess_image(
    model: Any,
    image_bgr: Any,
    *,
    blur_threshold: float,
    min_face_width_px: int,
    image_kind: str = IMAGE_KIND["DOCUMENT"],
) -> tuple:
    """Select an oriented face and evaluate the quality verdict for an image.

    Returns `(verdict, best_face)`; the caller reuses `best_face` from the
    selected orientation for the embedding comparison.
    """
    assessment = assess_image_with_orientation(
        model,
        image_bgr,
        blur_threshold=blur_threshold,
        min_face_width_px=min_face_width_px,
        image_kind=image_kind,
    )
    return assessment.verdict, assessment.face


# --- Real InsightFace pipeline ---

_analyzer: Any = None
_analyzer_initialization_error: str | None = None
_analyzer_initialization_lock = Lock()


def _build_analyzer() -> Any:
    settings = get_settings()
    try:
        from insightface.app import FaceAnalysis
    except ImportError as exc:
        raise RuntimeError(
            "insightface is not installed; run `pip install -r requirements.txt` "
            "to enable real face analysis (unit tests work without it)"
        ) from exc

    analyzer = FaceAnalysis(name=settings.model_name, root=settings.model_root)
    analyzer.prepare(ctx_id=0, det_size=settings.det_size)
    return analyzer


def analyzer_failure_reason() -> str | None:
    """Return a safe, generic initialization failure state for diagnostics."""
    return _analyzer_initialization_error


def is_analyzer_ready() -> bool:
    """Return true only after the InsightFace analyzer has prepared successfully."""
    return _analyzer is not None


def preload_analyzer() -> Any:
    """Build and prepare the configured analyzer before serving biometric traffic."""
    return get_analyzer()


def get_analyzer() -> Any:
    """Return a cached, safely initialized InsightFace FaceAnalysis pipeline.

    Application startup calls this through `preload_analyzer()`.  The lazy
    access remains useful for isolated tests and local callers, while the
    lock prevents concurrent requests from constructing duplicate analyzers.
    A failed initialization is retained as a generic failure state so the
    service remains not-ready and does not repeatedly initialize in-process.
    """
    global _analyzer, _analyzer_initialization_error
    if _analyzer is not None:
        return _analyzer
    if _analyzer_initialization_error is not None:
        raise RuntimeError("InsightFace analyzer initialization previously failed")

    with _analyzer_initialization_lock:
        if _analyzer is not None:
            return _analyzer
        if _analyzer_initialization_error is not None:
            raise RuntimeError("InsightFace analyzer initialization previously failed")

        try:
            analyzer = _build_analyzer()
        except Exception as exc:
            _analyzer_initialization_error = "InsightFace analyzer initialization failed"
            raise RuntimeError(_analyzer_initialization_error) from exc

        _analyzer = analyzer
        return _analyzer
