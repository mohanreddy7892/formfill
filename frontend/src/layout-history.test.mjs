import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutHistory} from './layout-history.js';
import {fieldLabel} from './browser/detect.js';
test('one Undo restores a complete drag and a deletion',()=>{
 const initial={fields:[{id:'test',rect:[10,10,100,30]}]};
 let state={present:initial,past:[]};
 for(let step=0;step<10;step++)state=layoutHistory(state,{type:'edit',record:step===0,fn:t=>({...t,fields:[{...t.fields[0],rect:[10+step,10,100+step,30]}]})});
 assert.equal(state.past.length,1);
 state=layoutHistory(state,{type:'undo'});assert.deepEqual(state.present,initial);
 state=layoutHistory(state,{type:'edit',fn:t=>({...t,fields:[]})});
 assert.deepEqual(layoutHistory(state,{type:'undo'}).present,initial);
});
test('history is bounded and reducers do not mutate prior snapshots',()=>{
 const original={present:{fields:[]},past:[]};let state=original;
 for(let i=0;i<30;i++)state=layoutHistory(state,{type:'edit',fn:t=>({...t,name:String(i)})});
 assert.equal(state.past.length,20);assert.equal(original.present.name,undefined);assert.equal(original.past.length,0);
});
test('labels use printed prompts outside the answer area',()=>{
 const rect=[200,80,350,110],words=[{text:'Name:',x:40,y:80,width:40,height:10},{text:'TEST VALUE',x:210,y:80,width:80,height:10}];
 assert.equal(fieldLabel(rect,words),'Name');
 assert.equal(fieldLabel(rect,[words[1]]),'');
});
