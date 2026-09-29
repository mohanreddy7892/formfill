// detect.js — Find printable box rows and native fields in a locally opened PDF.
// Geometry is in displayed PDF points so mapping works on rotated pages too.
export function boxRuns(operators, OPS, viewport, words) {
  let matrix=[1,0,0,1,0,0]; const stack=[],boxes=[];
  const multiply=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
  const add=points=>{
    if(points.length<4)return;
    const t=multiply(viewport.transform,matrix);
    const p=points.map(([x,y])=>[t[0]*x+t[2]*y+t[4],t[1]*x+t[3]*y+t[5]]);
    const b=[Math.min(...p.map(p=>p[0])),Math.min(...p.map(p=>p[1])),Math.max(...p.map(p=>p[0])),Math.max(...p.map(p=>p[1]))];
    const w=b[2]-b[0],h=b[3]-b[1];
    if(w>5 && w<16 && h>5 && h<16 && w/h>.6 && w/h<1.7 && boxes.length<5000) boxes.push(b.map(x=>+x.toFixed(2)));
  };
  for(let i=0;i<operators.fnArray.length;i++) {
    const op=operators.fnArray[i],args=operators.argsArray[i];
    if(op===OPS.save)stack.push([...matrix]);
    else if(op===OPS.restore)matrix=stack.pop()||[1,0,0,1,0,0];
    else if(op===OPS.transform)matrix=multiply(matrix,args);
    else if(op===OPS.paintFormXObjectBegin){stack.push([...matrix]);if(args[0])matrix=multiply(matrix,args[0]);}
    else if(op===OPS.paintFormXObjectEnd)matrix=stack.pop()||[1,0,0,1,0,0];
    else if(op===OPS.constructPath) {
      // PDF.js 6 compact DrawOPS: move, line, cubic, quadratic, close.
      const path=args[1]?.[0];if(!path || typeof path.length!=='number')continue;
      let points=[];
      for(let j=0;j<path.length;) {
        const kind=path[j++];
        if(kind===0){if(points.length>=5 && points[0][0]===points.at(-1)[0] && points[0][1]===points.at(-1)[1])add(points);points=[];points.push([path[j++],path[j++]]);}
        else if(kind===1)points.push([path[j++],path[j++]]);
        else if(kind===2){j+=4;points.push([path[j++],path[j++]]);}
        else if(kind===3){j+=2;points.push([path[j++],path[j++]]);}
        else if(kind===4){add(points);points=[];}
        else break;
        if(points.length>64)points=[];
      }
      if(points.length>=5 && points[0][0]===points.at(-1)[0] && points[0][1]===points.at(-1)[1])add(points);
    }
  }
  return groupBoxes(boxes,words);
}

export function groupBoxes(boxes,words=[]) {
  const unique=[...new Map(boxes.map(b=>[b.map(x=>Math.round(x*2)).join(','),b])).values()].sort((a,b)=>a[1]-b[1]||a[0]-b[0]);
  const rows=[];
  for(const b of unique){const row=rows.find(r=>Math.abs(r[0][1]-b[1])<=2.2);row?row.push(b):rows.push([b]);}
  const runs=[];
  for(const row of rows){row.sort((a,b)=>a[0]-b[0]);let run=[];for(const b of row){if(run.length && b[0]-run.at(-1)[2]>4){runs.push(run);run=[];}run.push(b);}if(run.length)runs.push(run);}
  return runs.map((boxes,i)=>{
    const b=boxes[0];
    const near=words.filter(w=>Math.abs(w.y-b[1])<8 && w.x+w.width<=b[0]+2 && b[0]-w.x<220).sort((a,b)=>a.x-b.x);
    return {id:`r${i}`,boxes,kind:boxes.length===1?'checkbox':'boxes',label:near.map(w=>w.text).join(' ').slice(-60).replace(/[:\s]+$/,'')};
  });
}

