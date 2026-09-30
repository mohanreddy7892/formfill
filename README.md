# FormFill — browser edition

The Sites app now processes PDFs and English OCR on your device. Documents and personal values stay in temporary browser memory; there is no document-processing server for this edition. See [Sites usage, limits and privacy](docs/SITES.md).

Run `npm ci --prefix frontend` and `npm run build` for the browser edition. Explicit downloads remain on your device.

The Python backend and MCP installation below are still available separately. They do not share sessions with the browser app.

# FormFill

Fill PDF forms, inspect bills with local OCR, and build a claim-pack PDF.
The application processes personal data temporarily in memory and does not persist documents.

## Privacy behavior

- Uploaded forms and edited layouts are private to a random temporary browser session.
- Sessions expire after 40 minutes. **Clear session** removes the current session and entered browser state.
- No saved form library, personal-values export, database, document volume or cloud bucket.
- No browser localStorage/sessionStorage for form data or tokens. Responses are not cacheable.
- Bill OCR uses local Tesseract; external AI document processing is disabled.
- Web PDFs download only on explicit request. MCP returns PDF bytes directly, without saving a file or creating a retained download link.

Downloads remain on the user's device, and MCP/AI clients may retain tool responses.
Read [docs/PRIVACY.md](docs/PRIVACY.md) for lifetimes, deployment limitations and migration steps.

## Start locally

Python 3.12, Node.js 20+, and Tesseract with English language data are required for OCR.

```sh
python -m pip install -r backend/requirements.txt
(cd frontend && npm ci && npm run build)
export FORMFILL_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
(cd backend && python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-access-log)
```

Open http://localhost:8000 and enter the token. Use one backend worker. A restart
intentionally discards all temporary forms. New sessions require a fresh upload.
The source contains blank sample forms under `demo/forms/` and fictional test documents.

## Docker

```sh
export FORMFILL_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
export FORMFILL_MCP_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
docker compose up -d --build
```

The app listens on port 8000, and optional MCP on 8765. Tokens are required by
Compose. Each remote MCP instance is for one trusted user; do not share it among
unrelated users. Cloud deployment instructions: [deploy/DEPLOY.md](deploy/DEPLOY.md).

## MCP

Install with `python -m pip install ./mcp_server`. Set FORMFILL_URL and FORMFILL_TOKEN,
then run `formfill-mcp serve` for stdio or see [mcp_server/README.md](mcp_server/README.md).
Tools include form upload, field descriptions, validation, filling, bill scanning,
page preview, and `clear_session`. PDFs are returned as embedded resources.
Clients must support PDF resources; no server download link or automatic local-file fallback exists.

## Tests

```sh
python -m pip install pytest httpx
(cd backend && python -m pytest -q -rs)
node --test frontend/src/util.test.mjs frontend/src/privacy.test.mjs frontend/src/demo/rules.parity.test.mjs deploy/cloudflare/worker.test.mjs
(cd frontend && npm run build)
(cd mcp_server && PYTHONPATH=src python -m pytest -q tests/test_privacy.py)
```

Two Medi Assist tests require an external blank form via TEST_FORM. The legacy
TypeLLM schema test is optional; live TypeLLM processing is disabled in privacy mode.

## Source layout

- `backend/app/`: PDF processing, local OCR, rules and ephemeral session handling.
- `frontend/`: React UI and an offline demo with fictional data.
- `mcp_server/`: AI-tool integration; documents are returned directly.
- `deploy/`: single-instance deployment and token-forwarding edge proxy.
- `docs/REVIEW_FIXES.md`: earlier correctness fixes; privacy behavior is superseded by PRIVACY.md.
