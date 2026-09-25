# Deploy FormFill: Google Cloud Run (Mumbai) + Cloudflare

```
User ── https://forms.<domain> ──┐
Claude/MCP ─ https://mcp.<domain> ┤  Cloudflare: domain, DNS, HTTPS, Access login, Worker proxy
                                  └─▶ Cloud Run asia-south1: formfill (app+API) · formfill-mcp
                                          └─▶ Cloud Storage bucket: blank forms + field layouts only
```
Why a Worker: Cloud Run's built-in domain mapping is not offered in asia-south1. The Worker forwards your domain
to Cloud Run and forwards the token supplied by each user. Both origins and the proxy require a valid token for protected API routes. The Worker never injects a server credential.

Expected cost for a small team: Cloud Run free tier (scales to zero) + Workers free plan + domain ~₹900/year.

## 0. Before you start
- **Approval:** real employee data (PAN, bank, medical) needs IT/Security sign-off, ideally on a company GCP account.
- Tools: a GCP project with billing, a Cloudflare account, Node.js (for `npx wrangler`). Cloud Shell has gcloud.

## 1. Domain (Cloudflare Registrar)
Cloudflare dashboard → Domain Registration → Register Domains → buy e.g. `fillmyform.com`.
It's added to your Cloudflare account automatically (DNS + HTTPS ready).

## 2. Google Cloud
```bash
export PROJECT_ID=<your-project-id>
bash deploy/gcp/deploy.sh                                  # APIs, bucket, secrets, both services
BILLING_ACCOUNT=<id> bash deploy/gcp/budget_alert.sh       # ₹500/month email alerts - do this on day one
```
Note the two `*.run.app` URLs it prints.

## 3. Cloudflare Worker
Edit `deploy/cloudflare/wrangler.toml`: your two hostnames, `MCP_HOST`, and the two origins. Then:
```bash
cd deploy/cloudflare
npx wrangler login
# Distribute this token securely to authorized users; enter it in the app token prompt.
gcloud secrets versions access latest --secret=formfill-token
# If upgrading, remove the obsolete Worker secret: npx wrangler secret delete APP_TOKEN
npx wrangler deploy                    # creates the DNS records for forms.* and mcp.* and issues HTTPS
```
Re-run step 2 once with `PUBLIC_MCP_URL=https://mcp.<domain>` so MCP download links use your domain.

## 4. Optional additional login layer: Cloudflare Access
Zero Trust → Access → Applications → Add → Self-hosted:
- Domain `forms.<domain>`, policy **Allow** → *Emails ending in* `@yourcompany.com` (or a list of emails).
- Login method: One-time PIN (email code), no passwords to manage. Free for small teams.
- Leave `mcp.<domain>` out of Access: MCP clients authenticate with the bearer token instead.

The backend token is required even after Access login. Keep FORMFILL_TOKEN configured in every hosted deployment; all token holders share template access.

## 5. Check
```bash
curl -s https://forms.<domain>/api/health                  # through Access you'll get the login page instead
formfill-mcp doctor --formfill-url https://forms.<domain>   # from a machine that passes Access, or skip
formfill-mcp config claude-code --remote https://mcp.<domain>/mcp --mcp-token "$(gcloud secrets versions access latest --secret=formfill-mcp-token)"
```

## Updating
Push code, then re-run `bash deploy/gcp/deploy.sh` (secrets and bucket are reused). Worker changes: `npx wrangler deploy`.

## Settings used and why
| Setting | Value | Reason |
|---|---|---|
| Region | asia-south1 (Mumbai) | data stays in India, Tier-1 pricing |
| min-instances | 0 | pay nothing when idle (first request after idle takes a few seconds) |
| formfill max-instances | 3 | caps cost |
| formfill-mcp max-instances | 1, stateless | download links live in one instance's memory, never on disk |
| /data | Cloud Storage volume | forms and layouts survive restarts; no filled data is stored |
| Tokens | Secret Manager | not in code or config files |

## Remove everything
```bash
gcloud run services delete formfill formfill-mcp --region asia-south1
gcloud storage rm -r gs://$PROJECT_ID-formfill-data
gcloud secrets delete formfill-token; gcloud secrets delete formfill-mcp-token
cd deploy/cloudflare && npx wrangler delete
```
