import os
import re

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
import anyio

# Shared per-process limit for expensive document operations.
DOCUMENT_WORKERS = anyio.CapacityLimiter(2)

async def document_work(fn, *args):
    return await anyio.to_thread.run_sync(fn, *args, limiter=DOCUMENT_WORKERS)
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

import json

from fastapi import Form

from . import detect, extract, filler, ocr, pack, render, rules, storage, tables
from pydantic import BaseModel as _BM

from .models import FillRequest, PageInfo, Template


class BillsRequest(_BM):
    values: dict = {}
    bills: list[dict] = []
    table: str | None = None

MAX_DOC = 15 * 1024 * 1024
MAX_DOCS = 25
DOC_TYPES = (b"%PDF-", b"\x89PNG", b"\xff\xd8\xff", b"GIF8", b"RIFF", b"II*\x00", b"MM\x00*")

app = FastAPI(title="FormFill", version="1.0")
MAX_UPLOAD = 20 * 1024 * 1024
APP_TOKEN = os.environ.get("FORMFILL_TOKEN")   # optional shared token for internal deployments


def auth(x_formfill_token: str | None = Header(default=None)):
    if APP_TOKEN and x_formfill_token != APP_TOKEN:
        raise HTTPException(401, "Missing or wrong access token")


def _template(form_id: str) -> Template:
    try:
        return storage.load_template(form_id)
    except FileNotFoundError:
        raise HTTPException(404, "Form not found")
    except ValidationError as e:
        msgs = "; ".join(err["msg"].replace("Value error, ", "") for err in e.errors())
        raise HTTPException(409, f"This form's field layout is invalid: {msgs}. Open 'Edit fields' to fix it.")


def _path(form_id: str):
    try:
        return str(storage.form_path(form_id))
    except FileNotFoundError:
        raise HTTPException(404, "Form not found")


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/templates", dependencies=[Depends(auth)])
def templates():
    return [{"form_id": t.form_id, "name": t.name, "pages": len(t.pages), "fields": len(t.fields)}
            for t in storage.list_templates()]


def _acro_fields(acro: list[dict]) -> list[dict]:
    """Fields for a fillable PDF, keyed by the PDF's own field names (readable for people and AI)."""
    out, seen = [], set()
    for a in acro:
        base = re.sub(r"[^a-z0-9]+", "_", a["name"].lower()).strip("_") or "field"
        fid, n = base, 2
        while fid in seen:
            fid, n = f"{base}_{n}", n + 1
        seen.add(fid)
        label = re.sub(r"[_\-.]+", " ", a["name"]).strip().capitalize()
        out.append({"id": fid, "label": label, "group": f"Page {a['page'] + 1}", "page": a["page"],
                    "type": "checkbox" if a["ft"] == "/Btn" else "acro", "acro_name": a["name"],
                    "rect": a["rect"], "upper": False})
    return out


@app.post("/api/forms", dependencies=[Depends(auth)])
async def upload(file: UploadFile = File(...)):
    head = await file.read(5)
    if head != b"%PDF-":
        raise HTTPException(400, "That file is not a PDF")
    await file.seek(0)
    form_id = storage.new_id()
    path = storage.save_form(file.file, form_id)
    if path.stat().st_size > MAX_UPLOAD:
        storage.delete_form(form_id)
        raise HTTPException(413, "PDF is larger than 20 MB")
    fp = detect.fingerprint(str(path))
    info = detect.detect(str(path))
    seed = storage.seed_for(fp)
    fields = seed["fields"] if seed else _acro_fields(info["acro"])
    tpl = Template(form_id=form_id, name=(seed or {}).get("name") or os.path.splitext(file.filename or "form")[0],
                   fingerprint=fp, pages=[PageInfo(width=p["width"], height=p["height"]) for p in info["pages"]],
                   fields=fields, rules=(seed or {}).get("rules", []), tables=(seed or {}).get("tables", []),
                   patient_name=(seed or {}).get("patient_name", []))
    storage.save_template(tpl)
    return {"form_id": form_id, "matched_seed": bool(seed), "fields": len(tpl.fields)}


