# FormFill

Fill any PDF form in the browser. Upload a blank form once, map its boxes, and colleagues can type their details and download a neatly filled copy. Built with **FastAPI + React**.

| Screen | What it does |
|---|---|
| **Forms** | Upload a blank PDF; list, fill, edit or delete shared forms |
| **Edit fields** | Auto-detected character boxes are shown in amber. Click to select, then make a box field, checkboxes or a choice. Draw tools cover anything not detected (including scanned PDFs) |
| **Fill** | Auto-generated form grouped by section, with a live preview that types straight into the page boxes. Download the filled PDF |

## Smart features
| Feature | What it does |
|---|---|
| **Auto-calculated fields** | Totals, age from date of birth, days between dates, and copies (Part B repeats Part A). Used only when the field is left empty, so typing always wins |
| **Checks before download** | Totals must add up, discharge after admission, bill dates inside the stay (plus pre/post period), same patient name across sections, required fields. Errors block the download; warnings inform |
| **Documents & bills** | Add photos or PDFs of bills, reports, discharge summary, cheque, ID. Bills are read automatically (**offline Tesseract OCR**: nothing leaves the server): bill no., date, amount, issuer. Review, then add them to the bills table in one click |
| **Optional AI reading (TypeLLM)** | Self-hosted type-safe extraction on an open model that also looks at the photo; cross-checked with the text reading, disagreements highlighted, automatic fallback. See `docs/TYPELLM.md` |
| **Patient-name check** | Flags documents where the patient's name is spelled differently from the form (e.g. ANANAYA vs ANANYA) so it can be corrected before submitting |
| **Claim pack** | One ordered PDF: index page, filled claim form, then every document in checklist order, page-numbered, with a list of required documents still missing |

Rules, computed fields and tables live in the template (`rules`, `compute`, `tables`, `patient_name`); the bundled
Medi Assist template ships with 23 computed fields, 9 checks and its bills table.

## Works with any form format
- **Box-style forms** (IRDA / insurance / bank): vector boxes are detected and grouped into rows (`backend/app/detect.py`).
- **Fillable PDFs (AcroForm)**: fields are imported automatically on upload and filled natively.
- **Scanned / image PDFs**: draw text areas, box rows (auto-split into N boxes) and checkboxes by hand.
- **Known forms**: templates in `backend/seed/` are matched by a layout fingerprint (page sizes + printed text), so re-uploading the same form gets its fields instantly. The **Medi Assist Reimbursement Claim Form** (Part A + B, 163 fields) ships as a seed.

## Use it from Claude and other AI tools (MCP)
`mcp_server/` is the `formfill-mcp` package: an MCP server for Claude (Desktop, Code, claude.ai) and any other
MCP client (Cursor, VS Code, Windsurf, Gemini CLI, Codex, ChatGPT). `formfill-mcp config <tool>` prints the exact
setup; `formfill-mcp tools` exports the same tools for frameworks without MCP. See `mcp_server/README.md`.

## Try it with demo forms
`demo/forms/` has five blank forms, one per format (box-style, fillable, line-style, table, scanned). Upload any of them to see how each is set up. Regenerate them with `python demo/make_demo_forms.py`.

## Privacy
- The server stores **blank forms and field layouts only**.
- Filled values are sent once to `/api/forms/{id}/fill`, processed in memory, returned as a PDF with `Cache-Control: no-store`, and never written to disk. Uvicorn access logs are off in Docker.
- "Save values to my computer" / "Load values" keep personal data on the user's own machine as JSON.
- Set `FORMFILL_TOKEN` for every hosted deployment; Docker Compose requires it. The app prompts for this token. Add SSO / Cloudflare Access as an extra login layer for company use. Token holders share access to all templates.

## Run locally (dev)
```bash
# API
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Web (new terminal)
cd frontend
npm install
npm run dev          # http://localhost:5173 (proxies /api to :8000)
```

## Deploy to the internet (Google Cloud Run + Cloudflare)
Step-by-step in `deploy/DEPLOY.md`: one script deploys both services to Cloud Run in Mumbai, a Cloudflare Worker
serves them on your own domain with HTTPS, and Cloudflare Access limits who can open it.

## Run for the team (Docker)
```bash
export FORMFILL_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
export FORMFILL_MCP_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
docker compose up -d --build         # http://<server>:8000; use FORMFILL_TOKEN at the prompt
```

## Offline demo page
A single HTML file that runs the real interface with fictional data and no server (typing, auto-calculation,
checks, designer, sample bill reading). The browser rules engine is tested for exact parity with the server.
```bash
cd frontend && npx vite build -c vite.demo.config.js
python build_demo.py demo_data.json formfill-demo.html      # demo_data.json: see build_demo.py
node --test src/demo/rules.parity.test.mjs
```

## Tests
```bash
cd backend && pytest -q -rs                       # API, validation, auth (uses demo/forms; always runs)
TEST_FORM=/path/to/Medi_Assist_Claim_BLANK.pdf pytest -q   # + Medi Assist seed tests (skipped otherwise)
node --test frontend/src/util.test.mjs deploy/cloudflare/worker.test.mjs   # frontend ids + proxy security
cd frontend && npm run build
cd mcp_server && FORMFILL_URL=http://localhost:8000 pytest -q tests/test_inprocess.py
```
`tests/test_auth.py` fails if any `/api` route other than `/api/health` is added without authentication.

## Template format
Coordinates are PDF points from the page's top-left (`[x0, top, x1, bottom]`).
```json
{"id": "pin", "label": "Pin code", "group": "Section A", "page": 1, "type": "boxes",
 "boxes": [[87.4,146,97.8,155.6], "..."], "align": "left", "upper": true, "clear": false}
```
Types: `boxes` (one char per box), `text` (auto-shrinks to fit), `checkbox`, `choice` (options with their own boxes, `multi` for several ticks), `acro` (native PDF field).

## Project layout
```
backend/app/     main.py (API) · detect.py · filler.py · render.py · storage.py · models.py
backend/seed/    bundled templates (no personal data)
backend/tools/   build_medi_assist_seed.py
frontend/src/    Library · Designer · FillForm · PageCanvas · ValueLayer
mcp_server/      formfill-mcp package: server · CLI (serve/config/doctor/tools) · client configs · tests
demo/forms/      five sample forms, one per format
deploy/          gcp/deploy.sh · gcp/budget_alert.sh · cloudflare/worker.js · DEPLOY.md
```

## Review fixes (2026-09-25)

- Decimal OCR/AI amounts remain visible without rounding. The bills table accepts positive whole rupees only; fractional or malformed amounts require correction and are never silently changed.
- Claim-pack downloads enforce the same blocking rules as individual form downloads.
- The edge proxy forwards the user's token and never supplies its own credential. On upgrade, remove the unused Worker APP_TOKEN secret; users must enter the backend token. Docker Compose now requires both app and MCP tokens.
- Patient names require all expected tokens. Initials and missing names require review. Warnings appear in document review, pack reports and MCP results; name matching is advisory, not identity proof.
- Required consent must be checked; empty choice lists fail required validation. Offline demo rules use the same semantics.
- OCR, AI extraction and claim-pack PDF work run off the async event loop, with at most two concurrent document jobs per process.

See `docs/REVIEW_FIXES.md` for verification and examples.
