"""MCP tools, resources and prompt. Transport-agnostic: the CLI decides stdio / HTTP / SSE."""
from __future__ import annotations

import base64
import functools
import os
import re
import secrets
import time
from datetime import datetime
from pathlib import Path
from typing import Any

try:                                                   # MCP Python SDK 2.x
    from mcp.server.mcpserver import MCPServer as _Server, Image
    from mcp.server.mcpserver.exceptions import ToolError
except ImportError:                                    # MCP Python SDK 1.x
    from mcp.server.fastmcp import FastMCP as _Server, Image
    from mcp.server.fastmcp.exceptions import ToolError
from mcp.types import BlobResourceContents, EmbeddedResource, TextContent, ToolAnnotations

from .api import FormFillAPI, FormFillError

INSTRUCTIONS = """FormFill fills PDF forms (insurance claims, KYC, HR, leave and expense forms).
Workflow: list_forms -> get_form_fields (section by section for large forms) -> ask the user for values
(bills: use scan_documents on their bill photos/PDFs instead of typing them) ->
check_values -> show a short summary and get the user's confirmation -> fill_form.
Rules:
- Some fields are calculated automatically when left empty (totals, age, Part B copies); check_values shows them
  under auto_filled, so don't ask the user for those. check_values also lists errors (must fix) and warnings.
- Keys are the exact field ids from get_form_fields. Choice fields take one listed option (a list if multi).
  Box fields hold at most max_length characters. Amounts are whole rupees without separators in box fields.
- Never invent personal data (names, PAN, account numbers, IDs, dates, amounts). Ask for anything missing.
- Do not repeat full ID or account numbers back unnecessarily. FormFill does not store filled values."""

READ_ONLY = ToolAnnotations(readOnlyHint=True, openWorldHint=False)


class Settings:
    """Runtime settings; the CLI adjusts these before serving."""
    mode: str = "local"                   # "local" = save files to disk, "remote" = serve download links
    output_dir: Path = Path(os.environ.get("FORMFILL_OUTPUT_DIR", Path.home() / "FormFill" / "filled")).expanduser()
    public_url: str = os.environ.get("FORMFILL_MCP_PUBLIC_URL", "").rstrip("/")
    link_ttl: int = int(os.environ.get("FORMFILL_MCP_LINK_TTL", "900"))


settings = Settings()
api = FormFillAPI()
mcp = _Server("FormFill", instructions=INSTRUCTIONS)

# Filled PDFs for remote mode: token -> (expires_at, filename, bytes). Memory only.
DOWNLOADS: dict[str, tuple[float, str, bytes]] = {}


def _guard(fn):
    """Turn FormFill errors into ToolErrors so the reason reaches the model."""
    @functools.wraps(fn)
    def wrapper(*a, **kw):
        try:
            return fn(*a, **kw)
        except FormFillError as e:
            raise ToolError(str(e)) from None
    return wrapper


def _is_empty(v: Any) -> bool:
    return v is None or v == "" or v == []


def _describe(f: dict) -> dict[str, Any]:
    d: dict[str, Any] = {"id": f["id"], "label": f.get("label") or f["id"], "type": f["type"]}
    if f["type"] == "boxes":
        d["max_length"] = len(f.get("boxes", []))
        if f.get("align") == "right":
            d["note"] = "right-aligned number"
    elif f["type"] == "choice":
        d["options"] = [o["value"] for o in f.get("options", [])]
        d["multi"] = bool(f.get("multi"))
    elif f["type"] == "checkbox":
        d["value"] = "true or false"
    if f.get("hint"):
        d["hint"] = f["hint"]
    return d


def _problems(tpl: dict, values: dict) -> tuple[list[str], list[str]]:
    fields = {f["id"]: f for f in tpl["fields"]}
    errors, unknown = [], []
    for key, v in values.items():
        f = fields.get(key)
        if f is None:
            unknown.append(key)
            continue
        if _is_empty(v):
            continue
        if f["type"] == "boxes" and len(str(v)) > len(f["boxes"]):
            errors.append(f"{key}: '{v}' has {len(str(v))} characters but the form has {len(f['boxes'])} boxes")
        if f["type"] == "choice":
            allowed = {o["value"].upper() for o in f["options"]}
            items = v if isinstance(v, list) else [v]
            if len(items) > 1 and not f.get("multi"):
                errors.append(f"{key}: only one option allowed, got {items}")
            errors += [f"{key}: '{i}' is not one of {sorted(allowed)}" for i in items if str(i).upper() not in allowed]
    return errors, unknown


