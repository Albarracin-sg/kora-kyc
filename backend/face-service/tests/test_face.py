"""Embedding / comparison tests with a mocked model.

No model weights are ever downloaded: the InsightFace pipeline is
replaced by duck-typed fakes, and the embeddings are plain lists.
"""
import math

import pytest

from app.face_service import (
    IMAGE_KIND,
    assess_image_with_orientation,
    cosine_similarity,
    face_width_px,
    finalize_compare,
    select_best_face,
)


class FakeFace:
    """Mimics the real InsightFace 1.0.1 detection API: `det_score`.

    `score` is only kept for backward-compat tests (older builds / dummies).
    """

    def __init__(self, det_score=0.5, score=None, embedding=None, bbox=(0, 0, 200, 200)):
        self.det_score = det_score
        self.score = score
        self.embedding = embedding
        self.bbox = bbox


class ExplodingEmbeddingFace:
    """A fake face whose embedding blows up if read - proves the quality
    gate short-circuits before any embedding access."""

    det_score = 0.9
    bbox = (10, 10, 200, 200)

    @property
    def embedding(self):
        raise AssertionError("embedding must not be read when quality is LOW")


class OrientedImage:
    def __init__(self, orientation_degrees):
        self.orientation_degrees = orientation_degrees


class OrientationModel:
    def __init__(self, faces_by_orientation):
        self.faces_by_orientation = faces_by_orientation
        self.seen_orientations = []

    def get(self, image):
        orientation = getattr(image, "orientation_degrees", 0)
        self.seen_orientations.append(orientation)
        return self.faces_by_orientation.get(orientation, [])


def _verdict(quality, reason):
    return {
        "quality": quality,
        "reason": reason,
        "face_width_px": 150,
        "laplacian_variance": 120.0,
        "action": "OK" if quality == "HIGH" else "NEEDS_REVIEW",
    }


def _patch_orientation_dependencies(monkeypatch):
    def fake_rotate(image, orientation_degrees):
        if orientation_degrees == 0:
            return image
        return OrientedImage(orientation_degrees)

    monkeypatch.setattr("app.face_service.rotate_image", fake_rotate)
    monkeypatch.setattr(
        "app.face_service.compute_laplacian_variance", lambda _image: 120.0
    )


def test_document_quality_selects_the_orientation_that_passes_the_conservative_floor(
    monkeypatch,
):
    _patch_orientation_dependencies(monkeypatch)
    model = OrientationModel(
        {
            0: [FakeFace(det_score=0.99, bbox=(0, 0, 70, 70), embedding=[0.0, 1.0])],
            90: [FakeFace(det_score=0.8, bbox=(0, 0, 95, 95), embedding=[1.0, 0.0])],
        }
    )

    assessment = assess_image_with_orientation(
        model,
        object(),
        blur_threshold=25.0,
        min_face_width_px=90,
        image_kind=IMAGE_KIND["DOCUMENT"],
    )

    assert assessment.orientation_degrees == 90
    assert assessment.verdict["quality"] == "HIGH"
    assert assessment.verdict["action"] == "OK"
    assert assessment.face is model.faces_by_orientation[90][0]


def test_selfie_is_evaluated_only_in_the_normal_orientation(monkeypatch):
    _patch_orientation_dependencies(monkeypatch)
    model = OrientationModel({0: [FakeFace(embedding=[1.0, 0.0])]})

    assessment = assess_image_with_orientation(
        model,
        object(),
        blur_threshold=25.0,
        min_face_width_px=100,
        image_kind=IMAGE_KIND["SELFIE"],
    )

    assert assessment.orientation_degrees == 0
    assert model.seen_orientations == [0]


@pytest.mark.parametrize(
    ("faces_by_orientation", "variance", "reason"),
    [
        ({}, 120.0, "no_face"),
        ({0: [FakeFace(embedding=[1.0, 0.0])]}, 12.0, "blurry"),
    ],
)
def test_document_no_face_and_blur_remain_low(
    monkeypatch, faces_by_orientation, variance, reason
):
    _patch_orientation_dependencies(monkeypatch)
    monkeypatch.setattr("app.face_service.compute_laplacian_variance", lambda _image: variance)
    assessment = assess_image_with_orientation(
        OrientationModel(faces_by_orientation),
        object(),
        blur_threshold=25.0,
        min_face_width_px=90,
        image_kind=IMAGE_KIND["DOCUMENT"],
    )

    assert assessment.verdict["quality"] == "LOW"
    assert assessment.verdict["action"] == "NEEDS_REVIEW"
    assert assessment.verdict["reason"] == reason


