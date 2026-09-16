import assert from "node:assert/strict";
import test from "node:test";
import { rejectLegacyTls } from "../server/transport-security.ts";

function request(version?: string) {
  const value = new Request("https://vanteloq.example/api/v1/session", {
    headers: { "x-tls-version": "TLSv1.3", "cf-tls-version": "TLSv1.3" },
  });
  if (version) Object.defineProperty(value, "cf", { value: { tlsVersion: version } });
  return value;
}

test("legacy platform TLS metadata is denied despite spoofed version headers", async () => {
  for (const version of ["TLSv1", "TLSv1.0", "TLSv1.1"]) {
    const response = rejectLegacyTls(request(version));
    assert.equal(response?.status, 403);
    assert.match(await response!.text(), /TLS 1.2 or newer/);
    assert.match(response!.headers.get("cache-control")!, /no-store/);
    assert.equal(response!.headers.has("set-cookie"), false);
  }
});

test("modern transport and local requests are not confused with legacy handshakes", () => {
  for (const version of ["TLSv1.2", "TLSv1.3", undefined]) assert.equal(rejectLegacyTls(request(version)), null);
  const value = new Request("https://vanteloq.example/", { headers: { "cf-tls-version": "TLSv1.1" } });
  assert.equal(rejectLegacyTls(value), null);
});
