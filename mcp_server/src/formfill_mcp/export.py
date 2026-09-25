"""Export the MCP tools as plain JSON-schema tool definitions for frameworks without MCP support."""
from __future__ import annotations

import asyncio
import inspect
import json
from typing import Any


async def _tools():
    from mcp import Client
    from .server import mcp
    async with Client(mcp) as c:
        return (await c.list_tools()).tools


def export(fmt: str) -> str:
    tools = asyncio.run(_tools())
    rows = []
    for t in tools:
        schema = t.input_schema if hasattr(t, "input_schema") else t.inputSchema
        desc = inspect.cleandoc(t.description or "")
        if fmt == "anthropic":
            rows.append({"name": t.name, "description": desc, "input_schema": schema})
        elif fmt == "openai":
            rows.append({"type": "function", "function": {"name": t.name, "description": desc, "parameters": schema}})
        else:
            rows.append({"name": t.name, "description": desc, "schema": schema})
    return json.dumps(rows, indent=2)


async def _call(name: str, arguments: dict[str, Any]):
    from mcp import Client
    from .server import mcp
    async with Client(mcp) as c:
        r = await c.call_tool(name, arguments)
    parts = []
    for item in r.content:
        if getattr(item, "type", "") == "text":
            parts.append(item.text)
    if r.is_error:
        raise RuntimeError("\n".join(parts))
    resources = [item.model_dump(mode="json", by_alias=True) for item in r.content if getattr(item, "type", "") == "resource"]
    if resources:
        return {"message": "\n".join(parts), "resources": resources}
    sc = getattr(r, "structured_content", None)
    if sc is not None:
        return sc.get("result", sc) if isinstance(sc, dict) and set(sc) == {"result"} else sc
    text = "\n".join(parts)
    try:
        return json.loads(text)
    except ValueError:
        return text


def call_tool(name: str, arguments: dict[str, Any] | None = None):
    """Run a FormFill tool in-process - for agent frameworks that use plain function calling.

    >>> from formfill_mcp.export import call_tool
    >>> call_tool("list_forms")
    """
    return asyncio.run(_call(name, arguments or {}))