@app.get("/api/forms/{form_id}/detect", dependencies=[Depends(auth)])
def detected(form_id: str):
    return detect.detect(_path(form_id))


@app.get("/api/forms/{form_id}/pages/{page}.png", dependencies=[Depends(auth)])
def page_image(form_id: str, page: int):
    path = _path(form_id)
    try:
        return Response(render.page_png(path, page), media_type="image/png",
                        headers={"Cache-Control": "private, max-age=3600"})
    except IndexError:
        raise HTTPException(404, "No such page")


@app.get("/api/forms/{form_id}/template", dependencies=[Depends(auth)])
def get_template(form_id: str):
    _path(form_id)
    return _template(form_id)


@app.put("/api/forms/{form_id}/template", dependencies=[Depends(auth)])
def put_template(form_id: str, tpl: Template):
    _path(form_id)
    if tpl.form_id != form_id:
        raise HTTPException(400, "form_id mismatch")
    tpl.version += 1
    storage.save_template(tpl)
    return {"saved": True, "version": tpl.version}


@app.delete("/api/forms/{form_id}", dependencies=[Depends(auth)])
def delete(form_id: str):
    _path(form_id)
    storage.delete_form(form_id)
    return {"deleted": True}


def _validated_values(tpl: Template, values: dict) -> dict:
    blocking = [i["message"] for i in rules.check(tpl, values) if i["severity"] == "error"]
    if blocking:
        raise HTTPException(422, "; ".join(blocking))
    return {**rules.computed_values(tpl, values),
            **{k: v for k, v in values.items() if v not in (None, "", [])}}


@app.post("/api/forms/{form_id}/fill", dependencies=[Depends(auth)])
def fill(form_id: str, req: FillRequest):
    """Values are used in memory only - nothing about the filled form is written to disk or logs."""
    path = _path(form_id)
    tpl = _template(form_id)
    values = _validated_values(tpl, req.values)
    try:
        pdf = filler.fill(path, tpl, values)
    except filler.FillError as e:
        raise HTTPException(422, str(e))
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{tpl.name}_filled.pdf"',
                             "Cache-Control": "no-store"})


@app.post("/api/forms/{form_id}/check", dependencies=[Depends(auth)])
def check(form_id: str, req: FillRequest):
    """Auto-calculated values for empty fields, plus cross-field checks. Nothing is stored."""
    _path(form_id)
    tpl = _template(form_id)
    return {"computed": rules.computed_values(tpl, req.values), "issues": rules.check(tpl, req.values)}


async def _read_docs(files: list[UploadFile]) -> list[tuple[str, bytes]]:
    if len(files) > MAX_DOCS:
        raise HTTPException(413, f"At most {MAX_DOCS} documents at a time")
    out = []
    for f in files:
        data = await f.read(MAX_DOC + 1)
        if len(data) > MAX_DOC:
            raise HTTPException(413, f"{f.filename}: larger than 15 MB")
        if not data.startswith(DOC_TYPES):
            raise HTTPException(400, f"{f.filename}: only PDF or image files (JPG, PNG, TIFF)")
        out.append((f.filename or "document", data))
    return out


@app.get("/api/features", dependencies=[Depends(auth)])
def features():
    return {"ocr": ocr.ocr_available(), **extract.engine_status(),
            "categories": [{"id": c, "label": l, "required": r} for c, l, r in ocr.CATEGORIES]}


