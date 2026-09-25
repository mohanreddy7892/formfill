// The browser demo's rules must give exactly the Python server's results.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computedValues, check } from "./rules.js";
const { template, cases } = JSON.parse(readFileSync(new URL("./parity_cases.json", import.meta.url)));
cases.forEach((c, i) => test(`case ${i}: same computed values and issues as the server`, () => {
  assert.deepEqual(computedValues(template, c.values), c.computed);
  assert.deepEqual(check(template, c.values), c.issues);
}));


test('required fields reject unchecked consent and empty choices', () => {
  const tpl = {fields:[{id:'consent',type:'checkbox'},{id:'choice',type:'choice'}],
    rules:[{kind:'required',of:['consent','choice'],severity:'error',message:'Required'}]};
  assert.equal(check(tpl, {consent:false,choice:[]}).length, 1);
  assert.equal(check(tpl, {consent:true,choice:['A']}).length, 0);
});
