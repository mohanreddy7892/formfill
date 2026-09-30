import { useEffect, useState } from "react";
import { api, clearSession, sessionExpiresAt } from "./api.js";
import Library from "./components/Library.jsx";
import Designer from "./components/Designer.jsx";
import FillForm from "./components/FillForm.jsx";
import Menu from "./components/Menu.jsx";
import { Clock, Lock } from "./components/Icons.jsx";

function parseHash() {
  const [, view, id] = window.location.hash.split("/");
  return { view: view || "library", id };
}

export default function App() {
  const [remaining,setRemaining]=useState(()=>Math.max(0,Math.ceil((sessionExpiresAt()-Date.now())/1000)));
  const [route, setRoute] = useState(parseHash());
  const [generation, setGeneration] = useState(0);
  const [privacyMessage, setPrivacyMessage] = useState("");
  async function clear() {
    setGeneration((g) => g + 1);
    window.location.hash = "/library";
    setRoute({view:"library"});
    const cleared = await clearSession();
    setPrivacyMessage(cleared ? "Session cleared." : "Cleared here. Old data expires on its own.");
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
    const expired = () => { setGeneration(g => g + 1); window.location.hash='/library'; setRoute({view:'library'}); setPrivacyMessage('Session expired. Add your form again.'); };
    window.addEventListener('formfill-expired', expired);
    return () => window.removeEventListener('formfill-expired', expired);
  }, []);
  useEffect(() => {
    if (!privacyMessage) return;
    const t = setTimeout(() => setPrivacyMessage(""), 5000);
    return () => clearTimeout(t);
  }, [privacyMessage]);
  useEffect(() => {
    const refresh=()=>setRemaining(Math.max(0,Math.ceil((sessionExpiresAt()-Date.now())/1000)));
    const timer=setInterval(refresh,1000);window.addEventListener('focus',refresh);
    return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);};
  },[]);
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
        <span className="spacer" />
        <span className={`session-chip ${remaining<=120?'expiring':''}`} role="timer" aria-label={`Session clears in ${Math.floor(remaining/60)} minutes ${remaining%60} seconds`}>
          <Clock width={16} height={16} />{Math.floor(remaining/60)}:{String(remaining%60).padStart(2,'0')}
        </span>
        <Menu label="Session menu">
          <p className="menu-note"><Lock width={16} height={16} />Stays in this tab. Clears after 40 minutes.</p>
          <button type="button" role="menuitem" onClick={clear}>Clear session now</button>
        </Menu>
      </header>
      {remaining<=120&&remaining>0&&<p className="notice warn" role="status">Clears in under 2 minutes. Download your PDF now.</p>}
      {privacyMessage && <p className="notice ok" role="status">{privacyMessage}</p>}
      {window.__FORMFILL_DEMO__ && (
        <p className="demo-banner">Demo with fictional data. PDF download needs the installed app.</p>
      )}
      <main className="main" key={generation}>
        {route.view === "design" && route.id && <Designer formId={route.id} go={go} />}
        {route.view === "fill" && route.id && <FillForm formId={route.id} go={go} onClear={clear} />}
        {(route.view === "library" || !route.id) && <Library go={go} />}
      </main>
    </div>
  );
}