def _grouped(tpl: dict) -> dict[str, list[dict]]:
    groups: dict[str, list[dict]] = {}
    for f in tpl["fields"]:
        groups.setdefault(f.get("group") or "General", []).append(f)
    return groups


# ------------------------------------------------------------------ tools
@mcp.tool(title="List forms", annotations=READ_ONLY)
@_guard
def list_forms() -> list[dict]:
    """List the PDF forms available on the FormFill server with their ids, page and field counts."""
    return api.forms()


@mcp.tool(title="Get form fields", annotations=READ_ONLY)
@_guard
def get_form_fields(form_id: str, section: str | None = None) -> dict:
    """Describe a form's fields grouped by section.

    Large forms first return an overview of section names and counts; call again with `section`
    (full name or part of it) to get that section's fields. Small forms return everything at once.
    """
    tpl = api.template(form_id, refresh=True)
    groups = _grouped(tpl)
    if section:
        match = {g: fs for g, fs in groups.items() if section.lower() in g.lower()}
        if not match:
            raise ToolError(f"No section matching '{section}'. Sections: {list(groups)}")
        return {"form": tpl["name"], "sections": {g: [_describe(f) for f in fs] for g, fs in match.items()}}
    if len(tpl["fields"]) <= 40:
        return {"form": tpl["name"], "sections": {g: [_describe(f) for f in fs] for g, fs in groups.items()}}
    return {"form": tpl["name"], "total_fields": len(tpl["fields"]),
            "sections": {g: len(fs) for g, fs in groups.items()},
            "next": "Call get_form_fields again with section=<name> for that section's fields."}


@mcp.tool(title="Check values", annotations=READ_ONLY)
@_guard
def check_values(form_id: str, values: dict[str, Any]) -> dict:
    """Validate values without filling: too many characters for the boxes, invalid choices,
    unknown field ids, and how many fields per section are still empty."""
    tpl = api.template(form_id)
    errors, unknown = _problems(tpl, values)
    filled = {k for k, v in values.items() if not _is_empty(v) and k not in unknown}
    empty: dict[str, int] = {}
    for f in tpl["fields"]:
        if f["id"] not in filled:
            g = f.get("group") or "General"
            empty[g] = empty.get(g, 0) + 1
    server = api.check(form_id, {k: v for k, v in values.items() if k not in unknown and not _is_empty(v)})
    auto = server.get("computed", {})
    for k in auto:                                           # auto-calculated fields are not "empty"
        g = next((f.get("group") or "General" for f in tpl["fields"] if f["id"] == k), None)
        if g and empty.get(g):
            empty[g] -= 1
    rule_errors = [i["message"] for i in server.get("issues", []) if i["severity"] == "error"]
    warnings = [i["message"] for i in server.get("issues", []) if i["severity"] != "error"]
    return {"ok": not errors and not unknown and not rule_errors, "errors": errors + rule_errors,
            "warnings": warnings, "unknown_fields": unknown, "auto_filled": auto,
            "filled": len(filled) + len(auto), "total": len(tpl["fields"]),
            "empty_by_section": {g: n for g, n in empty.items() if n}}


