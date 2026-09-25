import os
import tempfile
from pathlib import Path

import pytest

# Isolated storage for the whole test session (must be set before the app is imported).
os.environ["FORMFILL_DATA"] = tempfile.mkdtemp(prefix="formfill-test-")
os.environ.pop("FORMFILL_TOKEN", None)

from fastapi.testclient import TestClient  # noqa: E402
import app.main as main  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
DEMO = REPO / "demo" / "forms"
MEDI_ASSIST = os.environ.get("TEST_FORM")      # optional external fixture: blank Medi Assist claim form


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main, "APP_TOKEN", None)
    return TestClient(main.app)


@pytest.fixture
def token_client(monkeypatch):
    monkeypatch.setattr(main, "APP_TOKEN", "test-token")
    return TestClient(main.app)


def upload(c, name, headers=None):
    with open(DEMO / name, "rb") as f:
        r = c.post("/api/forms", files={"file": (name, f, "application/pdf")}, headers=headers or {})
    assert r.status_code == 200, r.text
    return r.json()


needs_medi_assist = pytest.mark.skipif(
    not MEDI_ASSIST or not Path(MEDI_ASSIST).is_file(),
    reason="set TEST_FORM=/path/to/Medi_Assist_Reimbursement_Claim_Form_BLANK.pdf to run",
)
