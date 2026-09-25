"""Ephemeral session storage. Uploaded documents and layouts never reach disk.
Sessions expire after 15 minutes; expiry is absolute, not extended by requests.
"""
import json
import secrets
import threading
import time
from contextvars import ContextVar
from pathlib import Path
from .models import Template

SESSION = ContextVar("formfill_session", default="")
SEED = Path(__file__).resolve().parent.parent / "seed"
TTL = 15 * 60
MAX_BYTES = 64 * 1024 * 1024
MAX_TEMPLATE_BYTES = 1024 * 1024
_lock = threading.RLock()
_sessions = {}
_revoked = {}


def purge():
    with _lock:
        now = time.monotonic()
        for key in list(_sessions):
            if _sessions[key]["expires"] <= now:
                del _sessions[key]
                _revoked[key] = now + TTL
        for key in list(_revoked):
            if _revoked[key] <= now:
                del _revoked[key]


def _session(create=False):
    purge()
    key = SESSION.get()
    if not key or key in _revoked:
        raise FileNotFoundError("Session expired")
    if create and key not in _sessions:
        _sessions[key] = {"expires": time.monotonic() + TTL, "forms": {}, "templates": {}}
    if key not in _sessions:
        raise FileNotFoundError("Session expired")
    return _sessions[key]


def clear_session():
    with _lock:
        key = SESSION.get()
        _sessions.pop(key, None)
        _revoked[key] = time.monotonic() + TTL


def clear_all():
    with _lock:
        _sessions.clear()
        _revoked.clear()


def new_id():
    return secrets.token_hex(16)


def form_path(form_id):
    """Compatibility name: returns PDF bytes, never a filesystem path."""
    with _lock:
        try:
            return _session()["forms"][form_id]
        except KeyError:
            raise FileNotFoundError("Form expired or not found") from None


def save_form(data, form_id):
    with _lock:
        session = _session(create=True)
        used = sum(len(b) for s in _sessions.values() for b in s["forms"].values())
        if used + len(data) > MAX_BYTES:
            raise ValueError("Temporary document capacity reached; clear your session and retry")
        session["forms"][form_id] = data
    return data


def delete_form(form_id):
    with _lock:
        session = _session()
        session["forms"].pop(form_id, None)
        session["templates"].pop(form_id, None)


def load_template(form_id):
    with _lock:
        try:
            raw = _session()["templates"][form_id]
        except KeyError:
            raise FileNotFoundError("Form expired or not found") from None
        return Template.model_validate_json(raw)


def save_template(tpl):
    with _lock:
        session = _session()
        if tpl.form_id not in session["forms"]:
            raise FileNotFoundError("Form expired or not found")
        raw = tpl.model_dump_json()
        size = len(raw.encode("utf-8"))
        if size > MAX_TEMPLATE_BYTES:
            raise ValueError("Temporary layout exceeds 1 MB")
        layout_bytes = sum(len(t.encode("utf-8")) for s in _sessions.values() for t in s["templates"].values())
        old_size = len(session["templates"].get(tpl.form_id, "").encode("utf-8"))
        if layout_bytes - old_size + size > MAX_BYTES:
            raise ValueError("Temporary layout capacity reached; clear your session and retry")
        session["templates"][tpl.form_id] = raw


def list_templates():
    with _lock:
        try:
            raw = list(_session()["templates"].values())
        except FileNotFoundError:
            return []
        return [Template.model_validate_json(t) for t in raw]


def seed_for(fp):
    # These are bundled blank layout definitions, not uploaded documents.
    for path in SEED.glob("*.json"):
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("fingerprint") == fp:
            return data
    return None
