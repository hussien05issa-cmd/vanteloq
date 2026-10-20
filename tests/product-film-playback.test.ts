import assert from 'node:assert/strict';
import test from 'node:test';
import {playProductFilm} from '../app/play-product-film.ts';

test('an explicit film click loads an empty player and calls play before yielding the gesture', async () => {
  const calls: string[] = [];
  const video = {networkState:0,error:null,load(){calls.push('load');},play(){calls.push('play');return Promise.resolve();}};
  playProductFilm(video as unknown as HTMLVideoElement, () => calls.push('blocked'));
  assert.deepEqual(calls,['load','play']);
  await Promise.resolve();
  assert.deepEqual(calls,['load','play']);
});

test('a browser playback rejection retains an explicit fallback and media errors can be retried', async () => {
  let blocked=0,loads=0;
  const video:{networkState:number;error:{code:number}|null;load():void;play():Promise<void>}={networkState:3,error:{code:4},load(){loads++;},play(){return Promise.reject(new DOMException('Gesture required','NotAllowedError'));}};
  playProductFilm(video as unknown as HTMLVideoElement,()=>blocked++);
  await Promise.resolve();
  assert.equal(loads,1);assert.equal(blocked,1);
  video.error=null;video.networkState=1;video.play=()=>Promise.resolve();
  playProductFilm(video as unknown as HTMLVideoElement,()=>blocked++);
  await Promise.resolve();
  assert.equal(loads,1,'a paused loaded player resumes without another download');assert.equal(blocked,1);
});

test('intentional pause interruption is quiet, while missing or throwing players expose the fallback', async () => {
  let blocked=0;
  const video={networkState:1,error:null,load(){},play(){return Promise.reject(new DOMException('Paused','AbortError'));}};
  playProductFilm(video as unknown as HTMLVideoElement,()=>blocked++);
  await Promise.resolve();assert.equal(blocked,0);
  playProductFilm(null,()=>blocked++);
  video.play=()=>{throw Error('Player unavailable');};
  playProductFilm(video as unknown as HTMLVideoElement,()=>blocked++);
  assert.equal(blocked,2);
});
