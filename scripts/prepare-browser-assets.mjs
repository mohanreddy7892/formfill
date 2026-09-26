// prepare-browser-assets.mjs — Bundle OCR and PDF support files on the same origin.
// Copies installed public runtime assets; never reads user documents or personal values.
import {cpSync,mkdirSync,readdirSync} from 'node:fs';
const modules='frontend/node_modules';
mkdirSync('frontend/public/ocr',{recursive:true});
cpSync(`${modules}/tesseract.js/dist/worker.min.js`,'frontend/public/ocr/worker.min.js');
for(const name of readdirSync(`${modules}/tesseract.js-core`)) {
  if(name.endsWith('.wasm')||name.endsWith('.wasm.js'))cpSync(`${modules}/tesseract.js-core/${name}`,`frontend/public/ocr/${name}`);
}
cpSync(`${modules}/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz`,'frontend/public/ocr/eng.traineddata.gz');
for(const directory of ['cmaps','standard_fonts','wasm'])cpSync(`${modules}/pdfjs-dist/${directory}`,`frontend/public/pdf/${directory}`,{recursive:true});
