export function wholeRupees(raw) {
  const s = String(raw ?? "").trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export const isEmpty = (v) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

export function slug(s, taken) {
  const base = (s || "field").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 32) || "field";
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}_${n++}`;
  return id;
}

/**
 * Append new fields to the CURRENT list, giving each a unique id. Pure: safe inside a React functional
 * state update (so batched additions see each other) and under StrictMode's double invocation.
 * Returns { fields, ids } where ids are the ids assigned to the new fields, in order.
 */
export function appendFields(current, partials, defaults = {}) {
  const taken = new Set(current.map((f) => f.id));
  const made = partials.map((p) => {
    const label = p.label || "New field";
    const id = slug(label, taken);
    taken.add(id);
    return { ...defaults, ...p, label, id };
  });
  return { fields: [...current, ...made], ids: made.map((f) => f.id) };
}

export function groupBy(fields) {
  const m = new Map();
  fields.forEach((f) => { const g = f.group || "General"; if (!m.has(g)) m.set(g, []); m.get(g).push(f); });
  return m;
}

export const overlaps = (a, b) => !(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]);

export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const TOWARDS = { pharmacy: "PHARMACY", lab: "LAB INVESTIGATIONS", hospital: "HOSPITAL BILL", other: "OTHERS" };

/** "2026-08-31" -> "310826" (DDMMYY) or "31082026" (DDMMYYYY). */
export function isoToForm(iso, format = "DDMMYY") {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return "";
  return format === "DDMMYYYY" ? `${m[3]}${m[2]}${m[1]}` : `${m[3]}${m[2]}${m[1].slice(2)}`;
}

/**
 * Place scanned bills into a template table without overwriting anything the person typed.
 * Bills prefer a row printed for their type (hospital, pharmacy); the rest take free rows in order.
 * Rows printed for pre/post-hospitalization bill counts are never filled automatically.
 * Returns { updates, placed, skipped } where skipped explains every bill that was not placed.
 */
export function assignBills(table, values, bills) {
  const updates = {};
  const val = (id) => (id ? updates[id] ?? values[id] : undefined);
  const empty = (row) => row.ids.every((id) => isEmpty(val(id)));
  const rows = table.rows.map((r) => ({ ...r, ids: [r.no, r.date, r.issuer, r.amount].filter(Boolean) }));
  const existingNos = new Set(rows.map((r) => String(val(r.no) || "").toUpperCase()).filter(Boolean));
  const placed = [], skipped = [];
  for (const b of bills) {
    if (!b || b.amount == null) { skipped.push({ bill: b, reason: "no amount found" }); continue; }
    if (wholeRupees(b.amount) === null) { skipped.push({ bill: b, reason: "enter a positive whole-rupee amount" }); continue; }
    const no = String(b.bill_no || "").toUpperCase();
    if (no && existingNos.has(no)) { skipped.push({ bill: b, reason: "already in the form" }); continue; }
    // a row printed for this bill type first (e.g. "Hospital main bill", "Pharmacy bills"), then free rows
    const row = rows.find((r) => r.kind && r.kind === b.kind && empty(r)) || rows.find((r) => !r.kind && empty(r));
    if (!row) { skipped.push({ bill: b, reason: "no free row left" }); continue; }
    const put = (id, v) => { if (id && v !== "" && v != null) updates[id] = v; };
    put(row.no, no);
    put(row.date, isoToForm(b.date, table.date_format));
    put(row.issuer, String(b.issuer || "").toUpperCase());
    put(row.amount, String(b.amount));
    if (!row.kind) put(row.towards, TOWARDS[b.kind] || TOWARDS.other);
    if (no) existingNos.add(no);
    placed.push({ bill: b, row: table.rows.indexOf(table.rows.find((r) => r.no === row.no)) + 1 });
  }
  return { updates, placed, skipped };
}

/**
 * Find day / month / year box rows so they can be shown as one date field.
 * A run is 3 consecutive box fields: (2, 2, 2|4 boxes) named "... - day/month/year" or sharing one label.
 * Returns items in display order: {date:[d,m,y], label} or {field}.
 */
export function dateRuns(fields) {
  const SUFFIX = /\s*[-\u2013:]\s*(day|month|year)(\s*\(.*?\))?\s*$/i;
  const base = (f) => (f.label || "").replace(SUFFIX, "").trim();
  const kind = (f) => (SUFFIX.exec(f.label || "")?.[1] || "").toLowerCase();
  const out = [];
  for (let i = 0; i < fields.length; i++) {
    const [a, b, c] = [fields[i], fields[i + 1], fields[i + 2]];
    const boxes = (f) => f?.type === "boxes" ? f.boxes.length : 0;
    const shape = boxes(a) === 2 && boxes(b) === 2 && (boxes(c) === 2 || boxes(c) === 4);
    const named = kind(a) === "day" && kind(b) === "month" && kind(c) === "year" && base(a) === base(b) && base(b) === base(c);
    const same = !!a?.label && a.label === b?.label && b?.label === c?.label && /birth|dob|date|admission|discharge/i.test(a.label);
    if (shape && (named || same) && a.page === b.page && b.page === c.page) {
      out.push({ date: [a, b, c], label: named ? base(a) : a.label });
      i += 2;
    } else out.push({ field: a });
  }
  return out;
}

/** Bounding box [x0, y0, x1, y1] of everything a field draws on the page. */
export function fieldBounds(f) {
  const rects = f.type === "boxes" ? f.boxes : f.type === "choice" ? (f.options || []).map((o) => o.rect) : [f.rect];
  const r = rects.filter(Boolean);
  if (!r.length) return null;
  return [Math.min(...r.map((b) => b[0])), Math.min(...r.map((b) => b[1])), Math.max(...r.map((b) => b[2])), Math.max(...r.map((b) => b[3]))];
}

/** Fields with a value, in reading order (page, then top to bottom, then left to right). */
export function reviewItems(fields, values) {
  return fields
    .map((f, i) => ({ f, i, b: fieldBounds(f) }))
    .filter(({ f, b }) => b && !isEmpty(values[f.id]))
    .sort((a, b) => a.f.page - b.f.page || a.b[1] - b.b[1] || a.b[0] - b.b[0] || a.i - b.i)
    .map(({ f }) => f);
}

/** A viewBox [x, y, w, h] around bounds, padded and kept inside the page, at a steady aspect ratio. */
export function cropBox(b, page) {
  const w = Math.min(page.width, Math.max(240, b[2] - b[0] + 80));
  const h = Math.min(page.height, Math.max(b[3] - b[1] + 40, w / 2.5));
  const x = Math.min(Math.max(0, (b[0] + b[2]) / 2 - w / 2), page.width - w);
  const y = Math.min(Math.max(0, (b[1] + b[3]) / 2 - h / 2), page.height - h);
  return [x, y, w, h];
}

/** Human-readable form of a stored value for a field. */
export function displayValue(f, v) {
  if (f.type === "checkbox") return v === true || /^(1|true|yes|y|x|on)$/i.test(String(v)) ? "Ticked" : "Not ticked";
  return Array.isArray(v) ? v.join(", ") : String(v ?? "");
}
