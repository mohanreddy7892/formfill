"""Fast in-process checks (no subprocess). Needs FormFill at FORMFILL_URL with the leave form uploaded."""
import asyncio, os, tempfile
from pathlib import Path
os.environ.setdefault("FORMFILL_OUTPUT_DIR", tempfile.mkdtemp())
from mcp import Client
from formfill_mcp.server import mcp
from formfill_mcp.export import call_tool, export


def test_tools_and_validation():
    async def run():
        async with Client(mcp) as c:
            names = {t.name for t in (await c.list_tools()).tools}
            assert {"list_forms", "get_form_fields", "check_values", "fill_form", "view_form_page", "upload_form"} <= names
            ann = {t.name: t.annotations for t in (await c.list_tools()).tools}
            assert ann["list_forms"].read_only_hint is True and ann["fill_form"].read_only_hint is False
    asyncio.run(run())
    forms = call_tool("list_forms")
    leave = next((f for f in forms if "leave" in f["name"].lower()), None)
    if leave is None:                                    # self-contained: upload the bundled demo form
        demo = Path(__file__).resolve().parents[2] / "demo" / "forms" / "2_fillable_leave_application.pdf"
        leave = call_tool("upload_form", {"pdf_path": str(demo)})
    chk = call_tool("check_values", {"form_id": leave["form_id"], "values": {"days": "3", "bogus": 1}})
    assert chk["unknown_fields"] == ["bogus"] and not chk["ok"]


def test_export_formats():
    import json
    for fmt, key in (("anthropic", "input_schema"), ("openai", "function"), ("json", "schema")):
        assert key in json.loads(export(fmt))[0]
