import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import worker from '../dist/server/index.js';

test('the actual compiled public film routes preserve Safari ranges through the Worker and asset binding',async()=>{
  const prefix='/brand/homepage-glass-2026-10-13/';
  const files=new Map(await Promise.all(['product-film.mp4','data-studio-film.mp4'].map(async name=>[prefix+name,await readFile(new URL('../public'+prefix+name,import.meta.url))])));
  const env={ASSETS:{async fetch(request){
    assert.equal(request.headers.get('authorization'),null);assert.equal(request.headers.get('cookie'),null);
    const bytes=files.get(new URL(request.url).pathname);assert.ok(bytes,'only the public allowlisted film may be read');
    return new Response(bytes,{headers:{'content-type':'video/mp4'}});
  }}};
  const ctx={waitUntil(){},passThroughOnException(){}};
  for(const [id,name] of [['overview-v1','product-film.mp4'],['data-studio-v1','data-studio-film.mp4']]){
    const url='https://vanteloq.com/films/'+id;
    const response=await worker.fetch(new Request(url,{headers:{range:'bytes=0-1'}}),env,ctx);
    assert.equal(response.status,206,await response.clone().text());
    assert.equal(response.headers.get('content-range'),`bytes 0-1/${files.get(prefix+name).length}`);
    assert.equal(response.headers.get('content-type'),'video/mp4');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),files.get(prefix+name).subarray(0,2));
    const head=await worker.fetch(new Request(url,{method:'HEAD'}),env,ctx);
    assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
    const tail=await worker.fetch(new Request(url,{headers:{range:'bytes=-8','if-range':head.headers.get('etag')}}),env,ctx);
    assert.equal(tail.status,206);assert.deepEqual(Buffer.from(await tail.arrayBuffer()),files.get(prefix+name).subarray(-8));
  }
});
