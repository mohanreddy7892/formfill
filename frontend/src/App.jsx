import { useEffect, useState } from "react";
import Library from "./components/Library.jsx";
import Designer from "./components/Designer.jsx";
import FillForm from "./components/FillForm.jsx";

function parseHash() {
  const [, view, id] = window.location.hash.split("/");
  return { view: view || "library", id };
}

export default function App() {
  const [route, setRoute] = useState(parseHash());
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
        <p className="topbar-note">Filled values are never stored on the server.</p>
      </header>
      {window.__FORMFILL_DEMO__ && (
        <p className="demo-banner">
          <span className="wide-only">Interactive demo with fictional data. Typing, auto-calculation, checks, the field designer and bill reading all work here; creating PDFs needs the installed app.</span>
          <span className="narrow-only">Demo with fictional data · PDF download needs the installed app</span>
        </p>
      )}
      <main className="main">
        {route.view === "design" && route.id && <Designer formId={route.id} go={go} />}
        {route.view === "fill" && route.id && <FillForm formId={route.id} go={go} />}
        {(route.view === "library" || !route.id) && <Library go={go} />}
      </main>
    </div>
  );
}