@mcp.tool(title="Fill form", annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                                          idempotentHint=True, openWorldHint=False))
@_guard
def fill_form(form_id: str, values: dict[str, Any], file_name: str | None = None,
              include_pdf: bool = False) -> list:
    """Fill the form and deliver the PDF. Call only after the user confirmed the values.

    Local use saves the PDF to the user's FormFill folder; remote use returns a short-lived download link.
    Set include_pdf=true to also attach the PDF itself (for clients that can display files).
    """
    tpl = api.template(form_id)
    errors, unknown = _problems(tpl, values)
    if unknown:
        errors.append(f"Unknown field ids: {unknown}. Use get_form_fields for valid ids.")
    if errors:
        raise ToolError("Fix these before filling:\n- " + "\n- ".join(errors))
    clean = {k: v for k, v in values.items() if not _is_empty(v)}
    server = api.check(form_id, clean)
    blocking = [i["message"] for i in server.get("issues", []) if i["severity"] == "error"]
    if blocking:
        raise ToolError("Fix these before filling:\n- " + "\n- ".join(blocking))
    warnings = [i["message"] for i in server.get("issues", []) if i["severity"] != "error"]
    pdf = api.fill(form_id, clean)                                  # the server adds auto-calculated values
    stem = re.sub(r"[^\w-]+", "_", file_name or f"{tpl['name']}_filled").strip("_")
    name = f"{stem}_{datetime.now():%Y%m%d_%H%M%S}.pdf"

    if settings.mode == "remote":
        _purge()
        token = secrets.token_urlsafe(24)
        DOWNLOADS[token] = (time.time() + settings.link_ttl, name, pdf)
        where = (f"Download (valid {settings.link_ttl // 60} min): {settings.public_url}/files/{token}"
                 if settings.public_url else f"Download path on the MCP server: /files/{token}")
    else:
        settings.output_dir.mkdir(parents=True, exist_ok=True)
        path = settings.output_dir / name
        path.write_bytes(pdf)
        where = f"Saved to: {path}"

    auto = server.get("computed", {})
    note = f" (+{len(auto)} calculated automatically)" if auto else ""
    warn = ("\nPlease review with the user:\n- " + "\n- ".join(warnings)) if warnings else ""
    out: list = [TextContent(type="text", text=(
        f"Filled {len(clean)} of {len(tpl['fields'])} fields on '{tpl['name']}'{note}.\n{where}{warn}\n"
        "Ask the user to review the PDF and sign or get stamps where the form needs them."))]
    if include_pdf:
        out.append(EmbeddedResource(type="resource", resource=BlobResourceContents(
            uri=f"formfill://filled/{name}", mimeType="application/pdf", blob=base64.b64encode(pdf).decode())))
    return out


@mcp.tool(title="View form page", annotations=READ_ONLY)
@_guard
def view_form_page(form_id: str, page: int = 0) -> Image:
    """Image of one page of the blank form (0-based page number), to understand its layout."""
    return Image(data=api.page_png(form_id, page), format="png")


@mcp.tool(title="Upload form", annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                                              idempotentHint=False, openWorldHint=False))
@_guard
def upload_form(pdf_path: str | None = None, pdf_base64: str | None = None, file_name: str = "form.pdf") -> dict:
    """Add a blank PDF form. Give `pdf_path` (a file on the machine running this server) or `pdf_base64`.

    Known forms get their fields automatically and fillable PDFs import their own fields; other forms must
    be mapped once in the FormFill web app (edit_url) before they can be filled.
    """
    if pdf_path:
        p = Path(pdf_path).expanduser()
        if settings.mode == "remote":
            raise ToolError("pdf_path is not available on a remote server; send pdf_base64 instead.")
        if not p.is_file() or p.suffix.lower() != ".pdf":
            raise ToolError(f"Not a PDF file: {p}")
        data, file_name = p.read_bytes(), p.name
    elif pdf_base64:
        data = base64.b64decode(pdf_base64)
    else:
        raise ToolError("Provide pdf_path or pdf_base64.")
    if not data.startswith(b"%PDF-"):
        raise ToolError("That file is not a PDF.")
    r = api.upload(file_name, data)
    r["edit_url"] = f"{api.base_url}/#/design/{r['form_id']}"
    if not r["fields"]:
        r["next"] = f"No fields yet. Map them once in the web app: {r['edit_url']}"
    return r


MAX_SCAN = 15 * 1024 * 1024


