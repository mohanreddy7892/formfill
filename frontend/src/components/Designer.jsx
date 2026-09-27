import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import PageCanvas, { PageThumb, rectOf } from "./PageCanvas.jsx";
import { Outline } from "./ValueLayer.jsx";
import { appendFields, groupBy, overlaps } from "../util.js";

const MODES = [
  { id: "select", label: "Pick detected", tip: "Click amber boxes to select them, then make a field" },
  { id: "text", label: "Draw text area", tip: "Drag a rectangle for free text" },
  { id: "boxes", label: "Draw box row", tip: "Drag across a row of character boxes" },
  { id: "checkbox", label: "Draw checkbox", tip: "Drag around a single tick box" },
];

export default function Designer({ formId, go }) {
  const [tpl, setTpl] = useState(null);
  const [det, setDet] = useState(null);
  const [page, setPage] = useState(0);
  const [mode, setMode] = useState("select");
  const [sel, setSel] = useState([]);           // selected run ids on current page
  const [activeId, setActiveId] = useState(null);
  const [draft, setDraft] = useState(null);     // rect being drawn
  const [status, setStatus] = useState("");
  const [dirty, setDirty] = useState(false);
  const svgRef = useRef();

  useEffect(() => {
    Promise.all([api.template(formId), api.detect(formId)]).then(([t, d]) => { setTpl(t); setDet(d); })
      .catch((e) => setStatus(e.message));
  }, [formId]);

  const update = useCallback((fn) => { setTpl((t) => ({ ...t, fields: fn(t.fields) })); setDirty(true); }, []);
  const active = tpl?.fields.find((f) => f.id === activeId);

  const runs = det?.pages[page]?.runs || [];
  const usedRects = useMemo(() => (tpl?.fields || []).filter((f) => f.page === page)
    .flatMap((f) => f.type === "boxes" ? f.boxes : f.type === "choice" ? f.options.map((o) => o.rect) : [f.rect]).filter(Boolean), [tpl, page]);
  const isUsed = (run) => run.boxes.some((b) => usedRects.some((u) => overlaps(b, u)));

  // Ids are generated inside the functional update from the *current* list, so several fields
  // created in one go (e.g. "Make checkboxes") never collide. The newest id is then selected.
  const pendingActive = useRef(null);
  function addFields(partials) {
    const defaults = { group: `Page ${page + 1}`, page, align: "left", upper: true, clear: false, multi: false, boxes: [], options: [], hint: "" };
    update((fs) => {
      const { fields, ids } = appendFields(fs, partials, defaults);
      pendingActive.current = ids[ids.length - 1];
      return fields;
    });
    setSel([]);
  }
  const addField = (partial) => addFields([partial]);
  useEffect(() => {
    if (pendingActive.current) { setActiveId(pendingActive.current); pendingActive.current = null; }
  }, [tpl]);

  function fromSelection(kind) {
    const chosen = runs.filter((r) => sel.includes(r.id));
    if (!chosen.length) return;
    if (kind === "boxes") {
      addField({ type: "boxes", label: chosen[0].label || "New field", boxes: chosen.flatMap((r) => r.boxes).sort((a, b) => a[1] - b[1] || a[0] - b[0]) });
    } else if (kind === "checkbox") {
      addFields(chosen.map((r) => ({ type: "checkbox", label: r.label || "Checkbox", rect: r.boxes[0] })));
    } else if (kind === "choice") {
      const opts = chosen.flatMap((r) => r.boxes.map((b, i) => ({ value: (r.label || `Option ${i + 1}`).toUpperCase().slice(0, 24), rect: b })));
      addField({ type: "choice", label: "Choose one", options: opts });
    }
  }

  // --- drawing ---
  const toPt = (e) => {
    const svg = svgRef.current; const p = svg.createSVGPoint();
    p.x = e.clientX; p.y = e.clientY;
    const q = p.matrixTransform(svg.getScreenCTM().inverse());
    return [q.x, q.y];
  };
  const onDown = (e) => { if (mode === "select") return; const [x, y] = toPt(e); setDraft({ x0: x, y0: y, x1: x, y1: y }); };
  const onMove = (e) => { if (!draft) return; const [x, y] = toPt(e); setDraft((d) => ({ ...d, x1: x, y1: y })); };
  const onUp = () => {
    if (!draft) return;
    const r = [Math.min(draft.x0, draft.x1), Math.min(draft.y0, draft.y1), Math.max(draft.x0, draft.x1), Math.max(draft.y0, draft.y1)].map((v) => +v.toFixed(2));
    setDraft(null);
    if (r[2] - r[0] < 4 || r[3] - r[1] < 4) return;
    if (mode === "text") addField({ type: "text", label: "Text", rect: r });
    if (mode === "checkbox") addField({ type: "checkbox", label: "Checkbox", rect: r });
    if (mode === "boxes") {
      const n = Math.max(1, Math.round((r[2] - r[0]) / (r[3] - r[1])));
      addField({ type: "boxes", label: "Boxes", boxes: split(r, n) });
    }
  };

  useEffect(() => {
    const onKey = (e) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
      if (e.key === "Escape") { setSel([]); setActiveId(null); }
      if ((e.key === "Delete" || e.key === "Backspace") && activeId) { update((fs) => fs.filter((f) => f.id !== activeId)); setActiveId(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, update]);

  async function save() {
    try { const r = await api.saveTemplate(formId, tpl); setTpl((t) => ({ ...t, version: r.version })); setDirty(false); setStatus(window.__FORMFILL_DEMO__ ? "Saved (demo: until you reload)" : "Kept in this temporary session only"); }
    catch (e) { setStatus(e.message); }
  }

  if (!tpl || !det) return <p className="muted pad">{status || "Loading form…"}</p>;
  const info = tpl.pages[page];

  return (
    <section className="designer">
      <div className="toolbar">
        <input className="title-input" value={tpl.name} aria-label="Form name" onChange={(e) => { setTpl({ ...tpl, name: e.target.value }); setDirty(true); }} />
        <div className="seg" role="group" aria-label="Tool">
          {MODES.map((m) => (
            <button key={m.id} className={mode === m.id ? "on" : ""} title={m.tip} onClick={() => { setMode(m.id); setSel([]); }}>{m.label}</button>
          ))}
        </div>
        <span className="spacer" />
        {status && <span className="status" role="status">{status}</span>}
        <button className="btn" onClick={() => go("fill", formId)} disabled={dirty}>Try filling</button>
        <button className="btn primary" onClick={save} disabled={!dirty}>Save layout</button>
      </div>

      <div className="designer-body">
        <nav className="pages" aria-label="Pages">
          {tpl.pages.map((p, i) => (
            <button key={i} className={i === page ? "on" : ""} onClick={() => { setPage(i); setSel([]); }}>
              <PageThumb formId={formId} page={i} />
              <span>Page {i + 1} · {tpl.fields.filter((f) => f.page === i).length}</span>
            </button>
          ))}
        </nav>

        <div className="canvas-wrap">
          {mode === "select" && sel.length > 0 && (
            <div className="selbar">
              <span>{sel.length} selected</span>
              <button className="btn primary" onClick={() => fromSelection("boxes")}>Make one box field</button>
              <button className="btn" onClick={() => fromSelection("checkbox")}>Make checkboxes</button>
              <button className="btn" onClick={() => fromSelection("choice")}>Make a choice</button>
              <button className="btn ghost" onClick={() => setSel([])}>Clear</button>
            </div>
          )}
          <PageCanvas formId={formId} page={page} info={info} className={`mode-${mode}`}
            svgProps={{ ref: svgRef, onPointerDown: (e) => { if (mode !== "select") e.currentTarget.setPointerCapture(e.pointerId); onDown(e); }, onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: () => setDraft(null) }}>
            {tpl.fields.filter((f) => f.page === page).map((f) => (
              <g key={f.id} className="field-hit" onClick={(e) => { if (mode === "select") { e.stopPropagation(); setActiveId(f.id); } }}>
                <Outline f={f} className={f.id === activeId ? "outline active" : "outline mapped"} />
              </g>
            ))}
            {mode === "select" && runs.filter((r) => !isUsed(r)).map((r) => (
              <g key={r.id} className={`run ${sel.includes(r.id) ? "sel" : ""}`}
                 onClick={() => setSel((s) => s.includes(r.id) ? s.filter((x) => x !== r.id) : [...s, r.id])}>
                <title>{r.label || "Detected boxes"} ({r.boxes.length})</title>
                {r.boxes.map((b, i) => <rect key={i} {...rectOf(b)} />)}
                <rect className="hit" {...rectOf(bounds(r.boxes))} />
              </g>
            ))}
            {draft && <rect className="draft" x={Math.min(draft.x0, draft.x1)} y={Math.min(draft.y0, draft.y1)} width={Math.abs(draft.x1 - draft.x0)} height={Math.abs(draft.y1 - draft.y0)} />}
          </PageCanvas>
        </div>

        <aside className="inspector">
          {tpl.review_layout && <p className="hint-box" role="status">{tpl.fields.length} fields suggested from printed boxes. Select an outline to review its label and position. Rename fields as needed, save any changes, then choose Try filling. Detection can miss or misidentify boxes.</p>}
          {active ? <Inspector f={active} update={update} setActiveId={setActiveId} existing={tpl.fields} /> : (
            <div className="hint-box">
              <p><strong>Map this form</strong></p>
              <p>Amber outlines are boxes found on the page. Select one row (or several), then choose what it is. Use the draw tools for anything that wasn't found, including scanned forms.</p>
              <p className="muted">Esc clears the selection. Delete removes the selected field.</p>
            </div>
          )}
          <FieldList fields={tpl.fields} activeId={activeId} onPick={(f) => { setPage(f.page); setActiveId(f.id); setMode("select"); }} />
        </aside>
      </div>
    </section>
  );
}

function bounds(bs) {
  return [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))];
}

