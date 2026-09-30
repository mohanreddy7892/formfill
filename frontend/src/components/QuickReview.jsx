import { useEffect, useMemo, useRef, useState } from "react";
import { usePageImage } from "./PageCanvas.jsx";
import ValueLayer from "./ValueLayer.jsx";
import { Check, Download } from "./Icons.jsx";
import { cropBox, displayValue, fieldBounds, isEmpty, reviewItems } from "../util.js";

/** Steps through every filled field, zoomed on the page, so each value can be checked before download. */
export default function QuickReview({ formId, tpl, effective, autoIds, unfilled, errorCount, busy, onEdit, onDownload, onClose }) {
  const items = useMemo(() => reviewItems(tpl.fields, effective), []); // fixed order while the dialog is open
  const [idx, setIdx] = useState(0);
  const [seen, setSeen] = useState(() => new Set());
  const ref = useRef(null);
  const summary = idx >= items.length;
  const f = summary ? null : items[idx];

  useEffect(() => {
    const d = ref.current; d?.showModal();
    const cancel = (e) => { e.preventDefault(); onClose(); };
    d?.addEventListener("cancel", cancel);
    return () => d?.removeEventListener("cancel", cancel);
  }, [onClose]);

  const next = () => { if (f) setSeen((s) => new Set(s).add(f.id)); setIdx((i) => Math.min(items.length, i + 1)); };
  const prev = () => setIdx((i) => Math.max(0, i - 1));
  const onKeyDown = (e) => {
    if (e.target.closest("input, textarea, select")) return;
    if (e.key === "ArrowRight") { e.preventDefault(); if (!summary) next(); }
    if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
  };

  return (
    <dialog ref={ref} className="review" aria-labelledby="review-title" onKeyDown={onKeyDown}>
      <div className="review-head">
        <h2 id="review-title">Quick review</h2>
        <button type="button" className="btn ghost" onClick={onClose}>Close</button>
      </div>
      {items.length === 0 ? (
        <>
          <p className="muted review-empty">Nothing is filled in yet. Add some answers, then review them here.</p>
          <div className="review-actions"><button type="button" className="btn primary" onClick={onClose}>Back to editing</button></div>
        </>
      ) : summary ? (
        <Summary total={items.length} seen={seen.size} unfilled={unfilled} errorCount={errorCount} busy={busy}
          onDownload={onDownload} onClose={onClose} onAgain={() => setIdx(0)} />
      ) : (
        <Step formId={formId} tpl={tpl} f={f} effective={effective} autoIds={autoIds} n={idx + 1} total={items.length}
          onPrev={idx > 0 ? prev : null} onOk={next} onEdit={() => onEdit(f)} />
      )}
    </dialog>
  );
}

function Step({ formId, tpl, f, effective, autoIds, n, total, onPrev, onOk, onEdit }) {
  const src = usePageImage(formId, f.page);
  const info = tpl.pages[f.page];
  const [x, y, w, h] = cropBox(fieldBounds(f), info);
  const value = displayValue(f, effective[f.id]);
  return (
    <>
      <div className="review-progress" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={n} aria-label="Review progress">
        <span style={{ width: `${(n / total) * 100}%` }} />
      </div>
      <p className="review-count muted">Field {n} of {total} · Page {f.page + 1}</p>
      <svg className="review-crop" viewBox={`${x} ${y} ${w} ${h}`} role="img" aria-label={`${f.label || f.id} on page ${f.page + 1}`}>
        {src && <image href={src} x={0} y={0} width={info.width} height={info.height} preserveAspectRatio="none" />}
        <ValueLayer fields={tpl.fields.filter((t) => t.page === f.page)} values={effective} autoIds={autoIds} page={f.page} activeId={f.id} />
      </svg>
      <div className="review-value">
        <span className="review-label">{f.label || f.id}{autoIds.has(f.id) && <span className="auto-chip">auto</span>}</span>
        <strong className="review-answer" aria-live="polite">{isEmpty(value) ? "—" : value}</strong>
      </div>
      <div className="review-actions">
        <button type="button" className="btn primary" onClick={onOk}><Check width={18} height={18} />Looks right</button>
        <button type="button" className="btn" onClick={onEdit}>Edit</button>
        <button type="button" className="btn ghost" onClick={onPrev} disabled={!onPrev}>Back</button>
      </div>
      <p className="review-tip muted">Tip: use the left and right arrow keys to move between fields.</p>
    </>
  );
}

function Summary({ total, seen, unfilled, errorCount, busy, onDownload, onClose, onAgain }) {
  const blocked = errorCount > 0;
  return (
    <div className="review-summary">
      <svg className="done-tick" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="22" /><path d="M14 25l7 7 13-15" /></svg>
      <h3>Review finished</h3>
      <p className="muted">
        {seen} of {total} filled fields confirmed.
        {unfilled > 0 && ` ${unfilled} field${unfilled === 1 ? " is" : "s are"} still empty.`}
        {blocked && ` ${errorCount} check${errorCount === 1 ? "" : "s"} must be fixed before you can download.`}
      </p>
      <div className="review-actions">
        <button type="button" className="btn primary" onClick={onDownload} disabled={busy || blocked}><Download width={18} height={18} />{busy ? "Filling…" : "Download PDF"}</button>
        <button type="button" className="btn" onClick={onClose}>Back to editing</button>
        <button type="button" className="btn ghost" onClick={onAgain}>Review again</button>
      </div>
    </div>
  );
}
