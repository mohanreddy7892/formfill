import { useEffect, useState } from "react";
import { api } from "../api.js";

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
    if (!window.confirm(`Delete "${t.name}" and its field layout from this session?`)) return;
    await api.remove(t.form_id).catch((e) => setError(e.message));
    load();
  }

  return (
    <section className="library">
      <div className="library-intro">
        <h1>Fill a PDF form without printing it.</h1>
        <p>Choose a form, fill it, and download the result. Your documents stay in this browser tab. Forms and layouts expire after 15 minutes; use Clear session when finished.</p>
      </div>

      <div
        className={`dropzone ${drag ? "is-drag" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files[0]); }}
      >
        <span className="dropzone-title">{busy ? "Reading the form…" : "Drop a blank PDF form here"}</span>
        <span className="dropzone-sub">Choose a PDF · up to 20 MB and 40 pages</span>
        <input className="file-picker" type="file" accept=".pdf,application/pdf" aria-label="Choose a blank PDF form" disabled={busy}
          onChange={(e) => { const file = e.currentTarget.files?.[0]; if (!file) return; e.currentTarget.value = ""; upload(file); }} />
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      <h2 className="section-title">Forms in this temporary session</h2>
      {items === null ? <p className="muted">Loading…</p> : items.length === 0 ? (
        <p className="muted">No forms yet. Upload the first one above.</p>
      ) : (
        <ul className="form-list">
          {items.map((t) => (
            <li key={t.form_id}>
              <div>
                <strong>{t.name}</strong>
                <span className="muted">{t.pages} pages, {t.fields} fields</span>
              </div>
              <div className="row-actions">
                <button className="btn primary" onClick={() => go("fill", t.form_id)} disabled={!t.fields}>Fill</button>
                <button className="btn" onClick={() => go("design", t.form_id)}>Edit fields</button>
                <button className="btn ghost danger" onClick={() => remove(t)} aria-label={`Delete ${t.name}`}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
