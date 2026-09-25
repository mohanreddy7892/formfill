// Run: node --test deploy/cloudflare/worker.test.mjs     (no network, fetch is mocked)
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "./worker.js";

const env = { APP_ORIGIN: "https://formfill-abc-el.a.run.app", MCP_ORIGIN: "https://mcp-abc-el.a.run.app",
              MCP_HOST: "mcp.example.com", APP_TOKEN: "TEST_TOKEN_ONLY" };
let calls = [];
globalThis.fetch = async (url, init) => { calls.push({ url: new URL(String(url)), headers: new Headers(init.headers) }); return new Response("ok"); };
const go = async (u, init = { headers: { "x-formfill-token": "USER_TOKEN" } }) => { calls = []; const r = await worker.fetch(new Request(u, init), env); return { r, c: calls[0] }; };

test("path cannot redirect the request (or the token) to another host", async () => {
  for (const p of ["//attacker.example/collect", "///attacker.example/x", "/\\attacker.example/x",
                   "/%2F%2Fattacker.example/x", "/..//attacker.example/x", "/api?next=//attacker.example"]) {
    const { c } = await go("https://forms.example.com" + p);
    if (!c) continue;                                     // refusing to forward is also safe
    assert.equal(c.url.origin, env.APP_ORIGIN, `leaked for ${p}`);
  }
});

test("path and query are preserved for normal requests", async () => {
  const { c } = await go("https://forms.example.com/api/forms/abc/pages/1.png?v=2");
  assert.equal(c.url.href, env.APP_ORIGIN + "/api/forms/abc/pages/1.png?v=2");
  assert.equal(c.headers.get("x-formfill-token"), "USER_TOKEN");
});

test("MCP host never receives the app token", async () => {
  const { c } = await go("https://mcp.example.com/mcp", { headers: { authorization: "Bearer user" } });
  assert.equal(c.url.origin, env.MCP_ORIGIN);
  assert.equal(c.headers.get("x-formfill-token"), null);
  assert.equal(c.headers.get("authorization"), "Bearer user");
});

test("caller token is passed to the app for validation and removed for MCP", async () => {
  const { c } = await go("https://mcp.example.com/mcp", { headers: { "x-formfill-token": "forged" } });
  assert.equal(c.headers.get("x-formfill-token"), null);
  const a = await go("https://forms.example.com/api/templates", { headers: { "x-formfill-token": "forged" } });
  assert.equal(a.c.headers.get("x-formfill-token"), "forged");
});

 test("unauthenticated callers never acquire a backend token", async () => {
  for (const method of ["GET", "PUT", "DELETE"]) {
    const { c } = await go("https://forms.example.com/api/forms/abc", { method });
    assert.equal(c.headers.get("x-formfill-token"), null);
  }
});
