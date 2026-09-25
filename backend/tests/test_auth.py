"""Issue 2 and a guard against it happening again."""
from fastapi.routing import APIRoute

import app.main as main
from conftest import upload

PUBLIC = {"/api/health"}


def test_every_api_route_requires_auth():
    unprotected = []
    for r in main.app.routes:
        if isinstance(r, APIRoute) and r.path.startswith("/api") and r.path not in PUBLIC:
            deps = {d.call for d in r.dependant.dependencies}
            if main.auth not in deps:
                unprotected.append(f"{sorted(r.methods)} {r.path}")
    assert not unprotected, f"routes without auth: {unprotected}"


def test_page_image_needs_token(token_client):
    h = {"X-FormFill-Token": "test-token"}
    fid = upload(token_client, "1_box_style_kyc.pdf", headers=h)["form_id"]
    assert token_client.get(f"/api/forms/{fid}/pages/0.png").status_code == 401
    assert token_client.get(f"/api/forms/{fid}/pages/0.png", headers={"X-FormFill-Token": "wrong"}).status_code == 401
    ok = token_client.get(f"/api/forms/{fid}/pages/0.png", headers=h)
    assert ok.status_code == 200 and ok.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_all_endpoints_reject_missing_token(token_client):
    fid = upload(token_client, "1_box_style_kyc.pdf", headers={"X-FormFill-Token": "test-token"})["form_id"]
    for method, path in [("get", "/api/templates"), ("get", f"/api/forms/{fid}/template"),
                         ("get", f"/api/forms/{fid}/detect"), ("get", f"/api/forms/{fid}/pages/0.png"),
                         ("post", f"/api/forms/{fid}/fill"), ("delete", f"/api/forms/{fid}")]:
        kw = {"json": {"values": {}}} if method == "post" else {}
        assert getattr(token_client, method)(path, **kw).status_code == 401, path
