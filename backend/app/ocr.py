"""Offline text extraction and bill/document understanding. Nothing leaves the server.

Text PDFs are read directly (exact); scans and photos go through Tesseract OCR.
Parsing is heuristic: every extracted value is shown to the person for review before use.
"""
from __future__ import annotations

import difflib
import io
import re
import shutil
import subprocess
from datetime import date

import pdfplumber
from PIL import Image, ImageOps

MAX_PAGES = 10
MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


class OCRUnavailable(RuntimeError):
    pass


def ocr_available() -> bool:
    return shutil.which("tesseract") is not None


def _prep(img: Image.Image) -> Image.Image:
    img = ImageOps.exif_transpose(img).convert("L")
    if img.width < 1800:                                    # small photos: upscale for better accuracy
        f = 1800 / img.width
        img = img.resize((int(img.width * f), int(img.height * f)), Image.LANCZOS)
    return ImageOps.autocontrast(img, cutoff=1)


def ocr_image(img: Image.Image) -> str:
    if not ocr_available():
        raise OCRUnavailable("Tesseract OCR is not installed on the server")
    buf = io.BytesIO()
    _prep(img).save(buf, format="PNG")
    r = subprocess.run(["tesseract", "stdin", "stdout", "--psm", "6", "-l", "eng"],
                       input=buf.getvalue(), capture_output=True, timeout=60)
    return r.stdout.decode("utf-8", "replace")


def extract_text(data: bytes, filename: str = "") -> tuple[str, str]:
    """Returns (text, method) where method is 'pdf-text', 'ocr' or 'none'."""
    if data[:5] == b"%PDF-":
        parts, used_ocr = [], False
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            for page in pdf.pages[:MAX_PAGES]:
                t = page.extract_text() or ""
                if len(t.strip()) < 25 and ocr_available():  # scanned page inside a PDF
                    t = ocr_image(page.to_image(resolution=200).original)
                    used_ocr = True
                parts.append(t)
        return "\n".join(parts), ("ocr" if used_ocr else "pdf-text")
    try:
        img = Image.open(io.BytesIO(data))
    except Exception:
        return "", "none"
    return ocr_image(img), "ocr"


# ------------------------------------------------------------------ parsing
AMOUNT_KEYS = ["net amount", "net payable", "bill amount", "grand total", "total amount", "amount payable",
               "amount paid", "total payable", "total"]
NUM = r"(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)"


def _to_number(s: str) -> float | None:
    try:
        return float(s.replace(",", ""))
    except ValueError:
        return None


def _parse_date(s: str) -> date | None:
    s = s.strip()
    m = re.search(r"\b(\d{1,2})\s*[-/.]\s*([A-Za-z]{3,9})\s*[-/.,]?\s*(\d{2,4})\b", s)
    if m and m.group(2)[:3].lower() in MONTHS:
        d, mo, y = int(m.group(1)), MONTHS[m.group(2)[:3].lower()], int(m.group(3))
    else:
        m = re.search(r"\b(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{2,4})\b", s)
        if not m:
            return None
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if y < 100:
        y += 2000
    try:
        dt = date(y, mo, d)
    except ValueError:
        return None
    return dt if 2000 <= dt.year <= 2100 else None


def _find_date(lines: list[str]) -> date | None:
    labelled = [l for l in lines if re.search(r"\b(bill|invoice|receipt)?\s*date\b", l, re.I)]
    for l in labelled + lines:
        dt = _parse_date(re.split(r"(?i)date\s*[:\-]?", l)[-1]) or _parse_date(l)
        if dt:
            return dt
    return None


def _find_amount(lines: list[str]) -> float | None:
    for key in AMOUNT_KEYS:
        for i, l in enumerate(lines):
            low = l.lower()
            if key in low and "in words" not in low:
                tail = low.split(key, 1)[1]
                nums = [_to_number(x) for x in re.findall(NUM, tail)]
                if not nums and i + 1 < len(lines):
                    nums = [_to_number(x) for x in re.findall(NUM, lines[i + 1])]
                nums = [n for n in nums if n and n >= 10]
                if nums:
                    return nums[-1]
    decimals = [_to_number(x) for x in re.findall(r"\b\d{1,3}(?:,\d{2,3})*\.\d{2}\b", "\n".join(lines))]
    decimals = [n for n in decimals if n and n >= 10]      # tiny decimals are lab values, not bill totals
    return max(decimals) if decimals else None


def _find_bill_no(text: str) -> str | None:
    m = re.search(r"(?i)\b(?:bill|invoice|receipt|inv|voucher)\s*(?:no|number|#)\.?\s*[:\-]?\s*"
                  r"([A-Z]{0,4}[\s\-/]?\d[\dA-Z\-/]{0,14})", text)
    return re.sub(r"\s+", " ", m.group(1)).strip(" -/") if m else None


ISSUER_HINT = re.compile(r"(?i)hospital|medical|medicals|pharmacy|pharma|chemist|lab|diagnostic|clinic|nursing|health")
SKIP = re.compile(r"(?i)^(tax invoice|cash bill|invoice|bill|receipt|investigation bill|original|duplicate)\b")


