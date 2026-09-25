"""formfill-mcp command line: serve | config | doctor | tools."""
from __future__ import annotations

import argparse
import hmac
import logging
import os
import sys
import time

from . import __version__


def _serve(args):
    logging.disable(logging.CRITICAL)
    from . import server as srv

    if args.transport == "stdio":
        srv.settings.mode = "local"
        srv.mcp.run()
        return

    import uvicorn
    from starlette.responses import JSONResponse, Response

    srv.settings.mode = "remote"
    token = args.token or os.environ.get("FORMFILL_MCP_TOKEN", "")

    @srv.mcp.custom_route("/health", methods=["GET"])
    async def health(_):
        return JSONResponse({"ok": True, "version": __version__})

    if args.transport == "sse":
        app = srv.mcp.sse_app()
    else:
        kw = {"host": args.host}
        if args.stateless:
            kw.update(stateless_http=True, json_response=True)   # serverless-friendly (Cloud Run, proxies)
        try:
            app = srv.mcp.streamable_http_app(**kw)
        except TypeError:                                        # MCP SDK 1.x signature
            kw.pop("host", None)
            app = srv.mcp.streamable_http_app(**kw) if not kw else srv.mcp.streamable_http_app()
    app = BearerAuth(app, token) if token else app
    if not token and args.host not in ("127.0.0.1", "localhost"):
        print("WARNING: serving on a network interface without --token / FORMFILL_MCP_TOKEN.", file=sys.stderr)
    path = "/sse" if args.transport == "sse" else "/mcp"
    print(f"FormFill MCP ({args.transport}) on http://{args.host}:{args.port}{path}  -> FormFill {srv.api.base_url}",
          file=sys.stderr)
    uvicorn.run(app, host=args.host, port=args.port, log_level="critical", access_log=False)


class BearerAuth:
    """ASGI middleware: MCP endpoints need `Authorization: Bearer <token>`; /health stays open
    (documents are returned directly; there are no download links)."""

    OPEN = ("/health",)

    def __init__(self, app, token: str):
        self.app, self.token = app, token.encode()

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and not scope["path"].startswith(self.OPEN):
            auth = dict(scope.get("headers") or []).get(b"authorization", b"")
            if not hmac.compare_digest(auth, b"Bearer " + self.token):
                await send({"type": "http.response.start", "status": 401,
                            "headers": [(b"content-type", b"application/json"), (b"www-authenticate", b"Bearer")]})
                await send({"type": "http.response.body", "body": b'{"error":"unauthorized"}'})
                return
        await self.app(scope, receive, send)


def _config(args):
    from .clients import CLIENTS, render
    if args.client == "list":
        for k, v in CLIENTS.items():
            print(f"  {k:<15} {v}")
        return
    from .clients import CLIENTS as C
    print(f"# {C[args.client]}\n")
    print(render(args.client, args.formfill_url, args.formfill_token or "", args.remote or "", args.mcp_token or ""))


def _doctor(args):
    from .api import FormFillAPI, FormFillError
    api = FormFillAPI(args.formfill_url, args.formfill_token)
    print(f"formfill-mcp {__version__}  |  Python {sys.version.split()[0]}")
    try:
        import importlib.metadata as md
        print(f"MCP SDK {md.version('mcp')}")
    except Exception:
        pass
    t = time.time()
    try:
        api.health()
        forms = api.forms()
        print(f"OK  FormFill reachable at {api.base_url} ({(time.time() - t) * 1000:.0f} ms)")
        print(f"OK  {len(forms)} temporary form(s)")
        if not any(f["fields"] for f in forms):
            print("!!  No form has fields yet - upload or map one in the FormFill web app.")
    except FormFillError as e:
        print(f"ERR {e}")
        sys.exit(1)


def _tools(args):
    from .export import export
    print(export(args.format))


def main(argv=None):
    try:
        _main(argv)
    except BrokenPipeError:                 # e.g. `formfill-mcp config cursor | head`
        sys.stderr.close()


def _main(argv=None):
    ap = argparse.ArgumentParser(prog="formfill-mcp", description="FormFill MCP server")
    ap.add_argument("--version", action="version", version=__version__)
    sub = ap.add_subparsers(dest="cmd")

    s = sub.add_parser("serve", help="run the MCP server (default)")
    s.add_argument("--transport", choices=["stdio", "http", "sse"], default="stdio")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8765)))
    s.add_argument("--token", help="require this bearer token for HTTP/SSE (or FORMFILL_MCP_TOKEN)")
    s.add_argument("--public-url", help="public base URL used in download links (or FORMFILL_MCP_PUBLIC_URL)")
    s.add_argument("--stateless", action="store_true",
                   default=os.environ.get("FORMFILL_MCP_STATELESS", "").lower() in ("1", "true", "yes"),
                   help="stateless Streamable HTTP with JSON responses (recommended on Cloud Run)")

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--formfill-url", default=os.environ.get("FORMFILL_URL", "http://localhost:8000"))
    common.add_argument("--formfill-token", default=os.environ.get("FORMFILL_TOKEN"))

    c = sub.add_parser("config", parents=[common], help="print setup for an MCP client ('list' to see all)")
    c.add_argument("client", choices=["list", "claude-desktop", "claude-code", "claude-ai", "cursor", "vscode",
                                      "windsurf", "gemini", "codex", "chatgpt", "generic"])
    c.add_argument("--remote", help="connect to a deployed server, e.g. https://forms.example.com/mcp")
    c.add_argument("--mcp-token", help="bearer token of the remote MCP server")

    sub.add_parser("doctor", parents=[common], help="check the connection to FormFill")

    t = sub.add_parser("tools", help="export tool definitions for non-MCP frameworks")
    t.add_argument("--format", choices=["anthropic", "openai", "json"], default="anthropic")

    args = ap.parse_args(argv)
    if args.cmd in (None, "serve"):
        if args.cmd is None:
            args = ap.parse_args(["serve", *(argv or sys.argv[1:])])
        _serve(args)
    elif args.cmd == "config":
        _config(args)
    elif args.cmd == "doctor":
        _doctor(args)
    elif args.cmd == "tools":
        _tools(args)


if __name__ == "__main__":
    main()
