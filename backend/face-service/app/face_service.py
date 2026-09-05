"""Face embedding and comparison logic.

The pure helpers (`cosine_similarity`, `select_best_face`,
`face_width_px`, `finalize_compare`) deliberately avoid importing
insightface, onnxruntime, numpy or opencv: they operate on plain
sequences and duck-typed face objects, so the unit tests run without
downloading any model weights.

The real InsightFace pipeline is built lazily by `get_analyzer()`; the
buffalo_l weights are downloaded on the first real request, never at
import time and never in the test suite.
"""
from __future__ import annotations

import math
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
    evaluate_face_quality,
)

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
        return float(det)
    return getattr(face, "score", None)


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
    if document_quality["quality"] != "HIGH" or selfie_quality["quality"] != "HIGH":
        return _needs_review(
            document_quality["quality"], selfie_quality["quality"], reasons
        )

    doc_embedding = getattr(document_face, "embedding", None)
    selfie_embedding = getattr(selfie_face, "embedding", None)
    if doc_embedding is None or selfie_embedding is None:
        reasons["document"] = REASON_NO_FACE if document_face is None else REASON_ERROR
        reasons["selfie"] = REASON_NO_FACE if selfie_face is None else REASON_ERROR
        return _needs_review("HIGH", "HIGH", reasons)

    similarity = cosine_similarity(doc_embedding, selfie_embedding)
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


def assess_image(
    model: Any,
    image_bgr: Any,
    *,
    blur_threshold: float,
    min_face_width_px: int,
) -> tuple:
    """Detect the best face and evaluate the quality verdict for an image.

    Returns `(verdict, best_face)`; the caller reuses `best_face` for
    the embedding comparison so face detection runs once per image.
    """
    faces = model.get(image_bgr) if model is not None else []
    best = select_best_face(faces)
    variance = compute_laplacian_variance(image_bgr)
    if best is None:
        verdict = evaluate_face_quality(
            face_detected=False,
            laplacian_variance=variance,
            blur_threshold=blur_threshold,
            min_face_width_px=min_face_width_px,
        )
        return verdict, None
    verdict = evaluate_face_quality(
        face_detected=True,
        face_width_px=face_width_px(best),
        laplacian_variance=variance,
        blur_threshold=blur_threshold,
        min_face_width_px=min_face_width_px,
    )
    return verdict, best


# --- Real InsightFace pipeline (lazy) ---

_analyzer: Any = None


def get_analyzer() -> Any:
    """Return a lazily-built, cached InsightFace FaceAnalysis pipeline.

    The buffalo_l model weights are downloaded by `FaceAnalysis` on
    first use - which happens only when a real request needs it, never
    on import and never in the test suite.
    """
    global _analyzer
    if _analyzer is not None:
        return _analyzer
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
    _analyzer = analyzer
    return _analyzer
