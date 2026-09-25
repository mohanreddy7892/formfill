"""Document understanding engines.

* "rules"   - built-in heuristics over OCR text (always available, CPU only).
* "typellm" - TypeLLM type-safe decoding on a self-hosted SGLang model (optional, needs a GPU server).
              It sees the OCR text AND, for photos, the image itself; answers are guaranteed to have the
              declared type, choices stay inside the allowed list, and "not printed" comes back as null.

The TypeLLM result is always cross-checked against the rules result: where both found a value and they
disagree, the field is flagged for the person to review. Any TypeLLM failure falls back to "rules".

Environment:
  TYPELLM_URL      SGLang server, e.g. http://gpu-box:30000   (unset = rules only)
  TYPELLM_MODEL    model id served by SGLang, e.g. Qwen/Qwen3.5-9B
  TYPELLM_VISION   "1" to also send photos to a vision-capable model (default 1)
  TYPELLM_TIMEOUT  seconds per document (default 60)
"""
from __future__ import annotations

import logging
import os
import re
from datetime import date

from . import ocr

log = logging.getLogger("formfill.extract")
KINDS = ["pharmacy", "lab", "hospital", "other"]
IMAGE_SIGS = (b"\x89PNG", b"\xff\xd8\xff", b"GIF8", b"BM", b"RIFF")

# Ordered questions; independent, so TypeLLM can batch them over one shared (prefix-cached) context.
QUESTIONS = {
    "category": {
        "type": "string", "enum": ocr.CATEGORY_IDS, "return_probabilities": True,
        "instructions": "Which kind of document is this? claim_form, intimation (claim intimation email/letter), "
                        "ecard (health insurance card), id_proof (Aadhaar/PAN/passport), discharge_summary, "
                        "hospital_bill (hospital main or cash bill/receipt), pharmacy_bill, lab_bill (bill for tests), "
                        "investigation_report (test results), prescription, cheque, or other.",
    },
    "bill_no": {"type": ["string", "null"], "maxLength": 30,
                "instructions": "Bill, invoice or receipt number exactly as printed. null if none is printed."},
    "bill_date": {"type": ["string", "null"], "maxLength": 10,
                  "instructions": "Date of the bill as DD-MM-YYYY. null if there is no bill date."},
    "amount": {"type": ["number", "null"],
               "instructions": "Final amount payable in rupees as a plain number (1,400.00 is 1400). "
                               "Use the net/total/bill amount, not a line item. null if this is not a bill."},
    "issuer": {"type": ["string", "null"], "maxLength": 60,
               "instructions": "Name of the hospital, pharmacy or lab that issued the document, as printed. null if unclear."},
    "patient": {"type": ["string", "null"], "maxLength": 50,
                "instructions": "Patient name exactly as printed, including any misspelling. null if not printed."},
    "kind": {"type": "string", "enum": KINDS,
             "instructions": "If this is a bill, who issued it: pharmacy, lab, hospital, or other."},
}


def _parse_date(s) -> str | None:
    if not s:
        return None
    m = re.search(r"(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{2,4})", str(s))
    if not m:
        return None
    d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    y += 2000 if y < 100 else 0
    try:
        return date(y, mo, d).isoformat()
    except ValueError:
        return None


def rules_extract(text: str, filename: str) -> dict:
    return {"category": ocr.classify(text, filename), **ocr.parse_bill(text), "engine": "rules", "review": []}


class TypeLLMEngine:
    def __init__(self, url: str, model: str | None, vision: bool = True, timeout: float = 60, client=None):
        self.url, self.model, self.vision = url, model, vision
        if client is None:
            from typellm import TypeLLMClient            # optional dependency, imported only when configured
            client = TypeLLMClient(url, model=model, timeout=timeout, text_max_tokens=64)
        self.client = client

    def ask(self, text: str, filename: str, data: bytes) -> dict:
        context = f"Document file name: {filename}\nText read from the document (OCR, may contain errors):\n{text[:6000]}"
        images = [data] if self.vision and data.startswith(IMAGE_SIGS) else None
        return self.client.generate(context=context, questions=QUESTIONS, images=images, execution="auto")


def _clean_llm(raw: dict) -> dict:
    cat = raw.get("category")
    probs = {}
    if isinstance(cat, dict):                          # opted into probabilities
        probs, cat = cat.get("probabilities", {}), cat.get("value")
    amount = raw.get("amount")
    amount = amount if not isinstance(amount, bool) and isinstance(amount, (int, float)) and 0 < amount < 10_000_000 else None
    txt = lambda k: (str(raw[k]).strip() or None) if isinstance(raw.get(k), str) else None
    return {"category": cat if cat in ocr.CATEGORY_IDS else None, "category_confidence": round(max(probs.values()), 2) if probs else None,
            "bill_no": txt("bill_no"), "date": _parse_date(raw.get("bill_date")), "amount": amount,
            "issuer": txt("issuer"), "patient": txt("patient"), "kind": raw.get("kind") if raw.get("kind") in KINDS else None}


def _norm(k, v):
    if v is None:
        return None
    return re.sub(r"[\s\-/.]", "", str(v)).upper() if k in ("bill_no", "issuer", "patient") else v


def merge(llm: dict, rules: dict) -> dict:
    """TypeLLM value when valid, otherwise the rules value; flag fields where both exist and disagree."""
    out, review = {}, []
    for k in ("category", "bill_no", "date", "amount", "issuer", "patient", "kind"):
        a, b = llm.get(k), rules.get(k)
        out[k] = a if a is not None else b
        if k in ("bill_no", "date", "amount") and a is not None and b is not None and _norm(k, a) != _norm(k, b):
            review.append(k)
    out["confidence"] = round(sum(1 for k in ("bill_no", "date", "amount", "issuer") if out[k]) / 4, 2)
    out["category_confidence"] = llm.get("category_confidence")
    out["review"] = review
    out["engine"] = "typellm"
    return out


_engine: TypeLLMEngine | None = None
_engine_error: str | None = None


def engine() -> TypeLLMEngine | None:
    # Strict privacy mode: never send document content to an external/model service.
    return None


def engine_status() -> dict:
    e = engine()
    if e:
        return {"engine": "typellm", "model": e.model, "vision": e.vision}
    return {"engine": "rules", **({"typellm_error": _engine_error} if _engine_error else {})}


def extract(text: str, filename: str, data: bytes, eng: TypeLLMEngine | None = None) -> dict:
    """Understand one document. Never raises because of TypeLLM: falls back to the rules engine."""
    base = rules_extract(text, filename)
    eng = eng if eng is not None else engine()
    if eng is None:
        return base
    try:
        return merge(_clean_llm(eng.ask(text, filename, data)), base)
    except Exception as e:                              # server down, timeout, schema/decoding error
        log.warning("Document AI unavailable; using offline rules")
        return {**base, "engine": "rules", "engine_note": "AI engine unavailable, used rule-based reading"}
