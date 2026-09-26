// pdf.js — Fill PDFs locally and enforce the same checks for individual and packed exports.
// Uses PDF coordinates from the displayed page, including rotation and cropped pages.
import {PDFDocument, StandardFonts, rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix} from 'pdf-lib';
import {check,computedValues} from '../demo/rules.js';

const truthy=v=>v===true || /^(1|true|yes|y|on|x|checked)$/i.test(String(v));
export function checkedValues(tpl, values) {
  const v={...values,...computedValues(tpl,values)};
  const errors=check(tpl,v).filter(i=>i.severity==='error').map(i=>i.message);
  for (const f of tpl.fields) {
    const value=v[f.id]; if(value==null || value==='' || (Array.isArray(value)&&!value.length)) continue;
    if (f.type==='boxes' && String(value).length>f.boxes.length) errors.push(`${f.label}: too many characters for the boxes.`);
    if (f.type==='choice') {
      const chosen=[...new Set((Array.isArray(value)?value:[value]).map(x=>String(x).toUpperCase()))];
      if ((!f.multi && chosen.length>1) || chosen.some(x=>!f.options.some(o=>o.value.toUpperCase()===x))) errors.push(`${f.label}: choose a valid option.`);
    }
  }
  if(errors.length) throw new Error(errors.join(' · '));
  return v;
}
export async function fillPdf(bytes,tpl,values) {
  const v=checkedValues(tpl,values);
  const doc=await PDFDocument.load(bytes,{updateMetadata:false});
  const font=await doc.embedFont(StandardFonts.HelveticaBold);
  const form=doc.getForm(), pages=doc.getPages();
  for(const f of tpl.fields) {
    const value=v[f.id]; if(value==null || value==='' || (Array.isArray(value)&&!value.length)) continue;
    if(f.acro_name) {
      const native=form.getField(f.acro_name);
      if(native.setText) native.setText(String(value));
      else if(native.check) truthy(value)?native.check():native.uncheck();
      else if(native.select) native.select(value);
      else throw new Error('This PDF field cannot be filled. Map it as a text area instead.');
      continue;
    }
    const page=pages[f.page], info=tpl.pages[f.page], height=info.height;
    const t=info.transform || [1,0,0,-1,0,height];
    const [a,b,c,d,e,g]=t, determinant=a*d-b*c;
    // Inverse viewport transform, composed with the displayed bottom-left coordinates.
    page.pushOperators(pushGraphicsState(),concatTransformationMatrix(d/determinant,-b/determinant,c/determinant,-a/determinant,
      (-d*e+c*(g-height))/determinant,(b*e+a*(height-g))/determinant));
    const ink=rgb(.05,.10,.45);
    const white=r=>page.drawRectangle({x:r[0],y:height-r[3],width:r[2]-r[0],height:r[3]-r[1],color:rgb(1,1,1)});
    const draw=(s,x,baseline,size,center=false)=>{
      try {const width=font.widthOfTextAtSize(s,size);page.drawText(s,{x:center?x-width/2:x,y:height-baseline,size,font,color:ink});}
      catch {throw new Error(`${f.label}: this PDF font supports Latin characters only. Use a supported spelling before exporting.`);}
    };
    const tick=r=>draw('X',(r[0]+r[2])/2,r[1]+(r[3]-r[1])*.82,Math.max(5.5,Math.min(9,(r[3]-r[1])*.95)),true);
    if(f.type==='boxes') {
      const s=f.upper===false?String(value):String(value).toUpperCase(), boxes=f.align==='right'?f.boxes.slice(f.boxes.length-s.length):f.boxes;
      [...s].forEach((ch,i)=>{const r=boxes[i],w=r[2]-r[0],h=r[3]-r[1];if(f.clear)white([r[0]+.8,r[1]+.8,r[2]-.8,r[3]-.8]);draw(ch,(r[0]+r[2])/2,r[1]+h*.78,f.size||Math.max(5,Math.min(h*.78,w*.95)),true);});
    } else if(f.type==='text'||f.type==='acro') {
      const r=f.rect,s=f.upper===false?String(value):String(value).toUpperCase();
      let size=f.size||Math.min(8,(r[3]-r[1])*.75),width;
      try {while(size>4.5 && font.widthOfTextAtSize(s,size)>r[2]-r[0]-4)size-=.25;width=font.widthOfTextAtSize(s,size);}
      catch {throw new Error(`${f.label}: use Latin characters for this PDF font.`);}
      if(width>r[2]-r[0]-4) throw new Error(`${f.label}: text does not fit. Shorten it or enlarge its field.`);
      if(f.clear)white(r);
      draw(s,f.align==='right'?r[2]-2-width:r[0]+2,r[3]-(r[3]-r[1]-size)/2-size*.18,size);
    } else if(f.type==='checkbox' && truthy(value))tick(f.rect);
    else if(f.type==='choice') {
      const chosen=(Array.isArray(value)?value:[value]).map(x=>String(x).toUpperCase());
      f.options.filter(o=>chosen.includes(o.value.toUpperCase())).forEach(o=>tick(o.rect));
    }
    page.pushOperators(popGraphicsState());
  }
  form.updateFieldAppearances(font);
  form.flatten();
  // A new document drops source document-level scripts and metadata.
  const output=await PDFDocument.create();
  for(const p of await output.copyPages(doc,doc.getPageIndices()))output.addPage(p);
  return output.save();
}
