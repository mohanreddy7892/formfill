import { useEffect, useRef, useState } from "react";
import { Dots } from "./Icons.jsx";

/** Small overflow menu: closes on outside tap, Escape, or choosing an item. */
export default function Menu({ label = "More", children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button type="button" className="icon-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}><Dots /></button>
      {open && <div className="menu-panel" role="menu" onClick={() => setOpen(false)}>{children}</div>}
    </div>
  );
}
