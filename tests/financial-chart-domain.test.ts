import test from 'node:test';
import assert from 'node:assert/strict';
import { financialChartDomain } from '../domain/financial-chart-domain';
const y=(value: number,height: number,domain: ReturnType<typeof financialChartDomain>)=>height-(value-domain.min)/(domain.max-domain.min)*height;
test('a small return remains below zero without a coarse negative-bound jump',()=>{
 const domain=financialChartDomain([-5999,450000,220000]);
 assert.equal(domain.min,-24238.96);
 assert.ok((-domain.min)/(domain.max-domain.min)<0.06);
 assert.ok(y(-5999,276,domain)>y(0,276,domain));
 assert.ok(y(-5999,276,domain)<276);
 assert.ok(y(450000,276,domain)>0);
 assert.ok(domain.ticks.includes(0));
 assert.ok(domain.ticks.every(value=>value%100000===0));
});
test('positive, negative, mixed, zero, missing and one-cent inputs remain representable',()=>{
 for(const input of [[],[0],[NaN,Infinity],[-1],[1],[-1,1],[-900000,-100],[-5999,450000],[-300000,400000],[100000]]){
  const domain=financialChartDomain(input);
  assert.ok(Number.isFinite(domain.min)&&Number.isFinite(domain.max));
  assert.ok(domain.max>domain.min&&domain.min<=0&&domain.max>=0);
  assert.ok(domain.ticks.includes(0));
  assert.ok(domain.ticks.every((value,i)=>value>=domain.min&&value<=domain.max&&(i===0||value>domain.ticks[i-1])));
  for(const value of input.filter(Number.isFinite))assert.ok(y(value,276,domain)>=0&&y(value,276,domain)<=276);
 }
});
test('equal distances preserve the same linear spacing, including across zero',()=>{
 const domain=financialChartDomain([-20000,450000]);
 const before=y(-10000,276,domain)-y(0,276,domain);
 const after=y(0,276,domain)-y(10000,276,domain);
 assert.ok(Math.abs(before-after)<1e-10);
});
test('input values are preserved and reversing their order leaves the domain unchanged',()=>{
 const input=Object.freeze([-5999,450000,120000]);
 assert.deepEqual(financialChartDomain(input),financialChartDomain([...input].reverse()));
 assert.deepEqual(input,[-5999,450000,120000]);
});
