// text-layout.js — Share PDF font metrics and text placement with the page preview.
// Normalizes character boxes before validation and rejects text that cannot fit.
import {StandardFontEmbedder, StandardFonts} from 'pdf-lib';

const previewFont=StandardFontEmbedder.for(StandardFonts.HelveticaBold);
export const fieldText=(field,value)=>field.upper===false?String(value):String(value).toUpperCase();
export const boxCharacters=(field,value)=>Array.from(fieldText(field,value));

export function fitTextLines(text,font,width,height,initialSize=8) {
  for(let size=initialSize;size>=Math.min(4.5,initialSize);size-=.25){
    const lines=[];let tooWide=false;
    for(const paragraph of text.split(/\r?\n/)){
      let line='';
      for(const word of paragraph.split(/\s+/).filter(Boolean)){
        if(font.widthOfTextAtSize(word,size)>width){tooWide=true;break;}
        const candidate=line?`${line} ${word}`:word;
        if(font.widthOfTextAtSize(candidate,size)>width){lines.push(line);line=word;}else line=candidate;
      }
      lines.push(line);if(tooWide)break;
    }
    if(!tooWide&&lines.length*size*1.2<=height)return {lines,size,lineHeight:size*1.2};
  }
  throw new Error('text does not fit. Shorten it or enlarge its field.');
}

export function textFieldLayout(field,value,font=previewFont) {
  const r=field.rect,text=fieldText(field,value),width=r[2]-r[0]-4,height=r[3]-r[1];
  if(field.type==='text'&&height>20){
    const fitted=fitTextLines(text,font,width,height-4,field.size||8);
    return fitted.lines.map((text,i)=>({text,size:fitted.size,width:font.widthOfTextAtSize(text,fitted.size),
      x:field.align==='right'?r[2]-2-font.widthOfTextAtSize(text,fitted.size):r[0]+2,
      baseline:r[1]+2+fitted.size+i*fitted.lineHeight}));
  }
  let size=field.size||Math.min(8,height*.75);
  while(size>4.5&&font.widthOfTextAtSize(text,size)>width)size-=.25;
  const measured=font.widthOfTextAtSize(text,size);
  if(measured>width)throw new Error('text does not fit. Shorten it or enlarge its field.');
  return [{text,size,width:measured,x:field.align==='right'?r[2]-2-measured:r[0]+2,
    baseline:r[3]-(height-size)/2-size*.18}];
}
