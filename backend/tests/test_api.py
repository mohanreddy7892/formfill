"""Routine API tests. They use the demo forms bundled in demo/forms, so they always run."""
import io

import pytest
from pypdf import PdfReader

from conftest import DEMO, upload

pytestmark = pytest.mark.skipif(not DEMO.is_dir(), reason="demo/forms missing from the repo")


def pdf_text(data: bytes) -> str:
    return "".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(data)).pages)


def test_health(client):
    assert client.get("/api/health").json() == {"ok": True}


def test_rejects_non_pdf(client):
    r = client.post("/api/forms", files={"file": ("x.pdf", b"hello", "application/pdf")})
    assert r.status_code == 400


def test_box_form_detect_map_fill(client):
    fid = upload(client, "1_box_style_kyc.pdf")["form_id"]
    runs = client.get(f"/api/forms/{fid}/detect").json()["pages"][0]["runs"]
    boxes = [r for r in runs if r["kind"] == "boxes"]
    ticks = [r for r in runs if r["kind"] == "checkbox"]
    assert len(boxes) == 9 and [t["label"] for t in ticks] == ["Male", "Female", "Other", "Single", "Married", "Other"]
    tpl = client.get(f"/api/forms/{fid}/template").json()
    tpl["fields"] = [
        {"id": "surname", "page": 0, "type": "boxes", "boxes": boxes[1]["boxes"]},
        {"id": "gender", "page": 0, "type": "choice",
         "options": [{"value": t["label"].upper(), "rect": t["boxes"][0]} for t in ticks[:3]]},
    ]
    assert client.put(f"/api/forms/{fid}/template", json=tpl).status_code == 200
    r = client.post(f"/api/forms/{fid}/fill", json={"values": {"surname": "VERMA", "gender": "FEMALE"}})
    assert r.status_code == 200 and r.content[:5] == b"%PDF-"
    text = pdf_text(r.content)
    assert all(ch in text for ch in "VERMA") and "X" in text        # letters and the tick really drawn


def test_fillable_pdf_imports_real_field_names(client):
    body = upload(client, "2_fillable_leave_application.pdf")
    tpl = client.get(f"/api/forms/{body['form_id']}/template").json()
    ids = [f["id"] for f in tpl["fields"]]
    assert "emp_name" in ids and "type_sick" in ids and not any(i.startswith("acro_") for i in ids)
    r = client.post(f"/api/forms/{body['form_id']}/fill", json={"values": {"emp_name": "Arjun Nair", "type_sick": True}})
    assert r.status_code == 200
    fields = PdfReader(io.BytesIO(r.content)).get_fields()
    assert fields["emp_name"]["/V"] == "Arjun Nair" and fields["type_sick"]["/V"] not in (None, "/Off")


def test_too_long_value_rejected(client):
    fid = upload(client, "1_box_style_kyc.pdf")["form_id"]
    run = next(r for r in client.get(f"/api/forms/{fid}/detect").json()["pages"][0]["runs"] if len(r["boxes"]) == 6)
    tpl = client.get(f"/api/forms/{fid}/template").json()
    tpl["fields"] = [{"id": "pin", "label": "Pin code", "page": 0, "type": "boxes", "boxes": run["boxes"]}]
    client.put(f"/api/forms/{fid}/template", json=tpl)
    r = client.post(f"/api/forms/{fid}/fill", json={"values": {"pin": "12345678"}})
    assert r.status_code == 422 and "Pin code" in r.json()["detail"]


# ---- issue 3: invalid mappings are rejected when saved -------------------------------------------
INVALID = {
    "text without rect": {"id": "a", "page": 0, "type": "text"},
    "page out of range": {"id": "b", "page": 99, "type": "text", "rect": [10, 10, 100, 20]},
    "inverted rect": {"id": "c", "page": 0, "type": "text", "rect": [100, 20, 10, 10]},
    "boxes without boxes": {"id": "d", "page": 0, "type": "boxes"},
    "choice without options": {"id": "e", "page": 0, "type": "choice"},
    "acro without name": {"id": "f", "page": 0, "type": "acro"},
    "rect off the page": {"id": "g", "page": 0, "type": "text", "rect": [10, 10, 5000, 20]},
    "rect with 3 numbers": {"id": "h", "page": 0, "type": "text", "rect": [10, 10, 100]},
    "negative page": {"id": "i", "page": -1, "type": "text", "rect": [10, 10, 100, 20]},
    "bad id": {"id": "Bad Id!", "page": 0, "type": "text", "rect": [10, 10, 100, 20]},
    "duplicate choice values": {"id": "j", "page": 0, "type": "choice", "options": [
        {"value": "YES", "rect": [10, 10, 20, 20]}, {"value": "yes", "rect": [30, 10, 40, 20]}]},
}


@pytest.mark.parametrize("case", INVALID, ids=list(INVALID))
def test_invalid_mapping_rejected_on_save(client, case):
    fid = upload(client, "3_line_style_travel_claim.pdf")["form_id"]
    tpl = client.get(f"/api/forms/{fid}/template").json()
    tpl["fields"] = [INVALID[case]]
    r = client.put(f"/api/forms/{fid}/template", json=tpl)
    assert r.status_code == 422, f"{case} was accepted"


def test_duplicate_ids_rejected(client):
    fid = upload(client, "3_line_style_travel_claim.pdf")["form_id"]
    tpl = client.get(f"/api/forms/{fid}/template").json()
    f = {"id": "same", "page": 0, "type": "text", "rect": [10, 10, 100, 20]}
    tpl["fields"] = [f, dict(f)]
    assert client.put(f"/api/forms/{fid}/template", json=tpl).status_code == 422


def test_invalid_stored_layout_gives_clear_error(client):
    import json
    from app import storage
    fid = upload(client, "3_line_style_travel_claim.pdf")["form_id"]
    p = storage.DATA / "templates" / f"{fid}.json"
    data = json.loads(p.read_text())
    data["fields"] = [{"id": "x", "page": 7, "type": "text", "rect": [1, 1, 50, 10]}]
    p.write_text(json.dumps(data))                         # simulate a layout saved before validation existed
    r = client.post(f"/api/forms/{fid}/fill", json={"values": {"x": "a"}})
    assert r.status_code == 409 and "Edit fields" in r.json()["detail"]


# ---- issue 5: single choice ------------------------------------------------------------------------
def test_single_choice_accepts_one_option_only(client):
    fid = upload(client, "1_box_style_kyc.pdf")["form_id"]
    ticks = [r for r in client.get(f"/api/forms/{fid}/detect").json()["pages"][0]["runs"] if r["kind"] == "checkbox"]
    opts = lambda ts: [{"value": t["label"].upper(), "rect": t["boxes"][0]} for t in ts]
    tpl = client.get(f"/api/forms/{fid}/template").json()
    tpl["fields"] = [{"id": "gender", "page": 0, "type": "choice", "options": opts(ticks[:3])},
                     {"id": "marital", "page": 0, "type": "choice", "multi": True, "options": opts(ticks[3:5])}]
    client.put(f"/api/forms/{fid}/template", json=tpl)
    bad = client.post(f"/api/forms/{fid}/fill", json={"values": {"gender": ["MALE", "FEMALE"]}})
    assert bad.status_code == 422 and "only one" in bad.json()["detail"]
    assert client.post(f"/api/forms/{fid}/fill", json={"values": {"gender": ["FEMALE"]}}).status_code == 200
    assert client.post(f"/api/forms/{fid}/fill", json={"values": {"marital": ["SINGLE", "MARRIED"]}}).status_code == 200