def test_compare_uses_the_same_document_orientation_that_quality_selected(monkeypatch):
    _patch_orientation_dependencies(monkeypatch)
    model = OrientationModel(
        {
            0: [FakeFace(det_score=0.99, bbox=(0, 0, 70, 70), embedding=[0.0, 1.0])],
            90: [FakeFace(det_score=0.8, bbox=(0, 0, 95, 95), embedding=[1.0, 0.0])],
        }
    )
    image = object()

    quality_assessment = assess_image_with_orientation(
        model,
        image,
        blur_threshold=25.0,
        min_face_width_px=90,
        image_kind=IMAGE_KIND["DOCUMENT"],
    )
    compare_assessment = assess_image_with_orientation(
        model,
        image,
        blur_threshold=25.0,
        min_face_width_px=90,
        image_kind=IMAGE_KIND["DOCUMENT"],
    )
    selfie_assessment = assess_image_with_orientation(
        OrientationModel({0: [FakeFace(embedding=[1.0, 0.0])]}),
        object(),
        blur_threshold=25.0,
        min_face_width_px=100,
        image_kind=IMAGE_KIND["SELFIE"],
    )

    result = finalize_compare(
        document_quality=quality_assessment.verdict,
        selfie_quality=selfie_assessment.verdict,
        document_face=compare_assessment.face,
        selfie_face=selfie_assessment.face,
        match_threshold=0.72,
    )

    assert quality_assessment.orientation_degrees == 90
    assert compare_assessment.orientation_degrees == 90
    assert result["similarity"] == pytest.approx(1.0)
    assert result["match"] is True
    assert result["action"] == "MATCHED"


# --- cosine_similarity ---


def test_cosine_identical_vectors():
    assert cosine_similarity([1, 2, 3], [1, 2, 3]) == pytest.approx(1.0)


def test_cosine_orthogonal_vectors():
    assert cosine_similarity([1, 0, 0], [0, 1, 0]) == pytest.approx(0.0)


def test_cosine_opposite_vectors_negative():
    assert cosine_similarity([1, 0], [-1, 0]) == pytest.approx(-1.0)


def test_cosine_zero_norm_is_zero():
    assert cosine_similarity([0, 0, 0], [1, 2, 3]) == 0.0
    assert cosine_similarity([1, 2, 3], [0, 0, 0]) == 0.0


def test_cosine_length_mismatch_is_zero():
    assert cosine_similarity([1, 2], [1, 2, 3]) == 0.0


def test_cosine_accepts_numpy_arrays():
    np = pytest.importorskip("numpy")
    a = np.array([1.0, 2.0, 3.0])
    b = np.array([2.0, 3.0, 4.0])
    assert cosine_similarity(a, b) == pytest.approx(cosine_similarity(list(a), list(b)))


# --- best-face selection / geometry ---


def test_best_face_selected_by_score_not_position():
    low = FakeFace(det_score=0.3)
    high = FakeFace(det_score=0.99)
    assert select_best_face([low, high]) is high
    assert select_best_face([high, low]) is high


def test_select_best_face_empty():
    assert select_best_face([]) is None


def test_select_best_face_skips_faces_without_score():
    class NoScore:
        pass

    f = FakeFace(det_score=0.7)
    assert select_best_face([NoScore(), f]) is f


def test_select_best_face_prefers_det_score_over_score():
    # Real InsightFace 1.0.1 clones: `det_score` is authoritative.
    both = FakeFace(det_score=0.9, score=0.3)
    assert select_best_face([both]) is both


def test_select_best_face_det_score_only_regression():
    # Regression: the live detector exposes only `det_score` (no `score`
    # attribute).  A face with det_score but no score must rank and win.
    only_det = FakeFace(det_score=0.784, score=None)
    assert select_best_face([only_det]) is only_det

    # And it must beat another face even if that other face is first in
    # list order, proving it is ranked by confidence, not position.
    other = FakeFace(det_score=0.3, score=None)
    assert select_best_face([only_det, other]) is only_det
    assert select_best_face([other, only_det]) is only_det


def test_select_best_face_falls_back_to_legacy_score():
    # Backward-compat: a dummy / older face exposing only `score` still works.
    legacy = FakeFace(det_score=None, score=0.72)
    assert select_best_face([legacy]) is legacy


def test_face_width_from_bbox():
    assert face_width_px(FakeFace(bbox=(10, 5, 110, 95))) == 100


def test_face_width_missing_bbox():
    assert face_width_px(FakeFace(bbox=None)) is None


# --- finalize_compare / quality gate ---


def test_low_quality_skips_comparison_and_never_touches_embeddings():
    result = finalize_compare(
        document_quality=_verdict("LOW", "face_resolution_too_small"),
        selfie_quality=_verdict("HIGH", "ok"),
        document_face=ExplodingEmbeddingFace(),
        selfie_face=FakeFace(embedding=[1.0, 0.0]),
    )
    assert result["action"] == "NEEDS_REVIEW"
    assert result["match"] is False
    assert result["similarity"] is None
    assert result["confidence"] is None
    assert result["quality_document"] == "LOW"
    assert result["quality_selfie"] == "HIGH"
    assert result["reasons"] == {"document": "face_resolution_too_small", "selfie": "ok"}
    # ExplodingEmbeddingFace.embedding never raised -> embeddings never read.


