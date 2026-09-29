// api.js — Browser-only FormFill session and document operations.
// Inputs stay in bounded RAM; clearing destroys PDF/OCR workers and revokes previews.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import {createWorker} from 'tesseract.js';
import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
import {computedValues,check} from '../demo/rules.js';
import {fillPdf} from './pdf.js';
import {boxRuns,nativeFields,rasterBoxRuns,suggestedFields,mergeDetectedRuns,isInstructionPage,fieldLabel} from './detect.js';
import {categories,parseDocument} from './documents.js';
import seed from './medi-assist.json';

pdfjs.GlobalWorkerOptions.workerSrc=pdfWorker;
const MB=1024*1024,TTL=15*60*1000;
let generation=0,expires=Date.now()+TTL,busy=false,abort=new AbortController(),imageTail=Promise.resolve();
const forms=new Map(),urls=new Map(),tasks=new Set(),ocrWorkers=new Set();
const clone=x=>structuredClone(x);
const canceled=()=>new DOMException('Session cleared. Choose your documents again.','AbortError');
function cancelable(promise,g,timeout=120000){
  guard(g);const signal=abort.signal;
  return new Promise((resolve,reject)=>{
    const stop=()=>{cleanup();reject(canceled());};
    const timer=setTimeout(()=>{cleanup();reject(new Error('Processing took too long. Try a smaller document.'));},timeout);
    const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',stop);};
    signal.addEventListener('abort',stop,{once:true});
    promise.then(value=>{cleanup();try{guard(g);resolve(value);}catch(e){reject(e);}},error=>{cleanup();reject(error);});
  });
}
function guard(g){if(g!==generation)throw canceled();if(Date.now()>=expires){void clearSession();window.dispatchEvent(new Event('formfill-expired'));throw canceled();}}
async function operation(fn){const g=generation;guard(g);if(busy)throw new Error('A document is still being processed. Please wait.');busy=true;try{const result=await fn(g);guard(g);return result;}finally{if(g===generation)busy=false;}}
function get(id){guard(generation);const f=forms.get(id);if(!f)throw new Error('This temporary form has expired. Choose it again.');return f;}
function limit(files,max=60*MB){if(files.length>30||files.some(f=>f.size>20*MB)||files.reduce((s,f)=>s+f.size,0)>max)throw new Error('Choose up to 30 files, 20 MB each and 60 MB total.');}
async function withPdf(bytes,g,fn){
  guard(g);
  const task=pdfjs.getDocument({data:bytes.slice(),isEvalSupported:false,verbosity:0,cMapUrl:'/pdf/cmaps/',cMapPacked:true,standardFontDataUrl:'/pdf/standard_fonts/',wasmUrl:'/pdf/wasm/',useSystemFonts:false});
  tasks.add(task);
  try{const doc=await task.promise;guard(g);if(doc.numPages>40)throw new Error('Choose a PDF with at most 40 pages.');return await fn(doc);}
  finally{tasks.delete(task);await task.destroy();}
}
async function canvasFor(page,g,scale=1.5){
  guard(g);let viewport=page.getViewport({scale});
  if(viewport.width*viewport.height>6e6)viewport=page.getViewport({scale:scale*Math.sqrt(6e6/(viewport.width*viewport.height))});
  const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  try{await page.render({canvasContext:canvas.getContext('2d'),viewport,annotationMode:pdfjs.AnnotationMode.DISABLE}).promise;guard(g);return canvas;}
  catch(e){canvas.width=canvas.height=0;throw e;}
}
const blobOf=canvas=>new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Could not render this page.')),'image/png'));
function textItems(content,viewport){return content.items.filter(x=>x.str).map(x=>{const t=pdfjs.Util.transform(viewport.transform,x.transform);return {text:x.str,x:t[4],y:t[5]-Math.hypot(t[2],t[3]),width:x.width,height:Math.hypot(t[2],t[3]),eol:x.hasEOL};});}
function linesOf(items){return items.map(x=>x.text+(x.eol?'\n':' ')).join('');}