// Scans have no PDF paths. Find enclosed, mostly empty box interiors in a bounded
// grayscale raster, then group them using the same displayed-point coordinates.
export function rasterBoxRuns(image,scaleX,scaleY,words=[]) {
  const {width,height,data}=image,n=width*height;
  if(n>6000000)throw new Error('Detection image is too large.');
  const white=new Uint8Array(n),queue=new Uint32Array(n),boxes=[],textAreas=[];
  // Pale gray borders in scanned forms can exceed 225 after interpolation.
  // Keep those borders closed; otherwise adjacent cells leak into the background
  // and one real input is incorrectly split into shorter fields or checkboxes.
  for(let i=0;i<n;i++)white[i]=(data[i*4]+data[i*4+1]+data[i*4+2])/3>245?1:0;
  // Close sub-pixel scan gaps in borders without widening or inventing cells.
  // Opening the white mask is equivalent to closing the dark border mask.
  const interior=new Uint8Array(n);
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    const p=y*width+x;
    interior[p]=white[p-width-1]&white[p-width]&white[p-width+1]&white[p-1]&white[p]&white[p+1]&white[p+width-1]&white[p+width]&white[p+width+1];
  }
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    const p=y*width+x;
    white[p]=interior[p-width-1]|interior[p-width]|interior[p-width+1]|interior[p-1]|interior[p]|interior[p+1]|interior[p+width-1]|interior[p+width]|interior[p+width+1];
  }
  for(let start=0;start<n;start++){
    if(!white[start])continue;
    let head=0,tail=1,minX=width,minY=height,maxX=0,maxY=0,touches=false;
    queue[0]=start;white[start]=0;
    while(head<tail){
      const p=queue[head++],x=p%width,y=(p/width)|0;
      minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
      if(x===0||y===0||x===width-1||y===height-1)touches=true;
      if(x>0&&white[p-1]){white[p-1]=0;queue[tail++]=p-1;}
      if(x+1<width&&white[p+1]){white[p+1]=0;queue[tail++]=p+1;}
      if(y>0&&white[p-width]){white[p-width]=0;queue[tail++]=p-width;}
      if(y+1<height&&white[p+width]){white[p+width]=0;queue[tail++]=p+width;}
    }
    const w=(maxX-minX+1)/scaleX,h=(maxY-minY+1)/scaleY;
    const density=tail/((maxX-minX+1)*(maxY-minY+1));
    const rect=[(minX-.5)/scaleX,(minY-.5)/scaleY,(maxX+1.5)/scaleX,(maxY+1.5)/scaleY];
    if(!touches && w>=5 && w<=18 && h>=5 && h<=18 && w/h>.6 && w/h<1.7 && density>.65)boxes.push(rect);
    else if(!touches && w>30 && w<=520 && h>=5 && h<=350 && w/h>=.2 && density>.985)textAreas.push(rect);
  }
  const marks=smallInkMarks(image,scaleX,scaleY,white,queue);
  const areas=textAreas.flatMap(rect=>{
    // A merged answer column may contain several colon-prefixed answers.
    const edge=marks.filter(m=>m[0]>=rect[0]&&m[2]<=rect[0]+7&&m[1]>rect[1]&&m[3]<rect[3]);
    const colons=[];
    for(let i=0;i<edge.length;i++)for(let j=i+1;j<edge.length;j++){
      const a=edge[i],b=edge[j],dy=b[1]-a[1];
      if(Math.abs(a[0]-b[0])<.8&&dy>=1.5&&dy<=4.5&&a[2]-a[0]<2&&b[2]-b[0]<2){colons.push(a[1]);break;}
    }
    const starts=[...new Set(colons.map(y=>Math.round(y)))].sort((a,b)=>a-b).filter((y,i,ys)=>!i||y-ys[i-1]>5);
    if(!starts.length)return [rect];
    return starts.map((y,i)=>[rect[0]+7,Math.max(rect[1],y-3),rect[2],Math.min(rect[3],i+1<starts.length?starts[i+1]-3:rect[3])]).filter(r=>r[3]-r[1]>=5);
  });
  const open=colonAnswerAreas(marks,width/scaleX,height/scaleY,words).filter(r=>!textAreas.some(a=>r[0]<a[2]&&r[2]>a[0]&&r[1]<a[3]&&r[3]>a[1])&&!boxes.some(a=>r[0]<a[2]&&r[2]>a[0]&&r[1]<a[3]&&r[3]>a[1]));
  const dotted=mergeDottedAreas(dottedAreas(marks),words).filter(r=>!areas.some(a=>r[0]<a[2]&&r[2]>a[0]&&r[1]<a[3]&&r[3]>a[1]));
  return [...groupBoxes(boxes.filter(b=>!insidePrintedWord(b,words)),words),...[...areas,...open,...dotted].map((rect,i)=>({id:`t${i}`,boxes:[rect],kind:'text',source:open.includes(rect)?'open-answer':'printed-area',label:words.filter(w=>Math.abs(w.y-rect[1])<8&&w.x+w.width<=rect[0]+2&&rect[0]-w.x<140).map(w=>w.text).join(' ').slice(-60)}))];
}

