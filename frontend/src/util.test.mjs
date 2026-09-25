// Run: node --test frontend/src/util.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFields, slug } from "./util.js";

test("batched fields with the same label get unique ids", () => {
  const { fields, ids } = appendFields([{ id: "gender" }], [{ label: "Checkbox" }, { label: "Checkbox" }, { label: "Checkbox" }]);
  assert.deepEqual(ids, ["checkbox", "checkbox_2", "checkbox_3"]);
  assert.equal(new Set(fields.map((f) => f.id)).size, fields.length);
});

test("new ids avoid ids already in the current list", () => {
  const { ids } = appendFields([{ id: "checkbox" }, { id: "checkbox_2" }], [{ label: "Checkbox" }]);
  assert.deepEqual(ids, ["checkbox_3"]);
});

test("successive updates build on each other (functional update semantics)", () => {
  let state = [];
  for (let i = 0; i < 3; i++) state = appendFields(state, [{ label: "Pin code" }]).fields;
  assert.deepEqual(state.map((f) => f.id), ["pin_code", "pin_code_2", "pin_code_3"]);
});

test("pure: calling twice on the same input gives the same result (StrictMode)", () => {
  const cur = [{ id: "a" }];
  assert.deepEqual(appendFields(cur, [{ label: "X" }]), appendFields(cur, [{ label: "X" }]));
  assert.deepEqual(cur, [{ id: "a" }]);
});

test("slug output always satisfies the backend id rule", () => {
  for (const s of ["", "Name of the hospital!!", "  __x__ ", "पता", "A".repeat(80)]) {
    assert.match(slug(s, new Set()), /^[a-z0-9_]{1,64}$/);
  }
});

import { assignBills, isoToForm } from "./util.js";
const TABLE = { id: "bills", date_format: "DDMMYY", rows: [1, 2, 3, 4, 5].map((n) => ({
  no: `b${n}_no`, date: `b${n}_date`, issuer: `b${n}_by`, towards: `b${n}_to`, amount: `b${n}_amt`,
  ...(n === 1 ? { kind: "hospital" } : n === 2 ? { kind: "pre" } : {}) })) };
const MA_LIKE = { ...TABLE, rows: TABLE.rows.map((r, i) => (i === 2 ? { ...r, kind: "pharmacy" } : r)) };

test("a row printed for pharmacy bills takes the first pharmacy bill, without writing 'towards'", () => {
  const { updates } = assignBills(MA_LIKE, {}, [
    { bill_no: "P1", amount: 10, kind: "pharmacy" }, { bill_no: "P2", amount: 20, kind: "pharmacy" }, { bill_no: "L1", amount: 30, kind: "lab" }]);
  assert.equal(updates.b3_no, "P1"); assert.equal(updates.b3_to, undefined);
  assert.equal(updates.b4_no, "P2"); assert.equal(updates.b4_to, "PHARMACY");
  assert.equal(updates.b5_no, "L1"); assert.equal(updates.b5_to, "LAB INVESTIGATIONS");
});

test("dates convert to the form's format", () => {
  assert.equal(isoToForm("2026-08-31"), "310826");
  assert.equal(isoToForm("2026-08-31", "DDMMYYYY"), "31082026");
  assert.equal(isoToForm("bad"), "");
});

test("hospital bill goes to its printed row, others fill free rows in order", () => {
  const bills = [{ bill_no: "ph 1", date: "2026-08-31", amount: 2644, issuer: "Care Medicals", kind: "pharmacy" },
                 { bill_no: "47", date: "2026-09-02", amount: 5500, issuer: "City Hospital", kind: "hospital" },
                 { bill_no: "LB-9", date: "2026-08-31", amount: 850, issuer: "City Hospital", kind: "lab" }];
  const { updates, placed, skipped } = assignBills(TABLE, {}, bills);
  assert.equal(updates.b1_no, "47"); assert.equal(updates.b1_amt, "5500"); assert.equal(updates.b1_to, undefined);
  assert.equal(updates.b3_no, "PH 1"); assert.equal(updates.b3_to, "PHARMACY"); assert.equal(updates.b3_date, "310826");
  assert.equal(updates.b4_to, "LAB INVESTIGATIONS");
  assert.equal(updates.b2_no, undefined, "pre-hospitalization row is left alone");
  assert.equal(placed.length, 3); assert.equal(skipped.length, 0);
});

test("never overwrites typed rows, skips duplicates and bills without amounts", () => {
  const typed = { b3_no: "MANUAL", b3_amt: "100" };
  const { updates, skipped } = assignBills(TABLE, typed, [
    { bill_no: "MANUAL", amount: 100, kind: "pharmacy" }, { bill_no: "X1", amount: null, kind: "lab" },
    { bill_no: "X2", amount: 50, kind: "pharmacy" }]);
  assert.equal(updates.b3_no, undefined);
  assert.equal(updates.b4_no, "X2");
  assert.deepEqual(skipped.map((s) => s.reason), ["already in the form", "no amount found"]);
});

test("reports when the table is full", () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ bill_no: `P${i}`, amount: 10, kind: "pharmacy" }));
  const { placed, skipped } = assignBills(TABLE, {}, many);
  assert.equal(placed.length, 3);
  assert.equal(skipped.filter((s) => s.reason === "no free row left").length, 2);
});

test('decimal amounts cannot become a larger whole-rupee amount', async () => {
  const { wholeRupees } = await import('./util.js');
  assert.equal(wholeRupees('1234.56'), null);
  assert.equal(wholeRupees('1,234'), null);
  assert.equal(wholeRupees('-5'), null);
  assert.equal(wholeRupees(''), null);
  assert.equal(wholeRupees('1234'), 1234);
});

test('bill placement refuses fractional amounts', () => {
  const table = { rows: [{ no: 'n', amount: 'a' }] };
  const r = assignBills(table, {}, [{ bill_no: 'B1', amount: 1234.56 }]);
  assert.deepEqual(r.updates, {});
  assert.equal(r.skipped.length, 1);
});
