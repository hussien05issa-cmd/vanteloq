import assert from "node:assert/strict";
import test from "node:test";
import { executiveAxis, formatExecutiveAxisValue } from "../domain/executive-presentation.ts";

test("executive chart axes preserve quantities and convert only money from cents", () => {
  assert.equal(formatExecutiveAxisValue(100, "count"), "100");
  assert.equal(formatExecutiveAxisValue(1500, "count"), "1.5K");
  assert.equal(formatExecutiveAxisValue(1.25, "count"), "1.25");
  assert.equal(formatExecutiveAxisValue(100, "money"), "1");
  assert.equal(formatExecutiveAxisValue(1, "money"), "0.01");
  assert.equal(formatExecutiveAxisValue(-1, "money"), "-0.01");
  assert.equal(formatExecutiveAxisValue(0.25, "percent"), "25%");
  assert.equal(formatExecutiveAxisValue(0.005, "percent"), "0.5%");
});

test("executive axes distinguish recorded zero from unavailable values", () => {
  assert.equal(formatExecutiveAxisValue(0, "count"), "0");
  assert.equal(formatExecutiveAxisValue(0, "money"), "0");
  assert.equal(formatExecutiveAxisValue(0, "percent"), "0%");
  for (const value of [NaN, Infinity, -Infinity]) assert.equal(formatExecutiveAxisValue(value, "money"), "Not available");
});

test("readable axes contain signed results, zero and stable flat values",()=>{
  assert.deepEqual(executiveAxis([88275,100838,74341]),{min:0,max:150000,ticks:[0,50000,100000,150000]});
  for(const values of [[-320,180],[-200,-100],[0,0],[.0004,.0007],[1e12,8e11]]){
    const axis=executiveAxis(values);assert.ok(axis.min<=Math.min(...values));assert.ok(axis.max>=Math.max(...values));assert.ok(axis.max>axis.min);assert.ok(axis.ticks.includes(0));assert.ok(axis.ticks.length<=7);
  }
});
