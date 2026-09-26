import { useEffect, useState } from "react";
import { api, clearSession } from "./api.js";
import Library from "./components/Library.jsx";
import Designer from "./components/Designer.jsx";
import FillForm from "./components/FillForm.jsx";

function parseHash() {
  const [, view, id] = window.location.hash.split("/");
  return { view: view || "library", id };
}

export default function App() {
  const [route, setRoute] = useState(parseHash());
  const [generation, setGeneration] = useState(0);
  const [privacyMessage, setPrivacyMessage] = useState("");
  async function clear() {
    setGeneration((g) => g + 1);
    window.location.hash = "/library";
    setRoute({view:"library"});
    const cleared = await clearSession();
    setPrivacyMessage(cleared ? "Session cleared." : "Browser cleared. Server cleanup could not be confirmed; temporary forms expire automatically.");
  }
  useEffect(() => {
    const context=document.modelContext;
    if(!context?.registerTool)return;
    const controller=new AbortController();
    const validate=input=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw new Error('This action takes an empty object.');};
    for(const tool of [
      {name:'read_formfill_session_status',title:'Read temporary session status',description:'Return the number of forms in this tab without exposing document contents or personal values.',annotations:{readOnlyHint:true,untrustedContentHint:false},execute:async input=>{validate(input);return {forms:(await api.templates()).length,storage:'temporary browser memory'};}},
      {name:'clear_formfill_session',title:'Clear temporary session',description:'Clear documents, entered values and previews in this tab and return to the empty form list.',annotations:{readOnlyHint:false,untrustedContentHint:false},execute:async input=>{validate(input);await clear();return {cleared:true,forms:(await api.templates()).length};}},
    ]){
      try{Promise.resolve(context.registerTool({...tool,inputSchema:{type:'object',properties:{},additionalProperties:false}},{signal:controller.signal})).catch(()=>{});}catch{/* Unsupported browser: visible controls remain available. */}
    }
    return()=>controller.abort();
  },[]);
  useEffect(() => {
    const expired = () => { setGeneration(g => g + 1); window.location.hash='/library'; setRoute({view:'library'}); setPrivacyMessage('Session expired and cleared. Choose your documents again.'); };
    window.addEventListener('formfill-expired', expired);
    return () => window.removeEventListener('formfill-expired', expired);
  }, []);
  useEffect(() => {
    const timer = setTimeout(clear, 15 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [generation]);
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = (view, id) => { window.location.hash = id ? `/${view}/${id}` : `/${view}`; };

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="#/library" aria-label="FormFill home">
          <span className="brand-mark" aria-hidden="true">
            {"FORM".split("").map((c, i) => <span key={i}>{c}</span>)}
          </span>
          <span className="brand-name">fill</span>
        </a>
        <p className="topbar-note">Processed on your device · clears after 15 minutes. Explicit PDF downloads stay on your device.</p>
        <button className="btn ghost" onClick={clear}>Clear session</button>
      </header>
      {privacyMessage && <p role="status">{privacyMessage}</p>}
      {window.__FORMFILL_DEMO__ && (
        <p className="demo-banner">
          <span className="wide-only">Interactive demo with fictional data. Typing, auto-calculation, checks, the field designer and bill reading all work here; creating PDFs needs the installed app.</span>
          <span className="narrow-only">Demo with fictional data · PDF download needs the installed app</span>
        </p>
      )}
      <main className="main" key={generation}>
        {route.view === "design" && route.id && <Designer formId={route.id} go={go} />}
        {route.view === "fill" && route.id && <FillForm formId={route.id} go={go} />}
        {(route.view === "library" || !route.id) && <Library go={go} />}
      </main>
    </div>
  );
}
