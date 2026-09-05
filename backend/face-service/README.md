# Koa Face Service

Standalone facial comparison service for KYC identity verification.

**Scope (closed by decision):** FastAPI + InsightFace/ArcFace (SCRFD
detector + ArcFace embeddings), cosine-similarity comparison, and a
pre-comparison **quality gate** that flags small (<100 px wide) or blurry
faces as `LOW` / `NEEDS_REVIEW`. Nothing else.

- The document OCR pipeline is untouched (it stays in the NestJS backend).
- The NestJS backend can select this service explicitly over HTTP (see
  [Integración NestJS](#integración-nestjs)) - always an opt-in, never a fallback.
- Fail-closed: a degraded input can never approve a match.
- PII-safe: images travel as **base64 payloads, never URLs**, and no
  image, embedding or base64 content is ever logged or persisted.

## Layout

```
backend/face-service/
├── pyproject.toml        # pytest configuration only
├── requirements.txt      # runtime dependencies
├── requirements-dev.txt  # test dependencies (pytest)
├── README.md
├── app/
│   ├── __init__.py
│   ├── config.py         # env-based settings (documented defaults)
│   ├── schemas.py        # pydantic request/response models
│   ├── quality.py        # quality gate: rules + blur metric + base64 decode
│   ├── face_service.py   # cosine similarity, best-face selection, compare flow
│   └── main.py           # FastAPI app (thin HTTP layer)
├── conftest.py           # pytest bootstrap
└── tests/
    ├── test_quality.py
    ├── test_face.py
    └── test_smoke_optional.py
```

## Install

Python 3.9+ (tested on 3.13):

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt      # runtime stack
pip install -r requirements-dev.txt  # pytest
```

The unit tests are dependency-light by design (mocked model, no weights):
installing only `pytest` is enough to run them, even on a machine where
`insightface`/`onnxruntime` cannot be installed.

> The InsightFace `buffalo_l` model weights are downloaded **the first
> time a request runs** (into `~/.insightface/models`), never at import
> and never during tests.

# Run

```bash
cd backend/face-service
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## Integration with the NestJS backend

The backend selects the face verification provider explicitly through
environment configuration. Selecting `face_service` routes the facial
verification of every KYC job to this service over HTTP; the default
remains `local` (Human/TFJS, in-process). These are explicit selections
only - there is no automatic routing and no fallback.

| Backend variable             | Default                | Meaning                                                        |
| ---------------------------- | ---------------------- | -------------------------------------------------------------- |
| `FACE_VERIFICATION_PROVIDER` | `local`                | `local` or `face_service` (this service)                       |
| `FACE_SERVICE_URL`           | `http://localhost:8000` | Base URL of this service                                       |
| `FACE_SERVICE_TIMEOUT_MS`    | `30000`                | Per-request timeout, bounded to 1000-120000 ms                 |

Run both without Docker:

```bash
# terminal 1 - face service
cd backend/face-service
source .venv/bin/activate
uvicorn app.main:app --host 127.0.0.1 --port 8000

# terminal 2 - backend
cd backend
FACE_VERIFICATION_PROVIDER=face_service pnpm start:dev
```

The backend calls `POST /face/quality` first and, only when both verdicts
are `HIGH`, `POST /face/compare` with the same base64 JSON payload. It maps
`match`/`similarity` straight into the facial result (`distance = 1 -
similarity`, matching the cosine semantics of this service) and fails
closed on every degraded path: `LOW` quality, `NEEDS_REVIEW` verdicts,
HTTP errors, timeouts, and malformed or out-of-schema payloads are
surfaced as face capture failures - a verification is never approved by
degradation.

## Configuration (environment variables)

| Variable                         | Default    | Meaning                                                              |
| -------------------------------- | ---------- | -------------------------------------------------------------------- |
| `FACE_MATCH_THRESHOLD`           | `0.40`     | Cosine similarity at or above which faces match (calibrated for buffalo_l) |
| `FACE_HIGH_CONFIDENCE_THRESHOLD` | `0.60`     | Similarity at or above which `confidence` is `high`                  |
| `FACE_BLUR_THRESHOLD`            | `25.0`     | Laplacian-variance floor; below it the image is `blurry`             |
| `FACE_MIN_WIDTH_PX`              | `100`      | Minimum face width in px; strictly below is `face_resolution_too_small` |
| `FACE_DET_SIZE`                  | `640,640`  | SCRFD detection resolution (`W,H`)                                   |
| `INSIGHTFACE_MODEL`              | `buffalo_l`| InsightFace model zoo name                                           |

## API

Transport is JSON; images are **base64 strings** (never URLs, for PII
privacy). Payloads are capped at 15 MB decoded.

### `GET /health`

```json
{ "status": "ok" }
```

### `POST /face/quality`

Request:

```json
{
  "document_face": "<base64 of the ID portrait>",
  "selfie": "<base64 of the selfie>"
}
```

Response - one verdict per image, keyed by field name:

```json
{
  "document": { "quality": "LOW", "reason": "face_resolution_too_small",
                "face_width_px": 95, "laplacian_variance": 188.4,
                "action": "NEEDS_REVIEW" },
  "selfie":   { "quality": "HIGH", "reason": "ok",
                "face_width_px": 240, "laplacian_variance": 92.1,
                "action": "OK" }
}
```

Reasons: `ok` | `face_resolution_too_small` | `blurry` | `no_face` | `error`.

Rules, checked in order:

1. No detectable face -> `no_face` / `LOW`.
2. Face width strictly below `FACE_MIN_WIDTH_PX` -> `face_resolution_too_small`.
3. Laplacian variance below `FACE_BLUR_THRESHOLD` (or not computable) -> `blurry` (fail-closed).
4. Otherwise -> `HIGH` / `OK`.

### `POST /face/compare`

Request: same shape as `/face/quality`.

Response:

```json
{
  "match": false,
  "similarity": null,
  "confidence": null,
  "quality_document": "LOW",
  "quality_selfie": "HIGH",
  "action": "NEEDS_REVIEW",
  "reasons": { "document": "face_resolution_too_small", "selfie": "ok" }
}
```

Flow: the quality gate runs **first**. If either image is `LOW`, the
embeddings are never computed or compared and the result is
`NEEDS_REVIEW` (fail-closed). Only when both are `HIGH`:

- Best face per image (highest detection score) -> ArcFace embedding.
- `similarity` = cosine similarity; `match` = `similarity >= FACE_MATCH_THRESHOLD`.
- `confidence` = `high` if `similarity >= FACE_HIGH_CONFIDENCE_THRESHOLD`, else `low`.
- `action` = `MATCHED` | `NO_MATCH`.

Example:

```bash
curl -s -X POST http://localhost:8000/face/compare \
  -H "Content-Type: application/json" \
  -d '{"document_face": "<base64>", "selfie": "<base64>"}'
```

## Errors

Request-time failures never leak content and never approve: they return
HTTP 200 with `action: "NEEDS_REVIEW"` and `reason: "error"`
(fail-closed). Only health/config failures (e.g. `insightface` missing)
surface as errors.

## Tests

```bash
pytest        # mocked model, no weights, no network
```

## Limitations

- Single best face per image; multi-face handling is out of scope.
- No auth, TLS termination or rate limiting (expected to be fronted by
  the NestJS backend when wired in).
- `FaceAnalysis.prepare(ctx_id=0)` uses the default InsightFace backend
  (onnxruntime; CPU when no GPU is available).