@app.post("/api/scan", dependencies=[Depends(auth)])
async def scan(files: list[UploadFile] = File(...), names: str = Form("[]")):
    """Read bills and documents (offline OCR): type of document, bill details, patient-name check.
    Files are processed in memory and discarded."""
    try:
        patient = [n for n in json.loads(names) if isinstance(n, str) and n.strip()]
    except ValueError:
        patient = []
    results = []
    for name, data in await _read_docs(files):
        try:
            text, method = await document_work(ocr.extract_text, data, name)
        except ocr.OCRUnavailable as e:
            raise HTTPException(503, str(e))
        except Exception:
            results.append({"file": name, "error": "Could not read this file"})
            continue
        x = await document_work(extract.extract, text, name, data)
        cat = x["category"]
        names_text = f"{text}\n{x.get('patient') or ''}"        # AI-read name helps when OCR missed it
        item = {"file": name, "category": cat, "method": method, "engine": x["engine"],
                "readable": len(text.strip()) > 20 or x["engine"] == "typellm",
                "names": ocr.name_check(patient, names_text) if patient else {"status": "unknown"}}
        if x.get("engine_note"):
            item["note"] = x["engine_note"]
        if cat in ("hospital_bill", "pharmacy_bill", "lab_bill", "other"):
            item["bill"] = {k: x.get(k) for k in ("bill_no", "date", "amount", "issuer", "patient", "kind", "confidence", "review")}
        results.append(item)
    return {"results": results}


@app.post("/api/forms/{form_id}/bills", dependencies=[Depends(auth)])
def add_bills(form_id: str, req: BillsRequest):
    """Field values for placing scanned bills into the form's bills table (nothing typed is overwritten)."""
    _path(form_id)
    tpl = _template(form_id)
    table = next((t for t in tpl.tables if req.table in (None, t.id)), None)
    if table is None:
        raise HTTPException(404, "This form has no bills table")
    return {"table": table.id, **tables.assign_bills(table, req.values, req.bills)}


@app.post("/api/forms/{form_id}/pack", dependencies=[Depends(auth)])
async def claim_pack(form_id: str, files: list[UploadFile] = File(default=[]), categories: str = Form("[]"),
                     values: str = Form("{}"), include_form: bool = Form(True)):
    """One ordered PDF: index page, filled claim form, then documents in checklist order.
    Everything is processed in memory and returned; nothing is stored."""
    path = _path(form_id)
    tpl = _template(form_id)
    try:
        cats, vals = json.loads(categories), json.loads(values)
    except ValueError:
        raise HTTPException(400, "categories and values must be JSON")
    if not isinstance(vals, dict) or not isinstance(cats, list) or not all(isinstance(c, str) for c in cats):
        raise HTTPException(400, "values must be an object and categories must be a list of strings")
    docs_raw = await _read_docs(files)
    if len(cats) != len(docs_raw):
        raise HTTPException(400, "one category is needed per file")
    merged = _validated_values(tpl, vals) if include_form else vals
    names = [" ".join(str(merged.get(i, "")) for i in tpl.patient_name).strip()] if tpl.patient_name else []
    docs = []
    for (name, data), cat in zip(docs_raw, cats):
        cat = cat if cat in ocr.CATEGORY_IDS else "other"
        check = None
        if names and names[0] and cat not in ("cheque", "ecard", "id_proof"):
            try:
                check = ocr.name_check(names, (await document_work(ocr.extract_text, data, name))[0])
            except ocr.OCRUnavailable:
                check = None
        docs.append(pack.Doc(name, data, cat, check))
    form_pdf = None
    if include_form:
        try:
            form_pdf = await document_work(filler.fill, path, tpl, merged)
        except filler.FillError as e:
            raise HTTPException(422, str(e))
    try:
        pdf, rep = await document_work(pack.build, docs, form_pdf, tpl.name)
    except ValueError as e:
        raise HTTPException(413, str(e))
    return Response(pdf, media_type="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="{tpl.name}_claim_pack.pdf"', "Cache-Control": "no-store",
        "X-FormFill-Report": json.dumps(rep, ensure_ascii=True), "Access-Control-Expose-Headers": "X-FormFill-Report"})


# Serve the built React app (production / Docker)
_dist = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")
if os.path.isdir(_dist):
    app.mount("/assets", StaticFiles(directory=os.path.join(_dist, "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        return FileResponse(os.path.join(_dist, "index.html"))
