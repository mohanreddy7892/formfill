// Browser port of backend/app/rules.py for the offline demo. Kept identical (see rules.parity.test.mjs).
const txt = (v) => (v === undefined || v === null ? "" : String(v).trim());

export function num(v) {
  const s = txt(v).replace(/[,\s₹]/g, "").replace(/rs\.?/gi, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function mkDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt : null;
}

export function toDate(ref, values) {
  if (!ref) return null;
  let d, m, y;
  if (ref.field) {
    const s = txt(values[ref.field]).replace(/\D/g, "");
    const fmt = ref.format || "DDMMYY";
    if (fmt === "DDMMYY" && s.length === 6) { d = +s.slice(0, 2); m = +s.slice(2, 4); y = 2000 + +s.slice(4); }
    else if (fmt === "DDMMYYYY" && s.length === 8) { d = +s.slice(0, 2); m = +s.slice(2, 4); y = +s.slice(4); }
    else return null;
  } else {
    const parts = [ref.d, ref.m, ref.y].map((k) => txt(values[k]));
    if (parts.some((p) => !/^\d+$/.test(p))) return null;
    [d, m, y] = parts.map(Number);
    if (y < 100) y += 2000;
  }
  return mkDate(y, m, d);
}

const DAY = 86400000;
const days = (a, b) => Math.round((b - a) / DAY);
const monthsBetween = (a, b) => (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth() - (b.getUTCDate() < a.getUTCDate() ? 1 : 0);
const pad2 = (n) => String(n).padStart(2, "0");
const fmt = (dt) => `${pad2(dt.getUTCDate())}-${pad2(dt.getUTCMonth() + 1)}-${dt.getUTCFullYear()}`;
const nfmt = (n) => n.toLocaleString("en-US");

export function computeValue(c, values) {
  if (c.kind === "sum") {
    const ns = c.of.map((k) => num(values[k]));
    return ns.some((n) => n !== null) ? String(ns.reduce((a, n) => a + (n ?? 0), 0)) : null;
  }
  if (c.kind === "copy") return txt(values[c.source]) || null;
  if (c.kind === "age_years" || c.kind === "age_months") {
    const dob = toDate(c.dob, values), on = toDate(c.on, values);
    if (!dob || !on || on < dob) return null;
    const mo = monthsBetween(dob, on);
    return pad2(c.kind === "age_years" ? Math.floor(mo / 12) : mo % 12);
  }
  if (c.kind === "days_between") {
    const a = toDate(c.start, values), b = toDate(c.end, values);
    if (!a || !b || b < a) return null;
    return pad2(days(a, b) + (c.inclusive ? 1 : 0));
  }
  return null;
}

const present = (v) => txt(v) !== "" || v === true || (Array.isArray(v) && v.length > 0);

export function computedValues(tpl, values) {
  const merged = Object.fromEntries(Object.entries(values).filter(([, v]) => present(v)));
  const out = {};
  const fields = tpl.fields.filter((f) => f.compute);
  for (let i = 0; i <= fields.length; i++) {
    let changed = false;
    for (const f of fields) {
      if (f.id in merged && !(f.id in out)) continue;
      let v = computeValue(f.compute, merged);
      if (f.type === "boxes" && v !== null && v.length > f.boxes.length) v = null;
      if (v !== null && out[f.id] !== v) { out[f.id] = merged[f.id] = v; changed = true; }
    }
    if (!changed) break;
  }
  return out;
}

const ids = (ref) => (ref.field ? [ref.field] : [ref.d, ref.m, ref.y]);

export function check(tpl, values) {
  const v = { ...values, ...computedValues(tpl, values) };
  const by = Object.fromEntries(tpl.fields.map((f) => [f.id, f]));
  const labels = (list) => list.filter((i) => by[i]).map((i) => by[i].label || i).join(", ");
  const issues = [];
  const add = (r, message, fields) => issues.push({ severity: r.severity || "warning", message, fields });
  for (const r of tpl.rules || []) {
    if (r.kind === "equals_sum") {
      const target = num(v[r.target]), parts = r.of.map((k) => num(v[k]));
      if (target !== null && parts.some((p) => p !== null)) {
        const total = parts.reduce((a, p) => a + (p ?? 0), 0);
        if (total !== target) add(r, `${r.message} (entered ${nfmt(target)}, adds up to ${nfmt(total)})`, [r.target, ...r.of]);
      }
    } else if (r.kind === "date_order") {
      const a = toDate(r.first, v), b = toDate(r.second, v);
      if (a && b && (b < a || (+b === +a && r.allow_equal === false))) add(r, `${r.message} (${fmt(a)} → ${fmt(b)})`, [...ids(r.first), ...ids(r.second)]);
    } else if (r.kind === "date_within") {
      const s = toDate(r.start, v), e = toDate(r.end, v);
      if (!s || !e) continue;
      const lo = new Date(+s - (r.days_before || 0) * DAY), hi = new Date(+e + (r.days_after || 0) * DAY);
      for (const d of r.dates) {
        const dt = toDate(d, v);
        if (dt && (dt < lo || dt > hi)) add(r, `${r.message}: ${labels(ids(d))} is ${fmt(dt)}`, ids(d));
      }
    } else if (r.kind === "same_text") {
      const filled = r.of.map((k) => [k, txt(v[k]).replace(/\s+/g, " ").toUpperCase()]).filter(([, x]) => x);
      const uniq = [...new Set(filled.map(([, x]) => x))];
      if (uniq.length > 1) add(r, `${r.message} (${uniq.sort().join(" / ")})`, filled.map(([k]) => k));
    } else if (r.kind === "required") {
      const empty = r.of.filter((k) => {
        const value = v[k];
        if (by[k].type === "checkbox") return !(value === true ||
          (["string", "number"].includes(typeof value) && ["1", "true", "yes", "y", "on", "x", "checked"].includes(txt(value).toLowerCase())));
        if (Array.isArray(value)) return !value.length || !value.every((x) => typeof x === "string" && x.trim());
        return value == null || value === false || typeof value === "object" || !txt(value);
      });
      if (empty.length) add(r, `${r.message}: ${labels(empty)}`, empty);
    }
  }
  return issues;
}
