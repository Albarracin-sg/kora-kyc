#!/usr/bin/env bash
# Render build script for the Koa face service.
#
# Installs the runtime requirements and pre-downloads the InsightFace
# model weights so the first request does not pay the download cost.
#
# Usage:
#   ./build.sh [MODEL_NAME]
#
# MODEL_NAME defaults to $INSIGHTFACE_MODEL or `buffalo_sc`.
# Model weights land in $INSIGHTFACE_ROOT or Render's service workspace.
set -euo pipefail

python -m pip install --upgrade pip
python -m pip install -r requirements.txt

MODEL="${1:-${INSIGHTFACE_MODEL:-buffalo_sc}}"
ROOT="${INSIGHTFACE_ROOT:-$PWD/.insightface}"
mkdir -p "$ROOT"

python - "$MODEL" "$ROOT" <<'PY'
import sys

from insightface.app import FaceAnalysis

model = sys.argv[1]
root = sys.argv[2]

# Same construction path as app/face_service.get_analyzer(); download=True
# triggers the weights download during the build instead of at request time.
analyzer = FaceAnalysis(name=model, root=root, download=True)
analyzer.prepare(ctx_id=0, det_size=(640, 640))
PY
