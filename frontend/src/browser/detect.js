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
        if(kind===0){points=[];points.push([path[j++],path[j++]]);}
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
