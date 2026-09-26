// runtime.test.mjs — Exercise the browser session using a Node canvas adapter.
// Uses fictional in-memory PDFs and images; no browser automation or production data.
import test from 'node:test';
import 'tesseract.js';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
import {createCanvas,DOMMatrix,Path2D,ImageData,loadImage} from '@napi-rs/canvas';
const root=fileURLToPath(new URL('../..',import.meta.url));
const runtime=fileURLToPath(new URL('./.runtime-api.mjs',import.meta.url));
const originalTimer=setInterval;
globalThis.DOMMatrix=DOMMatrix;globalThis.Path2D=Path2D;globalThis.ImageData=ImageData;
globalThis.window=new EventTarget();window.location={reload(){}};window.requestAnimationFrame=fn=>setTimeout(fn,0);window.cancelAnimationFrame=clearTimeout;
globalThis.document={createElement(type){assert.equal(type,'canvas');const c=createCanvas(1,1);c.toBlob=fn=>fn(new Blob([c.toBuffer('image/png')],{type:'image/png'}));return c;}};
globalThis.createImageBitmap=async blob=>{const im=await loadImage(Buffer.from(await blob.arrayBuffer()));im.close=()=>{};return im;};
globalThis.setInterval=(...args)=>{const t=originalTimer(...args);t.unref();return t;};
await build({entryPoints:[`${root}/src/browser/api.js`],outfile:runtime,bundle:true,platform:'node',format:'esm',packages:'external',plugins:[{name:'test-adapters',setup(b){
 b.onResolve({filter:/pdf\.worker\.min\.mjs\?url$/},()=>({path:'worker',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export default ${JSON.stringify(`${root}/node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs`)}`}));
 b.onResolve({filter:/node_modules\/tesseract\.js\/src\/index\.js$/},args=>({path:args.path,external:true}));
 b.onResolve({filter:/^tesseract.js$/},()=>({path:'ocr',namespace:'ocr'}));
 b.onLoad({filter:/.*/,namespace:'ocr'},()=>({contents:`import {createWorker as make} from ${JSON.stringify(`${root}/node_modules/tesseract.js/src/index.js`)};export async function createWorker(lang,oem,options){const w=await make(lang,oem,{...options,workerPath:${JSON.stringify(`${root}/node_modules/tesseract.js/src/worker-script/node/index.js`)},langPath:${JSON.stringify(`${root}/public/ocr`)},corePath:${JSON.stringify(`${root}/node_modules/tesseract.js-core`)}});const recognize=w.recognize;w.recognize=image=>recognize(image.toBuffer?image.toBuffer('image/png'):image);return w;}`}));
 b.onLoad({filter:/browser\/api\.js$/},async args=>{const {readFile}=await import('node:fs/promises');let text=await readFile(args.path,'utf8');text=text.replaceAll("'/pdf/cmaps/'",JSON.stringify(`${root}/public/pdf/cmaps/`)).replaceAll("'/pdf/standard_fonts/'",JSON.stringify(`${root}/public/pdf/standard_fonts/`)).replaceAll("'/pdf/wasm/'",JSON.stringify(`${root}/public/pdf/wasm/`));return {contents:text,resolveDir:`${root}/src/browser`};});
}}]});
const {api,clearSession}=await import('./.runtime-api.mjs');
async function fixture(){const doc=await PDFDocument.create(),page=doc.addPage([595,842]);page.drawText('FICTIONAL TEST FORM',{x:40,y:795,size:18});const f=doc.getForm().createTextField('Patient');f.addToPage(page,{x:155,y:745,width:280,height:22});for(let i=0;i<8;i++)page.drawRectangle({x:155+i*13,y:665,width:10,height:10,borderWidth:.5,borderColor:rgb(0,0,0)});return new File([await doc.save()],'fictional.pdf',{type:'application/pdf'});}
test('browser session: detect, render, fill, scan, pack and clear',async()=>{
 const file=await fixture(),r=await api.upload(file);assert.equal(r.fields,1);
 const tpl=await api.template(r.form_id);const detected=await api.detect(r.form_id);assert.ok(detected.pages[0].runs.some(r=>r.boxes.length===8));
 const preview=await api.pageImage(r.form_id,0);assert.ok(preview.startsWith('blob:'));
 const filled=await api.fill(r.form_id,{[tpl.fields[0].id]:'TEST PERSON'});assert.equal((await PDFDocument.load(await filled.arrayBuffer())).getPageCount(),1);
 const canvas=createCanvas(1500,700),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1500,700);ctx.fillStyle='black';ctx.font='42px sans-serif';
 ['EXAMPLE PHARMACY','Tax Invoice','Patient Name: TEST PERSON','Bill No: 12345','Date: 25-09-2026','Grand Total: 1234.56'].forEach((s,i)=>ctx.fillText(s,60,80+i*95));
 const bill=new File([canvas.toBuffer('image/png')],'fictional-bill.png',{type:'image/png'});
 const scanned=await api.scan([bill],['TEST PERSON']);assert.equal(scanned.results[0].bill?.amount,1234.56,JSON.stringify(scanned));assert.equal(scanned.results[0].names.status,'match');
 const packed=await api.pack(r.form_id,[bill],['pharmacy_bill'],{[tpl.fields[0].id]:'TEST PERSON'});assert.equal(packed.report.pages,3);assert.equal((await PDFDocument.load(await packed.blob.arrayBuffer())).getPageCount(),3);
 await clearSession();assert.equal((await api.templates()).length,0);await assert.rejects(api.template(r.form_id),/expired/);
 await assert.rejects(fetch(preview));
 console.log('Sample result: detected 8 boxes; OCR amount 1234.56; exported 3-page pack; session forms after clear = 0');
});
test('clearing an in-flight upload cannot restore private data',async()=>{const f=await fixture(),pending=api.upload(f);await clearSession();await assert.rejects(pending,/Session cleared/);assert.equal((await api.templates()).length,0);});
test.after(async()=>{await clearSession();await unlink(runtime);});
