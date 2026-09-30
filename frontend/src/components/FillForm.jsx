import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import PageCanvas from "./PageCanvas.jsx";
import ValueLayer from "./ValueLayer.jsx";
import Documents from "./Documents.jsx";
import QuickReview from "./QuickReview.jsx";
import { ArrowDown, Back, Check, Download, Files } from "./Icons.jsx";
import { dateRuns, download, groupBy, isEmpty } from "../util.js";

export default function FillForm({ formId, go, onClear }) {
  const [tpl, setTpl] = useState(null);
  const [values, setValues] = useState({});
  const [page, setPage] = useState(0);
  const [activeId, setActiveId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [computed, setComputed] = useState({});
  const [issues, setIssues] = useState([]);
  const [showDocs, setShowDocs] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [view, setView] = useState("fields");
  const [openGroups, setOpenGroups] = useState(null);   // Set of group names; null = first group only
  const [done, setDone] = useState(false);
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
      setDone(true);
    } catch (e) { setMsg({ err: e.message }); } finally { setBusy(false); }
  }

  if (!tpl) return <p className="muted pad">{msg?.err || "Opening form…"}</p>;
  if (!tpl.fields.length) return (
    <div className="pad empty-fill"><p>No fields yet.</p><button className="btn primary" onClick={() => go("design", formId)}>Add fields</button></div>
  );

  const groupList = [...groups];
  const isOpen = (g, gi) => (openGroups ? openGroups.has(g) : gi === 0);
  const toggleGroup = (g, gi, open) => setOpenGroups((cur) => {
    const next = new Set(cur ?? (groupList[0] ? [groupList[0][0]] : []));
    open ? next.add(g) : next.delete(g);
    return next;
  });
  const isFilled = (f) => !isEmpty(effective[f.id]);
  const nextEmpty = () => {
    const order = groupList.flatMap(([g, fs]) => fs.map((f) => ({ g, f })));
    const from = Math.max(0, order.findIndex((x) => x.f.id === activeId));
    const rotated = [...order.slice(from + 1), ...order.slice(0, from + 1)];
    const hit = rotated.find(({ f }) => !isFilled(f) && !autoIds.has(f.id));
    if (!hit) return;
    reveal(hit.f, hit.g);
  };
  const reveal = (f, g = f.group || "General") => {
    setView("fields");
    setOpenGroups((cur) => new Set([...(cur ?? (groupList[0] ? [groupList[0][0]] : [])), g]));
    focus(f);
    setTimeout(() => {
      const el = document.getElementById(`f-${f.id}`) || document.querySelector(`#f-${f.id}-l`)?.closest(".field")?.querySelector("button, input");
      el?.focus({ preventScroll: true });
      el?.closest(".field")?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 80);
  };
  const remaining = tpl.fields.filter((f) => !isFilled(f) && !autoIds.has(f.id)).length;

  const total = tpl.fields.length;
  const pct = total ? Math.round((filled / total) * 100) : 0;
  const warnings = issues.length - errors.length;
  const focusIssue = (i) => {
    const f = tpl.fields.find((x) => x.id === i.fields?.[0]);
    if (!f) return;
    setView("fields"); focus(f);
    setTimeout(() => document.getElementById(`f-${f.id}`)?.focus(), 50);
  };

  return (
    <section className="fill" data-view={view}>
      <div className="fillbar">
        <button className="icon-btn" onClick={() => go("library")} aria-label="Back to forms"><Back /></button>
        <div className="fill-title">
          <h1 className="title">{tpl.name}</h1>
          <span className="muted">{filled} of {total} filled</span>
        </div>
        <div className="seg view-switch" role="tablist" aria-label="Show">
          <button role="tab" aria-selected={view === "fields"} className={view === "fields" ? "on" : ""} onClick={() => setView("fields")}>Fields</button>
          <button role="tab" aria-selected={view === "preview"} className={view === "preview" ? "on" : ""} onClick={() => setView("preview")}>Preview</button>
        </div>
      </div>
      <div className="bar-progress" role="progressbar" aria-label="Fields filled" aria-valuemin={0} aria-valuemax={total} aria-valuenow={filled}><span style={{ width: `${pct}%` }} /></div>
      {msg && <p className={`notice ${msg.err ? "err" : "ok"}`} role={msg.err ? "alert" : "status"}>{msg.err || msg.ok}</p>}

      <div className="fill-body">
        <form autoComplete="off" className="fields" onSubmit={(e) => e.preventDefault()}>
          {issues.length > 0 && (
            <details className={`checks ${errors.length ? "has-error" : "has-warning"}`} open={errors.length > 0}>
              <summary>
                <span className="checks-badge">{errors.length ? `${errors.length} to fix` : `${warnings} to review`}</span>
                {errors.length > 0 && warnings > 0 && <span className="muted">+ {warnings} to review</span>}
              </summary>
              <ul>
                {issues.map((i, k) => (
                  <li key={k} className={i.severity}>
                    <button type="button" onClick={() => focusIssue(i)}>{i.message}</button>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {groupList.map(([g, fs], gi) => {
            const done = fs.filter((f) => !isEmpty(effective[f.id])).length;
            const common = (f) => ({ f, v: values[f.id], auto: autoIds.has(f.id) ? computed[f.id] : undefined, set, onFocus: () => focus(f), active: f.id === activeId });
            return (
              <details className="group" key={g} open={isOpen(g, gi)} onToggle={(e) => { if (e.currentTarget.open !== isOpen(g, gi)) toggleGroup(g, gi, e.currentTarget.open); }}>
                <summary>
                  <span className="group-name">{g}</span>
                  <span className={`group-count ${done === fs.length ? "done" : ""}`}>{done === fs.length ? <Check width={16} height={16} /> : `${done}/${fs.length}`}</span>
                </summary>
                <div className="group-fields">
                  {dateRuns(fs).map((item) => item.date
                    ? <DateRow key={item.date[0].id} label={item.label} parts={item.date.map(common)} />
                    : <Input key={item.field.id} {...common(item.field)} />)}
                </div>
              </details>
            );
          })}
        </form>
        <div className="preview">
          {tpl.pages.filter((_, i) => tpl.fields.some((f) => f.page === i)).length > 1 && <div className="page-tabs" role="tablist">
            {tpl.pages.map((_, i) => tpl.fields.some((f) => f.page === i) && (
              <button key={i} role="tab" aria-selected={i === page} className={i === page ? "on" : ""} onClick={() => setPage(i)}>Page {i + 1}</button>
            ))}
          </div>}
          <PageCanvas formId={formId} page={page} info={tpl.pages[page]}>
            <ValueLayer fields={tpl.fields} values={effective} autoIds={autoIds} page={page} activeId={activeId} />
          </PageCanvas>
        </div>
      </div>

      <div className="actionbar">
        <button className="btn icon-only" onClick={() => setShowDocs(true)} aria-label="Bills and documents"><Files width={20} height={20} /></button>
        {view === "fields" && remaining > 0 && <button className="btn" onClick={nextEmpty} aria-label="Go to next empty field"><ArrowDown width={18} height={18} />Next</button>}
        {filled > 0 && <button className="btn" onClick={() => setShowReview(true)} aria-label="Quick review of filled fields"><Check width={18} height={18} />Review</button>}
        <button className="btn primary" onClick={generate} disabled={busy || !filled || errors.length > 0}
          title={errors.length ? "Fix the items under Checks first" : undefined}><Download width={18} height={18} />{busy ? "Filling…" : "Download PDF"}</button>
      </div>
      {done && <DoneSheet name={tpl.name} onEdit={() => setDone(false)} onNext={() => go("library")} onClear={onClear} />}
      {showReview && (
        <QuickReview formId={formId} tpl={tpl} effective={effective} autoIds={autoIds} unfilled={remaining} errorCount={errors.length} busy={busy}
          onClose={() => setShowReview(false)}
          onEdit={(f) => { setShowReview(false); reveal(f); }}
          onDownload={async () => { setShowReview(false); await generate(); }} />
      )}
      {showDocs && <Documents formId={formId} tpl={tpl} values={values} effective={effective} setValues={setValues} onClose={() => setShowDocs(false)} />}
    </section>
  );
}

function Input({ f, v, auto, set, onFocus, active }) {
  const id = `f-${f.id}`;
  const common = { id, onFocus };
  let control;
  if (f.type === "boxes") {
    const n = f.boxes.length;
    const len = String(v ?? "").length;
    const cells = n <= 14;
    const input = (
      <input {...common} value={v ?? ""} placeholder={auto ? `auto: ${auto}` : undefined} maxLength={n} autoComplete="off"
        autoCapitalize={f.upper !== false ? "characters" : undefined} spellCheck={false}
        className={f.upper !== false ? "caps" : ""}
        onChange={(e) => set(f.id, e.target.value)} />
    );
    control = (
      <div className={`boxes-input ${cells ? "cells" : ""}`} style={{ "--n": n }}>
        {cells ? <span className="cellbox">{input}</span> : input}
        <span className={`count ${len === n ? "full" : ""}`}>{len}/{n}</span>
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
      <label htmlFor={id} id={`${id}-l`}>{f.label || f.id}{auto !== undefined && <span className="auto-chip" title="Calculated for you. Type to override.">auto</span>}</label>
      {control}
      {f.hint && active && <small className="muted hint">{f.hint}</small>}
    </div>
  );
}


/** One label, three small cell inputs: Day, Month, Year. Jumps to the next box when one is full. */
function DateRow({ label, parts }) {
  const names = ["Day", "Month", "Year"];
  const anyActive = parts.some((p) => p.active);
  return (
    <div className={`field date-row ${anyActive ? "is-active" : ""}`} role="group" aria-label={label}>
      <span className="field-label" aria-hidden="true">{label}</span>
      <div className="date-parts">
        {parts.map(({ f, v, auto, set, onFocus }, i) => {
          const n = f.boxes.length;
          return (
            <label key={f.id} className="date-part" style={{ "--n": n }}>
              <span className="date-name">{names[i]}</span>
              <div className="boxes-input cells" style={{ "--n": n }}>
                <span className="cellbox"><input id={`f-${f.id}`} value={v ?? ""} maxLength={n} inputMode="numeric" autoComplete="off" spellCheck={false}
                  placeholder={auto ? auto : undefined} onFocus={onFocus}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, "");
                    set(f.id, val);
                    if (val.length === n) document.getElementById(`f-${parts[i + 1]?.f.id}`)?.focus();
                  }} /></span>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

/** Shown after the PDF is saved: what to do next, without a wall of text. */
function DoneSheet({ name, onEdit, onNext, onClear }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current; d?.showModal();
    const close = () => onEdit();
    d?.addEventListener("cancel", close);
    return () => d?.removeEventListener("cancel", close);
  }, [onEdit]);
  return (
    <dialog ref={ref} className="done" aria-labelledby="done-title">
      <svg className="done-tick" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="22" /><path d="M14 25l7 7 13-15" /></svg>
      <h2 id="done-title">PDF saved</h2>
      <p className="muted">{name}. Sign it, then submit.</p>
      <div className="done-actions">
        <button className="btn primary" onClick={onNext}>Fill another form</button>
        <button className="btn" onClick={onEdit}>Keep editing</button>
        {onClear && <button className="btn ghost" onClick={onClear}>Clear session now</button>}
      </div>
    </dialog>
  );
}
