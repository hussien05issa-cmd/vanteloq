/** Bounded SSE reader shared by the provider adapter and transport tests. */
export async function* advisorSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal) {
  const reader=body.getReader(), decoder=new TextDecoder(); let buffer="";
  try {
    while(true) {
      signal?.throwIfAborted();
      const {value,done}=await reader.read();
      buffer=(buffer+decoder.decode(value,{stream:!done})).replace(/\r\n/g,"\n");
      if(buffer.length>200_000) throw new Error("Stream event exceeds limit");
      let index;
      while((index=buffer.indexOf("\n\n"))!==-1) {
        const block=buffer.slice(0,index); buffer=buffer.slice(index+2);
        const data=block.split("\n").filter(line=>line.startsWith("data:")).map(line=>line.slice(5).trimStart()).join("\n");
        if(data && data!=="[DONE]") yield JSON.parse(data) as Record<string,unknown>;
      }
      if(done) { if(buffer.trim()) throw new Error("Incomplete stream event"); break; }
    }
  } finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
}
