# FormFill privacy requirements

These requirements apply to all code in this repository.

- Never persist uploaded documents, entered personal values, OCR text or generated PDFs to application disks, databases, object storage, logs, browser storage or retained download caches.
- Temporary RAM processing is allowed only for the current workflow. Preserve bounded requests, session isolation, explicit cleanup and absolute expiry.
- Do not restore personal-values exports, document volumes, automatic local PDF writes, external AI document transmission, or content-bearing debug logs.
- A user-requested PDF download is an explicit export to that user's device. MCP responses are explicit exports to the caller. Document these boundaries honestly; never claim control over client history, host backups or secure RAM erasure.
- Use only fictional test fixtures. Never copy production/personal documents into fixtures, commits, screenshots or diagnostics.
- Keep privacy regression tests passing when changing uploads, caching, logging, rendering, sessions or MCP delivery.
- A deployment change does not prove old stored data was deleted. Historical-data cleanup requires a separately scoped operation against the actual storage.
