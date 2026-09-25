"""Write values onto a PDF according to a Template. Works for any layout."""
import io

from pypdf import PdfReader, PdfWriter
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

from .models import Template, FieldSpec

FONT = "Helvetica-Bold"
INK = (0.05, 0.10, 0.45)
TRUTHY = {"1", "true", "yes", "y", "on", "x", "checked"}


class FillError(ValueError):
    pass


def _truthy(v) -> bool:
    return v is True or str(v).strip().lower() in TRUTHY


def _box_font(b):
    w, h = b[2] - b[0], b[3] - b[1]
    return max(5.0, min(h * 0.78, w * 0.95))


def validate(tpl: Template, values: dict) -> list[str]:
    errors = []
    fields = {f.id: f for f in tpl.fields}
    for key, v in values.items():
        f = fields.get(key)
        if f is None or v in (None, "", []):
            continue
        if f.type == "boxes" and len(str(v)) > len(f.boxes):
            errors.append(f"{f.label or f.id}: {len(str(v))} characters, only {len(f.boxes)} boxes")
        if f.type == "choice":
            allowed = {o.value.upper() for o in f.options}
            items = v if isinstance(v, list) else [v]
            chosen = {str(i).upper() for i in items}
            if not f.multi and len(chosen) > 1:
                errors.append(f"{f.label or f.id}: choose only one option, got {sorted(chosen)}")
            for item in items:
                if str(item).upper() not in allowed:
                    errors.append(f"{f.label or f.id}: '{item}' is not one of {sorted(allowed)}")
    return errors


def _ops_for(f: FieldSpec, v):
    """Yield drawing ops: ('char', cx, baseline, text, size) | ('text', x, baseline, text, size) | ('white', rect)."""
    if f.type == "boxes":
        s = str(v).upper() if f.upper else str(v)
        boxes = f.boxes[len(f.boxes) - len(s):] if f.align == "right" else f.boxes
        for ch, b in zip(s, boxes):
            if f.clear:
                yield ("white", [b[0] + 0.8, b[1] + 0.8, b[2] - 0.8, b[3] - 0.8])
            if ch != " ":
                yield ("char", (b[0] + b[2]) / 2, b[1] + (b[3] - b[1]) * 0.78, ch, f.size or _box_font(b))
    elif f.type == "text":
        s = str(v).upper() if f.upper else str(v)
        x0, top, x1, bottom = f.rect
        size = f.size or min(8.0, (bottom - top) * 0.75)
        while size > 4.5 and stringWidth(s, FONT, size) > (x1 - x0 - 4):
            size -= 0.25
        if f.clear:
            yield ("white", f.rect)
        x = x1 - 2 - stringWidth(s, FONT, size) if f.align == "right" else x0 + 2
        yield ("text", x, bottom - (bottom - top - size) / 2 - size * 0.18, s, size)
    elif f.type == "checkbox":
        if _truthy(v):
            yield from _tick(f.rect)
    elif f.type == "choice":
        chosen = {str(i).upper() for i in (v if isinstance(v, list) else [v])}
        for o in f.options:
            if o.value.upper() in chosen:
                yield from _tick(o.rect)


def _tick(r):
    size = max(5.5, min(9.0, (r[3] - r[1]) * 0.95))
    yield ("char", (r[0] + r[2]) / 2, r[1] + (r[3] - r[1]) * 0.82, "X", size)


def _on_state(reader, f: FieldSpec) -> str:
    """Name of a checkbox widget's 'checked' appearance (often /Yes or /On)."""
    for annot in reader.pages[f.page].get("/Annots") or []:
        a = annot.get_object()
        if a.get("/T") == f.acro_name or (a.get("/Parent") or {}).get("/T") == f.acro_name:
            states = [k for k in (a.get("/AP") or {}).get("/N", {}).keys() if k != "/Off"]
            if states:
                return states[0]
    return "/Yes"


def fill(pdf_path: str, tpl: Template, values: dict) -> bytes:
    errors = validate(tpl, values)
    if errors:
        raise FillError("; ".join(errors))
    reader = PdfReader(pdf_path)
    writer = PdfWriter()
    writer.append(reader)

    ops: dict[int, list] = {}
    acro: dict[int, dict] = {}
    for f in tpl.fields:
        v = values.get(f.id)
        if v in (None, "", []):
            continue
        if f.type == "acro":
            acro.setdefault(f.page, {})[f.acro_name] = str(v)
            continue
        if f.type == "checkbox" and f.acro_name:          # native PDF checkbox: set its on/off state
            acro.setdefault(f.page, {})[f.acro_name] = _on_state(reader, f) if _truthy(v) else "/Off"
            continue
        ops.setdefault(f.page, []).extend(_ops_for(f, v))

    for pi, page in enumerate(writer.pages):
        if pi in acro:
            writer.update_page_form_field_values(page, acro[pi], auto_regenerate=False)
        if pi not in ops:
            continue
        w, h = float(page.mediabox.width), float(page.mediabox.height)
        buf = io.BytesIO()
        c = canvas.Canvas(buf, pagesize=(w, h))
        for op in sorted(ops[pi], key=lambda o: o[0] != "white"):   # white-outs first
            if op[0] == "white":
                x0, top, x1, bottom = op[1]
                c.setFillColorRGB(1, 1, 1)
                c.rect(x0, h - bottom, x1 - x0, bottom - top, stroke=0, fill=1)
                continue
            _, x, base, s, size = op
            c.setFillColorRGB(*INK)
            c.setFont(FONT, size)
            (c.drawCentredString if op[0] == "char" else c.drawString)(x, h - base, s)
        c.save()
        buf.seek(0)
        page.merge_page(PdfReader(buf).pages[0])

    if acro:
        writer.set_need_appearances_writer(True)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()