async function upload(file){return operation(async g=>{
  limit([file],20*MB);
  if(forms.size>=3||[...forms.values()].reduce((n,f)=>n+f.bytes.length,0)+file.size>60*MB)throw new Error('Keep at most three forms in a session. Remove a form or clear the session first.');
  const bytes=new Uint8Array(await file.arrayBuffer());guard(g);
  if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw new Error('Choose a valid, unencrypted PDF.');
  const form_id=crypto.randomUUID().replaceAll('-','');
  const result=await withPdf(bytes,g,async doc=>{
    const pages=[],fields=[],detected=[];let printed='';
    for(let i=0;i<doc.numPages;i++){
      guard(g);const page=await doc.getPage(i+1),viewport=page.getViewport({scale:1});
      if(!Number.isFinite(viewport.width*viewport.height)||viewport.width>4000||viewport.height>4000)throw new Error('This PDF page is too large for browser processing.');
      pages.push({width:viewport.width,height:viewport.height,transform:[...viewport.transform]});
      let words=textItems(await page.getTextContent(),viewport);printed+=linesOf(words)+'\n';
      const native=nativeFields(await page.getAnnotations(),viewport,i,fields);
      fields.push(...native);
      const instructions=isInstructionPage(words);
      let runs=instructions?[]:boxRuns(await page.getOperatorList(),pdfjs.OPS,viewport,words);
      if(!native.length&&!instructions){
        const canvas=await canvasFor(page,g,2.5);
        try{const raster=rasterBoxRuns(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height),canvas.width/viewport.width,canvas.height/viewport.height,words);runs=mergeDetectedRuns(runs,raster,words);
          if(runs.filter(r=>r.source==='open-answer').length>=5){
            try{const tsv=await recognize(canvas,g,true);const sx=canvas.width/viewport.width,sy=canvas.height/viewport.height;
              words=(tsv||'').split('\n').slice(1).map(line=>line.split('\t')).filter(v=>v[0]==='5'&&Number(v[10])>=50&&v[11]?.trim()).map(v=>({text:v[11].trim(),x:Number(v[6])/sx,y:Number(v[7])/sy,width:Number(v[8])/sx,height:Number(v[9])/sy}));
            }catch{guard(g);}
          }
        }
        finally{canvas.width=canvas.height=0;}
      }
      if(!native.length){runs=runs.map(run=>({...run,label:fieldLabel([Math.min(...run.boxes.map(b=>b[0])),Math.min(...run.boxes.map(b=>b[1])),Math.max(...run.boxes.map(b=>b[2])),Math.max(...run.boxes.map(b=>b[3]))],words)||run.label}));fields.push(...suggestedFields(runs,i));}
      detected.push({width:viewport.width,height:viewport.height,runs});
      page.cleanup();
    }
    // A title alone is not sufficient: every pre-mapped box must match detected geometry.
    const expected=seed.fields.flatMap(f=>(f.boxes||[]).map(b=>({page:f.page,b})));
    const matches=expected.length>0 && expected.every(({page,b})=>detected[page]?.runs.some(r=>r.boxes.some(q=>q.every((x,j)=>Math.abs(x-b[j])<1.2))));
    const matched=matches && /medi\s*assist/i.test(printed);
    const tpl={form_id,name:matched?seed.name:'Temporary form',version:1,review_layout:!matched&&fields.some(f=>f.id.startsWith('detected_')),pages,fields:matched?clone(seed.fields):fields,rules:matched?clone(seed.rules||[]):[],tables:matched?clone(seed.tables||[]):[],patient_name:matched?clone(seed.patient_name||[]):[]};
    return {tpl,detect:{pages:detected,acro:[]},matched};
  });
  guard(g);forms.set(form_id,{bytes,...result});
  return {form_id,fields:result.tpl.fields.length,matched_seed:result.matched,review_layout:result.tpl.review_layout};
});}

async function pageImage(id,index){
  const key=`${id}/${index}`;if(urls.has(key))return urls.get(key);
  const g=generation,f=get(id);
  const pending=imageTail.catch(()=>{}).then(()=>{guard(g);get(id);return withPdf(f.bytes,g,async doc=>{
    const canvas=await canvasFor(await doc.getPage(index+1),g,1.25);
    try{const blob=await blobOf(canvas);guard(g);return URL.createObjectURL(blob);}finally{canvas.width=canvas.height=0;}
  });});
  imageTail=pending;
  urls.set(key,pending);pending.catch(()=>{if(urls.get(key)===pending)urls.delete(key);});return pending;
}

