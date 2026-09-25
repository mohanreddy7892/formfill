"""File storage for blank forms + templates. Never stores filled data."""
import json
import os
import shutil
import uuid
from pathlib import Path

from .models import Template

DATA = Path(os.environ.get("FORMFILL_DATA", Path(__file__).resolve().parent.parent / "data"))
SEED = Path(__file__).resolve().parent.parent / "seed"
(DATA / "forms").mkdir(parents=True, exist_ok=True)
(DATA / "templates").mkdir(parents=True, exist_ok=True)


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def form_path(form_id: str) -> Path:
    if not form_id.isalnum():
        raise FileNotFoundError(form_id)
    p = DATA / "forms" / f"{form_id}.pdf"
    if not p.exists():
        raise FileNotFoundError(form_id)
    return p


def save_form(src_file, form_id: str) -> Path:
    p = DATA / "forms" / f"{form_id}.pdf"
    with open(p, "wb") as f:
        shutil.copyfileobj(src_file, f)
    return p


def delete_form(form_id: str):
    for p in (DATA / "forms" / f"{form_id}.pdf", DATA / "templates" / f"{form_id}.json"):
        p.unlink(missing_ok=True)


def load_template(form_id: str) -> Template:
    p = DATA / "templates" / f"{form_id}.json"
    return Template.model_validate_json(p.read_text(encoding="utf-8"))


def save_template(tpl: Template):
    (DATA / "templates" / f"{tpl.form_id}.json").write_text(tpl.model_dump_json(indent=2), encoding="utf-8")


def list_templates() -> list[Template]:
    out = []
    for p in sorted((DATA / "templates").glob("*.json"), key=os.path.getmtime, reverse=True):
        try:
            out.append(Template.model_validate_json(p.read_text(encoding="utf-8")))
        except Exception:
            continue
    return out


def seed_for(fp: str):
    """Return a bundled template (fields only) whose fingerprint matches an uploaded form."""
    for p in SEED.glob("*.json"):
        data = json.loads(p.read_text(encoding="utf-8"))
        if data.get("fingerprint") == fp:
            return data
    return None
