# Review fixes — 25 September 2026

Historical correctness review. Storage, authentication-session and MCP download behavior are superseded by [PRIVACY.md](PRIVACY.md).

This update fixes the six issues identified in the code review.
Source code, regression tests and deployment instructions are included.

| Area | Result |
| --- | --- |
| Bill amounts | Decimal OCR/AI values remain unchanged for review. Whole-rupee bill placement rejects fractional, negative, empty and malformed amounts. The UI keeps invalid input visible and disables placement with an explanation. |
| Claim packs | A shared validation function blocks both fill and pack requests on error-severity rules. An explicitly document-only pack does not validate an excluded form. |
| Proxy authentication | The Worker no longer injects an app credential. It forwards the caller's token to the backend for validation. MCP does not receive app tokens. Compose requires app and MCP tokens. |
| Patient names | Every expected token must be accounted for. A surname alone or an initial cannot establish a full match. Unverified names are shown in review, pack reports and MCP results. |
| Required fields | Required checkboxes must be checked; empty lists and blank selections fail validation. Browser demo rules match the backend behavior. |
| Async responsiveness | OCR, AI extraction and pack PDF processing use worker threads with a shared two-job limit per process, keeping the async event loop free. |

## Upgrade

1. Set a strong `FORMFILL_TOKEN` and `FORMFILL_MCP_TOKEN` before starting Docker Compose.
2. Distribute the app token securely to authorized users. The browser prompts for it and keeps it in session storage.
3. Redeploy the Worker. Remove its obsolete `APP_TOKEN` secret; the Worker no longer uses it.
4. Keep Cloudflare Access if configured; it adds an extra login layer and does not replace the backend token.
5. Rebuild the frontend and restart the backend/MCP services.

All holders of the shared app token can edit the shared template collection. This patch does not introduce per-user ownership or roles. No cloud deployment was performed during the review.

## Verification

- Backend: 62 tests passed; 3 optional tests skipped (two external Medi Assist PDF tests and one missing optional TypeLLM schema test).
- JavaScript: 27 tests passed, covering utilities, demo rules and the edge proxy.
- Frontend: production Vite build succeeded.
- MCP: 2 in-process tests passed; stdio, HTTP and SSE transport checks succeeded. PDF download returned HTTP 200; wrong bearer token was rejected.
- TypeLLM extraction behavior was tested with mocks. A live GPU service was not available.

Reproduce the primary checks from the project root:

```sh
(cd backend && python -m pytest -q -rs)
node --test frontend/src/util.test.mjs frontend/src/demo/rules.parity.test.mjs deploy/cloudflare/worker.test.mjs
(cd frontend && npm ci && npm run build)
```

Install the backend requirements plus pytest and httpx before testing. MCP integration checks additionally require the installed MCP package and local services described in its tests.

## Demonstrated outcomes

| Input/scenario | Updated output |
| --- | --- |
| Paste `1234.56` into the bill amount | Input stays `1234.56`; placement is blocked with a whole-rupee validation message. |
| OCR reads `Grand total 1234.56` | Extracted amount is `1234.56`, without silent rounding. |
| Expected `MOHAN REDDY`, document `SURESH REDDY` | `not_found`, missing `MOHAN`; review requested. |
| Expected `SHARMA ANANYA`, document `S.ANANYA` | `not_found`, missing `SHARMA`; an initial is not treated as a verified surname. |
| Required consent is `False` | Blocking validation issue. |
| Required choice is `[]` | Blocking validation issue. |
| Claim-pack form lacks a required name | HTTP 422, same as individual form download. |
| Caller has no app token | Proxy does not grant a token; configured backend rejects the protected request. |

The bill-placement loop checks each bill's amount first, then checks duplicate bill numbers, chooses an eligible empty row, writes its fields, and records the placement. Invalid amounts skip that iteration before any row changes. The required-field loop collects invalid fields and emits one issue per required rule. Document work queues behind the per-process limiter instead of occupying the event loop.
