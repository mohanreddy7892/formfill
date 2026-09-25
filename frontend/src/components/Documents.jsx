import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { assignBills, download, wholeRupees } from "../util.js";

const BILL_CATS = new Set(["hospital_bill", "pharmacy_bill", "lab_bill"]);
const KIND_OF = { hospital_bill: "hospital", pharmacy_bill: "pharmacy", lab_bill: "lab" };

/** Documents & bills: scan (offline OCR on the server), review, add bills to the form, build the claim pack.
 *  Files stay in this browser tab; the server reads them in memory and keeps nothing. */
export default function Documents({ formId, tpl, values, effective, setValues, onClose }) {
  const [features, setFeatures] = useState(null);
  const [docs, setDocs] = useState([]);           // {id, file, category, bill, names, method, busy, error}
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  const [report, setReport] = useState(null);
  const dialog = useRef();
  const table = tpl.tables?.[0];
  const patient = (tpl.patient_name || []).map((id) => effective[id] || "").join(" ").trim();

  useEffect(() => { api.features().then(setFeatures).catch(() => setFeatures({ ocr: false, categories: [] })); }, []);
  useEffect(() => {
    const d = dialog.current; d?.showModal();
    const esc = (e) => e.key === "Escape" && onClose();
    d?.addEventListener("cancel", esc);
    return () => d?.removeEventListener("cancel", esc);
  }, [onClose]);

  const cats = features?.categories || [];
  const catLabel = (id) => cats.find((c) => c.id === id)?.label || id;

  async function add(fileList) {
    const files = [...fileList].filter((f) => /pdf|image/.test(f.type) || /\.(pdf|jpe?g|png|tiff?)$/i.test(f.name));
    if (!files.length) return;
    const fresh = files.map((file) => ({ id: crypto.randomUUID(), file, category: "other", busy: true }));
    setDocs((d) => [...d, ...fresh]); setMsg(null); setReport(null);
    if (!features?.ocr) { setDocs((d) => d.map((x) => (x.busy ? { ...x, busy: false } : x))); return; }
    try {
      const { results } = await api.scan(files, patient ? [patient] : []);
      setDocs((d) => d.map((x) => {
        const i = fresh.findIndex((f) => f.id === x.id);
        if (i < 0) return x;
        const r = results[i] || {};
        return { ...x, busy: false, error: r.error, category: r.category || "other", method: r.method, names: r.names,
                 engine: r.engine, note: r.note,
                 bill: r.bill ? { ...r.bill, kind: KIND_OF[r.category] || r.bill.kind } : null };
      }));
    } catch (e) {
      setDocs((d) => d.map((x) => (fresh.some((f) => f.id === x.id) ? { ...x, busy: false, error: e.message } : x)));
    }
  }

  const setDoc = (id, patch) => setDocs((d) => d.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const setBill = (id, patch) => setDocs((d) => d.map((x) => (x.id === id ? { ...x, bill: { ...(x.bill || {}), ...patch } } : x)));
  const bills = docs.filter((d) => BILL_CATS.has(d.category) && d.bill);
  const invalidAmounts = bills.some((d) => wholeRupees(d.bill.amount) === null);

  function addBills() {
    const { updates, placed, skipped } = assignBills(table, values, bills.map((d) => ({ ...d.bill, kind: KIND_OF[d.category] })));
    setValues((v) => ({ ...v, ...updates }));
    const why = skipped.length ? ` · ${skipped.length} not added (${[...new Set(skipped.map((s) => s.reason))].join(", ")})` : "";
    setMsg({ ok: `${placed.length} bill${placed.length === 1 ? "" : "s"} added to ${table.label}${why}` });
  }

  async function buildPack() {
    setBusy("pack"); setMsg(null);
    try {
      const { blob, report: rep } = await api.pack(formId, docs.map((d) => d.file), docs.map((d) => d.category), effective);
      download(blob, `${tpl.name.replace(/[^\w-]+/g, "_")}_claim_pack.pdf`);
      setReport(rep);
    } catch (e) { setMsg({ err: e.message }); } finally { setBusy(""); }
  }

  const required = cats.filter((c) => c.required);
  const present = new Set([...docs.map((d) => d.category), "claim_form"]);

  return (
    <dialog ref={dialog} className="docs" aria-labelledby="docs-title" onClose={onClose}>
      <header className="docs-head">
        <div>
          <h2 id="docs-title">Documents &amp; bills</h2>
          <p className="muted">Files stay in this tab. The server reads them in memory and keeps nothing.</p>
          {features && (
            <p className={`engine-badge ${features.engine === "typellm" ? "ai" : ""}`}>
              {features.engine === "typellm"
                ? <>Reading with AI · TypeLLM{features.model ? ` (${features.model})` : ""}, self-hosted{features.vision ? ", sees photos" : ""}</>
                : <>Reading with built-in text rules{features.typellm_error ? " · AI engine unavailable" : ""}</>}
            </p>
          )}
        </div>
        <button className="btn ghost" onClick={onClose} aria-label="Close">Close</button>
      </header>

      <div className="docs-body">
        <label className="dropzone small" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); add(e.dataTransfer.files); }}>
          <input type="file" multiple accept="application/pdf,image/*" hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
          <span className="dropzone-title">Add bills, reports, discharge summary, cheque, ID…</span>
          <span className="dropzone-sub">Photos or PDFs · {features?.ocr ? "bills are read automatically" : "automatic reading is off on this server"}</span>
        </label>

        {window.__FORMFILL_DEMO__ && docs.length === 0 && (
          <button className="btn sample-btn" onClick={() => add(window.__FORMFILL_DEMO__.sampleFiles())}>
            Try with 3 sample documents (a pharmacy bill photo, a lab bill, a lab report)
          </button>
        )}

        {required.length > 0 && (
          <ul className="checklist" aria-label="Required documents">
            {required.map((c) => (
              <li key={c.id} className={present.has(c.id) ? "have" : ""}>{present.has(c.id) ? "✓" : "○"} {c.label}</li>
            ))}
          </ul>
        )}

        {docs.length > 0 && (
          <table className="doc-table">
            <thead><tr><th>File</th><th>Type</th><th>Bill no.</th><th>Date</th><th className="num">Amount ₹</th><th>Issued by</th><th /></tr></thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className={d.busy ? "is-busy" : ""}>
                  <td className="file">
                    <span title={d.file.name}>{d.file.name}</span>
                    {d.busy && <small className="muted">reading…</small>}
                    {d.error && <small className="error">{d.error}</small>}
                    {d.note && <small className="muted">{d.note}</small>}
                    {d.bill?.review?.length > 0 && (
                      <small className="warn">Check {d.bill.review.map((k) => ({ bill_no: "bill no.", date: "date", amount: "amount" }[k])).join(", ")}: AI and text reading differ</small>
                    )}
                    {d.names?.status === "not_found" && <small className="error">Patient name could not be fully matched. Check this document before submission.</small>}
                    {d.names?.status === "variant" && (
                      <small className="warn">Name spelled {d.names.variants.map((v) => `“${v.found}”`).join(", ")} (form: {d.names.variants.map((v) => v.expected).join(", ")})</small>
                    )}
                  </td>
                  <td>
                    <select value={d.category} aria-label={`Type of ${d.file.name}`} onChange={(e) => setDoc(d.id, { category: e.target.value, bill: BILL_CATS.has(e.target.value) ? d.bill || {} : d.bill })}>
                      {cats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  </td>
                  {BILL_CATS.has(d.category) ? (
                    <>
                      <td><input aria-label="Bill number" className={`${d.bill?.review?.includes("bill_no") ? "needs-review" : ""}`} value={d.bill?.bill_no || ""} onChange={(e) => setBill(d.id, { bill_no: e.target.value })} /></td>
                      <td><input aria-label="Bill date" className={`${d.bill?.review?.includes("date") ? "needs-review" : ""}`} type="date" value={d.bill?.date || ""} onChange={(e) => setBill(d.id, { date: e.target.value })} /></td>
                      <td><input aria-label="Amount" className={`${d.bill?.review?.includes("amount") ? "needs-review" : ""} num`} inputMode="numeric" value={d.bill?.amount ?? ""} onChange={(e) => setBill(d.id, { amount: e.target.value })} /></td>
                      <td><input aria-label="Issued by" value={d.bill?.issuer || ""} onChange={(e) => setBill(d.id, { issuer: e.target.value })} /></td>
                    </>
                  ) : <td colSpan={4} className="muted">Not a bill: included in the claim pack as a document</td>}
                  <td><button className="btn ghost" aria-label={`Remove ${d.file.name}`} onClick={() => setDocs((x) => x.filter((y) => y.id !== d.id))}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {invalidAmounts && <p className="error" role="alert">Enter positive whole-rupee amounts only. Decimals and separators are not accepted; confirm any rounding against the bill before adding it.</p>}
        {bills.length > 0 && <p className="muted small-note">Check each bill against the paper copy. Handwritten amounts are often misread.</p>}
        {msg && <p className={msg.err ? "error" : "ok"} role={msg.err ? "alert" : "status"}>{msg.err || msg.ok}</p>}
        {report && (
          <div className="pack-report" role="status">
            <strong>Claim pack downloaded · {report.pages} pages</strong>
            {report.missing?.length ? <p className="warn">Not included: {report.missing.join(", ")}</p> : <p className="ok">All required documents included.</p>}
            {report.name_unverified?.map((v, i) => <p key={`unverified-${i}`} className="error">Patient name not verified: {v.file}. Review before submission.</p>)}
            {report.name_variants?.map((v) => (
              <p key={v.file} className="warn">Name spelling differs in {v.file}: {v.variants.map((x) => `${x.found} (form: ${x.expected})`).join(", ")}. Ask the hospital to correct and stamp it.</p>
            ))}
          </div>
        )}
      </div>

      <footer className="docs-foot">
        {table && <button className="btn" onClick={addBills} disabled={!bills.length || invalidAmounts}>Add {bills.length || ""} bill{bills.length === 1 ? "" : "s"} to the form</button>}
        <span className="spacer" />
        <button className="btn primary" onClick={buildPack} disabled={busy === "pack" || docs.some((d) => d.busy)}>
          {busy === "pack" ? "Building…" : "Download claim pack (one PDF)"}
        </button>
      </footer>
    </dialog>
  );
}
