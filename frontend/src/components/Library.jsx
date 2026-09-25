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
    if (!window.confirm(`Delete "${t.name}" and its field layout for everyone?`)) return;
    await api.remove(t.form_id).catch((e) => setError(e.message));
    load();
  }

  return (
    <section className="library">
      <div className="library-intro">
        <h1>Fill any PDF form without printing it.</h1>
        <p>Upload a blank form once and map its boxes. After that, anyone on the team can type their details and download a neatly filled copy.</p>
      </div>

      <label
        className={`dropzone ${drag ? "is-drag" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files[0]); }}
      >
        <input ref={input} type="file" accept="application/pdf" hidden onChange={(e) => upload(e.target.files[0])} />
        <span className="dropzone-title">{busy ? "Reading the form…" : "Drop a blank PDF form here"}</span>
        <span className="dropzone-sub">or <u>choose a file</u> · up to 20 MB</span>
      </label>
      {error && <p className="error" role="alert">{error}</p>}

      <h2 className="section-title">Forms on this server</h2>
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
