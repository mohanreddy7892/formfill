import { useEffect, useState } from "react";
import { api } from "../api.js";

/** Loads a page image with the access token and returns an object URL (or null while loading). */
export function usePageImage(formId, page) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let alive = true;
    setSrc(null);
    api.pageImage(formId, page).then((u) => alive && setSrc(u)).catch(() => alive && setSrc(null));
    return () => { alive = false; };
  }, [formId, page]);
  return src;
}

/** Page image with an SVG overlay whose coordinate system is PDF points (top-left origin). */
export default function PageCanvas({ formId, page, info, children, svgProps = {}, className = "" }) {
  const src = usePageImage(formId, page);
  const [zoom,setZoom]=useState(1);
  return (
    <div className="page-viewer">
      <div className="zoom-controls" role="group" aria-label="Page zoom">
        <button className="btn" onClick={()=>setZoom(z=>Math.max(1,z-.25))} disabled={zoom<=1} aria-label="Zoom out">−</button>
        <span>{Math.round(zoom*100)}%</span>
        <button className="btn" onClick={()=>setZoom(z=>Math.min(3,z+.25))} disabled={zoom>=3} aria-label="Zoom in">+</button>
        <button className="btn" onClick={()=>setZoom(1)}>Fit page</button>
      </div>
      <div className="zoom-scroll">
    <div className={`page ${className}`} style={{ width:`${zoom*100}%`,maxWidth:'none',margin:0,aspectRatio: `${info.width} / ${info.height}` }}>
      {src ? <img src={src} alt={`Page ${page + 1}`} draggable="false" /> : <div className="page-loading" aria-hidden="true" />}
      <svg viewBox={`0 0 ${info.width} ${info.height}`} {...svgProps}>{children}</svg>
    </div></div></div>
  );
}

export function PageThumb({ formId, page }) {
  const src = usePageImage(formId, page);
  return src ? <img src={src} alt="" /> : <span className="thumb-loading" aria-hidden="true" />;
}

export const rectOf = (b) => ({ x: b[0], y: b[1], width: b[2] - b[0], height: b[3] - b[1] });
