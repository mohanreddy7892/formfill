// Offline demo: answers /api/* from embedded data so the real UI runs as a static page.
import { check, computedValues } from "./rules.js";

const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
const notInDemo = (what) => json({ detail: `${what} needs the installed FormFill server, so it's off in this demo. Everything else works.` }, 501);

export function installDemo(data) {
  const forms = data.forms;
  const pngs = {};
  window.__FORMFILL_DEMO__ = {
    sampleFiles: () => data.samples.map((s) => new File([b64ToBytes(s.data)], s.name, { type: s.type })),
  };
  const scanResult = (name) => data.samples.find((s) => s.name === name)?.result;
  const realFetch = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
    const p = url.pathname.replace(/^\/api/, "");
    const method = (init.method || "GET").toUpperCase();
    const body = () => JSON.parse(init.body || "{}");
    await new Promise((r) => setTimeout(r, 120));                     // feel like a network call
    let m;
    if (p === "/health") return json({ ok: true });
    if (p === "/templates") return json(Object.entries(forms).map(([id, f]) => ({ form_id: id, name: f.template.name, pages: f.template.pages.length, fields: f.template.fields.length })));
    if (p === "/features") return json({ ocr: true, engine: "rules", categories: data.categories });
    if (p === "/forms" && method === "POST") return notInDemo("Uploading new PDFs");
    if (p === "/scan") {
      const files = init.body.getAll("files");
      return json({ results: files.map((f) => scanResult(f.name) || { file: f.name, category: "other", method: "ocr", readable: false, names: { status: "unknown" }, note: "In this demo only the sample documents are read." }) });
    }
    if ((m = p.match(/^\/forms\/(\w+)\/pages\/(\d+)\.png$/))) {
      const key = `${m[1]}/${m[2]}`;
      pngs[key] = pngs[key] || new Blob([b64ToBytes(forms[m[1]].pages[+m[2]])], { type: "image/png" });
      return new Response(pngs[key], { headers: { "Content-Type": "image/png" } });
    }
    if ((m = p.match(/^\/forms\/(\w+)\/(template|detect|check|fill|pack|bills)$/))) {
      const f = forms[m[1]];
      if (!f) return json({ detail: "Form not found" }, 404);
      if (m[2] === "template" && method === "GET") return json(f.template);
      if (m[2] === "template" && method === "PUT") { f.template = { ...body(), version: (f.template.version || 1) + 1 }; return json({ saved: true, version: f.template.version }); }
      if (m[2] === "detect") return json(f.detect);
      if (m[2] === "check") { const v = body().values || {}; return json({ computed: computedValues(f.template, v), issues: check(f.template, v) }); }
      if (m[2] === "fill") return notInDemo("Creating the filled PDF");
      if (m[2] === "pack") return notInDemo("Building the claim pack PDF");
    }
    if ((m = p.match(/^\/forms\/(\w+)$/)) && method === "DELETE") return notInDemo("Deleting forms");
    return json({ detail: "Not available in the demo" }, 404);
  };
}
