"""Computed fields and cross-field checks. Pure functions over (template, values)."""
from __future__ import annotations

import re
from datetime import date

from .models import Compute, DateRef, FieldSpec, Rule, Template


def _txt(v) -> str:
    return "" if v is None else str(v).strip()


def num(v) -> int | None:
    """'12,380' / '12380.00' / 12380 -> 12380. None when empty or not a number."""
    s = re.sub(r"[,\s₹]|(?i:rs\.?)", "", _txt(v))
    if not s:
        return None
    try:
        return int(round(float(s)))
    except ValueError:
        return None


def to_date(ref: DateRef | None, values: dict) -> date | None:
    if ref is None:
        return None
    try:
        if ref.field:
            s = re.sub(r"\D", "", _txt(values.get(ref.field)))
            if ref.format == "DDMMYY" and len(s) == 6:
                d, m, y = int(s[:2]), int(s[2:4]), 2000 + int(s[4:])
            elif ref.format == "DDMMYYYY" and len(s) == 8:
                d, m, y = int(s[:2]), int(s[2:4]), int(s[4:])
            else:
                return None
        else:
            d, m, y = (int(_txt(values.get(k))) for k in (ref.d, ref.m, ref.y))
            if y < 100:
                y += 2000
        return date(y, m, d)
    except (ValueError, TypeError):
        return None


def _months_between(a: date, b: date) -> int:
    return (b.year - a.year) * 12 + b.month - a.month - (1 if b.day < a.day else 0)


def compute_value(c: Compute, values: dict) -> str | None:
    if c.kind == "sum":
        nums = [num(values.get(k)) for k in c.of]
        return str(sum(n for n in nums if n is not None)) if any(n is not None for n in nums) else None
    if c.kind == "copy":
        v = _txt(values.get(c.source))
        return v or None
    if c.kind in ("age_years", "age_months"):
        dob, on = to_date(c.dob, values), to_date(c.on, values)
        if not dob or not on or on < dob:
            return None
        months = _months_between(dob, on)
        return f"{months // 12:02d}" if c.kind == "age_years" else f"{months % 12:02d}"
    if c.kind == "days_between":
        a, b = to_date(c.start, values), to_date(c.end, values)
        if not a or not b or b < a:
            return None
        return f"{(b - a).days + (1 if c.inclusive else 0):02d}"
    return None


def computed_values(tpl: Template, values: dict) -> dict[str, str]:
    """Values for empty computed fields. Resolved repeatedly so chains (sum of computed) settle."""
    merged = {k: v for k, v in values.items() if _txt(v) or v is True or (isinstance(v, list) and v)}
    out: dict[str, str] = {}
    fields: list[FieldSpec] = [f for f in tpl.fields if f.compute]
    for _ in range(len(fields) + 1):
        changed = False
        for f in fields:
            if f.id in merged and f.id not in out:
                continue                                   # the person typed it: never override
            v = compute_value(f.compute, merged)
            if f.type == "boxes" and v is not None and len(v) > len(f.boxes):
                v = None                                   # would not fit: leave it to the person
            if v is not None and out.get(f.id) != v:
                out[f.id] = merged[f.id] = v
                changed = True
        if not changed:
            break
    return out


def _labels(tpl: Template, ids) -> str:
    by = {f.id: f for f in tpl.fields}
    return ", ".join(by[i].label or i for i in ids if i in by)


def required_present(field: FieldSpec, value) -> bool:
    if field.type == "checkbox":
        return value is True or (isinstance(value, (str, int)) and
                                 str(value).strip().lower() in {"1", "true", "yes", "y", "on", "x", "checked"})
    if isinstance(value, list):
        return bool(value) and all(isinstance(x, str) and x.strip() for x in value)
    return value is not None and value is not False and not isinstance(value, dict) and bool(_txt(value))


def check(tpl: Template, values: dict) -> list[dict]:
    """Run the template's rules over typed + computed values. Rules skip silently when their inputs are empty."""
    v = {**values, **computed_values(tpl, values)}
    issues = []

    def add(rule: Rule, text: str, fields: list[str]):
        issues.append({"severity": rule.severity, "message": text, "fields": fields})

    for r in tpl.rules:
        if r.kind == "equals_sum":
            target, parts = num(v.get(r.target)), [num(v.get(k)) for k in r.of]
            if target is not None and any(p is not None for p in parts):
                total = sum(p for p in parts if p is not None)
                if total != target:
                    add(r, f"{r.message} (entered {target:,}, adds up to {total:,})", [r.target, *r.of])
        elif r.kind == "date_order":
            a, b = to_date(r.first, v), to_date(r.second, v)
            if a and b and (b < a or (b == a and not r.allow_equal)):
                add(r, f"{r.message} ({a:%d-%m-%Y} → {b:%d-%m-%Y})", r.first.ids() + r.second.ids())
        elif r.kind == "date_within":
            start, end = to_date(r.start, v), to_date(r.end, v)
            if not start or not end:
                continue
            lo, hi = date.fromordinal(start.toordinal() - r.days_before), date.fromordinal(end.toordinal() + r.days_after)
            for d in r.dates:
                dt = to_date(d, v)
                if dt and not lo <= dt <= hi:
                    add(r, f"{r.message}: {_labels(tpl, d.ids())} is {dt:%d-%m-%Y}", d.ids())
        elif r.kind == "same_text":
            vals = {k: re.sub(r"\s+", " ", _txt(v.get(k))).upper() for k in r.of}
            filled = {k: x for k, x in vals.items() if x}
            if len(set(filled.values())) > 1:
                add(r, f"{r.message} ({' / '.join(sorted(set(filled.values())))})", list(filled))
        elif r.kind == "required":
            by_id = {f.id: f for f in tpl.fields}
            empty = [k for k in r.of if not required_present(by_id[k], v.get(k))]
            if empty:
                add(r, f"{r.message}: {_labels(tpl, empty)}", empty)
    return issues
