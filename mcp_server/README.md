# formfill-mcp

MCP server for [FormFill](../README.md). Lets **Claude** and any other MCP-compatible AI tool fill PDF forms:
it lists forms, walks through them section by section, validates values, and delivers the filled PDF.

```
Claude / Cursor / VS Code / Gemini / ChatGPT ...  ⇄  formfill-mcp  ⇄  FormFill API  →  filled PDF
```

## 1. Install
```bash
pip install ./mcp_server            # from the repo;  gives the `formfill-mcp` command
formfill-mcp doctor                 # checks it can reach FormFill (FORMFILL_URL, default http://localhost:8000)
```
Works with MCP Python SDK 1.x and 2.x, Python 3.10+.

## 2. Connect your tool
Print the exact setup for your tool (paths filled in for your machine):
```bash
formfill-mcp config list                  # all supported clients
formfill-mcp config claude-desktop
formfill-mcp config claude-code
formfill-mcp config cursor --remote https://forms.example.com/mcp --mcp-token <token>
```

### Claude (first priority)
| Claude app | How it connects | Setup |
|---|---|---|
| **Claude Desktop** | Local (stdio) | `formfill-mcp config claude-desktop` → paste into Settings › Developer › Edit Config, restart |
| **Claude Code** | Local (stdio) or remote | `formfill-mcp config claude-code` → run the printed `claude mcp add …` command |
| **claude.ai** (web / mobile) | Remote only | Deploy over public HTTPS (below), then Settings › Connectors › Add custom connector |

### Other tools
| Tool | Config file | Command |
|---|---|---|
| Cursor | `.cursor/mcp.json` | `formfill-mcp config cursor` |
| VS Code (Copilot agent) | `.vscode/mcp.json` | `formfill-mcp config vscode` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | `formfill-mcp config windsurf` |
| Gemini CLI | `~/.gemini/settings.json` | `formfill-mcp config gemini` |
| OpenAI Codex CLI | `~/.codex/config.toml` | `formfill-mcp config codex` |
| ChatGPT (developer mode) | Connectors, remote only | `formfill-mcp config chatgpt --remote <url>` |
| Anything else | stdio / HTTP / SSE | `formfill-mcp config generic` |

Client config formats change over time. If a snippet is rejected, check that tool's MCP docs; the command,
URL and environment values stay the same.

### Frameworks without MCP (LangChain, OpenAI or Anthropic SDKs, custom agents)
```bash
formfill-mcp tools --format anthropic   # or openai / json: tool definitions for function calling
```
```python
from formfill_mcp.export import call_tool           # execute a tool call in-process
call_tool("list_forms")
call_tool("fill_form", {"form_id": "...", "values": {...}})
```
Or call the FormFill REST API directly: interactive docs at `http://<formfill>/docs`.

## 3. Transports
| Command | Endpoint | Use for |
|---|---|---|
| `formfill-mcp` (default stdio) | — | Claude Desktop, Claude Code, Cursor, VS Code, Gemini CLI on the same machine |
| `formfill-mcp serve --transport http` | `http://host:8765/mcp` | Remote / shared server (Streamable HTTP) |
| `formfill-mcp serve --transport sse` | `http://host:8765/sse` | Older clients that only speak SSE |

## 4. Deploy for a team
```bash
FORMFILL_MCP_TOKEN=<long-random-secret> FORMFILL_MCP_PUBLIC_URL=https://forms.example.com \
docker compose up -d --build            # FormFill on :8000, MCP on :8765/mcp
```
- HTTP/SSE endpoints require `Authorization: Bearer <FORMFILL_MCP_TOKEN>`; `/health` is open.
- In remote mode filled PDFs are **never written to disk**: they are held in memory and served once-per-link at
  `/files/<random-token>` for 15 minutes (`FORMFILL_MCP_LINK_TTL`).
- Put HTTPS and your company gateway / SSO in front. **claude.ai and ChatGPT connect from their own cloud**, so
  the endpoint must be publicly reachable and they authenticate with OAuth, not a static token. For an
  internal-only deployment, use Claude Desktop or Claude Code (local stdio, or remote with the bearer header).

## Tools
| Tool | Read-only | Purpose |
|---|---|---|
| `list_forms` | ✓ | Forms on the server |
| `get_form_fields` | ✓ | Fields by section; large forms are served one section at a time |
| `check_values` | ✓ | Validate before filling (box lengths, choices, unknown ids, what's empty) |
| `fill_form` |  | Fill and deliver: saved file (local) or download link (remote); `include_pdf` attaches it |
| `scan_documents` | ✓ | Read bill photos/PDFs: type, bill no., date, amount, issuer, name spelling; returns `bill_values` ready for `fill_form` |
| `view_form_page` | ✓ | Image of a blank page |
| `upload_form` |  | Add a blank PDF (`pdf_path` locally, `pdf_base64` remotely) |

Also: resources `formfill://forms`, `formfill://forms/{form_id}/fields`, and the prompt `fill_a_form`.
Tool annotations (read-only / idempotent) let clients like Claude skip confirmation for safe calls.

## Environment
| Variable | Default | Meaning |
|---|---|---|
| `FORMFILL_URL` | `http://localhost:8000` | FormFill API |
| `FORMFILL_TOKEN` | — | FormFill access token, if set on the server |
| `FORMFILL_OUTPUT_DIR` | `~/FormFill/filled` | Where local (stdio) mode saves PDFs |
| `FORMFILL_MCP_TOKEN` | — | Bearer token for HTTP/SSE |
| `FORMFILL_MCP_PUBLIC_URL` | — | Base URL used in download links |
| `FORMFILL_MCP_LINK_TTL` | `900` | Download link lifetime (seconds) |

## Privacy
FormFill stores no filled values. Values given to an AI assistant are part of that conversation, so follow your
company's AI-usage policy for PAN, bank and medical details. The server tells assistants never to invent
personal data and to confirm with the user before filling.

## Tests
```bash
FORMFILL_URL=http://localhost:8000 pytest -q tests/test_inprocess.py
python tests/test_transports.py      # stdio + HTTP + SSE + auth (see file header for the servers it needs)
```
