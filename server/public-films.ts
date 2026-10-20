type Assets = {fetch(request: Request): Promise<Response>};
const films = {
  'overview-v1': {path:'/brand/homepage-glass-2026-10-13/product-film.mp4',bytes:2028667,sha:'0204ecafe34c7912d79eefefdae87dd66a1d6c1e1be28fe9cbb3908a65d643f7'},
  'data-studio-v1': {path:'/brand/homepage-glass-2026-10-13/data-studio-film.mp4',bytes:1904396,sha:'436dc5f5e58d5209f9625821fa2046a85c9da8f9321b3284a301742304d9856a'},
} as const;
type Film = typeof films[keyof typeof films];

function rangeFor(value: string, size: number): {start:number;end:number}|null|undefined {
  if(value.length>128)return undefined;
  const match=/^bytes=(\d*)-(\d*)$/.exec(value.trim());
  // Unsupported units, malformed headers and multipart ranges use full delivery.
  if(!match||(!match[1]&&!match[2]))return undefined;
  const total=BigInt(size),zero=BigInt(0),one=BigInt(1);
  if(!match[1]){
    const suffix=BigInt(match[2]);
    return suffix>zero?{start:Number(suffix>=total?zero:total-suffix),end:size-1}:null;
  }
  const start=BigInt(match[1]),last=match[2]?BigInt(match[2]):total-one;
  if(start>=total||last<start)return null;
  return {start:Number(start),end:Number(last>=total?total-one:last)};
}

async function readFilm(assets: Assets, spec: Film, origin: string) {
  // The only upstream is the site's asset binding, with no visitor credentials.
  const response=await assets.fetch(new Request(new URL(spec.path,origin)));
  if(response.status!==200||!response.body)throw Error('Film unavailable');
  const reader=response.body.getReader(),bytes=new Uint8Array(spec.bytes);
  let size=0,complete=false;
  try{
    while(true){const part=await reader.read();if(part.done){complete=true;break;}
      if(part.value.byteLength>bytes.length-size)throw Error('Unexpected film size');
      bytes.set(part.value,size);size+=part.value.byteLength;
    }
  }finally{if(!complete)void reader.cancel().catch(()=>{});reader.releaseLock();}
  if(size!==spec.bytes)throw Error('Incomplete film');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');
  if(hash!==spec.sha)throw Error('Film content mismatch');
  return bytes;
}

export function createPublicFilmHandler(){
  // At most two immutable public films, under 4 MiB in total, loaded on demand.
  const cache=new Map<string,Promise<Uint8Array<ArrayBuffer>>>();
  return async(request:Request,id:string,assets?:Assets):Promise<Response>=>{
    if(!Object.hasOwn(films,id))return new Response('Film not found',{status:404,headers:{'Cache-Control':'no-store'}});
    if(request.method!=='GET'&&request.method!=='HEAD')return new Response(null,{status:405,headers:{Allow:'GET, HEAD'}});
    const spec=films[id as keyof typeof films],etag='"'+spec.sha+'"';
    const headers=new Headers({'Content-Type':'video/mp4','Content-Length':String(spec.bytes),'Accept-Ranges':'bytes','ETag':etag,'Cache-Control':'public, max-age=86400, immutable','X-Content-Type-Options':'nosniff'});
    const ifNone=request.headers.get('if-none-match');
    if(ifNone?.split(',').some(value=>value.trim()==='*'||value.trim().replace(/^W\//,'')===etag))return new Response(null,{status:304,headers});
    if(request.method==='HEAD')return new Response(null,{headers});
    const requested=request.headers.get('range'),ifRange=request.headers.get('if-range');
    const range=requested&&(!ifRange||ifRange===etag)?rangeFor(requested,spec.bytes):undefined;
    if(range===null){headers.set('Content-Range',`bytes */${spec.bytes}`);headers.set('Content-Length','0');return new Response(null,{status:416,headers});}
    if(!assets)return new Response('Film temporarily unavailable',{status:503,headers:{'Cache-Control':'no-store','Retry-After':'5'}});
    try{
      if(!cache.has(id)){
        const loaded=readFilm(assets,spec,new URL(request.url).origin).catch(error=>{cache.delete(id);throw error;});
        cache.set(id,loaded);
      }
      const bytes=await cache.get(id)!;
      if(range){headers.set('Content-Range',`bytes ${range.start}-${range.end}/${spec.bytes}`);headers.set('Content-Length',String(range.end-range.start+1));return new Response(bytes.subarray(range.start,range.end+1),{status:206,headers});}
      return new Response(bytes,{headers});
    }catch{return new Response('Film temporarily unavailable',{status:503,headers:{'Cache-Control':'no-store','Retry-After':'5'}});}
  };
}
export const servePublicFilm=createPublicFilmHandler();
