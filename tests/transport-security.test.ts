import assert from "node:assert/strict";
import test from "node:test";
import { isTrustedTlsEdgeProxy, rejectLegacyTls, trustedTlsEdgeClientIp } from "../server/transport-security.ts";

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

test("only Cloudflare's authenticated cross-zone Worker hop is trusted", () => {
  const trusted = new Request("https://vanteloq.hussien05issa.chatgpt.site/api/health", {
    headers: {
      "cf-worker": "vanteloq.com",
      "cf-connecting-ip": "2a06:98c0:3600::103",
      "x-vanteloq-edge-proxy": "1",
      "x-vanteloq-client-ip": "203.0.113.42",
    },
  });
  assert.equal(isTrustedTlsEdgeProxy(trusted), true);
  assert.equal(trustedTlsEdgeClientIp(trusted), "203.0.113.42");

  const untrustedHeaders: HeadersInit[] = [
    { "cf-worker": "vanteloq.com", "cf-connecting-ip": "203.0.113.42", "x-vanteloq-edge-proxy": "1" },
    { "cf-worker": "attacker.example", "cf-connecting-ip": "2a06:98c0:3600::103", "x-vanteloq-edge-proxy": "1" },
    { "cf-worker": "vanteloq.com", "cf-connecting-ip": "2a06:98c0:3600::103" },
  ];
  for (const headers of untrustedHeaders) {
    const untrusted = new Request("https://vanteloq.hussien05issa.chatgpt.site/", { headers });
    assert.equal(isTrustedTlsEdgeProxy(untrusted), false);
    assert.equal(trustedTlsEdgeClientIp(untrusted), null);
  }
});
