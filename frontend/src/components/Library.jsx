import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";

export default function Library({ go }) {
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const input = useRef();

  const load = () => api.templates().then(setItems).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function upload(file) {
    if (!file) return;
    setError(""); setBusy(true);
    try {
      const r = await api.upload(file);
      go(r.fields > 0 ? "fill" : "design", r.form_id);
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

      <label
        className={`dropzone ${drag ? "is-drag" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files[0]); }}
      >
        <input ref={input} type="file" accept="application/pdf" hidden onChange={(e) => { const file = e.target.files[0]; e.target.value = ""; upload(file); }} />
        <span className="dropzone-title">{busy ? "Reading the form…" : "Drop a blank PDF form here"}</span>
        <span className="dropzone-sub">or <u>choose a file</u> · up to 20 MB and 40 pages</span>
      </label>
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
