import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare, NoOpLog, Response } from "miniflare";

test("Deel native Worker token and data requests reject credential redirects", async t => {
  const patchRoot = fileURLToPath(new URL("../", import.meta.url));
  const repo = resolve(patchRoot, "../../work/vanteloq");
  const require = createRequire(resolve(repo, "package.json"));
  const bundle = await build({
    absWorkingDir: repo, tsconfigRaw:{compilerOptions:{target:"ESNext"}},
    stdin:{resolveDir:patchRoot,contents:`
      import { exchangeDeelCode, refreshDeelToken, fetchDeelOrganizationWithToken } from "./server/integrations/deel";
      export default {async fetch(request,env){
        globalThis.__vanteloqEnv=env;
        try {
          const path=new URL(request.url).pathname;
          const result=path==="/exchange" ? await exchangeDeelCode("fictional-code")
            : path==="/refresh" ? await refreshDeelToken("fictional-refresh")
            : await fetchDeelOrganizationWithToken("fictional-access");
          return Response.json({ok:true});
        } catch(error) {return Response.json({code:error.code,name:error.name},{status:502});}
      }};`},
    bundle:true,platform:"browser",format:"esm",write:false,logLevel:"error",
    plugins:[{name:"copied-source-overlay",setup(api){api.onResolve({filter:/.*/},args=>{
      if (args.path.startsWith(".")) {
        const initial=resolve(args.resolveDir,args.path);
        for(const suffix of ["",".ts",".tsx","/index.ts"]){
          const path=initial+suffix;
          if(existsSync(path)&&statSync(path).isFile())return {path};
          const fallback=path.startsWith(patchRoot)?resolve(repo,path.slice(patchRoot.length)):path;
          if(existsSync(fallback)&&statSync(fallback).isFile())return {path:fallback};
        }
      } else if (!args.path.startsWith("/") && !/^[A-Za-z]:/.test(args.path)) {
        try {return {path:require.resolve(args.path)}}catch{}
      }
    })}}],
  });
  const calls=[]; let redirectStatus=null;
  const mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:"2026-05-15",compatibilityFlags:["nodejs_compat"],log:new NoOpLog(),
    bindings:{DEEL_CLIENT_ID:"fictional-client",DEEL_CLIENT_SECRET:"fictional-secret",DEEL_REDIRECT_URI:"https://fixture.invalid/callback",DEEL_ENV:"sandbox",INTEGRATION_ENCRYPTION_KEY:Buffer.alloc(32,1).toString("base64")},
    outboundService:async request=>{
      calls.push(request.url);
      if(redirectStatus)return new Response(null,{status:redirectStatus,headers:{Location:"https://credential-sink.invalid/"}});
      if(request.url.includes("/rest/organizations"))return Response.json({data:[{id:"11111111-1111-4111-8111-111111111111",name:"Fixture"}]});
      return Response.json({access_token:"fictional-access",refresh_token:"fictional-refresh",token_type:"Bearer",expires_in:3600,scope:"organizations:read accounting:read legal-entity:read payslips:read"});
    },
  });
  try{
    for(const operation of ["exchange","refresh","organization"]){
      await t.test(`${operation} succeeds with native Worker fetch`,async()=>{
        redirectStatus=null;calls.length=0;
        const response=await mf.dispatchFetch(`https://fixture.invalid/${operation}`);
        assert.equal(response.status,200,await response.clone().text());assert.equal(calls.length,1);
      });
      for(const status of [300,301,302,303,304,307,308,399])await t.test(`${operation} rejects ${status}`,async()=>{
        redirectStatus=status;calls.length=0;
        const response=await mf.dispatchFetch(`https://fixture.invalid/${operation}`);
        assert.equal(response.status,502);assert.equal((await response.json()).code,"DEEL_REDIRECT_REJECTED");
        assert.equal(calls.length,1);assert.ok(!calls.some(url=>url.includes("credential-sink")));
      });
    }
  }finally{await mf.dispose();}
});
