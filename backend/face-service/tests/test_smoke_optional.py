"""Optional smoke checks - never download model weights.

These tests skip with an explanatory reason when the optional runtime
dependencies are not installed, so the suite stays green either way.
"""
import sys

import pytest


def test_insightface_importable_when_installed():
    """Real smoke test: import insightface without loading any weights.

    `FaceAnalysis` lives in the `insightface.app` submodule (not the
    package top level); importing it must never download weights.
    """
    try:
        from insightface.app import FaceAnalysis  # noqa: F401
    except ImportError:
        pytest.skip(
            "insightface is not installed here; install requirements.txt to "
            "run the real smoke test (no weights are downloaded by importing)"
        )


def test_app_import_does_not_load_insightface():
    """The app must stay lazy: importing it never pulls insightface in.

    Runs in a fresh subprocess so the check is independent of test order
    (other tests may already have imported insightface in this process).
    """
    pytest.importorskip("fastapi")
    import subprocess
    import sys
    import textwrap
    from pathlib import Path

    code = textwrap.dedent(
        """
        import sys
        import app.main  # noqa: F401
        assert "insightface" not in sys.modules, "app.main imported insightface at import time"
        print("lazy-ok")
        """
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        cwd=str(Path(__file__).resolve().parents[1]),
    )
    assert result.returncode == 0, result.stderr
    assert "lazy-ok" in result.stdout