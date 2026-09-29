// preview.test.mjs — Verify rendered answer previews against exported text layout.
// Uses fictional values and removes the temporary compiled component after checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const compiled=new URL('./.runtime-value-layer.mjs',import.meta.url);
await build({entryPoints:[fileURLToPath(new URL('./components/ValueLayer.jsx',import.meta.url))],outfile:fileURLToPath(compiled),bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic'});
const {default:ValueLayer}=await import(compiled.href);
const field={id:'name',label:'Name',type:'text',page:0,rect:[20,20,220,80]};
const preview=value=>renderToStaticMarkup(React.createElement('svg',null,React.createElement(ValueLayer,{fields:[field],page:0,values:{name:value}})));
test('multiline preview renders separate lines at their PDF baselines',()=>{
  const html=preview('LINE ONE\nLINE TWO');
  assert.match(html,/<text[^>]*y="30"[^>]*>LINE ONE<\/text>/);
  assert.match(html,/<text[^>]*y="39.6"[^>]*>LINE TWO<\/text>/);
  assert.equal((html.match(/<text\b/g)||[]).length,2);
});
test('overflow preview marks the field instead of squeezing an unexportable answer',()=>{
  const html=preview('EXAMPLE '.repeat(500));
  assert.match(html,/text does not fit/);assert.doesNotMatch(html,/<text\b/);
});
test.after(()=>unlink(compiled));
