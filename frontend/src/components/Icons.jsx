const base = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: false };
export const Lock = (p) => <svg {...base} {...p}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
export const Clock = (p) => <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
export const Dots = (p) => <svg {...base} {...p}><circle cx="12" cy="5" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="19" r="1.4" fill="currentColor" /></svg>;
export const Back = (p) => <svg {...base} {...p}><path d="M15 5l-7 7 7 7" /></svg>;
export const Download = (p) => <svg {...base} {...p}><path d="M12 4v11" /><path d="M7 11l5 5 5-5" /><path d="M5 20h14" /></svg>;
export const Files = (p) => <svg {...base} {...p}><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4" /></svg>;
export const Check = (p) => <svg {...base} {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
export const ArrowDown = (p) => <svg {...base} {...p}><path d="M12 5v14" /><path d="M6 13l6 6 6-6" /></svg>;
