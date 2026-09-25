import io

import pypdfium2 as pdfium


def page_png(path: str, page_index: int, scale: float = 1.6) -> bytes:
    pdf = pdfium.PdfDocument(path)
    try:
        pdf.init_forms()                       # draw fillable-PDF input boxes in the preview too
        img = pdf[page_index].render(scale=scale, may_draw_forms=True).to_pil()
        buf = io.BytesIO()
        img.save(buf, format="PNG", optimize=True)
        return buf.getvalue()
    finally:
        pdf.close()
