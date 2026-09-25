"""TypeLLM engine: schema validated by TypeLLM's own compiler; behaviour tested with a stand-in client
(the real model needs a GPU + SGLang server, which CI does not have)."""
import json
from pathlib import Path

import pytest

from app import extract
from conftest import upload

FIX = Path(__file__).parent / "fixtures"
BILL_TEXT = "TAX INVOICE\nCARE MEDICALS\nTo : S.ANANYA  BILL NO : PH 3342\nBILL DATE : 14-Aug-26\nNet Amount : 1,400.00"


def test_questions_compile_with_real_typellm():
    schema = pytest.importorskip("typellm.schema")
    decisions = schema.compile_json_schema({"type": "object", "properties": extract.QUESTIONS})
    assert [d.name for d in decisions] == list(extract.QUESTIONS)
    assert len(extract.QUESTIONS["category"]["enum"]) <= schema.MAX_ENUM_CHOICES


class FakeClient:
    """Mimics TypeLLMClient.generate: typed values, probabilities where opted in."""
    def __init__(self, answer=None, fail=None):
        self.answer, self.fail, self.calls = answer, fail, []

    def generate(self, *, context, questions, images=None, execution="auto"):
        self.calls.append({"context": context, "images": images, "questions": list(questions)})
        if self.fail:
            raise self.fail
        return self.answer


def eng(answer=None, fail=None, vision=True):
    return extract.TypeLLMEngine("http://gpu:30000", "Qwen/Qwen3.5-9B", vision=vision, client=FakeClient(answer, fail))


GOOD = {"category": {"value": "pharmacy_bill", "probabilities": {"pharmacy_bill": 0.96, "lab_bill": 0.04}},
        "bill_no": "PH 3342", "bill_date": "14-08-2026", "amount": 1400.0, "issuer": "CARE MEDICALS",
        "patient": "S.ANANYA", "kind": "pharmacy"}


def test_agreeing_answers_need_no_review():
    r = extract.extract(BILL_TEXT, "bill.jpg", b"\xff\xd8\xff...", eng(GOOD))
    assert r["engine"] == "typellm" and r["review"] == []
    assert (r["category"], r["bill_no"], r["date"], r["amount"]) == ("pharmacy_bill", "PH 3342", "2026-08-14", 1400)
    assert r["category_confidence"] == 0.96


def test_disagreement_is_flagged_for_review():
    r = extract.extract(BILL_TEXT, "bill.jpg", b"\xff\xd8\xff", eng({**GOOD, "amount": 1460.0, "bill_no": "PH 3343"}))
    assert r["amount"] == 1460 and set(r["review"]) == {"amount", "bill_no"}


def test_null_answers_fall_back_to_rules_values():
    r = extract.extract(BILL_TEXT, "bill.pdf", b"%PDF-", eng({**GOOD, "bill_no": None, "bill_date": None, "amount": None}))
    assert (r["bill_no"], r["date"], r["amount"]) == ("PH 3342", "2026-08-14", 1400)     # from the rules engine
    assert r["review"] == []


def test_invalid_values_are_ignored_not_trusted():
    r = extract.extract(BILL_TEXT, "b.pdf", b"%PDF-", eng({**GOOD, "category": "banana", "amount": -5, "bill_date": "31-02-2026", "kind": "x"}))
    assert r["category"] == "pharmacy_bill" and r["amount"] == 1400 and r["date"] == "2026-08-14" and r["kind"] == "pharmacy"


def test_server_failure_falls_back_to_rules():
    r = extract.extract(BILL_TEXT, "bill.jpg", b"\xff\xd8\xff", eng(fail=TimeoutError("GPU busy")))
    assert r["engine"] == "rules" and r["amount"] == 1400 and "unavailable" in r["engine_note"]


def test_images_sent_only_for_photos_and_only_with_vision():
    e = eng(GOOD); extract.extract(BILL_TEXT, "a.jpg", b"\xff\xd8\xff", e)
    assert e.client.calls[-1]["images"] == [b"\xff\xd8\xff"]
    extract.extract(BILL_TEXT, "a.pdf", b"%PDF-", e)
    assert e.client.calls[-1]["images"] is None
    e2 = eng(GOOD, vision=False); extract.extract(BILL_TEXT, "a.jpg", b"\xff\xd8\xff", e2)
    assert e2.client.calls[-1]["images"] is None
    assert "PH 3342" in e.client.calls[-1]["context"]                                   # OCR text goes in the context


def test_no_typellm_configured_means_rules(monkeypatch):
    monkeypatch.delenv("TYPELLM_URL", raising=False)
    assert extract.engine() is None and extract.engine_status()["engine"] == "rules"


def test_scan_api_uses_typellm_and_reports_review(client, monkeypatch):
    monkeypatch.setattr(extract, "engine", lambda: eng({**GOOD, "amount": 1460.0}))
    with open(FIX / "pharmacy_scan.png", "rb") as f:
        item = client.post("/api/scan", files=[("files", ("b.png", f, "image/png"))]).json()["results"][0]
    assert item["engine"] == "typellm" and item["bill"]["amount"] == 1460 and item["bill"]["review"] == ["amount"]
