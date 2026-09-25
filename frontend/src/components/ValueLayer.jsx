import { isEmpty } from "../util.js";

/** Client-side preview of how values land on the page - mirrors backend/app/filler.py. */
export default function ValueLayer({ fields, values, page, activeId, autoIds = new Set() }) {
  return fields.filter((f) => f.page === page).map((f) => {
    const v = values[f.id];
    const active = f.id === activeId;
    const marks = [];
    if (!isEmpty(v)) {
      if (f.type === "boxes") {
        let s = String(v); if (f.upper) s = s.toUpperCase();
        const boxes = f.align === "right" ? f.boxes.slice(Math.max(0, f.boxes.length - s.length)) : f.boxes;
        [...s].slice(0, boxes.length).forEach((ch, i) => {
          const b = boxes[i]; const h = b[3] - b[1], w = b[2] - b[0];
          if (f.clear) marks.push(<rect key={`w${i}`} x={b[0] + 0.8} y={b[1] + 0.8} width={w - 1.6} height={h - 1.6} fill="#fff" />);
          marks.push(<text key={i} className="ink" x={(b[0] + b[2]) / 2} y={b[1] + h * 0.78} fontSize={f.size || Math.max(5, Math.min(h * 0.78, w * 0.95))} textAnchor="middle">{ch}</text>);
        });
      } else if (f.type === "text" || f.type === "acro") {
        const r = f.rect; const s = f.upper === false ? String(v) : String(v).toUpperCase();
        const maxW = r[2] - r[0] - 4;
        let size = f.size || Math.min(8, (r[3] - r[1]) * 0.75);
        while (size > 4.5 && s.length * size * 0.62 > maxW) size -= 0.25;       // same idea as the PDF: shrink to fit
        const squeeze = s.length * size * 0.62 > maxW;
        marks.push(<text key="t" className="ink" x={f.align === "right" ? r[2] - 2 : r[0] + 2} y={r[3] - (r[3] - r[1] - size) / 2 - size * 0.18} fontSize={size}
          textAnchor={f.align === "right" ? "end" : "start"} {...(squeeze ? { textLength: maxW, lengthAdjust: "spacingAndGlyphs" } : {})}>{s}</text>);
      } else if (f.type === "checkbox" && (v === true || /^(1|true|yes|y|x|on)$/i.test(String(v)))) {
        marks.push(<Tick key="x" r={f.rect} />);
      } else if (f.type === "choice") {
        const chosen = new Set((Array.isArray(v) ? v : [v]).map((x) => String(x).toUpperCase()));
        f.options.forEach((o, i) => chosen.has(o.value.toUpperCase()) && marks.push(<Tick key={i} r={o.rect} />));
      }
    }
    return (
      <g key={f.id} className={`${active ? "field-active" : ""} ${autoIds.has(f.id) ? "is-auto" : ""}`}>
        {active && <Outline f={f} />}
        {marks}
      </g>
    );
  });
}

function Tick({ r }) {
  const h = r[3] - r[1];
  return <text className="ink" x={(r[0] + r[2]) / 2} y={r[1] + h * 0.82} fontSize={Math.max(5.5, Math.min(9, h * 0.95))} textAnchor="middle">X</text>;
}

export function Outline({ f, className = "outline" }) {
  const rects = f.type === "boxes" ? f.boxes : f.type === "choice" ? f.options.map((o) => o.rect) : [f.rect];
  return rects.filter(Boolean).map((b, i) => <rect key={i} className={className} x={b[0] - 0.8} y={b[1] - 0.8} width={b[2] - b[0] + 1.6} height={b[3] - b[1] + 1.6} />);
}
