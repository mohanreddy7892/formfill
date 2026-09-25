"""Verify document persistence is disabled and temporary sessions are cleared."""
import secrets
import tempfile
from fastapi.testclient import TestClient
from app import main, storage, extract
from conftest import DEMO, upload


def test_large_multipart_never_spills(client, monkeypatch, tmp_path):
    def forbidden(*args, **kwargs):
        raise AssertionError('Document spilled to a temporary file')
    monkeypatch.setattr(tempfile, 'TemporaryFile', forbidden)
    monkeypatch.setenv('FORMFILL_DATA', str(tmp_path / 'must-not-exist'))
    pdf = (DEMO / '3_line_style_travel_claim.pdf').read_bytes() + b'\n' + b' ' * (2 * 1024 * 1024)
    res = client.post('/api/forms', files={'file':('private-name.pdf',pdf,'application/pdf')})
    assert res.status_code == 200
    assert list(tmp_path.iterdir()) == []
    fid = res.json()['form_id']
    assert client.get(f'/api/forms/{fid}/template').json()['name'] == 'Temporary form'


def test_sessions_are_isolated(client):
    fid = upload(client, '3_line_style_travel_claim.pdf')['form_id']
    other = TestClient(main.app, headers={'X-FormFill-Session':secrets.token_hex(16)})
    assert other.get('/api/templates').json() == []
    assert other.get(f'/api/forms/{fid}/template').status_code == 404
    assert other.delete(f'/api/forms/{fid}').status_code == 404
    assert client.get(f'/api/forms/{fid}/template').status_code == 200


def test_clear_removes_bytes_and_revokes_session(client):
    fid = upload(client, '3_line_style_travel_claim.pdf')['form_id']
    sid = client.headers['X-FormFill-Session']
    assert client.post('/api/session/clear').status_code == 200
    assert sid not in storage._sessions
    assert client.get(f'/api/forms/{fid}/template').status_code == 404
    res = client.post('/api/forms',files={'file':('a.pdf',(DEMO / '3_line_style_travel_claim.pdf').read_bytes(),'application/pdf')})
    assert res.status_code == 410


def test_expiry_cleans_idle_sessions(client, monkeypatch):
    upload(client, '3_line_style_travel_claim.pdf')
    sid = client.headers['X-FormFill-Session']
    expires = storage._sessions[sid]['expires']
    monkeypatch.setattr(storage.time,'monotonic',lambda:expires+1)
    storage.purge()
    assert sid not in storage._sessions
    assert client.get('/api/templates').json() == []


def test_responses_are_not_cacheable(client):
    fid = upload(client,'2_fillable_leave_application.pdf')['form_id']
    for path in ['/api/templates',f'/api/forms/{fid}/template',f'/api/forms/{fid}/pages/0.png']:
        assert client.get(path).headers['cache-control'] == 'no-store'
    res=client.post(f'/api/forms/{fid}/fill',json={'values':{'emp_name':'TEST PERSON'}})
    assert res.status_code == 200 and res.headers['cache-control'] == 'no-store'


def test_legacy_ai_configuration_cannot_send_documents(monkeypatch):
    monkeypatch.setenv('TYPELLM_URL','https://must-not-be-called.invalid')
    assert extract.engine() is None and extract.engine_status()['engine'] == 'rules'


def test_shutdown_clears_memory():
    with TestClient(main.app,headers={'X-FormFill-Session':secrets.token_hex(16)}) as client:
        upload(client,'3_line_style_travel_claim.pdf')
        assert storage._sessions
    assert not storage._sessions


def test_errors_do_not_log_private_input(client,caplog):
    res=client.post('/api/forms',files={'file':('PRIVATE_MARKER.pdf',b'%PDF- broken PRIVATE_MARKER','application/pdf')})
    assert res.status_code == 500
    assert 'PRIVATE_MARKER' not in caplog.text and 'PRIVATE_MARKER' not in res.text
