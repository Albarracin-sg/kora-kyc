"""Pytest bootstrap: makes the project root importable.

Supported natively by the `pythonpath = ["."]` option in pyproject.toml
(pytest >= 7); kept as a belt-and-braces fallback for older pytest.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))