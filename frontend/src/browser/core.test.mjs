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

test('blank text areas and small breaks in scan borders are detected',async()=>{
  const {rasterBoxRuns,suggestedFields}=await import('./detect.js');
  const width=300,height=100,data=new Uint8ClampedArray(width*height*4).fill(255);
  const mark=(x,y)=>{const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=190;};
  for(const [left,right] of [[20,140],[180,260]]){
    for(let x=left;x<=right;x++){if(x!==40)mark(x,20);mark(x,44);}
    for(let y=20;y<=44;y++){mark(left,y);mark(right,y);}
  }
  // A printed content block must not be offered as a blank input.
  for(let y=25;y<39;y++)for(let x=190;x<245;x++)mark(x,y);
  const fields=suggestedFields(rasterBoxRuns({width,height,data},2,2),0);
  assert.equal(fields.length,1);assert.equal(fields[0].type,'text');
  assert.ok(fields[0].rect[2]-fields[0].rect[0]>55);
});
test('instruction headings exclude guidance tables without excluding forms',async()=>{
  const {isInstructionPage}=await import('./detect.js');
  assert.equal(isInstructionPage([{text:'GUIDANCE FOR FILLING CLAIM FORM',y:25}]),true);
  assert.equal(isInstructionPage([{text:'INSTRUCTIONS TO FILL THE FORM',y:25}]),true);
  assert.equal(isInstructionPage([{text:'CLAIM FORM - PART B',y:25},{text:'instructions for filling',y:500}]),false);
});
test('vector and raster detections do not duplicate the same cells',async()=>{
  const {mergeDetectedRuns}=await import('./detect.js');
  const runs=mergeDetectedRuns([{kind:'boxes',boxes:[[10,10,20,20],[23,10,33,20]]}],
    [{kind:'boxes',boxes:[[10.5,10.5,19.5,19.5],[23.5,10.5,32.5,19.5],[36,10,46,20]]}]);
  assert.equal(runs.length,1);assert.equal(runs[0].boxes.length,3);
});

