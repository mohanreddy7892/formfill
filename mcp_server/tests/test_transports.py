"""Exercise every transport the way real clients do.

Needs: FormFill at FORMFILL_URL with the leave form uploaded, and
  formfill-mcp serve --transport http --port 8766 --token s3cret --public-url http://127.0.0.1:8766
  formfill-mcp serve --transport sse  --port 8767 --token s3cret
"""
import asyncio, json, os, sys, tempfile
import httpx

try:
    import httpx2 as _hx          # MCP SDK 2.x ships its own httpx fork
except ImportError:
    _hx = httpx
from mcp import Client, StdioServerParameters
from mcp.client.streamable_http import streamable_http_client
from mcp.client.sse import sse_client

FF = os.environ.get("FORMFILL_URL", "http://127.0.0.1:8000")
TOKEN = "s3cret"
LEAVE = {"emp_name": "Arjun Nair", "emp_id": "10078901", "type_sick": True, "from_date": "05-10-2026",
         "to_date": "07-10-2026", "days": "3", "reason": "Fever"}


def data(r):
    sc = r.structured_content
    if sc is not None:
        return sc.get("result", sc) if isinstance(sc, dict) else sc
    return json.loads(r.content[0].text)


async def scenario(label, client, expect):
    async with client as c:
        tools = sorted(t.name for t in (await c.list_tools()).tools)
        forms = data(await c.call_tool("list_forms", {}))
        leave = next(f for f in forms if "leave" in f["name"])
        res = await c.call_tool("fill_form", {"form_id": leave["form_id"], "values": LEAVE})
        text = res.content[0].text
        ok = expect in text
        print(f"{label:<22} tools={len(tools)}  forms={len(forms)}  fill={'OK' if ok else 'FAIL'}  -> {text.splitlines()[1][:70]}")
        return text


async def main():
    tmp = tempfile.mkdtemp()
    stdio = StdioServerParameters(command="formfill-mcp", args=[], env={**os.environ, "FORMFILL_URL": FF, "FORMFILL_OUTPUT_DIR": tmp})
    await scenario("stdio (Claude Desktop)", Client(stdio), "Saved to:")

    http = _hx.AsyncClient(headers={"Authorization": f"Bearer {TOKEN}"}, timeout=60)
    text = await scenario("streamable HTTP", Client(streamable_http_client("http://127.0.0.1:8766/mcp", http_client=http)), "Download")
    link = text.split("): ")[1].splitlines()[0]
    r = httpx.get(link); print(f"{'download link':<22} status={r.status_code} pdf={r.content[:5] == b'%PDF-'} bytes={len(r.content)}")

    await scenario("SSE (older clients)", Client(sse_client("http://127.0.0.1:8767/sse", headers={"Authorization": f"Bearer {TOKEN}"})), "Download")

    try:
        bad = _hx.AsyncClient(headers={"Authorization": "Bearer wrong"}, timeout=10)
        async with Client(streamable_http_client("http://127.0.0.1:8766/mcp", http_client=bad)) as c:
            await c.list_tools()
        print("wrong token            FAIL (accepted)")
    except Exception:
        print("wrong token            rejected OK")

asyncio.run(main())
