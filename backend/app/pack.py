"""Claim pack: one ordered PDF with an index page, page numbers and a pre-submission report."""
from __future__ import annotations

import io
from dataclasses import dataclass

from PIL import Image, ImageOps
from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from .ocr import CATEGORIES, CATEGORY_IDS

MAX_TOTAL = 60 * 1024 * 1024


@dataclass
class Doc:
    name: str
    data: bytes
    category: str
    name_check: dict | None = None


def _image_to_pdf(data: bytes) -> bytes:
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    w, h = A4
    if img.width > img.height:                                   # landscape photo: landscape page
        w, h = h, w
    m = 24
    scale = min((w - 2 * m) / img.width, (h - 2 * m) / img.height)
    iw, ih = img.width * scale, img.height * scale
    if max(img.size) > 2400:                                     # keep the pack a sensible size
        img.thumbnail((2400, 2400))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=82)
    out = io.BytesIO()
    c = canvas.Canvas(out, pagesize=(w, h))
    c.drawImage(ImageReader(io.BytesIO(buf.getvalue())), (w - iw) / 2, (h - ih) / 2, iw, ih)
    c.save()
    return out.getvalue()


def _as_pdf(doc: Doc) -> PdfReader:
    data = doc.data if doc.data[:5] == b"%PDF-" else _image_to_pdf(doc.data)
    return PdfReader(io.BytesIO(data))


def report(docs: list[Doc], has_form: bool) -> dict:
    present = {d.category for d in docs} | ({"claim_form"} if has_form else set())
    missing = [label for cid, label, req in CATEGORIES if req and cid not in present]
    names = [{"file": d.name, **d.name_check} for d in docs if d.name_check and d.name_check.get("status") == "variant"]
    return {"missing": missing, "name_variants": names,
            "name_unverified": [{"file": d.name, **d.name_check} for d in docs
                                if d.name_check and d.name_check.get("status") in ("not_found", "unknown")],
            "counts": {cid: sum(1 for d in docs if d.category == cid) for cid in CATEGORY_IDS if any(d.category == cid for d in docs)}}


def build(docs: list[Doc], form_pdf: bytes | None, title: str) -> tuple[bytes, dict]:
    if sum(len(d.data) for d in docs) + len(form_pdf or b"") > MAX_TOTAL:
        raise ValueError("Documents are larger than 60 MB in total")
    order = {c: i for i, c in enumerate(CATEGORY_IDS)}
    items: list[tuple[str, str, PdfReader]] = []
    if form_pdf:
        items.append(("Claim form", "filled with FormFill", PdfReader(io.BytesIO(form_pdf))))
    for d in sorted(docs, key=lambda d: order.get(d.category, 99)):
        label = dict((c, l) for c, l, _ in CATEGORIES).get(d.category, "Other")
        items.append((label, d.name, _as_pdf(d)))

    rep = report(docs, form_pdf is not None)
    # index page first, with page ranges
    rows, page = [], 2
    for label, name, r in items:
        n = len(r.pages)
        rows.append((label, name, f"{page}" if n == 1 else f"{page}-{page + n - 1}"))
        page += n
    total = page - 1

    idx = io.BytesIO()
    c = canvas.Canvas(idx, pagesize=A4)
    W, H = A4
    c.setFont("Helvetica-Bold", 16); c.drawString(48, H - 64, title[:70])
    c.setFont("Helvetica", 10); c.setFillColorRGB(0.37, 0.41, 0.47)
    c.drawString(48, H - 82, f"Claim documents - {len(items)} items, {total} pages")
    y = H - 118
    c.setFillColorRGB(0, 0, 0); c.setFont("Helvetica-Bold", 10)
    c.drawString(48, y, "#"); c.drawString(70, y, "Document"); c.drawString(260, y, "File"); c.drawRightString(W - 48, y, "Pages")
    c.setFont("Helvetica", 10)
    for i, (label, name, pages) in enumerate(rows, 1):
        y -= 18
        if y < 120:
            break
        c.drawString(48, y, str(i)); c.drawString(70, y, label[:32]); c.drawString(260, y, name[:44]); c.drawRightString(W - 48, y, pages)
    y -= 30
    if rep["missing"]:
        c.setFillColorRGB(0.7, 0.15, 0.12); c.setFont("Helvetica-Bold", 10); c.drawString(48, y, "Not included:")
        c.setFont("Helvetica", 10); c.drawString(130, y, ", ".join(rep["missing"])[:80]); y -= 16
    for v in rep["name_variants"][:4]:
        c.setFillColorRGB(0.6, 0.4, 0.0); c.setFont("Helvetica", 9.5)
        pairs = ", ".join(f"{x['found']} (form: {x['expected']})" for x in v["variants"])
        c.drawString(48, y, f"Name spelling differs in {v['file'][:40]}: {pairs}"[:100]); y -= 14
    for item in rep["name_unverified"][:4]:
        c.setFillColorRGB(0.7, 0.15, 0.12); c.setFont("Helvetica", 9.5)
        c.drawString(48, y, f"Patient name not verified: {item['file'][:65]}"); y -= 14
    c.showPage(); c.save()

    w = PdfWriter()
    w.append(PdfReader(io.BytesIO(idx.getvalue())))
    for _, _, r in items:
        w.append(r)
    for i, pg in enumerate(w.pages, 1):                          # page numbers bottom-right
        pw, ph = float(pg.mediabox.width), float(pg.mediabox.height)
        b = io.BytesIO(); cc = canvas.Canvas(b, pagesize=(pw, ph))
        cc.setFont("Helvetica", 8); cc.setFillColorRGB(0.35, 0.35, 0.35)
        cc.drawRightString(pw - 18, 12, f"Page {i} of {total}"); cc.save(); b.seek(0)
        pg.merge_page(PdfReader(b).pages[0])
    out = io.BytesIO(); w.write(out)
    rep["pages"] = total
    return out.getvalue(), rep
