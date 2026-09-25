"""Computed fields, cross-field checks, offline bill reading and the claim pack."""
import io
import json
import shutil
from pathlib import Path

import pytest
from pypdf import PdfReader

from app.models import Template
from app.rules import check, computed_values
from conftest import DEMO, upload

FIX = Path(__file__).parent / "fixtures"
SEED = json.loads((Path(__file__).parents[1] / "seed" / "medi_assist_reimbursement.json").read_text())
PAGES = [{"width": 612, "height": 792}] + [{"width": 595.28, "height": 841.89}] * 4
needs_ocr = pytest.mark.skipif(not shutil.which("tesseract"), reason="Tesseract OCR not installed")


@pytest.fixture(scope="module")
def seed_tpl():
    return Template(form_id="x", name=SEED["name"], fingerprint=SEED["fingerprint"], pages=PAGES, fields=SEED["fields"],
                    rules=SEED["rules"], tables=SEED["tables"], patient_name=SEED["patient_name"])


BASE = {"pat_surname": "SHARMA", "pat_first": "ANANYA", "pat_dob_dd": "06", "pat_dob_mm": "11", "pat_dob_yyyy": "2024",
        "detected_dd": "23", "detected_mm": "08", "detected_yyyy": "2026", "adm_dd": "31", "adm_mm": "08", "adm_yy": "26",
        "dis_dd": "02", "dis_mm": "09", "dis_yy": "26", "hosp_amt": "12380"}


def test_computed_values_match_a_real_claim(seed_tpl):
    c = computed_values(seed_tpl, BASE)
    assert (c["total_amt"], c["pat_age_years"], c["pat_age_months"], c["pre_hosp_days"]) == ("12380", "01", "09", "08")
    assert c["b_pat_first"] == "ANANYA" and c["b_total_amt"] == "12380" and c["b_adm_dd"] == "31"


def test_typed_values_are_never_overridden(seed_tpl):
    c = computed_values(seed_tpl, {**BASE, "total_amt": "99999", "b_pat_first": "OTHER"})
    assert "total_amt" not in c and "b_pat_first" not in c


def test_checks_catch_real_mistakes(seed_tpl):
    msgs = lambda v: {i["severity"] + ":" + i["message"] for i in check(seed_tpl, v)}
    wrong_total = msgs({**BASE, "total_amt": "12000"})
    assert any(m.startswith("error:Total must equal") for m in wrong_total)
    backwards = msgs({**BASE, "dis_dd": "29", "dis_mm": "08"})
    assert any(m.startswith("error:Discharge date") for m in backwards)
    old_bill = msgs({**BASE, "bill4_date": "150626", "bill4_amount": "100"})
    assert any("Bill date is outside" in m for m in old_bill)
    bills_short = msgs({**BASE, "bill1_amount": "5500"})
    assert any("add up to the total" in m for m in bills_short)
    name_diff = msgs({**BASE, "b_pat_first": "ANANAYA"})
    assert any("first name differs" in m for m in name_diff)


def test_checks_stay_quiet_on_consistent_claim(seed_tpl):
    ok = {**BASE, **{f"bill{n}_amount": a for n, a in [(1, "5500"), (4, "2644"), (5, "688"), (6, "952"), (7, "796"), (8, "850"), (9, "950")]},
          "bill1_date": "020926", "bill4_date": "310826", "tpa_id": "5100012345", "ins_surname": "SHARMA",
          "hospital_name": "CITY CARE", "account_no": "123456789012", "ifsc": "SBIN0001234"}
    assert check(seed_tpl, ok) == []


def test_error_rules_block_fill_warnings_do_not(client):
    fid = upload(client, "1_box_style_kyc.pdf")["form_id"]
    runs = [r for r in client.get(f"/api/forms/{fid}/detect").json()["pages"][0]["runs"] if r["kind"] == "boxes"]
    tpl = client.get(f"/api/forms/{fid}/template").json()
    a, b, t = runs[7]["boxes"][:4], runs[8]["boxes"][:4], runs[6]["boxes"][:6]
    tpl["fields"] = [{"id": "a", "page": 0, "type": "boxes", "boxes": a}, {"id": "b", "page": 0, "type": "boxes", "boxes": b},
                     {"id": "total", "page": 0, "type": "boxes", "boxes": t, "compute": {"kind": "sum", "of": ["a", "b"]}}]
    tpl["rules"] = [{"kind": "equals_sum", "severity": "error", "target": "total", "of": ["a", "b"], "message": "Total wrong"},
                    {"kind": "required", "of": ["a"], "message": "Still empty"}]
    assert client.put(f"/api/forms/{fid}/template", json=tpl).status_code == 200
    r = client.post(f"/api/forms/{fid}/check", json={"values": {"a": "12", "b": "30"}}).json()
    assert r["computed"] == {"total": "42"} and r["issues"] == []
    assert client.post(f"/api/forms/{fid}/fill", json={"values": {"a": "12", "b": "30"}}).status_code == 200   # total auto-filled
    bad = client.post(f"/api/forms/{fid}/fill", json={"values": {"a": "12", "b": "30", "total": "50"}})
    assert bad.status_code == 422 and "Total wrong" in bad.json()["detail"]
    assert client.post(f"/api/forms/{fid}/fill", json={"values": {"b": "30"}}).status_code == 200            # warning only


