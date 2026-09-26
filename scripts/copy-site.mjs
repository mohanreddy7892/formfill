// copy-site.mjs — Prepare the browser app for Sites.
// Copies public build assets only; no runtime documents are included.
import {cpSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
rmSync('dist',{recursive:true,force:true});
cpSync('frontend/dist','dist',{recursive:true});

const index=readFileSync("dist/index.html","utf8");
const policy="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' blob:; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";
writeFileSync("dist/index.html",index.replace("<head>",`<head><meta http-equiv="Content-Security-Policy" content="${policy}">`));
