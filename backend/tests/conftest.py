from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.main import app, reset_runtime_state_for_tests


@pytest.fixture(autouse=True)
def _reset_state():
    """Reset all global runtime state before each test."""
    reset_runtime_state_for_tests()
    yield
    reset_runtime_state_for_tests()


@pytest.fixture()
def client():
    """FastAPI TestClient with DB init mocked out (no PostgreSQL required)."""
    with patch("app.main.init_db"):
        with TestClient(app, raise_server_exceptions=False) as c:
            yield c