def test_rules_must_reference_real_fields(client):
    fid = upload(client, "3_line_style_travel_claim.pdf")["form_id"]
    tpl = client.get(f"/api/forms/{fid}/template").json()
    tpl["fields"] = [{"id": "a", "page": 0, "type": "text", "rect": [10, 10, 100, 20]}]
    tpl["rules"] = [{"kind": "required", "of": ["nope"], "message": "x"}]
    assert client.put(f"/api/forms/{fid}/template", json=tpl).status_code == 422
    tpl["rules"] = []
    tpl["fields"][0]["compute"] = {"kind": "copy", "source": "a"}
    assert client.put(f"/api/forms/{fid}/template", json=tpl).status_code == 422          # computed from itself


@needs_ocr
@pytest.mark.parametrize("name", ["pharmacy_scan.png", "pharmacy_photo.jpg"])
def test_scan_reads_pharmacy_bill_even_from_a_photo(client, name):
    with open(FIX / name, "rb") as f:
        r = client.post("/api/scan", files=[("files", (name, f, "image/jpeg"))], data={"names": json.dumps(["SHARMA ANANYA"])})
    item = r.json()["results"][0]
    assert item["category"] == "pharmacy_bill" and item["method"] == "ocr"
    b = item["bill"]
    assert (b["bill_no"], b["date"], b["amount"], b["issuer"]) == ("PH 3342", "2026-08-14", 1400, "CARE MEDICALS")
    # Fixture prints S.ANANYA: an initial cannot verify the full surname SHARMA.
    assert item["names"]["status"] == "not_found"
    assert item["names"]["missing"] == ["SHARMA"]


def test_scan_reads_text_pdf_without_ocr(client):
    with open(FIX / "lab_bill.pdf", "rb") as f:
        item = client.post("/api/scan", files=[("files", ("lab.pdf", f, "application/pdf"))]).json()["results"][0]
    assert item["method"] == "pdf-text" and item["category"] == "lab_bill"
    assert (item["bill"]["bill_no"], item["bill"]["amount"], item["bill"]["date"]) == ("LB-0456", 1800, "2026-08-12")


@needs_ocr
def test_scan_flags_misspelt_patient_name(client):
    with open(FIX / "lab_report.png", "rb") as f:
        item = client.post("/api/scan", files=[("files", ("r.png", f, "image/png"))],
                           data={"names": json.dumps(["SHARMA ANANYA"])}).json()["results"][0]
    assert item["category"] == "investigation_report"
    assert item["names"] == {"status": "not_found", "missing": ["SHARMA"], "variants": [{"expected": "ANANYA", "found": "ANANAYA"}]}


def test_scan_rejects_non_documents(client):
    r = client.post("/api/scan", files=[("files", ("x.exe", b"MZ\x90\x00", "application/octet-stream"))])
    assert r.status_code == 400


def test_claim_pack_orders_documents_and_reports_gaps(client):
    fid = upload(client, "2_fillable_leave_application.pdf")["form_id"]
    files = [("files", ("report.png", (FIX / "lab_report.png").read_bytes(), "image/png")),
             ("files", ("bill.jpg", (FIX / "pharmacy_photo.jpg").read_bytes(), "image/jpeg")),
             ("files", ("lab.pdf", (FIX / "lab_bill.pdf").read_bytes(), "application/pdf"))]
    r = client.post(f"/api/forms/{fid}/pack", files=files, data={
        "categories": json.dumps(["investigation_report", "pharmacy_bill", "lab_bill"]),
        "values": json.dumps({"emp_name": "Arjun Nair"})})
    assert r.status_code == 200 and r.content[:5] == b"%PDF-"
    rep = json.loads(r.headers["X-FormFill-Report"])
    pdf = PdfReader(io.BytesIO(r.content))
    assert rep["pages"] == len(pdf.pages) == 1 + 1 + 3                       # index + form + 3 documents
    assert "Cancelled cheque" in rep["missing"] and "Claim form" not in rep["missing"]
    index = pdf.pages[0].extract_text()
    assert index.index("Pharmacy bills") < index.index("Investigation bills") < index.index("Investigation reports")
    assert f"Page {rep['pages']} of {rep['pages']}" in pdf.pages[-1].extract_text()


def test_claim_pack_needs_one_category_per_file(client):
    fid = upload(client, "2_fillable_leave_application.pdf")["form_id"]
    r = client.post(f"/api/forms/{fid}/pack", files=[("files", ("a.pdf", (FIX / "lab_bill.pdf").read_bytes(), "application/pdf"))],
                    data={"categories": "[]", "values": "{}"})
    assert r.status_code == 400