async function recognize(image,g,positions=false){
  guard(g);
  let abandoned=false;
  const pending=createWorker('eng',1,{workerPath:'/ocr/worker.min.js',corePath:'/ocr',langPath:'/ocr',cacheMethod:'none',workerBlobURL:false,logger:()=>{},errorHandler:()=>{}});
  pending.then(worker=>{if(abandoned||g!==generation)void worker.terminate();}).catch(()=>{});
  let worker;try{worker=await cancelable(pending,g);}catch(e){abandoned=true;throw e;}
  if(g!==generation){await worker.terminate();throw canceled();}
  ocrWorkers.add(worker);
  try{const result=await cancelable(worker.recognize(image,{},positions?{tsv:true}:undefined),g);guard(g);return positions?result.data.tsv:result.data.text;}
  finally{ocrWorkers.delete(worker);await worker.terminate();}
}
async function imageCanvas(file,g){
  const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});try{guard(g);}catch(e){bitmap.close();throw e;}
  const factor=Math.min(1,2400/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*factor));canvas.height=Math.max(1,Math.round(bitmap.height*factor));
  canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();return canvas;
}
async function scanOne(file,names,g){
  const bytes=new Uint8Array(await file.arrayBuffer());guard(g);let text='',method='pdf-text',truncated=false;
  if(new TextDecoder().decode(bytes.slice(0,5))==='%PDF-'){
    await withPdf(bytes,g,async doc=>{
      truncated=doc.numPages>10;
      for(let i=1;i<=Math.min(doc.numPages,10);i++){
        const page=await doc.getPage(i);guard(g);let t=linesOf(textItems(await page.getTextContent(),page.getViewport({scale:1})));
        if(t.trim().length<25){const canvas=await canvasFor(page,g,2);try{t=await recognize(canvas,g);method='ocr';}finally{canvas.width=canvas.height=0;}}
        text+=t+'\n';page.cleanup();
      }
    });
  }else{
    const canvas=await imageCanvas(file,g);try{text=await recognize(canvas,g);method='ocr';}finally{canvas.width=canvas.height=0;}
  }
  const result=parseDocument(text,file.name,names);result.method=method;
  if(truncated){result.note='Only the first 10 pages were read. Review all remaining pages yourself.';result.names={status:'unknown'};}
  return result;
}

async function pack(id,files,selected,values){return operation(async g=>{
  limit(files);const f=get(id),filled=await fillPdf(f.bytes,f.tpl,values);guard(g);
  if(files.reduce((n,f)=>n+f.size,0)+filled.length>60*MB)throw new Error('The complete claim pack exceeds 60 MB.');
  const output=await PDFDocument.create(),font=await output.embedFont(StandardFonts.Helvetica);
  const order=new Map(categories.map((c,i)=>[c.id,i]));
  const items=[{name:'Filled claim form',category:'claim_form',bytes:filled}];
  for(const [i,file] of files.entries()){
    guard(g);let bytes=new Uint8Array(await file.arrayBuffer());
    if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-'){
      const canvas=await imageCanvas(file,g);
      try{const imageDoc=await PDFDocument.create(),image=await imageDoc.embedPng(await (await blobOf(canvas)).arrayBuffer());const page=imageDoc.addPage(image.width>image.height?[842,595]:[595,842]);const s=Math.min((page.getWidth()-48)/image.width,(page.getHeight()-48)/image.height);page.drawImage(image,{x:(page.getWidth()-image.width*s)/2,y:(page.getHeight()-image.height*s)/2,width:image.width*s,height:image.height*s});bytes=await imageDoc.save();}
      finally{canvas.width=canvas.height=0;}
    }
    items.push({name:file.name,category:order.has(selected[i])?selected[i]:'other',bytes});
  }
  items.sort((a,b)=>order.get(a.category)-order.get(b.category));
  const indexCount=Math.ceil(items.length/30),indexes=Array.from({length:indexCount},()=>output.addPage([595,842]));
  const rows=[];
  for(const item of items){
    guard(g);const source=await PDFDocument.load(item.bytes,{updateMetadata:false});
    if(source.getPageCount()>40||output.getPageCount()+source.getPageCount()>160)throw new Error('Use at most 40 pages per document and 160 pages per pack.');
    const first=output.getPageCount()+1;
    for(const p of await output.copyPages(source,source.getPageIndices()))output.addPage(p);
    rows.push({label:categories.find(c=>c.id===item.category).label,name:item.name,range:`${first}–${output.getPageCount()}`});
  }
  const safe=s=>s.replace(/[^\x20-\x7E]/g,'?');
  for(let n=0;n<indexes.length;n++){
    const page=indexes[n];page.drawText('Claim document index',{x:36,y:795,font,size:18});
    page.drawText('Review all documents and patient details before submission.',{x:36,y:773,font,size:9});
    rows.slice(n*30,n*30+30).forEach((row,i)=>{const y=742-i*21;page.drawText(safe(row.label).slice(0,32),{x:36,y,font,size:9});page.drawText(safe(row.name).slice(0,34),{x:228,y,font,size:8});page.drawText(row.range,{x:510,y,font,size:9});});
  }
  for(const [i,page] of output.getPages().entries())page.drawText(`Page ${i+1} of ${output.getPageCount()}`,{x:Math.max(4,page.getWidth()-100),y:12,font,size:8,color:rgb(.35,.35,.35)});
  const present=new Set(items.map(i=>i.category));
  const report={pages:output.getPageCount(),missing:categories.filter(c=>c.required&&!present.has(c.id)).map(c=>c.label),name_variants:[],name_unverified:files.map(f=>({file:f.name,status:'unknown'}))};
  const bytes=await output.save();guard(g);return {blob:new Blob([bytes],{type:'application/pdf'}),report};
});}

