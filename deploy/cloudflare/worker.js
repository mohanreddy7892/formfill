/**
 * FormFill edge proxy on Cloudflare Workers.
 *   forms.<domain> -> FormFill on Cloud Run  (forwards the caller token; backend authentication is mandatory)
 *   mcp.<domain>   -> FormFill MCP on Cloud Run (clients send their own Bearer token)
 * Streams responses through untouched, so PDFs and MCP streams pass straight to the user.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isMcp = url.hostname === env.MCP_HOST;
    const originStr = isMcp ? env.MCP_ORIGIN : env.APP_ORIGIN;
    if (!originStr) return new Response("Not configured", { status: 500 });

    // Build the destination from the trusted origin and copy only path + query onto it.
    // Never resolve the incoming path as a URL: "//host/x" or "/\host/x" would replace the origin.
    const origin = new URL(originStr);
    const target = new URL(origin.href);
    target.pathname = url.pathname;
    target.search = url.search;
    target.hash = "";
    if (target.origin !== origin.origin) {
      return new Response("Bad request", { status: 400 });
    }

    const headers = new Headers(request.headers);
    headers.delete("host");
    if (isMcp) headers.delete("x-formfill-token"); // MCP has its own bearer authentication
    headers.set("x-forwarded-host", url.hostname);
    headers.set("x-forwarded-proto", "https");
    // Forward only credentials supplied by the caller. The backend validates the token.
    // Never inject a shared server credential into an unauthenticated request.

    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      duplex: "half",          // stream the request body (large PDF uploads) instead of buffering it
      redirect: "manual",
    });

    const out = new Headers(upstream.headers);
    out.set("strict-transport-security", "max-age=31536000; includeSubDomains");
    out.set("x-content-type-options", "nosniff");
    out.set("referrer-policy", "same-origin");
    if (!isMcp) out.set("x-frame-options", "DENY");
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
  },
};