@mcp.tool(title="Scan documents", annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=False))
@_guard
def scan_documents(form_id: str | None = None, paths: list[str] | None = None,
                   files_base64: list[dict[str, str]] | None = None,
                   values: dict[str, Any] | None = None) -> dict:
    """Read bills and claim documents (photos or PDFs): document type, bill no., date, amount, issuer,
    and whether the patient's name is spelled as on the form.

    Give local `paths` (on the machine running this server) or `files_base64` as [{"name": ..., "data": ...}].
    With `form_id`, also returns `bill_values`: field values that place the bills into the form's bills table
    (never overwriting `values` the user already gave). Show the extracted bills to the user to confirm,
    then pass bill_values together with the other values to fill_form.
    """
    files: list[tuple[str, bytes]] = []
    for p in paths or []:
        if settings.mode == "remote":
            raise ToolError("paths are not available on a remote server; send files_base64 instead.")
        fp = Path(p).expanduser()
        if not fp.is_file():
            raise ToolError(f"File not found: {fp}")
        if fp.stat().st_size > MAX_SCAN:
            raise ToolError(f"{fp.name} is larger than 15 MB")
        files.append((fp.name, fp.read_bytes()))
    for item in files_base64 or []:
        try:
            files.append((item.get("name") or "document", base64.b64decode(item["data"])))
        except (KeyError, ValueError):
            raise ToolError("files_base64 items need 'name' and base64 'data'")
    if not files:
        raise ToolError("Provide paths or files_base64.")

    values = values or {}
    names: list[str] = []
    if form_id:
        tpl = api.template(form_id)
        merged = {**api.check(form_id, values).get("computed", {}), **values}
        full = " ".join(str(merged.get(i, "")) for i in tpl.get("patient_name", [])).strip()
        names = [full] if full else []
    scanned = api.scan(files, names)["results"]
    out: dict[str, Any] = {"engine": api.features().get("engine", "rules"), "documents": []}
    bills = []
    for r in scanned:
        doc = {"file": r["file"], "type": r.get("category"), "read_by": r.get("engine")}
        if r.get("bill"):
            doc["bill"] = {k: r["bill"].get(k) for k in ("bill_no", "date", "amount", "issuer", "kind")}
            if r["bill"].get("review"):
                doc["check_with_user"] = r["bill"]["review"]
            bills.append({**r["bill"], "kind": {"hospital_bill": "hospital", "pharmacy_bill": "pharmacy",
                                                "lab_bill": "lab"}.get(r.get("category"), r["bill"].get("kind"))})
        if r.get("names", {}).get("status") in ("not_found", "unknown"):
            doc["name_check"] = r["names"]
            doc["name_warning"] = "Patient name not fully verified; review the document."
        if r.get("names", {}).get("status") == "variant":
            doc["name_spelling"] = r["names"]["variants"]
        if r.get("error"):
            doc["error"] = r["error"]
        out["documents"].append(doc)
    if form_id and bills and api.template(form_id).get("tables"):
        placed = api.place_bills(form_id, values, [b for b in bills if b.get("amount") is not None])
        out["bill_values"] = placed["updates"]
        out["not_placed"] = [{"bill_no": s["bill"].get("bill_no"), "reason": s["reason"]} for s in placed["skipped"]]
    out["next"] = ("Confirm each bill with the user (amounts on handwritten bills are often misread). "
                   "Then include bill_values in fill_form values.")
    return out


def _purge():
    now = time.time()
    for t in [t for t, (exp, _, _) in DOWNLOADS.items() if exp < now]:
        DOWNLOADS.pop(t, None)


# ------------------------------------------------------------------ resources (for clients that browse them)
@mcp.resource("formfill://forms", name="forms", title="Available forms", mime_type="application/json")
def forms_resource() -> str:
    import json
    try:
        return json.dumps(api.forms(), indent=1)
    except FormFillError as e:
        return json.dumps({"error": str(e)})


@mcp.resource("formfill://forms/{form_id}/fields", name="form_fields", title="Fields of a form",
              mime_type="application/json")
def fields_resource(form_id: str) -> str:
    import json
    tpl = api.template(form_id, refresh=True)
    return json.dumps({g: [_describe(f) for f in fs] for g, fs in _grouped(tpl).items()}, indent=1)


# ------------------------------------------------------------------ prompt
@mcp.prompt(title="Fill a form")
def fill_a_form(form_name: str = "") -> str:
    """Guided, section-by-section form filling."""
    target = f"the form '{form_name}'" if form_name else "a form"
    return (f"Help me fill {target} with FormFill. List the forms and choose the right one. Then go section by "
            "section: tell me what each section needs, ask me for the values (never guess personal details), "
            "run check_values, summarise everything for my confirmation, and only then call fill_form.")
