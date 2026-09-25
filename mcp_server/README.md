# FormFill MCP

Tools for temporary PDF form filling and offline document scanning.
Install with `python -m pip install ./mcp_server` from the project root.

Set FORMFILL_URL to the backend URL and FORMFILL_TOKEN to its access token.
Run `formfill-mcp serve` for stdio. For remote use, set FORMFILL_MCP_TOKEN and run
`formfill-mcp serve --transport http --host 0.0.0.0`. SSE is also supported.

## Privacy

Uploaded forms and layouts belong to this process's temporary backend session and
expire after 15 minutes. Use the `clear_session` tool when finished. New uploads are
required after expiry, clearing, backend restart or process restart.

`fill_form` always returns an embedded PDF resource. It never writes a local PDF,
retains a generated-document cache, or creates a download URL. The legacy
include_pdf argument is accepted for compatibility, but the PDF is always attached.
AI clients can store conversation/tool content; their retention policy is separate
from this application. Do not send personal documents to an AI client whose
retention settings do not meet your requirements.

Each remote instance has one backend session and is intended for one trusted user.
Do not share the bearer token/instance among unrelated users. Local file inputs are
allowed only in stdio mode; remote callers send base64 bytes.

## Tools

`list_forms`, `upload_form`, `get_form_fields`, `check_values`, `fill_form`,
`scan_documents`, `view_form_page`, `clear_session`.

The framework helper `formfill_mcp.export.call_tool` returns a dictionary containing
`message` and embedded `resources` for PDF output, with no filesystem side effects.
See `../docs/PRIVACY.md` for the full lifecycle and migration requirements.
