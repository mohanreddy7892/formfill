# Browser edition

The deployed Sites version uses browser-only document processing. See [SITES.md](SITES.md) for its lifecycle and limitations. The following describes the separately installed Python/MCP services.

# Temporary processing and no document persistence

FormFill's application code does not write uploaded forms, bills, entered values,
or generated PDFs to disk, a database, or an object-storage bucket.
Processing necessarily uses temporary RAM. This is not a claim of secure memory erasure.

## Data lifecycle

| Data | Lifetime |
| --- | --- |
| Uploaded form and edited layout | Browser-session-scoped server RAM; absolute 15-minute expiry from first upload. Clear session deletes the session immediately. |
| Bills, OCR text and submitted values | Request-local memory during processing; no persistent document cache. |
| Page previews | Browser memory only; object URLs are revoked on Clear session. No server render cache. |
| Browser field values and selected files | React memory; cleared by remounting on Clear session or expiry. No localStorage, sessionStorage, IndexedDB, or values JSON export. |
| Authentication token | Browser memory until session clear/reload. Deployment secrets still belong in Secret Manager or environment configuration. |
| Generated web PDF | Returned directly, downloaded only after the user presses Download. The downloaded copy remains on the user's device. |
| MCP generated PDF | Embedded in the tool response for every transport. No local output file and no retained download-link cache. The receiving AI client can retain the response. |

A background cleanup loop purges expired sessions every five seconds while the
server receives CPU time. Reads also enforce expiry. Browser timers and tab-close
cleanup are best-effort; sleeping devices and failed network requests can delay
them. Active requests may retain their local buffers until processing completes.
Restarting the process removes its in-memory sessions. Session IDs are random
capabilities and must not be logged or shared.

## Enforcement

- Requests are bounded to 60 MB before multipart parsing. Multipart files stay in
  RAM; the spool threshold is higher than the accepted entire request size.
- Individual forms are limited to 20 MB and documents to 15 MB. The form-byte store
  is bounded to 64 MB per process, and each layout to 1 MB.
- Responses use `Cache-Control: no-store`. PDF preview caching was removed from the server.
- Request failures return generic errors without logging the exception or upload name.
  The supplied server commands disable access logging; backend lifespan and MCP serve also disable Python logging to prevent document-library messages from being recorded. Do not enable debug logging,
  request-body tracing, or document capture in a proxy/APM service.
- TypeLLM runtime selection is disabled, including with legacy TYPELLM_URL variables.
  OCR runs locally through Tesseract. No document is sent to a model endpoint by the app.
- Docker/GCP configuration no longer mounts document storage. Docker's application
  filesystem is read-only. Blank seed layouts and fictional test fixtures are source assets.
- The frontend's Clear session cancels pending fetches, revokes previews, resets
  entered state and rotates the session identifier. Late responses are rejected.
- MCP's `clear_session` discards the backend session. Run each remote MCP instance
  for one trusted user: the current service has one process-local backend session,
  not per-user accounts. Do not share a remote MCP instance between unrelated users.

## Deployment limits and migration

Use a single backend worker/instance. A process restart or rescheduling intentionally
loses forms; upload again. RAM-only state is not compatible with arbitrary load-balanced
workers without routing clients to the same instance.

For strict organizational retention requirements, the operator must also configure
OS swap, crash dumps, proxy buffering, platform logs, backups and AI-client history.
Application code cannot erase user downloads, original files, host snapshots, or
copies already sent to an AI client.

If an older release was deployed, remove its old form directories/volumes, cloud
bucket objects and backups using the organization's approved deletion process.
This code update does not delete pre-existing storage or rewrite Git history.
No cloud deployment or historical-data purge was performed as part of this change.

## Privacy regression tests

`backend/tests/test_privacy.py` checks a multipart upload larger than the old spool
threshold without permitting disk spill, session isolation, explicit cleanup,
expiry, process shutdown, no-store headers, external-AI disabling and generic errors.
`mcp_server/tests/test_privacy.py` verifies PDF bytes are returned without disk writes.
`frontend/src/privacy.test.mjs` checks session clear, request cancellation and late-response rejection.

## Verified checks for this change

- Backend: 70 passed, 3 optional fixture/schema tests skipped.
- JavaScript: 29 passed, including cleanup and late-response rejection.
- MCP: 3 in-process tests passed; stdio, HTTP and SSE returned PDFs directly and cleared their sessions. Wrong bearer tokens were rejected.
- Frontend production build passed.
- Cloud deployment and historical-data deletion were not performed.
