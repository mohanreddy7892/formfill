# Deploy with temporary memory-only sessions

Set PROJECT_ID and run `bash deploy/gcp/deploy.sh` from the repository root.
The script creates app/MCP secrets and deploys one instance of each service.
It no longer creates or mounts a document bucket and removes legacy volume mounts.
Use one backend worker. Restarts and instance replacement intentionally lose forms.

Update origins and hostnames in `deploy/cloudflare/wrangler.toml`, then deploy the
Worker with `npx wrangler deploy` from that directory. The Worker forwards the
user-supplied app token; it never injects a credential. Remove an old APP_TOKEN
Worker secret if present. Distribute the backend token securely to authorized users.
Cloudflare Access can add a login layer but does not replace the backend token.

Remote MCP uses a bearer token and returns PDFs directly as embedded resources.
There is no `/files/...` download route. Each MCP service instance is for one
trusted user; use separately isolated instances for unrelated users.

See `docs/PRIVACY.md`. Disable proxy/APM request capture and body logging. Cloud
platform request metadata is outside the application's control. CPU-throttled idle
instances may pause the background cleanup loop; expiry is still checked on access.
Use an always-running runtime if timely physical RAM cleanup during idle periods is required.

Before using real documents after an upgrade, separately delete any old persisted
forms, mounted volumes, bucket objects and backups according to your retention policy.
Changing this deployment does not erase old bucket contents. Do not add a persistent
volume to restore the former saved-library behavior.
