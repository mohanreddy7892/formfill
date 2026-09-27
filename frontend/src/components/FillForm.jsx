import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import PageCanvas from "./PageCanvas.jsx";
import ValueLayer from "./ValueLayer.jsx";
import Documents from "./Documents.jsx";
import { download, groupBy, isEmpty } from "../util.js";

export default function FillForm({ formId, go }) {
  const [tpl, setTpl] = useState(null);
  const [values, setValues] = useState({});
  const [page, setPage] = useState(0);
  const [activeId, setActiveId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [computed, setComputed] = useState({});
  const [issues, setIssues] = useState([]);
  const [showDocs, setShowDocs] = useState(false);
  const seq = useRef(0);

  // Auto-calculated values and cross-checks, refreshed shortly after typing stops.
  useEffect(() => {
    if (!tpl) return;
    const n = ++seq.current;
    const t = setTimeout(() => {
      const clean = Object.fromEntries(Object.entries(values).filter(([, v]) => !isEmpty(v)));
      api.check(formId, clean).then((r) => { if (n === seq.current) { setComputed(r.computed || {}); setIssues(r.issues || []); } }).catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [values, tpl, formId]);

  useEffect(() => { api.template(formId).then((t) => { setTpl(t); setPage(t.fields[0]?.page ?? 0); }).catch((e) => setMsg({ err: e.message })); }, [formId]);

  const groups = useMemo(() => (tpl ? groupBy(tpl.fields) : new Map()), [tpl]);
  const effective = useMemo(() => ({ ...computed, ...Object.fromEntries(Object.entries(values).filter(([, v]) => !isEmpty(v))) }), [computed, values]);
  const autoIds = useMemo(() => new Set(Object.keys(computed).filter((k) => isEmpty(values[k]))), [computed, values]);
  const filled = tpl ? tpl.fields.filter((f) => !isEmpty(effective[f.id])).length : 0;
  const errors = issues.filter((i) => i.severity === "error");
  const set = (id, v) => setValues((s) => ({ ...s, [id]: v }));

  // Keep the field being edited visible in the page preview.
  useEffect(() => {
    if (!activeId) return;
    const t = setTimeout(() => {
      document.querySelector(".preview .field-active rect")?.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    }, 60);
    return () => clearTimeout(t);
  }, [activeId, page]);
  const focus = (f) => { setActiveId(f.id); setPage(f.page); };

  async function generate() {
    setBusy(true); setMsg(null);
    try {
      download(await api.fill(formId, effective), `${tpl.name.replace(/[^\w-]+/g, "_")}_filled.pdf`);
      setMsg({ ok: "Filled PDF downloaded. Sign it, then submit it." });
    } catch (e) { setMsg({ err: e.message }); } finally { setBusy(false); }
  }

  if (!tpl) return <p className="muted pad">{msg?.err || "Loading form…"}</p>;
  if (!tpl.fields.length) return (
    <div className="pad"><p>This form has no fields yet.</p><button className="btn primary" onClick={() => go("design", formId)}>Map its fields</button></div>
  );

  return (
    <section className="fill">
      <div className="toolbar">
        <h1 className="title">{tpl.name}</h1>
        <span className="progress" aria-label={`${filled} of ${tpl.fields.length} fields filled`}>
          <span style={{ width: `${(filled / tpl.fields.length) * 100}%` }} />
        </span>
        <span className="muted">{filled}/{tpl.fields.length}</span>
        <span className="spacer" />
        <button className="btn" onClick={() => setShowDocs(true)}>Documents &amp; bills</button>
        <button className="btn primary" onClick={generate} disabled={busy || !filled || errors.length > 0}
          title={errors.length ? "Fix the errors listed under Checks first" : undefined}>{busy ? "Filling…" : "Download filled PDF"}</button>
      </div>
      {msg && <p className={msg.err ? "error banner" : "ok banner"} role={msg.err ? "alert" : "status"}>{msg.err || msg.ok}</p>}

      <div className="fill-body">
        <form autoComplete="off" className="fields" onSubmit={(e) => e.preventDefault()}>
          {issues.length > 0 && (
            <section className="checks" aria-label="Checks">
              <h3>Checks <span className="muted">{errors.length ? `${errors.length} to fix` : "looks consistent"}{issues.length - errors.length ? ` · ${issues.length - errors.length} to review` : ""}</span></h3>
              <ul>
                {issues.map((i, k) => {
                  const f = tpl.fields.find((x) => x.id === i.fields?.[0]);
                  return (
                    <li key={k} className={i.severity}>
                      <button type="button" onClick={() => { if (f) { focus(f); document.getElementById(`f-${f.id}`)?.focus(); } }}>{i.message}</button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {[...groups].map(([g, fs]) => (
            <fieldset key={g}>
              <legend>{g}</legend>
              {fs.map((f) => <Input key={f.id} f={f} v={values[f.id]} auto={autoIds.has(f.id) ? computed[f.id] : undefined} set={set} onFocus={() => focus(f)} active={f.id === activeId} />)}
            </fieldset>
          ))}
        </form>
        <div className="preview">
          <div className="page-tabs" role="tablist">
            {tpl.pages.map((_, i) => tpl.fields.some((f) => f.page === i) && (
              <button key={i} role="tab" aria-selected={i === page} className={i === page ? "on" : ""} onClick={() => setPage(i)}>Page {i + 1}</button>
            ))}
          </div>
          <PageCanvas formId={formId} page={page} info={tpl.pages[page]}>
            <ValueLayer fields={tpl.fields} values={effective} autoIds={autoIds} page={page} activeId={activeId} />
          </PageCanvas>
        </div>
      </div>
      {showDocs && <Documents formId={formId} tpl={tpl} values={values} effective={effective} setValues={setValues} onClose={() => setShowDocs(false)} />}
    </section>
  );
}

function Input({ f, v, auto, set, onFocus, active }) {
  const id = `f-${f.id}`;
  const common = { id, onFocus };
  let control;
  if (f.type === "boxes") {
    const len = String(v ?? "").length;
    control = (
      <div className="boxes-input">
        <input {...common} value={v ?? ""} placeholder={auto ? `auto: ${auto}` : undefined} maxLength={f.boxes.length} autoComplete="off"
          style={{ "--n": Math.min(f.boxes.length, 40) }} className={f.upper !== false ? "caps" : ""}
          onChange={(e) => set(f.id, e.target.value)} />
        <span className={`count ${len === f.boxes.length ? "full" : ""}`}>{len}/{f.boxes.length}</span>
      </div>
    );
  } else if (f.type === "text" || f.type === "acro") {
    const props = { ...common, value: v ?? "", autoComplete: "off", placeholder: auto ? `auto: ${auto}` : undefined, className: f.upper !== false ? "caps" : "", onChange: (e) => set(f.id, e.target.value) };
    control = f.type === "text" && f.rect && f.rect[3] - f.rect[1] > 20
      ? <textarea {...props} rows={3} /> : <input {...props} />;
  } else if (f.type === "checkbox") {
    control = <input {...common} type="checkbox" checked={!!v} onChange={(e) => set(f.id, e.target.checked)} />;
  } else if (f.type === "choice") {
    const chosen = Array.isArray(v) ? v : v ? [v] : [];
    const autoChosen = !chosen.length && auto ? [auto] : [];
    control = (
      <div className="chips" role={f.multi ? "group" : "radiogroup"} aria-labelledby={`${id}-l`}>
        {f.options.map((o) => {
          const on = chosen.includes(o.value);
          const autoOn = autoChosen.includes(o.value);
          return (
            <button key={o.value} type="button" onFocus={onFocus} aria-pressed={on} className={on ? "on" : autoOn ? "auto-on" : ""}
              onClick={() => set(f.id, f.multi ? (on ? chosen.filter((x) => x !== o.value) : [...chosen, o.value]) : on ? "" : o.value)}>
              {o.value.toLowerCase()}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div className={`field ${active ? "is-active" : ""} ${f.type === "checkbox" ? "field-check" : ""}`}>
      <label htmlFor={id} id={`${id}-l`}>{f.label || f.id}{auto !== undefined && <span className="auto-chip" title="Calculated from other fields. Type to override.">auto</span>}</label>
      {control}
      {f.hint && <small className="muted">{f.hint}</small>}
    </div>
  );
}
