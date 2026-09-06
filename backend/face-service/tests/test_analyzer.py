"""Analyzer construction: verifies get_analyzer builds the InsightFace
pipeline with the configured model root.

The InsightFace import is stubbed out so no weights are ever downloaded
and this runs without insightface installed.
"""
import os
import sys
import types

import pytest

import app.face_service as fs
from app.config import get_settings
from app.face_service import analyzer_failure_reason, is_analyzer_ready


def _stub_insightface(monkeypatch, fake_analyzer):
    """Replace `insightface.app` with a fake module in sys.modules."""
    fake_app = types.ModuleType("insightface.app")
    fake_app.FaceAnalysis = fake_analyzer
    fake_pkg = types.ModuleType("insightface")
    fake_pkg.__path__ = []  # mark as a package so submodule import works
    monkeypatch.setitem(sys.modules, "insightface", fake_pkg)
    monkeypatch.setitem(sys.modules, "insightface.app", fake_app)


@pytest.fixture(autouse=True)
def _reset_analyzer():
    fs._analyzer = None
    fs._analyzer_initialization_error = None
    yield
    fs._analyzer = None
    fs._analyzer_initialization_error = None


def test_settings_expands_the_default_model_root(monkeypatch):
    monkeypatch.delenv("INSIGHTFACE_ROOT", raising=False)
    get_settings.cache_clear()

    try:
        assert get_settings().model_root == os.path.expanduser("~/.insightface")
    finally:
        get_settings.cache_clear()


def test_get_analyzer_passes_model_root(monkeypatch):
    created = {}

    class FakeAnalyzer:
        def __init__(self, **kwargs):
            created.update(kwargs)
            self.prepared = None

        def prepare(self, ctx_id, det_size):
            self.prepared = (ctx_id, det_size)

    _stub_insightface(monkeypatch, FakeAnalyzer)

    settings = types.SimpleNamespace(
        model_name="buffalo_l",
        det_size=(640, 640),
        model_root="/expected/models/root",
    )
    monkeypatch.setattr(fs, "get_settings", lambda: settings)

    analyzer = fs.get_analyzer()

    assert created.get("root") == "/expected/models/root"
    assert created.get("name") == "buffalo_l"
    assert analyzer.prepared == (0, (640, 640))


def test_get_analyzer_is_cached(monkeypatch):
    created = []

    class FakeAnalyzer:
        def __init__(self, **kwargs):
            created.append(kwargs)

        def prepare(self, ctx_id, det_size):
            pass

    _stub_insightface(monkeypatch, FakeAnalyzer)

    settings = types.SimpleNamespace(
        model_name="buffalo_l",
        det_size=(640, 640),
        model_root="/some/root",
    )
    monkeypatch.setattr(fs, "get_settings", lambda: settings)

    first = fs.get_analyzer()
    second = fs.get_analyzer()

    assert first is second
    assert len(created) == 1


def test_preload_analyzer_marks_the_service_ready_after_success(monkeypatch):
    created = []

    def build_analyzer():
        created.append(object())
        return created[-1]

    monkeypatch.setattr(fs, "_build_analyzer", build_analyzer)

    analyzer = fs.preload_analyzer()

    assert analyzer is created[0]
    assert is_analyzer_ready() is True
    assert fs.preload_analyzer() is analyzer
    assert len(created) == 1


def test_failed_preload_keeps_readiness_false_without_reinitializing(monkeypatch):
    attempts = 0

    def build_analyzer():
        nonlocal attempts
        attempts += 1
        raise RuntimeError("synthetic model initialization failure")

    monkeypatch.setattr(fs, "_build_analyzer", build_analyzer)

    with pytest.raises(RuntimeError, match="initialization failed"):
        fs.preload_analyzer()
    with pytest.raises(RuntimeError, match="previously failed"):
        fs.preload_analyzer()

    assert attempts == 1
    assert is_analyzer_ready() is False
    assert analyzer_failure_reason() == "InsightFace analyzer initialization failed"