test('tall answer columns split at colon markers',async()=>{
  const {rasterBoxRuns,suggestedFields}=await import('./detect.js');
  const width=400,height=400,data=new Uint8ClampedArray(width*height*4).fill(255);
  const ink=(x,y)=>{const p=(y*width+x)*4;data[p]=data[p+1]=data[p+2]=0;};
  for(let x=40;x<=300;x++){ink(x,20);ink(x,350);}
  for(let y=20;y<=350;y++){ink(40,y);ink(300,y);}
  for(const y of [40,160]){for(const dy of [0,5])for(let x=45;x<=46;x++)for(let z=y+dy;z<=y+dy+1;z++)ink(x,z);}
  const fields=suggestedFields(rasterBoxRuns({width,height,data},2,2),0);
  assert.equal(fields.length,2);assert.ok(fields.every(f=>f.type==='text'));
  assert.ok(fields[0].rect[3]<=fields[1].rect[1]);
  assert.ok(fields[0].rect[0]>23);
});
test('a split answer segment stops before a printed word instead of running into it',async()=>{
  const {rasterBoxRuns,suggestedFields}=await import('./detect.js');
  const width=400,height=400,data=new Uint8ClampedArray(width*height*4).fill(255);
  const ink=(x,y)=>{const p=(y*width+x)*4;data[p]=data[p+1]=data[p+2]=0;};
  for(let x=40;x<=300;x++){ink(x,20);ink(x,350);}
  for(let y=20;y<=350;y++){ink(40,y);ink(300,y);}
  for(const y of [40,160]){for(const dy of [0,5])for(let x=45;x<=46;x++)for(let z=y+dy;z<=y+dy+1;z++)ink(x,z);}
  // A printed hint ("Yes/No"-style word) sits well inside the detected box's raw width,
  // as happens when the scanned border is picked up a touch wider than the true blank.
  const words=[{text:'Yes',x:80,y:18,width:15,height:8}];
  const fields=suggestedFields(rasterBoxRuns({width,height,data},2,2,words),0);
  assert.equal(fields.length,2);
  assert.ok(fields[0].rect[2]<80,`expected the box to stop before the printed word, got right edge ${fields[0].rect[2]}`);
});
test('dotted answer runs become text fields, isolated punctuation does not',async()=>{
  const {dottedAreas}=await import('./detect.js');
  const marks=Array.from({length:12},(_,i)=>[20+i*2,30,20+i*2+.5,30.5]);
  const rects=dottedAreas([...marks,[80,30,80.5,30.5],[90,30,90.5,30.5]]);
  assert.equal(rects.length,1);assert.ok(rects[0][3]<30.5);
});
test('printed heading fragments cannot become checkboxes',async()=>{
  const {mergeDetectedRuns}=await import('./detect.js');
  const result=mergeDetectedRuns([],[{kind:'checkbox',boxes:[[10,10,16,17]]}],
    [{x:6,y:7,width:7,height:10},{x:13,y:7,width:8,height:10}]);
  assert.deepEqual(result,[]);
});
test('tall text wraps within bounds and rejects overflow',async()=>{
  const {fitTextLines}=await import('./pdf.js');
  const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.HelveticaBold);
  const text='TEST PERSON\nENGINEER AT EXAMPLE OFFICE';
  const layout=fitTextLines(text,font,85,40);
  assert.ok(layout.lines.length>=2);
  assert.ok(layout.lines.every(line=>font.widthOfTextAtSize(line,layout.size)<=85));
  assert.ok(layout.lines.length*layout.lineHeight<=40);
  assert.throws(()=>fitTextLines('TOO MUCH TEXT '.repeat(100),font,40,25),/does not fit/);
  doc.addPage([595,842]);
  const bytes=await fillPdf(await doc.save(),{pages:tpl.pages,fields:[{...tpl.fields[0],rect:[30,40,119,84]}]}, {name:text});
  assert.equal((await PDFDocument.load(bytes)).getPageCount(),1);
});
test('small printed placeholders do not remove real character boxes',async()=>{
  const {mergeDetectedRuns}=await import('./detect.js');
  const boxes=[[10,10,20,20],[23,10,33,20]];
  const runs=mergeDetectedRuns([{kind:'boxes',boxes}],[],[{x:9,y:12,width:26,height:6,text:'NAME'}]);
  assert.equal(runs[0].boxes.length,2);
});
test('aligned colon answers become text areas without covering printed choices',async()=>{
 const {colonAnswerAreas,mergeDottedAreas}=await import('./detect.js');
 const marks=Array.from({length:6},(_,i)=>[[300,100+i*20,301,101+i*20],[300,103+i*20,301,104+i*20]]).flat();
 const rects=colonAnswerAreas(marks,450,792,[{text:'Yes / No',x:335,y:97,width:40,height:10}]);
 assert.equal(rects.length,6);assert.ok(rects[0][2]<335);assert.ok(rects.every(r=>r[0]>301));
 assert.deepEqual(colonAnswerAreas(marks.slice(0,2),450,792),[]);
 assert.equal(mergeDottedAreas([[10,10,40,18],[50,10,80,18]]).length,1);
 assert.equal(mergeDottedAreas([[10,10,40,18],[50,10,80,18]],[{text:'to',x:42,y:10,width:6,height:8}]).length,2);
});
test('a colon row is not stretched across skipped lines to reach its next neighbour',async()=>{
 const {colonAnswerAreas}=await import('./detect.js');
 // 4 rows spaced 20pt apart (one printed line each), then a 5th row 3 lines further down -
 // as happens when the rows in between belong to a different, unrelated field.
 const close=Array.from({length:4},(_,i)=>[[300,100+i*20,301,101+i*20],[300,103+i*20,301,104+i*20]]).flat();
 const far=[[300,220,301,221],[300,223,301,224]];
 const rects=colonAnswerAreas([...close,...far],450,792,[{text:'Yes / No',x:335,y:97,width:40,height:10}]);
 assert.equal(rects.length,5);
 const heights=rects.map((r)=>r[3]-r[1]);
 assert.ok(heights.every((h)=>h<=22),`expected every row capped near one line, got ${heights}`);
});

test('uppercase expansion is validated before character boxes are drawn',async()=>{
  const doc=await PDFDocument.create();doc.addPage([595,842]);
  const field={id:'code',label:'Code',page:0,type:'boxes',upper:true,boxes:[[10,10,20,20]]};
  const template={pages:tpl.pages,fields:[field],rules:[]};
  assert.throws(()=>checkedValues(template,{code:'ß'}),/Code: too many characters/);
  await assert.rejects(fillPdf(await doc.save(),template,{code:'ß'}),/Code: too many characters/);
  field.boxes.push([23,10,33,20]);
  await assert.doesNotReject(fillPdf(await doc.save(),template,{code:'ß'}));
});

test('shared preview metrics match the embedded PDF font including alignment',async()=>{
  const {textFieldLayout}=await import('./text-layout.js');
  const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.HelveticaBold);
  for(const rect of [[20,20,220,80],[20,20,220,38]]){
    for(const align of ['left','right']){
      const field={type:'text',rect,align,upper:true};
      const text=rect[3]>40?'TEST PERSON\nEXAMPLE OFFICE':'AVATAR Test';
      assert.deepEqual(textFieldLayout(field,text),textFieldLayout(field,text,font));
      if(rect[3]>40)assert.equal(textFieldLayout(field,text).length,2);
    }
  }
});