def test_low_quality_on_either_side_is_needs_review():
    result = finalize_compare(
        document_quality=_verdict("HIGH", "ok"),
        selfie_quality=_verdict("LOW", "blurry"),
        document_face=FakeFace(embedding=[1.0]),
        selfie_face=None,
    )
    assert result["action"] == "NEEDS_REVIEW"
    assert result["match"] is False
    assert result["similarity"] is None


def test_identical_embeddings_match_high_confidence():
    result = finalize_compare(
        document_quality=_verdict("HIGH", "ok"),
        selfie_quality=_verdict("HIGH", "ok"),
        document_face=FakeFace(embedding=[1.0, 2.0, 3.0]),
        selfie_face=FakeFace(embedding=[1.0, 2.0, 3.0]),
    )
    assert result["action"] == "MATCHED"
    assert result["match"] is True
    assert result["similarity"] == pytest.approx(1.0)
    assert result["confidence"] == "high"
    assert result["quality_document"] == "HIGH"
    assert result["quality_selfie"] == "HIGH"


def test_orthogonal_embeddings_no_match():
    result = finalize_compare(
        document_quality=_verdict("HIGH", "ok"),
        selfie_quality=_verdict("HIGH", "ok"),
        document_face=FakeFace(embedding=[1.0, 0.0]),
        selfie_face=FakeFace(embedding=[0.0, 1.0]),
    )
    assert result["action"] == "NO_MATCH"
    assert result["match"] is False
    assert result["similarity"] == pytest.approx(0.0, abs=1e-12)
    assert result["confidence"] == "low"


def test_match_threshold_boundary():
    # The operational threshold is 0.72: exactly 0.72 -> MATCH, just below -> NO_MATCH.
    b_below = (0.71, math.sqrt(1.0 - 0.71 ** 2))
    b_at = (0.72, math.sqrt(1.0 - 0.72 ** 2))
    r1 = finalize_compare(
        document_quality=_verdict("HIGH", "ok"),
        selfie_quality=_verdict("HIGH", "ok"),
        document_face=FakeFace(embedding=[1.0, 0.0]),
        selfie_face=FakeFace(embedding=list(b_below)),
    )
    r2 = finalize_compare(
        document_quality=_verdict("HIGH", "ok"),
        selfie_quality=_verdict("HIGH", "ok"),
        document_face=FakeFace(embedding=[1.0, 0.0]),
        selfie_face=FakeFace(embedding=list(b_at)),
    )
    assert r1["match"] is False
    assert r1["action"] == "NO_MATCH"
    assert r2["match"] is True
    assert r2["action"] == "MATCHED"


def test_confidence_boundary():
    # cosine 0.59 -> confidence low; 0.60 -> high (default threshold).
    b_59 = (0.59, math.sqrt(1.0 - 0.59 ** 2))
    b_60 = (0.60, math.sqrt(1.0 - 0.60 ** 2))
    r1 = finalize_compare(
        document_quality=_verdict("HIGH", "ok"),
        selfie_quality=_verdict("HIGH", "ok"),
        document_face=FakeFace(embedding=[1.0, 0.0]),
        selfie_face=FakeFace(embedding=list(b_59)),
    )
    r2 = finalize_compare(
        document_quality=_verdict("HIGH", "ok"),
        selfie_quality=_verdict("HIGH", "ok"),
        document_face=FakeFace(embedding=[1.0, 0.0]),
        selfie_face=FakeFace(embedding=list(b_60)),
    )
    assert r1["confidence"] == "low"
    assert r2["confidence"] == "high"


def test_custom_match_threshold():
    result = finalize_compare(
        document_quality=_verdict("HIGH", "ok"),
        selfie_quality=_verdict("HIGH", "ok"),
        document_face=FakeFace(embedding=[1.0, 0.0]),
        selfie_face=FakeFace(embedding=[0.8, 0.6]),
        match_threshold=0.7,
    )
    assert result["similarity"] == pytest.approx(0.8)
    assert result["match"] is True
    result2 = finalize_compare(
        document_quality=_verdict("HIGH", "ok"),
        selfie_quality=_verdict("HIGH", "ok"),
        document_face=FakeFace(embedding=[1.0, 0.0]),
        selfie_face=FakeFace(embedding=[0.8, 0.6]),
        match_threshold=0.9,
    )
    assert result2["match"] is False


def test_missing_embedding_is_needs_review():
    result = finalize_compare(
        document_quality=_verdict("HIGH", "ok"),
        selfie_quality=_verdict("HIGH", "ok"),
        document_face=FakeFace(embedding=None),
        selfie_face=FakeFace(embedding=[1.0, 0.0]),
    )
    assert result["action"] == "NEEDS_REVIEW"
    assert result["match"] is False
    assert result["similarity"] is None
    assert result["reasons"]["document"] == "error"


def test_missing_face_is_needs_review():
    result = finalize_compare(
        document_quality=_verdict("HIGH", "ok"),
        selfie_quality=_verdict("HIGH", "ok"),
        document_face=None,
        selfie_face=FakeFace(embedding=[1.0, 0.0]),
    )
    assert result["action"] == "NEEDS_REVIEW"
    assert result["match"] is False
    assert result["reasons"]["document"] == "no_face"
