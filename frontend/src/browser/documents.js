// documents.js — Read bill details without sending document text to a server.
// Conservative matching preserves decimals and requires review of extracted values.
export const categories = [
  ['claim_form','Claim form',true], ['intimation','Claim intimation',false],
  ['ecard','Health e-card',true], ['id_proof','Patient ID proof',true],
  ['discharge_summary','Discharge summary',true], ['hospital_bill','Hospital main bill / receipt',true],
  ['pharmacy_bill','Pharmacy bills',false], ['lab_bill','Investigation bills',false],
  ['investigation_report','Investigation reports',false], ['prescription','Prescriptions',false],
  ['cheque','Cancelled cheque',true], ['other','Other documents',false],
].map(([id,label,required]) => ({id,label,required}));

const patterns = [
  ['claim_form', /claim form|details of primary insured/i],
  ['discharge_summary', /discharge\s+(summary|card)/i], ['intimation', /intimation/i],
  ['ecard', /ma-?id|policy holder|primary member|medi assist/i],
  ['cheque', /\bifsc\b|or bearer|cheque|payable at par/i],
  ['id_proof', /aadhaar|unique identification|income tax department|permanent account number|voter|passport/i],
  ['investigation_report', /normal range|reference range|department of laboratory|result\s+unit/i],
  ['lab_bill', /investigation bill|lab(oratory)? bill/i],
  ['pharmacy_bill', /tax invoice|pharma|chemist|batch|exp\.?\s*dt/i],
  ['hospital_bill', /cash bill|final bill|room|ward charges|consultation fee|hospital.*bill/i],
  ['prescription', /\brx\b|prescription|valid till/i],
];
export function nameCheck(names, text) {
  const patient = text.match(/^\s*(?:patient\s*name|pt\.?\s*name|name)\s*[:.\-]\s*([^\n]+)/im)?.[1]
    ?.split(/\s{2,}|\b(?:age|sex|date|id|bill|uhid)\b/i)[0];
  // Without a labelled patient name, a full token match elsewhere is not proof.
  if (!names.some(n => n.trim()) || !patient) return {status:'unknown'};
  const words = new Set(patient.toUpperCase().match(/[A-Z]+/g) || []);
  const expected = [...new Set(names.join(' ').toUpperCase().match(/[A-Z]+/g) || [])];
  const missing = expected.filter(t => !words.has(t));
  return missing.length ? {status:'not_found',missing} : {status:'match'};
}
function dateOf(lines) {
  const sorted = [...lines.filter(l => /date/i.test(l)), ...lines];
  const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  for (const line of sorted) {
    const m = line.match(/\b(\d{1,2})\s*[-/.]\s*(\d{1,2}|[A-Za-z]{3,9})\s*[-/.,]\s*(\d{2,4})\b/);
    if (!m) continue;
    const d=+m[1], mo=/^\d/.test(m[2]) ? +m[2] : months.indexOf(m[2].slice(0,3).toLowerCase())+1;
    const y=+m[3]<100 ? 2000 + +m[3] : +m[3], dt=new Date(Date.UTC(y,mo-1,d));
    if (y>=2000 && y<=2100 && dt.getUTCFullYear()===y && dt.getUTCMonth()===mo-1 && dt.getUTCDate()===d)
      return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }
  return null;
}
export function parseDocument(text, filename='', names=[]) {
  const lines=text.split('\n').map(s=>s.trim()).filter(Boolean);
  const category=patterns.find(([,p])=>p.test(`${filename}\n${text}`))?.[0] || 'other';
  let amount=null;
  for (const key of ['net amount','net payable','bill amount','grand total','total amount','amount payable','amount paid','total payable','total']) {
    for (let i=0;i<lines.length;i++) {
      const low=lines[i].toLowerCase();
      if (!low.includes(key) || low.includes('in words')) continue;
      const tail=low.slice(low.indexOf(key)+key.length);
      const nums=(tail.match(/\d+(?:,\d{2,3})*(?:\.\d{1,2})?/g)||[]).map(s=>Number(s.replaceAll(',',''))).filter(n=>n>0);
      if (nums.length) {amount=nums.at(-1);break;}
    }
    if (amount!==null) break;
  }
  const bill_no=text.match(/\b(?:bill|invoice|receipt|inv|voucher)\s*(?:no|number|#)\.?\s*[:\-]?\s*([A-Z]{0,4}[\s\-/]?\d[\dA-Z\-/]{0,14})/i)?.[1]?.trim() || null;
  const issuer=lines.slice(0,8).find(l=>/hospital|medical|pharmacy|chemist|lab|diagnostic|clinic|health/i.test(l))?.slice(0,60)||null;
  return {file:filename,category,readable:!!text.trim(),names:nameCheck(names,text),
    bill: category.endsWith('_bill') ? {bill_no,date:dateOf(lines),amount,issuer,kind:category.replace('_bill','')} : null,
    note:'Automatic reading can be wrong. Review document type, patient name and every amount.'};
}
