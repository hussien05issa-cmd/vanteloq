import test from 'node:test';
import assert from 'node:assert/strict';
import {springProgress,surfaceFrames} from '../domain/surface-motion.ts';
const origin={x:20,y:30,width:200,height:60},panel={x:100,y:100,width:600,height:500};
test('surface spring reaches its exact endpoints without non-finite overshoot',()=>{for(const steps of [2,32,NaN,Infinity]){const p=springProgress(steps);assert.equal(p[0],0);assert.equal(p.at(-1),1);assert.ok(p.every(v=>Number.isFinite(v)&&v>=0&&v<1.15));}});
test('opening reaches the untransformed panel and closing returns to the origin',()=>{const opening=surfaceFrames(origin,panel),closing=surfaceFrames(origin,panel,true);assert.equal(opening.at(-1)?.transform,'translate(0px, 0px) scale(1, 1)');assert.equal(opening[0].transform,closing.at(-1)?.transform);});
test('interrupted closing starts from the current rectangle rather than jumping to full size',()=>{const midway={x:60,y:65,width:400,height:280};const close=surfaceFrames(origin,panel,true,midway),reopen=surfaceFrames(midway,panel);assert.equal(close[0].transform,reopen[0].transform);assert.equal(close.at(-1)?.transform,surfaceFrames(origin,panel)[0].transform);assert.equal(surfaceFrames({...origin,width:0},panel).length,0);assert.equal(surfaceFrames(origin,{...panel,x:NaN}).length,0);});
