export const scannerEnv = { AZURE_DOCUMENT_SCAN_KEY: Buffer.alloc(64, 7).toString("base64"), AZURE_DOCUMENT_SCAN_ENDPOINT: "https://qastore.blob.core.windows.net" };
export function scannerFixture(initialResult = "No threats found") {
  const blobs = new Map<string, { etag: string; size: number; sha256: string }>();
  let result = initialResult;
  const calls: string[] = [];
  const transport = (async (input, init) => {
    const url = new URL(String(input)), method = init?.method || "GET";
    if (url.origin !== scannerEnv.AZURE_DOCUMENT_SCAN_ENDPOINT) throw new Error("Unexpected provider");
    const headers = new Headers(init?.headers);
    calls.push(method);
    if (method === "PUT") {
      blobs.set(url.pathname, { etag: '"0xABC123"', size: (init?.body as Uint8Array).byteLength, sha256: headers.get("x-ms-meta-sha256")! });
      return new Response(null, { status: 201, headers: { etag: '"0xABC123"' } });
    }
    const blob = blobs.get(url.pathname);
    if (!blob) return new Response(null, { status: 404 });
    if (method === "DELETE") { blobs.delete(url.pathname); return new Response(null, { status: 202 }); }
    if (method === "GET" && headers.get("range") === "bytes=0-0") return new Response(new Uint8Array([1]), { status: 206, headers: { etag: blob.etag, "content-range": `bytes 0-0/${blob.size}`, "content-length": "1", "x-ms-meta-sha256": blob.sha256 } });
    if (method === "GET" && url.searchParams.get("comp") === "tags") return new Response(`<Tags><TagSet>${result ? `<Tag><Key>Malware Scanning scan result</Key><Value>${result}</Value></Tag><Tag><Key>Malware Scanning scan time UTC</Key><Value>${new Date().toISOString()}</Value></Tag>` : ""}</TagSet></Tags>`);
    throw new Error("Unexpected storage operation");
  }) as typeof fetch;
  return { transport, blobs, calls, setResult: (value: string) => { result = value; } };
}
