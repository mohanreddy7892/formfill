"""MCP returns document bytes directly and never writes a local PDF."""
import asyncio
import base64
from mcp import Client
from formfill_mcp import server


def test_pdf_is_attached_without_disk_write(monkeypatch,tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv('FORMFILL_OUTPUT_DIR',str(tmp_path / 'private'))
    monkeypatch.setattr(server.api,'template',lambda *a,**k:{'name':'Test','fields':[]})
    monkeypatch.setattr(server.api,'check',lambda *a,**k:{'computed':{},'issues':[]})
    monkeypatch.setattr(server.api,'fill',lambda *a,**k:b'%PDF-test')
    async def run():
        async with Client(server.mcp) as c:
            result=await c.call_tool('fill_form',{'form_id':'test','values':{}})
            assert not result.is_error
            resources=[x.resource for x in result.content if x.type=='resource']
            assert len(resources)==1 and base64.b64decode(resources[0].blob)==b'%PDF-test'
    asyncio.run(run())
    assert list(tmp_path.iterdir()) == []
