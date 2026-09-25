"""Small client for the FormFill REST API."""
from __future__ import annotations

import os
from typing import Any

import httpx


class FormFillError(Exception):
    """A problem worth showing to the user / model as-is."""


class FormFillAPI:
    def __init__(self, base_url: str | None = None, token: str | None = None, timeout: float = 60):
        self.base_url = (base_url or os.environ.get("FORMFILL_URL", "http://localhost:8000")).rstrip("/")
        self.token = token if token is not None else os.environ.get("FORMFILL_TOKEN")
        self.timeout = timeout
        self._templates: dict[str, dict] = {}

    def _client(self) -> httpx.Client:
        headers = {"X-FormFill-Token": self.token} if self.token else {}
        return httpx.Client(base_url=self.base_url, headers=headers, timeout=self.timeout)

    def _req(self, method: str, path: str, **kw) -> httpx.Response:
        try:
            with self._client() as c:
                r = c.request(method, path, **kw)
        except httpx.ConnectError:
            raise FormFillError(f"Cannot reach FormFill at {self.base_url}. Start it, or set FORMFILL_URL.")
        except httpx.TimeoutException:
            raise FormFillError(f"FormFill at {self.base_url} did not answer in time.")
        if r.status_code == 401:
            raise FormFillError("FormFill rejected the access token. Set FORMFILL_TOKEN.")
        if r.status_code >= 400:
            try:
                detail = r.json().get("detail", r.text)
            except ValueError:
                detail = r.text
            raise FormFillError(f"FormFill error {r.status_code}: {detail}")
        return r

    def health(self) -> bool:
        return self._req("GET", "/api/health").json().get("ok", False)

    def forms(self) -> list[dict[str, Any]]:
        return self._req("GET", "/api/templates").json()

    def template(self, form_id: str, refresh: bool = False) -> dict:
        if refresh or form_id not in self._templates:
            self._templates[form_id] = self._req("GET", f"/api/forms/{form_id}/template").json()
        return self._templates[form_id]

    def check(self, form_id: str, values: dict) -> dict:
        """Server-side auto-calculated values and cross-field checks (older FormFill servers: empty)."""
        try:
            return self._req("POST", f"/api/forms/{form_id}/check", json={"values": values}).json()
        except FormFillError as e:
            if "404" in str(e) or "405" in str(e):
                return {"computed": {}, "issues": []}
            raise

    def fill(self, form_id: str, values: dict) -> bytes:
        return self._req("POST", f"/api/forms/{form_id}/fill", json={"values": values}).content

    def scan(self, files: list[tuple[str, bytes]], names: list[str] | None = None) -> dict:
        import json as _json
        multipart = [("files", (n, d, "application/octet-stream")) for n, d in files]
        return self._req("POST", "/api/scan", files=multipart, data={"names": _json.dumps(names or [])}).json()

    def place_bills(self, form_id: str, values: dict, bills: list[dict]) -> dict:
        return self._req("POST", f"/api/forms/{form_id}/bills", json={"values": values, "bills": bills}).json()

    def features(self) -> dict:
        try:
            return self._req("GET", "/api/features").json()
        except FormFillError:
            return {}

    def page_png(self, form_id: str, page: int) -> bytes:
        return self._req("GET", f"/api/forms/{form_id}/pages/{page}.png").content

    def upload(self, name: str, data: bytes) -> dict:
        return self._req("POST", "/api/forms", files={"file": (name, data, "application/pdf")}).json()
