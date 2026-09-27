import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {checkedValues,fillPdf} from './pdf.js';
import {parseDocument,nameCheck} from './documents.js';
import {boxRuns} from './detect.js';
const tpl={pages:[{width:595,height:842}],fields:[{id:'name',label:'Name',page:0,type:'text',rect:[30,40,300,60]}],rules:[{kind:'required',of:['name'],severity:'error',message:'Name required'}]};
test('exports enforce blocking rules',()=>assert.throws(()=>checkedValues(tpl,{}),/Name required/));
test('bill reading preserves decimal amounts',()=>{const r=parseDocument('EXAMPLE PHARMACY\nTax Invoice\nPatient Name: TEST PERSON\nBill No: 12345\nDate: 25-09-2026\nGrand Total: 1234.56','', ['TEST PERSON']);assert.equal(r.bill.amount,1234.56);assert.equal(r.bill.date,'2026-09-25');assert.equal(r.names.status,'match');});
test('a surname or initial is not a patient match',()=>{assert.equal(nameCheck(['TEST PERSON'],'Patient Name: T PERSON').status,'not_found');assert.equal(nameCheck(['TEST PERSON'],'Receipt for TEST PERSON').status,'unknown');});
test('invalid dates are not silently normalized',()=>assert.equal(parseDocument('Tax Invoice\nDate: 31-02-2026').bill.date,null));
test('box geometry groups adjacent rectangles',()=>{const path=[0,10,10,1,20,10,1,20,20,1,10,20,4,0,23,10,1,33,10,1,33,20,1,23,20,4];const r=boxRuns({fnArray:[91],argsArray:[[20,[path],[10,10,33,20]]]},{constructPath:91},{transform:[1,0,0,-1,0,842]},[]);assert.equal(r.length,1);assert.equal(r[0].boxes.length,2);assert.deepEqual(r[0].boxes[0],[10,822,20,832]);});
test('overlay filling produces a real PDF',async()=>{const doc=await PDFDocument.create();doc.addPage([595,842]);const bytes=await fillPdf(await doc.save(),tpl,{name:'TEST PERSON'});const out=await PDFDocument.load(bytes);assert.equal(out.getPageCount(),1);assert.equal(out.getForm().getFields().length,0);});
test('native PDF fields are filled and flattened',async()=>{const doc=await PDFDocument.create(),page=doc.addPage([595,842]);doc.getForm().createTextField('Name').addToPage(page,{x:30,y:780,width:270,height:20});const t={...tpl,fields:[{...tpl.fields[0],type:'acro',acro_name:'Name'}]};const bytes=await fillPdf(await doc.save(),t,{name:'TEST PERSON'});const out=await PDFDocument.load(bytes);assert.equal(out.getForm().getFields().length,0);assert.equal(out.getPageCount(),1);});
test('text that cannot fit is blocked instead of clipped',async()=>{const doc=await PDFDocument.create();doc.addPage([595,842]);await assert.rejects(fillPdf(await doc.save(),tpl,{name:'A'.repeat(200)}),/does not fit/);});

test('image-only gray box rows become editable field suggestions',async()=>{
  const {rasterBoxRuns,suggestedFields}=await import('./detect.js');
  const width=200,height=100,data=new Uint8ClampedArray(width*height*4).fill(255);
  const mark=(x,y)=>{const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=190;};
  for(const x of [20,44,68]){for(let dx=0;dx<=20;dx++){mark(x+dx,20);mark(x+dx,40);}for(let dy=0;dy<=20;dy++){mark(x,20+dy);mark(x+20,20+dy);}}
  const runs=rasterBoxRuns({width,height,data},2,2);
  assert.equal(runs.length,1);assert.equal(runs[0].boxes.length,3);
  const fields=suggestedFields(runs,0);assert.equal(fields[0].type,'boxes');assert.equal(fields[0].boxes.length,3);
  assert.ok(Math.abs(fields[0].boxes[0][0]-10)<1);
});
test('empty raster does not invent form fields',async()=>{
  const {rasterBoxRuns}=await import('./detect.js');assert.deepEqual(rasterBoxRuns({width:100,height:100,data:new Uint8ClampedArray(40000).fill(255)},2,2),[]);
});
test('faint cells within a phone row remain one complete input',async()=>{
  const {rasterBoxRuns,suggestedFields}=await import('./detect.js');
  const width=350,height=90,data=new Uint8ClampedArray(width*height*4).fill(255);
  for(let cell=0;cell<12;cell++){
    const x=20+24*cell,gray=[5,7].includes(cell)?240:190;
    const mark=(x,y)=>{const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=gray;};
    for(let dx=0;dx<=20;dx++){mark(x+dx,20);mark(x+dx,40);}
    for(let dy=0;dy<=20;dy++){mark(x,20+dy);mark(x+20,20+dy);}
  }
  const fields=suggestedFields(rasterBoxRuns({width,height,data},2,2),0);
  assert.equal(fields.length,1);assert.equal(fields[0].type,'boxes');assert.equal(fields[0].boxes.length,12);
});
test('repeated-start closed vector subpaths are detected before the next move',()=>{
  const path=[0,10,10,1,20,10,1,20,20,1,10,20,1,10,10,0,23,10,1,33,10,1,33,20,1,23,20,1,23,10];
  const runs=boxRuns({fnArray:[91],argsArray:[[20,[path],[10,10,33,20]]]},{constructPath:91},{transform:[1,0,0,-1,0,842]},[]);
  assert.equal(runs[0].boxes.length,2);
});
