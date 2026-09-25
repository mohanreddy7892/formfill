"""Tests that need the real Medi Assist PDF (not bundled). Skipped - visibly - unless TEST_FORM is set."""
from conftest import MEDI_ASSIST, needs_medi_assist


@needs_medi_assist
def test_seed_template_matches_and_fills(client):
    import json
    from pathlib import Path
    with open(MEDI_ASSIST, "rb") as f:
        body = client.post("/api/forms", files={"file": ("claim.pdf", f, "application/pdf")}).json()
    assert body["matched_seed"] and body["fields"] == 163
    values = json.loads((Path(__file__).parent / "sample_values.json").read_text())
    r = client.post(f"/api/forms/{body['form_id']}/fill", json={"values": values})
    assert r.status_code == 200 and r.content[:5] == b"%PDF-"


@needs_medi_assist
def test_seed_checkbox_labels(client):
    with open(MEDI_ASSIST, "rb") as f:
        fid = client.post("/api/forms", files={"file": ("claim.pdf", f, "application/pdf")}).json()["form_id"]
    runs = client.get(f"/api/forms/{fid}/detect").json()["pages"][1]["runs"]
    labels = [r["label"] for r in runs if r["kind"] == "checkbox"][:8]
    assert labels == ["Yes", "No", "Yes", "No", "Yes", "No", "Male", "Female"]
