import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {createPublicFilmHandler} from '../server/public-films.ts';

const files={
  'overview-v1':await readFile(new URL('../public/brand/homepage-glass-2026-10-13/product-film.mp4',import.meta.url)),
  'data-studio-v1':await readFile(new URL('../public/brand/homepage-glass-2026-10-13/data-studio-film.mp4',import.meta.url)),
};
function request(id:string,headers:HeadersInit={},method='GET'){return new Request('https://vanteloq.com/films/'+id,{method,headers});}

for(const id of ['overview-v1','data-studio-v1'] as const)test(id+' serves exact Safari probe, open, suffix and clipped byte ranges',async()=>{
  const handle=createPublicFilmHandler(),file=files[id];let reads=0;
  const assets={async fetch(req:Request){reads++;assert.equal(req.headers.get('authorization'),null);assert.equal(req.headers.get('cookie'),null);return new Response(file,{headers:{'content-type':'video/mp4'}});}};
  for(const [range,start,end] of [['bytes=0-1',0,1],['bytes=128-',128,file.length-1],['bytes=-32',file.length-32,file.length-1],['bytes=12-999999999999999999',12,file.length-1]] as const){
    const result=await handle(request(id,{range,authorization:'Bearer never-forwarded',cookie:'never-forwarded'}),id,assets);
    assert.equal(result.status,206);assert.equal(result.headers.get('accept-ranges'),'bytes');
    assert.equal(result.headers.get('content-range'),`bytes ${start}-${end}/${file.length}`);
    assert.equal(result.headers.get('content-length'),String(end-start+1));
    assert.deepEqual(Buffer.from(await result.arrayBuffer()),file.subarray(start,end+1));
  }
  assert.equal(reads,1,'immutable public bytes are verified and cached once');
  const full=await handle(request(id),id,assets);assert.equal(full.status,200);assert.deepEqual(Buffer.from(await full.arrayBuffer()),file);
});

test('HEAD, validators, rejected ranges and unknown films need no upstream read',async()=>{
  const handle=createPublicFilmHandler(),id='overview-v1';
  const head=await handle(request(id,{},'HEAD'),id);assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
  const etag=head.headers.get('etag')!;
  assert.equal((await handle(request(id,{'if-none-match':etag}),id)).status,304);
  for(const range of ['bytes=2028667-','bytes=10-3','bytes=-0']){
    const result=await handle(request(id,{range}),id);assert.equal(result.status,416);assert.equal(result.headers.get('content-range'),'bytes */2028667');
  }
  assert.equal((await handle(request('__proto__'),'__proto__')).status,404);
  assert.equal((await handle(request(id,{},'POST'),id)).status,405);
  for(const range of ['bytes=0-1,3-4','bytes=-','items=0-1']){
    const result=await handle(request(id,{range}),id,{async fetch(){return new Response(files[id]);}});
    assert.equal(result.status,200);assert.equal(result.headers.get('content-range'),null);
    assert.equal((await result.arrayBuffer()).byteLength,files[id].length);
  }
});

test('If-Range mismatch sends the full verified film and failed asset reads can be retried',async()=>{
  const handle=createPublicFilmHandler(),id='data-studio-v1',file=files[id];let reads=0;
  const assets={async fetch(){reads++;return new Response(reads===1?file.subarray(0,20):file);}};
  const failed=await handle(request(id),id,assets);assert.equal(failed.status,503);assert.equal(failed.headers.get('cache-control'),'no-store');
  const result=await handle(request(id,{range:'bytes=0-1','if-range':'"stale"'}),id,assets);
  assert.equal(result.status,200);assert.equal(result.headers.get('content-range'),null);assert.deepEqual(Buffer.from(await result.arrayBuffer()),file);
  assert.equal(reads,2);
});

test('an oversized or same-size substituted asset is never served',async()=>{
  for(const file of [Buffer.alloc(2028668),Buffer.alloc(2028667)]){
    const handle=createPublicFilmHandler();
    assert.equal((await handle(request('overview-v1'),'overview-v1',{async fetch(){return new Response(file);}})).status,503);
  }
});
