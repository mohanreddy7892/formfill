"""Manual transport integration: run backend plus HTTP(8766)/SSE(8767) with test token s3cret.
Each scenario uploads a fictional demo, receives PDF bytes directly, then clears its session.
"""
import asyncio
import base64
import json
import os
import sys
from pathlib import Path
try:
    import httpx2 as hx
except ImportError:
    import httpx as hx
from mcp import Client, StdioServerParameters
from mcp.client.streamable_http import streamable_http_client
from mcp.client.sse import sse_client

TOKEN='s3cret'
PDF=Path(__file__).resolve().parents[2]/'demo/forms/2_fillable_leave_application.pdf'


def data(result):
    assert not result.is_error
    structured=result.structured_content
    if structured is not None:
        return structured.get('result',structured) if isinstance(structured,dict) else structured
    return json.loads(result.content[0].text)


async def scenario(label,client):
    async with client as c:
        uploaded=data(await c.call_tool('upload_form',{'pdf_base64':base64.b64encode(PDF.read_bytes()).decode()}))
        result=await c.call_tool('fill_form',{'form_id':uploaded['form_id'],'values':{'emp_name':'TEST PERSON'}})
        assert not result.is_error
        docs=[item.resource for item in result.content if item.type=='resource']
        assert len(docs)==1 and base64.b64decode(docs[0].blob).startswith(b'%PDF-')
        data(await c.call_tool('clear_session',{}))
        assert data(await c.call_tool('list_forms',{}))==[]
        print(f'{label}: PDF returned directly; session cleared')


async def main():
    params=StdioServerParameters(command=sys.executable,args=['-m','formfill_mcp'],env=dict(os.environ))
    await scenario('stdio',Client(params))
    async with hx.AsyncClient(headers={'Authorization':f'Bearer {TOKEN}'},timeout=60) as http:
        await scenario('HTTP',Client(streamable_http_client('http://127.0.0.1:8766/mcp',http_client=http)))
    await scenario('SSE',Client(sse_client('http://127.0.0.1:8767/sse',headers={'Authorization':f'Bearer {TOKEN}'})))
    rejected=False
    try:
        async with hx.AsyncClient(headers={'Authorization':'Bearer wrong'},timeout=10) as bad:
            async with Client(streamable_http_client('http://127.0.0.1:8766/mcp',http_client=bad)) as c:
                await c.list_tools()
    except Exception:
        rejected=True
    assert rejected, 'wrong bearer token was accepted'
    print('wrong token: rejected')

if __name__=='__main__':
    asyncio.run(main())