def _find_issuer(lines: list[str]) -> str | None:
    head = [l.strip(" .:|") for l in lines[:8] if len(re.sub(r"[^A-Za-z]", "", l)) >= 5 and not SKIP.match(l.strip())]
    for l in head:
        if ISSUER_HINT.search(l):
            return re.sub(r"\s+", " ", l)[:60]
    return head[0][:60] if head else None


def _find_patient(text: str) -> str | None:
    m = re.search(r"(?im)^\s*(?:patient\s*name|pt\.?\s*name|name|to)\s*[:.\-]\s*([A-Z][A-Z .]{2,40})", text)
    if not m:
        return None
    name = re.split(r"\s{2,}|\b(?:age|sex|dr|date|id|bill|invoice|receipt|no|uhid|ip)\b", m.group(1), flags=re.I)[0]
    return re.sub(r"\s+", " ", name).strip(" .") or None


def bill_kind(text: str) -> str:
    t = text.lower()
    if re.search(r"investigation|laborator|diagnostic|\blab\b|pathology", t):
        return "lab"
    if re.search(r"pharma|chemist|medicals\b|batch|exp\.?\s*dt|expiry|gstin.*d\.?l\.?\s*no|d\.?l\.?\s*no", t):
        return "pharmacy"
    if re.search(r"consultation|room|ward|admission|discharge|nursing|hospital", t):
        return "hospital"
    return "other"


def parse_bill(text: str) -> dict:
    lines = [l for l in (x.strip() for x in text.splitlines()) if l]
    dt, amount = _find_date(lines), _find_amount(lines)
    out = {
        "bill_no": _find_bill_no(text),
        "date": dt.isoformat() if dt else None,
        "amount": amount,
        "issuer": _find_issuer(lines),
        "patient": _find_patient(text),
        "kind": bill_kind(text),
    }
    out["confidence"] = round(sum(1 for k in ("bill_no", "date", "amount", "issuer") if out[k]) / 4, 2)
    return out


# ------------------------------------------------------------------ document classification
CATEGORIES = [  # (id, label, required for a reimbursement claim)
    ("claim_form", "Claim form", True),
    ("intimation", "Claim intimation", False),
    ("ecard", "Health e-card", True),
    ("id_proof", "Patient ID proof", True),
    ("discharge_summary", "Discharge summary", True),
    ("hospital_bill", "Hospital main bill / receipt", True),
    ("pharmacy_bill", "Pharmacy bills", False),
    ("lab_bill", "Investigation bills", False),
    ("investigation_report", "Investigation reports", False),
    ("prescription", "Prescriptions", False),
    ("cheque", "Cancelled cheque", True),
    ("other", "Other documents", False),
]
CATEGORY_IDS = [c[0] for c in CATEGORIES]

_RULES = [  # checked in order, first match wins
    ("claim_form", r"claim form|details of primary insured"),
    ("discharge_summary", r"discharge\s+summary|discharge\s+card"),
    ("intimation", r"intimation"),
    ("ecard", r"ma-?id|policy holder|primary member|medi assist"),
    ("cheque", r"\bifsc\b.*|or bearer|a/c\s*no|cheque|payable at par"),
    ("id_proof", r"aadhaar|unique identification|income tax department|permanent account number|voter|passport"),
    ("investigation_report", r"normal range|reference range|department of laboratory|result\s+unit"),
    ("lab_bill", r"investigation bill|lab(oratory)? bill"),
    ("pharmacy_bill", r"tax invoice|pharma|chemist|batch|exp\.?\s*dt"),
    ("hospital_bill", r"cash bill|final bill|room|ward charges|consultation fee"),
    ("prescription", r"\brx\b|prescription|valid till|temp\b"),
]


def classify(text: str, filename: str = "") -> str:
    hay = f"{filename}\n{text}".lower()
    for cat, pat in _RULES:
        if re.search(pat, hay):
            return cat
    return "other"


# ------------------------------------------------------------------ patient name check
def name_check(names: list[str], text: str) -> dict:
    """Does the patient's name appear in this document? Flags near-miss spellings (e.g. ANANAYA vs ANANYA)."""
    patient = _find_patient(text)
    words = set(re.findall(r"[A-Za-z]+", (patient or text).upper()))
    tokens = list(dict.fromkeys(t for n in names for t in re.findall(r"[A-Za-z]+", n.upper())))
    if not tokens or not words:
        return {"status": "unknown"}
    found, variants, missing = [], [], []
    for t in tokens:
        if t in words:
            found.append(t)
            continue
        close = difflib.get_close_matches(t, words, n=1, cutoff=0.72) if len(t) >= 4 else []
        if close:
            variants.append({"expected": t, "found": close[0]})
        else:
            missing.append(t)
    if missing:
        return {"status": "not_found", "missing": missing, "variants": variants}
    if variants:
        return {"status": "variant", "variants": variants}
    return {"status": "match"}
