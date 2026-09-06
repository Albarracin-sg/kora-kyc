"""API key guard tests for the face service.

Runs against the FastAPI app via TestClient. The analytics endpoints
(`/face/quality`, `/face/compare`) always require a configured X-API-Key;
`/health` never requires it.
"""
import pytest

pytest.importorskip("httpx")

from fastapi.testclient import TestClient
from app.config import get_settings
from app.main import app
from app.schemas import MAX_BASE64_IMAGE_CHARS

PROTECTED_ENDPOINTS = ("/face/quality", "/face/compare")
PUBLIC_DOCUMENTATION_ENDPOINTS = ("/docs", "/redoc", "/openapi.json")
PAYLOAD = {"document_face": "x", "selfie": "x"}


@pytest.fixture(autouse=True)
def _reset_settings_cache(monkeypatch):
    get_settings.cache_clear()
    monkeypatch.setattr("app.main.get_analyzer", lambda: None)
    yield
    get_settings.cache_clear()


def _request(
    client: TestClient,
    endpoint: str,
    headers: dict[str, str] | None = None,
    payload: object = PAYLOAD,
):
    return client.post(endpoint, json=payload, headers=headers)


def test_health_never_requires_api_key(monkeypatch):
    monkeypatch.setenv("FACE_API_KEY", "test-face-api-key")

    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_readiness_is_false_until_the_analyzer_is_preloaded(monkeypatch):
    monkeypatch.setattr("app.main.is_analyzer_ready", lambda: False)

    not_ready = TestClient(app).get("/ready")

    assert not_ready.status_code == 503
    assert not_ready.json() == {"status": "not_ready"}

    monkeypatch.setattr("app.main.is_analyzer_ready", lambda: True)
    ready = TestClient(app).get("/ready")

    assert ready.status_code == 200
    assert ready.json() == {"status": "ready"}


def test_startup_preloads_the_analyzer_before_serving(monkeypatch):
    preload_calls = []
    monkeypatch.setattr("app.main.preload_analyzer", lambda: preload_calls.append(True))

    with TestClient(app) as client:
        assert client.get("/health").status_code == 200

    assert preload_calls == [True]


@pytest.mark.parametrize("endpoint", PUBLIC_DOCUMENTATION_ENDPOINTS)
def test_public_documentation_endpoints_are_disabled(endpoint):
    response = TestClient(app).get(endpoint)

    assert response.status_code == 404


@pytest.mark.parametrize("endpoint", PROTECTED_ENDPOINTS)
@pytest.mark.parametrize("headers", [None, {"X-API-Key": "invalid-test-key"}])
def test_protected_endpoints_reject_missing_or_invalid_api_keys(monkeypatch, endpoint, headers):
    monkeypatch.setenv("FACE_API_KEY", "test-face-api-key")

    response = _request(TestClient(app), endpoint, headers)
    assert response.status_code == 401


@pytest.mark.parametrize("endpoint", PROTECTED_ENDPOINTS)
def test_protected_endpoints_accept_the_configured_api_key(monkeypatch, endpoint):
    monkeypatch.setenv("FACE_API_KEY", "test-face-api-key")

    response = _request(
        TestClient(app),
        endpoint,
        headers={"X-API-Key": "test-face-api-key"},
    )

    # The guard passes; the endpoint then fails closed on invalid test images.
    assert response.status_code == 200


@pytest.mark.parametrize("endpoint", PROTECTED_ENDPOINTS)
def test_protected_endpoints_fail_safely_when_api_key_is_unset(monkeypatch, endpoint):
    monkeypatch.delenv("FACE_API_KEY", raising=False)

    response = _request(TestClient(app), endpoint)
    assert response.status_code == 503


def test_blank_api_key_fails_safely(monkeypatch):
    monkeypatch.setenv("FACE_API_KEY", "   ")

    response = _request(TestClient(app), "/face/quality")
    assert response.status_code == 503


@pytest.mark.parametrize("endpoint", PROTECTED_ENDPOINTS)
@pytest.mark.parametrize(
    "payload",
    [
        {
            "document_face": "c2Vuc2l0aXZlLWJhc2U2NC1tYXJrZXI="
            + "A" * MAX_BASE64_IMAGE_CHARS,
            "selfie": "x",
        },
        {
            "document_face": ["c2Vuc2l0aXZlLXBpaS1tYXJrZXI="],
            "selfie": "x",
        },
    ],
    ids=["overlong-base64", "malformed-field"],
)
def test_validation_errors_are_generic_and_never_echo_payload(monkeypatch, endpoint, payload):
    monkeypatch.setenv("FACE_API_KEY", "test-face-api-key")

    response = _request(
        TestClient(app),
        endpoint,
        headers={"X-API-Key": "test-face-api-key"},
        payload=payload,
    )

    assert response.status_code == 422
    assert response.json() == {"detail": "invalid request payload"}
    assert "c2Vuc2l0aXZl" not in response.text


@pytest.mark.parametrize("endpoint", PROTECTED_ENDPOINTS)
def test_invalid_api_key_still_returns_401_for_invalid_payload(monkeypatch, endpoint):
    monkeypatch.setenv("FACE_API_KEY", "test-face-api-key")

    response = _request(
        TestClient(app),
        endpoint,
        headers={"X-API-Key": "invalid-test-key"},
        payload={"document_face": ["c2Vuc2l0aXZlLXBpaS1tYXJrZXI="], "selfie": "x"},
    )

    assert response.status_code == 401
