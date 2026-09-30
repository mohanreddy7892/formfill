import { useEffect, useState } from "react";
import { api } from "../api.js";
import Menu from "./Menu.jsx";
import { Files, Lock } from "./Icons.jsx";

const STEPS = ["Choose", "Fill", "Download"];

export default function Library({ go }) {
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);

  const load = () => api.templates().then(setItems).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function upload(file) {
    if (!file || busy) return;
    setError(""); setBusy(true);
    try {
      const r = await api.upload(file);
      go(r.fields > 0 && !r.review_layout ? "fill" : "design", r.form_id);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function remove(t) {
    if (!window.confirm(`Delete "${t.name}" from this session?`)) return;
    await api.remove(t.form_id).catch((e) => setError(e.message));
    load();
  }

  return (
    <section className="library">
      <div className="hero">
        <h1>Fill a PDF form.</h1>
        <p className="lede"><Lock width={18} height={18} />Nothing leaves your device.</p>
      </div>

      <div
        className={`drop ${drag ? "is-drag" : ""} ${busy ? "is-busy" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files[0]); }}
      >
        <div className="cells" aria-hidden="true">
          {"PDF".split("").map((c, i) => <span key={i} className="cell on">{c}</span>)}
          {Array.from({ length: 6 }, (_, i) => <span key={i} className="cell" />)}
        </div>
        <input className="file-picker" type="file" accept=".pdf,application/pdf" aria-label="Choose a blank PDF form" disabled={busy}
          onChange={(e) => { const file = e.currentTarget.files?.[0]; if (!file) return; e.currentTarget.value = ""; upload(file); }} />
        <p className="drop-hint" role="status">{busy ? "Reading the form…" : <>Blank PDF, up to 20 MB<span className="hover-only"> · or drop it here</span></>}</p>
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      {items === null ? null : items.length === 0 ? (
        <ol className="steps" aria-label="How it works">
          {STEPS.map((s, i) => <li key={s}><span className="cell on">{i + 1}</span>{s}</li>)}
        </ol>
      ) : (
        <ul className="form-cards" aria-label="Forms in this session">
          {items.map((t) => (
            <li key={t.form_id} className="form-card">
              <span className="doc-icon" aria-hidden="true"><Files /></span>
              <div className="form-card-text">
                <strong>{t.name}</strong>
                <span className="muted">{t.pages} {t.pages === 1 ? "page" : "pages"} · {t.fields} fields</span>
              </div>
              <button className="btn primary" onClick={() => go("fill", t.form_id)} disabled={!t.fields}>Fill</button>
              <Menu label={`More for ${t.name}`}>
                <button type="button" role="menuitem" onClick={() => go("design", t.form_id)}>Edit fields</button>
                <button type="button" role="menuitem" className="danger" onClick={() => remove(t)}>Delete</button>
              </Menu>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
