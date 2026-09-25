let token = null;
let session = crypto.randomUUID().replaceAll("-", "");
const pending = new Set();

async function call(path, opts = {}) {
  const requestSession = session;
  const headers = { ...(opts.headers || {}) };
  if (token) headers["X-FormFill-Token"] = token;
  headers["X-FormFill-Session"] = session;
  const controller = new AbortController();
  pending.add(controller);
  let res;
  try {
    const response = await fetch(`/api${path}`, { ...opts, headers, cache: "no-store", signal: controller.signal });
    const body = await response.arrayBuffer();
    if (requestSession !== session) throw new DOMException("Session cleared", "AbortError");
    res = new Response(body, {status: response.status, statusText: response.statusText, headers: response.headers});
  } finally { pending.delete(controller); }
  if (res.status === 401) {
    const t = window.prompt("This FormFill server needs an access token. Ask your admin for it.");
    if (t) { token = t; return call(path, opts); }
  }
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch { /* not json */ }
    throw new Error(formatDetail(detail));
  }
  return res;
}

const json = (r) => r.json();

// FastAPI validation errors arrive as a list of {loc, msg}; turn them into plain sentences.
function formatDetail(detail) {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((d) => String(d.msg || d).replace(/^Value error, /, "")).join(" · ");
  }
  return JSON.stringify(detail);
}

export const api = {
  templates: () => call("/templates").then(json),
  upload: (file) => { const fd = new FormData(); fd.append("file", file); return call("/forms", { method: "POST", body: fd }).then(json); },
  detect: (id) => call(`/forms/${id}/detect`).then(json),
  template: (id) => call(`/forms/${id}/template`).then(json),
  saveTemplate: (id, tpl) => call(`/forms/${id}/template`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(tpl) }).then(json),
  remove: (id) => call(`/forms/${id}`, { method: "DELETE" }).then(json),
  fill: (id, values) => call(`/forms/${id}/fill`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values }) }).then((r) => r.blob()),
  pageImage,
  check: (id, values) => call(`/forms/${id}/check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values }) }).then(json),
  features: () => call("/features").then(json),
  scan: (files, names = []) => {
    const fd = new FormData(); files.forEach((f) => fd.append("files", f)); fd.append("names", JSON.stringify(names));
    return call("/scan", { method: "POST", body: fd }).then(json);
  },
  pack: async (id, files, categories, values) => {
    const fd = new FormData(); files.forEach((f) => fd.append("files", f));
    fd.append("categories", JSON.stringify(categories)); fd.append("values", JSON.stringify(values));
    const res = await call(`/forms/${id}/pack`, { method: "POST", body: fd });
    let report = null;
    try { report = JSON.parse(res.headers.get("X-FormFill-Report") || "null"); } catch { /* ignore */ }
    return { blob: await res.blob(), report };
  },
};

// Page images need the access token too, and <img src> cannot send headers:
// fetch them through call() and hand out object URLs (cached per form/page).
const imageCache = new Map();
function pageImage(id, page) {
  const key = `${id}/${page}`;
  if (!imageCache.has(key)) {
    const p = call(`/forms/${id}/pages/${page}.png`).then((r) => r.blob()).then((b) => URL.createObjectURL(b));
    p.catch(() => imageCache.delete(key));
    imageCache.set(key, p);
  }
  return imageCache.get(key);
}

export async function clearSession() {
  for (const controller of pending) controller.abort();
  pending.clear();
  for (const promise of imageCache.values()) promise.then(URL.revokeObjectURL).catch(() => {});
  imageCache.clear();
  const headers = {"X-FormFill-Session": session};
  if (token) headers["X-FormFill-Token"] = token;
  session = crypto.randomUUID().replaceAll("-", "");
  token = null;
  try {
    const r = await fetch('/api/session/clear', {method:'POST', headers, cache:'no-store', keepalive:true});
    return r.ok;
  } catch { return false; }
}
window.addEventListener('pagehide', () => { void clearSession(); });
window.addEventListener('pageshow', (event) => { if (event.persisted) window.location.reload(); });
