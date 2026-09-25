"""Detect fillable structure in an arbitrary PDF.

* Character boxes: small, roughly square vector shapes (curves or rects) of similar size.
  Adjacent boxes on the same row are grouped into "runs" (one run ~ one field).
* Checkbox candidates: runs with a single box.
* AcroForm fields: read straight from the PDF when the form is already fillable.
"""
import hashlib
import re
from collections import defaultdict

import pdfplumber
from pypdf import PdfReader

BOX_MIN, BOX_MAX = 5.0, 16.0     # accepted box size, points
ROW_TOL = 2.2                    # boxes whose tops differ less than this share a row
GAP_MAX = 4.0                    # max horizontal gap between boxes in one run


def fingerprint(path: str) -> str:
    """Stable identity of a form layout: page geometry + printed text (not file bytes)."""
    h = hashlib.sha256()
    with pdfplumber.open(path) as pdf:
        for p in pdf.pages:
            h.update(f"{round(p.width)}x{round(p.height)}|".encode())
            text = re.sub(r"\s+", " ", p.extract_text() or "").strip().upper()
            h.update(text[:4000].encode())
    return h.hexdigest()[:24]


def _shapes(page):
    for s in list(page.curves) + list(page.rects):
        w, h = s["x1"] - s["x0"], s["bottom"] - s["top"]
        if BOX_MIN < w < BOX_MAX and BOX_MIN < h < BOX_MAX and 0.6 < w / h < 1.7:
            yield (round(s["x0"], 2), round(s["top"], 2), round(s["x1"], 2), round(s["bottom"], 2))


def detect_page(page):
    boxes = sorted(set(_shapes(page)), key=lambda b: (b[1], b[0]))
    rows = []
    for b in boxes:
        for r in rows:
            if abs(r[0][1] - b[1]) <= ROW_TOL:
                r.append(b)
                break
        else:
            rows.append([b])
    runs = []
    for r in rows:
        r.sort(key=lambda b: b[0])
        cur = [r[0]]
        for b in r[1:]:
            if b[0] - cur[-1][2] <= GAP_MAX:
                cur.append(b)
            else:
                runs.append(cur)
                cur = [b]
        runs.append(cur)
    words = page.extract_words()
    tick_labels = _tick_labels(words, [r[0] for r in runs if len(r) == 1])
    out = []
    for i, run in enumerate(runs):
        x0, top = run[0][0], min(b[1] for b in run)
        single = len(run) == 1
        label = (tick_labels.get(tuple(run[0]), "") if single else "") or _nearest_label(words, x0, top)
        out.append({
            "id": f"r{i}",
            "boxes": [list(b) for b in run],
            "kind": "checkbox" if single else "boxes",
            "label": label,
        })
    return out


def _tick_labels(words, ticks):
    """Label single tick boxes. Each printed word goes to its nearest tick box on the same line
    (left or right), so both 'Male [ ]' and '[ ] Male' layouts resolve correctly."""
    best = {}
    for w in words:
        wm = (w["top"] + w["bottom"]) / 2
        cands = []
        for b in ticks:
            if abs((b[1] + b[3]) / 2 - wm) >= 6:
                continue
            gap = w["x0"] - b[2] if w["x0"] >= b[0] else b[0] - w["x1"]
            if -3 <= gap < 14:
                cands.append((gap, b))
        if cands:
            gap, b = min(cands, key=lambda t: t[0])
            if b not in best or gap < best[b][0]:
                best[b] = (gap, w["text"].strip(":"))
    return {tuple(b): t for b, (g, t) in best.items()}


def _nearest_label(words, x0, top):
    """Printed words just left of a run on the same line - used to suggest a field label."""
    line = [w for w in words if abs(w["top"] - top) < 6 and w["x1"] <= x0 + 1 and x0 - w["x1"] < 220]
    line.sort(key=lambda w: w["x0"])
    text = " ".join(w["text"] for w in line[-6:])
    return re.sub(r"^[a-zA-Z0-9]{1,3}[\).]\s*", "", text).strip(" :")[:60]


def detect(path: str):
    pages = []
    with pdfplumber.open(path) as pdf:
        for p in pdf.pages:
            pages.append({"width": float(p.width), "height": float(p.height), "runs": detect_page(p)})
    return {"pages": pages, "acro": acro_fields(path)}


def acro_fields(path: str):
    reader = PdfReader(path)
    out = []
    for pi, page in enumerate(reader.pages):
        height = float(page.mediabox.height)
        for annot in page.get("/Annots") or []:
            a = annot.get_object()
            if a.get("/Subtype") != "/Widget":
                continue
            name = a.get("/T") or (a.get("/Parent") or {}).get("/T")
            if not name:
                continue
            x0, y0, x1, y1 = [float(v) for v in a["/Rect"]]
            out.append({"name": str(name), "page": pi, "ft": str(a.get("/FT", "")),
                        "rect": [x0, height - y1, x1, height - y0]})
    return out
