"""Ready-to-paste configuration for popular MCP clients."""
from __future__ import annotations

import json
import shutil
import sys

CLIENTS = {
    "claude-desktop": "Claude Desktop - Settings > Developer > Edit Config (claude_desktop_config.json)",
    "claude-code": "Claude Code - run the command in a terminal",
    "claude-ai": "claude.ai - Settings > Connectors > Add custom connector (remote URL only)",
    "cursor": "Cursor - .cursor/mcp.json in the project, or ~/.cursor/mcp.json",
    "vscode": "VS Code (GitHub Copilot agent mode) - .vscode/mcp.json",
    "windsurf": "Windsurf - ~/.codeium/windsurf/mcp_config.json",
    "gemini": "Gemini CLI - ~/.gemini/settings.json",
    "codex": "OpenAI Codex CLI - ~/.codex/config.toml",
    "chatgpt": "ChatGPT - Settings > Connectors (developer mode), remote URL only",
    "generic": "Any other MCP client (stdio command or HTTP URL)",
}


def _launcher() -> tuple[str, list[str]]:
    """Prefer the installed `formfill-mcp` script; fall back to `python -m formfill_mcp`."""
    exe = shutil.which("formfill-mcp")
    return (exe, []) if exe else (sys.executable, ["-m", "formfill_mcp"])


def render(client: str, formfill_url: str, formfill_token: str = "", remote_url: str = "", mcp_token: str = "") -> str:
    cmd, args = _launcher()
    env = {"FORMFILL_URL": formfill_url}
    if formfill_token:
        env["FORMFILL_TOKEN"] = formfill_token
    headers = {"Authorization": f"Bearer {mcp_token}"} if mcp_token else {}
    remote = bool(remote_url)
    j = lambda o: json.dumps(o, indent=2)

    if client in ("claude-ai", "chatgpt"):
        if not remote:
            return ("This client only connects to remote servers. Deploy with\n"
                    "  formfill-mcp serve --transport http --host 0.0.0.0\nbehind HTTPS, then re-run with --remote <https://.../mcp>.")
        return (f"Server URL: {remote_url}\n"
                "The URL must be public HTTPS. These clients authenticate with OAuth, so a static bearer token\n"
                "cannot be entered here: protect the server with your company gateway / SSO, or keep it on a\n"
                "private network and use Claude Desktop or Claude Code instead.")
    if client == "claude-code":
        if remote:
            h = f' --header "Authorization: Bearer {mcp_token}"' if mcp_token else ""
            return f"claude mcp add --transport http formfill {remote_url}{h}"
        e = " ".join(f"-e {k}={v}" for k, v in env.items())
        return f"claude mcp add formfill {e} -- {cmd} {' '.join(args)}".rstrip()
    if client == "claude-desktop":
        if remote:
            return (j({"mcpServers": {"formfill": {"command": "npx", "args": ["-y", "mcp-remote", remote_url]
                    + (["--header", f"Authorization: Bearer {mcp_token}"] if mcp_token else [])}}})
                    + "\n# Claude Desktop reaches remote servers through the mcp-remote bridge (needs Node.js).")
        return j({"mcpServers": {"formfill": {"command": cmd, "args": args, "env": env}}})
    if client == "cursor":
        entry = {"url": remote_url, **({"headers": headers} if headers else {})} if remote else {"command": cmd, "args": args, "env": env}
        return j({"mcpServers": {"formfill": entry}})
    if client == "vscode":
        entry = ({"type": "http", "url": remote_url, **({"headers": headers} if headers else {})} if remote
                 else {"type": "stdio", "command": cmd, "args": args, "env": env})
        return j({"servers": {"formfill": entry}})
    if client == "windsurf":
        entry = {"serverUrl": remote_url, **({"headers": headers} if headers else {})} if remote else {"command": cmd, "args": args, "env": env}
        return j({"mcpServers": {"formfill": entry}})
    if client == "gemini":
        entry = {"httpUrl": remote_url, **({"headers": headers} if headers else {})} if remote else {"command": cmd, "args": args, "env": env}
        return j({"mcpServers": {"formfill": entry}})
    if client == "codex":
        if remote:
            return f'[mcp_servers.formfill]\nurl = "{remote_url}"' + (f'\nhttp_headers = {{ Authorization = "Bearer {mcp_token}" }}' if mcp_token else "")
        envs = ", ".join(f'{k} = "{v}"' for k, v in env.items())
        return f'[mcp_servers.formfill]\ncommand = "{cmd}"\nargs = {json.dumps(args)}\nenv = {{ {envs} }}'
    return (f"stdio command : {cmd} {' '.join(args)}\nenvironment   : {env}\n"
            f"HTTP endpoint : {remote_url or 'http://<host>:8765/mcp  (formfill-mcp serve --transport http)'}\n"
            f"SSE endpoint  : http://<host>:8765/sse  (formfill-mcp serve --transport sse, for older clients)"
            + (f"\nheader        : Authorization: Bearer {mcp_token}" if mcp_token else ""))