// Tiny connected ink marks identify dotted blanks and colon-prefixed answers.
// Reuse the bounded raster buffers; neither pixels nor text leave the session.
function smallInkMarks(image,sx,sy,mask,queue) {
  const {width,height,data}=image,n=width*height,marks=[];
  for(let i=0;i<n;i++)mask[i]=(data[i*4]+data[i*4+1]+data[i*4+2])/3<210?1:0;
  for(let start=0;start<n;start++){
    if(!mask[start])continue;
    let head=0,tail=1,x0=width,y0=height,x1=0,y1=0;queue[0]=start;mask[start]=0;
    while(head<tail){
      const p=queue[head++],x=p%width,y=(p/width)|0;
      x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
      if(x>0&&mask[p-1]){mask[p-1]=0;queue[tail++]=p-1;}
      if(x+1<width&&mask[p+1]){mask[p+1]=0;queue[tail++]=p+1;}
      if(y>0&&mask[p-width]){mask[p-width]=0;queue[tail++]=p-width;}
      if(y+1<height&&mask[p+width]){mask[p+width]=0;queue[tail++]=p+width;}
    }
    const w=(x1-x0+1)/sx,h=(y1-y0+1)/sy;
    if(marks.length<10000&&w<=4.5&&h<=2&&w>=.2&&h>=.2)marks.push([x0/sx,y0/sy,(x1+1)/sx,(y1+1)/sy]);
  }
  return marks.sort((a,b)=>a[1]-b[1]||a[0]-b[0]);
}
export function mergeDottedAreas(rects,words=[]) {
  const merged=[];
  for(const r of [...rects].sort((a,b)=>a[1]-b[1]||a[0]-b[0])){
    const prior=merged.find(a=>Math.abs(a[3]-r[3])<1.5&&r[0]>=a[2]&&r[0]-a[2]<=20&&!words.some(w=>/[\p{L}\p{N}\x00-\x1f]/u.test(w.text||'')&&w.x>=a[2]&&w.x+w.width<=r[0]&&w.y<r[3]+3&&w.y+(w.height||8)>r[1]));
    if(prior)prior[2]=r[2];else merged.push([...r]);
  }return merged;
}

export function colonAnswerAreas(marks,width,height,words=[]) {
  const points=[];
  for(let i=0;i<marks.length;i++){
    const a=marks[i];if(a[0]<width*.5||a[2]-a[0]>2||a[3]-a[1]>2)continue;
    for(let j=i+1;j<marks.length&&marks[j][1]-a[1]<=4.5;j++){
      const b=marks[j],dy=b[1]-a[1];
      if(dy>=1.4&&Math.abs(a[0]-b[0])<.8&&b[2]-b[0]<=2&&b[3]-b[1]<=2){points.push({x:Math.max(a[2],b[2]),y:a[1]});break;}
    }
  }
  const columns=[];
  for(const p of points){const column=columns.find(c=>Math.abs(c[0].x-p.x)<2);column?column.push(p):columns.push([p]);}
  const rects=[];
  for(const column of columns.filter(c=>c.length>=5)){
    const rows=column.sort((a,b)=>a.y-b.y).filter((p,i,ps)=>!i||p.y-ps[i-1].y>6);
    for(let i=0;i<rows.length;i++){
      const p=rows[i],top=Math.max(0,p.y-3),bottom=Math.min(height-10,rows[i+1]?.y-4||top+18);
      // Preserve printed options or prompts to the right of the colon.
      const rightWords=words.filter(w=>w.text?.trim()&&w.x>p.x+5&&Math.abs(w.y-top)<8);
      const right=Math.min(width-24,...rightWords.map(w=>w.x-3));
      if(right-p.x>=14&&bottom-top>=6)rects.push([p.x+3,top,right,Math.min(bottom,top+60)]);
    }
  }
  return rects;
}

export function dottedAreas(marks) {
  const rows=[];
  for(const m of marks){const row=rows.find(r=>Math.abs(r[0][3]-m[3])<.8);row?row.push(m):rows.push([m]);}
  const areas=[];
  for(const row of rows){
    row.sort((a,b)=>a[0]-b[0]);let run=[];
    const finish=()=>{if(run.length>=6&&run.at(-1)[2]-run[0][0]>=15){const y=Math.max(...run.map(m=>m[3]));areas.push([run[0][0],y-9,run.at(-1)[2],y-1]);}run=[];};
    for(const m of row){if(run.length&&(m[0]-run.at(-1)[2]>5||m[0]<run.at(-1)[2]))finish();run.push(m);}finish();
  }
  return areas;
}

export function isInstructionPage(words) {
  const heading=words.filter(w=>w.y<100).map(w=>w.text).join(' ');
  return /\b(?:guidance|instructions)\s+(?:for|on|to)\s+fill(?:ing)?\b/i.test(heading);
}

