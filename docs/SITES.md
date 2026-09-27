# Browser-only FormFill on Sites

The Sites build runs real PDF processing inside the browser. It has no Python server, document upload endpoint, database, document bucket, analytics, external AI, or external OCR service. PDF.js, pdf-lib and Tesseract.js assets are bundled with the app. OCR is English and runs locally; the first scan must load its language and WebAssembly assets.

Choose a blank PDF, use detected native fields or map printed fields, enter values, review checks, then download a filled PDF. Add PDF/JPEG/PNG/WebP documents, review OCR results and categories, and download the ordered claim pack. Mapping tools support mouse and touch. The Medi Assist preset is used only if its box geometry matches the chosen PDF; otherwise map and review the fields manually.

## Temporary session

Documents, entered values, layouts and page previews remain in RAM. Clear session empties the form map, revokes preview URLs, cancels pending operations and destroys active OCR/PDF workers. The absolute session expires after 15 minutes; expiration is checked before operations and when returning to the tab. Browser suspension can delay timers. Reloading starts an empty session. The app does not use localStorage, sessionStorage, IndexedDB, service workers or document caches. OCR's language cache is explicitly disabled.

Explicit PDF downloads are saved by the user's browser. FormFill cannot delete those downloads, browser/OS history, swap, backups or copies made outside the app, and cannot promise secure physical RAM erasure. Static app assets may be cached; they contain no chosen documents or entered values. Hosting authentication and access logs are managed by Sites and do not receive document payloads from this app.

## Limits and review

- Up to three forms, 20 MB and 40 pages per PDF; up to 30 supporting documents and 60 MB total; at most 160 pages in a pack.
- Bill scanning reads the first 10 pages of each PDF and warns when it stops. Pack export includes all permitted pages.
- OCR output is a suggestion. Decimal amounts are preserved; whole-rupee table fields require explicit correction before assignment. Never silently round a bill.
- Patient matching requires all tokens in a labelled name. Missing labels and initials remain unverified. Claim-pack reports conservatively ask for name review rather than implying all documents are verified.
- Password-protected PDFs must be unlocked outside this app. Standard PDF output fonts support Latin text; unsupported characters and text that cannot fit cause an explicit export error.
- English OCR, automatic box detection and printed-layout recognition differ from the Python implementations. Review field alignment and all extracted values. Large scans may be slower or exceed a mobile browser's memory.
- This Sites build does not expose the Python MCP HTTP/SSE endpoint. The existing Python backend and MCP package remain separate optional installations; their sessions are not shared with the browser.

## Build and verification

Run `npm ci --prefix frontend`, then `npm run build` from the repository root. The preparation script copies public OCR/PDF assets from installed packages, and the build copies `frontend/dist` into `dist` for Sites. No user documents are inputs to the build.

Run `node --test frontend/src/browser/core.test.mjs frontend/src/browser/runtime.test.mjs frontend/src/util.test.mjs frontend/src/demo/rules.parity.test.mjs frontend/src/privacy.test.mjs deploy/cloudflare/worker.test.mjs`.

The runtime tests use Node canvas adapters, fictional in-memory documents and the real local OCR/PDF engines. They are not a substitute for device/browser QA. The legacy API privacy tests cover `server-api.js`; the hosted entrypoint imports only the browser API. The old static mock demo is retained as historical source and is not the deployed app.

Validation for this migration: core/unit tests and Node-adapted document processing passed. Cloud-browser preview was blocked by the environment, so visual browser QA and WebMCP validation were unavailable. Test the live app on the target device before relying on a claim submission.

## Printed and scanned box detection

When native fields are absent, printed vector box rows become editable suggested fields. If vector detection finds too few boxes, the browser renders a bounded page image and detects enclosed rectangular interiors. Scanned forms therefore no longer require drawing every box manually. The layout review opens before filling; labels on image-only pages are generic and must be checked, and missed or mistaken boxes can be corrected with the existing designer. Instructions pages remain unfilled. No OCR text, uploaded PDF or rendered user page is added to the build or repository.
