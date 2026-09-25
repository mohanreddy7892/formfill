"""Place scanned bills into a template table (server twin of frontend/src/util.js assignBills).
Never overwrites typed values; a bill prefers a row printed for its type, then free rows in order."""
from __future__ import annotations

from .models import TableSpec
from decimal import Decimal, InvalidOperation

def whole_rupees(value):
    try:
        amount = Decimal(str(value))
        return amount.is_finite() and 0 < amount <= 9007199254740991 and amount == amount.to_integral_value()
    except InvalidOperation:
        return False

TOWARDS = {"pharmacy": "PHARMACY", "lab": "LAB INVESTIGATIONS", "hospital": "HOSPITAL BILL", "other": "OTHERS"}


def iso_to_form(iso: str | None, fmt: str = "DDMMYY") -> str:
    if not iso or len(iso) != 10 or iso[4] != "-" or iso[7] != "-":
        return ""
    y, m, d = iso[:4], iso[5:7], iso[8:]
    return f"{d}{m}{y}" if fmt == "DDMMYYYY" else f"{d}{m}{y[2:]}"


def _empty(v) -> bool:
    return v is None or v == "" or v == []


def assign_bills(table: TableSpec, values: dict, bills: list[dict]) -> dict:
    updates: dict[str, str] = {}
    val = lambda i: updates.get(i, values.get(i)) if i else None
    rows = [(r, [x for x in (r.no, r.date, r.issuer, r.amount) if x]) for r in table.rows]
    free = lambda ids: all(_empty(val(i)) for i in ids)
    existing = {str(val(r.no) or "").upper() for r, _ in rows if r.no and val(r.no)}
    placed, skipped = [], []
    for b in bills:
        if not b or b.get("amount") is None:
            skipped.append({"bill": b, "reason": "no amount found"}); continue
        if not whole_rupees(b["amount"]):
            skipped.append({"bill": b, "reason": "enter a positive whole-rupee amount"}); continue
        no = str(b.get("bill_no") or "").upper()
        if no and no in existing:
            skipped.append({"bill": b, "reason": "already in the form"}); continue
        kind = b.get("kind")
        hit = next(((r, ids) for r, ids in rows if r.kind and r.kind == kind and free(ids)), None) \
            or next(((r, ids) for r, ids in rows if not r.kind and free(ids)), None)
        if not hit:
            skipped.append({"bill": b, "reason": "no free row left"}); continue
        r, _ = hit
        for fid, v in ((r.no, no), (r.date, iso_to_form(b.get("date"), table.date_format)),
                       (r.issuer, str(b.get("issuer") or "").upper()), (r.amount, str(int(Decimal(str(b["amount"])))))):
            if fid and v:
                updates[fid] = v
        if not r.kind and r.towards:
            updates[r.towards] = TOWARDS.get(kind, TOWARDS["other"])
        if no:
            existing.add(no)
        placed.append({"bill": b, "row": table.rows.index(r) + 1})
    return {"updates": updates, "placed": placed, "skipped": skipped}