export function mergeDetectedRuns(vector,raster,words=[]) {
  const boxes=vector.filter(r=>r.kind!=='text').flatMap(r=>r.boxes);
  for(const box of raster.filter(r=>r.kind!=='text').flatMap(r=>r.boxes))
    if(!boxes.some(v=>v.every((x,i)=>Math.abs(x-box[i])<1.8)))boxes.push(box);
  return [...groupBoxes(boxes.filter(b=>!insidePrintedWord(b,words)),words),...raster.filter(r=>r.kind==='text')];
}

const insidePrintedWord=(b,words)=>{
  const overlapping=words.filter(w=>(w.height||10)>=10&&(w.height||10)>(b[3]-b[1])*1.25&&Math.min(w.y+(w.height||10),b[3])-Math.max(w.y,b[1])>(b[3]-b[1])*.5&&w.x<b[2]&&w.x+w.width>b[0]);
  const covered=overlapping.reduce((n,w)=>n+Math.min(w.x+w.width,b[2])-Math.max(w.x,b[0]),0);
  return covered>(b[2]-b[0])*.9&&overlapping.some(w=>w.x<b[0]-.5||w.x+w.width>b[2]+.5);
};

const cleanLabel=s=>s&&/\p{L}/u.test(s)&&!/[\x00-\x1f\ufffd]/.test(s)?s.trim():'';

export function fieldLabel(rect,words) {
  const usable=words.filter(w=>w.text?.trim()&&/\p{L}/u.test(w.text)&&!/[\x00-\x1f\ufffd]/.test(w.text));
  const left=usable.filter(w=>w.x+w.width<=rect[0]+1&&rect[0]-w.x<220&&Math.abs(w.y-rect[1])<10);
  const above=usable.filter(w=>w.y+(w.height||8)<=rect[1]+1&&rect[1]-w.y-(w.height||8)<14&&w.x>=rect[0]-8&&w.x<rect[2]);
  const candidates=left.length?left:above;if(!candidates.length)return '';
  const anchor=candidates.reduce((a,b)=>Math.abs(a.y-rect[1])<Math.abs(b.y-rect[1])?a:b);
  const line=candidates.filter(w=>Math.abs(w.y-anchor.y)<3).sort((a,b)=>a.x-b.x);
  let start=0;
  if(left.length)for(let i=1;i<line.length;i++)if(line[i].x-line[i-1].x-line[i-1].width>20)start=i;
  return line.slice(start).map(w=>w.text).join(' ').replace(/^\s*\d+[.)]?\s*/, '').replace(/[:\s]+$/,'').slice(-80);
}

export function suggestedFields(runs,page) {
  return runs.map((run,i)=>({id:`detected_${page}_${i}`,page,group:`Page ${page+1}`,label:cleanLabel(run.label)||`${run.kind==='text'?'Text area':run.boxes.length>1?'Character boxes':'Checkbox'} ${i+1}`,
    type:run.kind==='text'?'text':run.boxes.length>1?'boxes':'checkbox',boxes:run.kind!=='text'&&run.boxes.length>1?run.boxes:[],rect:run.boxes.length===1?run.boxes[0]:null,
    options:[],upper:true,align:'left',clear:false,multi:false,hint:'Suggested from printed areas. Check its label and position before filling.'}));
}

export function nativeFields(annotations,viewport,page,existing=[]) {
  const fields=[];
  for(const a of annotations) {
    if(a.subtype!=='Widget'||!a.fieldName||a.readOnly||a.fieldType==='Sig'||a.pushButton)continue;
    const t=viewport.transform,[x0,y0,x1,y1]=a.rect,r=[t[0]*x0+t[2]*y0+t[4],t[1]*x0+t[3]*y0+t[5],t[0]*x1+t[2]*y1+t[4],t[1]*x1+t[3]*y1+t[5]],rect=[Math.min(r[0],r[2]),Math.min(r[1],r[3]),Math.max(r[0],r[2]),Math.max(r[1],r[3])];
    let type=a.checkBox?'checkbox':a.radioButton||a.fieldType==='Ch'?'choice':'acro';
    if(a.fieldType==='Ch') type='acro'; // Text input accepts the existing option's exact value.
    const prior=[...existing,...fields].find(f=>f.acro_name===a.fieldName);
    if(prior){if(a.radioButton)prior.options.push({value:a.buttonValue||a.exportValue||'Yes',rect});continue;}
    fields.push({id:`native_${page}_${fields.length}`,page,label:a.alternativeText||a.fieldName,group:`Page ${page+1}`,type,rect,
      acro_name:a.fieldName,upper:false,boxes:[],options:a.radioButton?[{value:a.buttonValue||a.exportValue||'Yes',rect}]:[],multi:!!a.multiSelect});
  }
  return fields;
}