function split(r, n) {
  const w = (r[2] - r[0]) / n;
  return Array.from({ length: n }, (_, i) => [+(r[0] + i * w).toFixed(2), r[1], +(r[0] + (i + 1) * w).toFixed(2), r[3]]);
}

function Inspector({ f, update, setActiveId, existing }) {
  const set = (patch) => update((fs) => fs.map((x) => (x.id === f.id ? { ...x, ...patch } : x)));
  const groups = [...new Set(existing.map((x) => x.group))];
  const renameId = (v) => {
    const clean = v.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 64);
    if (!clean || existing.some((x) => x.id === clean && x.id !== f.id)) return;
    set({ id: clean }); setActiveId(clean);
  };
  return (
    <div className="insp">
      <div className="insp-head">
        <span className={`type-pill t-${f.type}`}>{f.type}</span>
        <button className="btn ghost danger" onClick={() => { update((fs) => fs.filter((x) => x.id !== f.id)); setActiveId(null); }}>Delete field</button>
      </div>
      <label>Label<input value={f.label} onChange={(e) => set({ label: e.target.value })} /></label>
      <label>Key in data files<input value={f.id} onChange={(e) => renameId(e.target.value)} /></label>
      <label>Section
        <input list="groups" value={f.group} onChange={(e) => set({ group: e.target.value })} />
        <datalist id="groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
      </label>
      <label>Help text for people filling<input value={f.hint || ""} onChange={(e) => set({ hint: e.target.value })} /></label>

      {f.type === "boxes" && <p className="muted">{f.boxes.length} boxes · max {f.boxes.length} characters</p>}
      {f.compute && (
        <p className="auto-note">Auto-calculated ({f.compute.kind.replace("_", " ")}{f.compute.of?.length ? ` of ${f.compute.of.length} fields` : f.compute.source ? ` from ${f.compute.source}` : ""}) when left empty.</p>
      )}
      {(f.type === "boxes" || f.type === "text") && (
        <div className="checks">
          <label className="inline"><input type="checkbox" checked={f.align === "right"} onChange={(e) => set({ align: e.target.checked ? "right" : "left" })} /> Right-align (amounts)</label>
          <label className="inline"><input type="checkbox" checked={f.upper !== false} onChange={(e) => set({ upper: e.target.checked })} /> Capital letters</label>
          <label className="inline"><input type="checkbox" checked={!!f.clear} onChange={(e) => set({ clear: e.target.checked })} /> Cover printed placeholder letters</label>
        </div>
      )}
      {f.type !== "checkbox" && f.type !== "choice" && (
        <label>Font size (pt, blank = auto)<input type="number" step="0.2" min="4" max="14" value={f.size ?? ""} onChange={(e) => set({ size: e.target.value ? +e.target.value : null })} /></label>
      )}
      {f.type === "choice" && (
        <>
          <label className="inline"><input type="checkbox" checked={!!f.multi} onChange={(e) => set({ multi: e.target.checked })} /> Allow more than one tick</label>
          <p className="muted">Options (value written in data files):</p>
          {f.options.map((o, i) => (
            <div key={i} className="opt-row">
              <input value={o.value} aria-label={`Option ${i + 1}`} onChange={(e) => set({ options: f.options.map((x, j) => (j === i ? { ...x, value: e.target.value.toUpperCase() } : x)) })} />
              <button className="btn ghost" aria-label="Remove option" onClick={() => set({ options: f.options.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function FieldList({ fields, activeId, onPick }) {
  const groups = groupBy(fields);
  return (
    <div className="field-list">
      <p className="list-title">{fields.length} fields</p>
      {[...groups].map(([g, fs]) => (
        <details key={g} open={fs.some((f) => f.id === activeId)}>
          <summary>{g} <span className="muted">{fs.length}</span></summary>
          {fs.map((f) => (
            <button key={f.id} className={f.id === activeId ? "on" : ""} onClick={() => onPick(f)}>
              <span>{f.label || f.id}</span><span className={`dot t-${f.type}`} aria-hidden="true" />
            </button>
          ))}
        </details>
      ))}
    </div>
  );
}