export const api={upload,pageImage,pack,
  templates:async()=>{guard(generation);return [...forms.entries()].map(([form_id,f])=>({form_id,name:f.tpl.name,pages:f.tpl.pages.length,fields:f.tpl.fields.length}));},
  template:async id=>clone(get(id).tpl),detect:async id=>clone(get(id).detect),
  suggestLabels:(id,index,currentFields)=>operation(async g=>{
    const f=get(id);const selected=currentFields||f.tpl.fields;if(!Array.isArray(selected)||selected.length>5000)throw new Error('This layout is too large.');if(!Number.isInteger(index)||index<0||index>=f.tpl.pages.length)throw new Error('Choose a valid page.');
    return withPdf(f.bytes,g,async doc=>{
      const page=await doc.getPage(index+1),view=page.getViewport({scale:1}),canvas=await canvasFor(page,g,2);
      try {
        const tsv=await recognize(canvas,g,true),sx=canvas.width/view.width,sy=canvas.height/view.height;
        const words=(tsv||'').split('\n').slice(1).map(line=>line.split('\t')).filter(v=>v[0]==='5'&&Number(v[10])>=50&&v[11]?.trim()).map(v=>({text:v[11].trim(),x:Number(v[6])/sx,y:Number(v[7])/sy,width:Number(v[8])/sx,height:Number(v[9])/sy}));
        const labels={};for(const field of selected.filter(x=>x.page===index&&!x.acro_name)){
          const boxes=field.boxes?.length?field.boxes:field.rect?[field.rect]:[];if(!boxes.length)continue;
          const rect=[Math.min(...boxes.map(b=>b[0])),Math.min(...boxes.map(b=>b[1])),Math.max(...boxes.map(b=>b[2])),Math.max(...boxes.map(b=>b[3]))];
          const label=fieldLabel(rect,words);if(label)labels[field.id]=label;
        }return labels;
      }finally{canvas.width=canvas.height=0;}
    });
  }),
  saveTemplate:async(id,tpl)=>{const f=get(id);if(JSON.stringify(tpl).length>MB)throw new Error('This layout is too large.');f.tpl={...clone(tpl),form_id:id,pages:f.tpl.pages,version:f.tpl.version+1};return {saved:true,version:f.tpl.version};},
  remove:async id=>{forms.delete(id);for(const [key,promise] of urls){if(key.startsWith(`${id}/`)){promise.then(URL.revokeObjectURL).catch(()=>{});urls.delete(key);}}return {deleted:true};},
  fill:(id,values)=>operation(async g=>{const f=get(id),bytes=await fillPdf(f.bytes,f.tpl,values);guard(g);return new Blob([bytes],{type:'application/pdf'});}),
  check:async(id,values)=>{const f=get(id);return {computed:computedValues(f.tpl,values),issues:check(f.tpl,values)};},
  features:async()=>({ocr:true,engine:'browser',categories}),
  scan:(files,names=[])=>operation(async g=>{limit(files);const results=[];for(const file of files){try{results.push(await scanOne(file,names,g));}catch(e){guard(g);results.push({file:file.name,category:'other',names:{status:'unknown'},error:'Could not read this document. Check the file and enter its details manually.'});}}return {results};}),
};
export async function clearSession(){
  generation++;abort.abort();abort=new AbortController();imageTail=Promise.resolve();expires=Date.now()+TTL;busy=false;forms.clear();
  for(const p of urls.values())p.then(URL.revokeObjectURL).catch(()=>{});urls.clear();
  for(const task of tasks)void task.destroy().catch(()=>{});tasks.clear();
  for(const worker of ocrWorkers)void worker.terminate().catch(()=>{});ocrWorkers.clear();return true;
}
setInterval(()=>{if(Date.now()>=expires){void clearSession();window.dispatchEvent(new Event('formfill-expired'));}},1000);
window.addEventListener('pagehide',()=>{void clearSession();window.dispatchEvent(new Event('formfill-expired'));});
window.addEventListener('pageshow',event=>{if(event.persisted)window.location.reload();});
window.addEventListener('focus',()=>{if(Date.now()>=expires){void clearSession();window.dispatchEvent(new Event('formfill-expired'));}});

export const sessionExpiresAt=()=>expires;
