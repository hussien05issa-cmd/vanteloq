import { readFile } from "node:fs/promises";

// The verification key is deliberately served as a public ownership file.
// This script sends only canonical public URLs, never workspace records.
const config = JSON.parse(await readFile(new URL("../.openai/discovery.json", import.meta.url), "utf8"));
const origin = new URL(config.origin);
if (origin.href !== "https://vanteloq.com/" || config.endpoint !== "https://api.indexnow.org/indexnow" || !/^[a-f0-9]{32}\.txt$/.test(config.keyFile)) throw new Error("Invalid discovery submission configuration.");
const key = (await readFile(new URL(`../public/${config.keyFile}`, import.meta.url), "utf8")).trim();
if (!/^[a-f0-9]{32}$/.test(key) || config.keyFile !== `${key}.txt`) throw new Error("Invalid public verification file.");
const args = process.argv.slice(2);
if (args.some(arg => arg !== "--submit")) throw new Error("Use no flags for a dry run, or --submit after deployment.");
const timeout = () => AbortSignal.timeout(30_000);
const sitemapResponse = await fetch(new URL("/sitemap.xml", origin), { signal: timeout() });
if (!sitemapResponse.ok) throw new Error(`Public sitemap check failed (${sitemapResponse.status}).`);
const sitemap = await sitemapResponse.text();
const urls = [...new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]))];
if (!urls.length || urls.length > 10_000) throw new Error("Public sitemap URL count is invalid.");
for (const value of urls) {
  const url = new URL(value);
  if (url.origin !== origin.origin || url.search || url.hash || url.pathname.startsWith("/api/") || url.pathname.startsWith("/workspace")) throw new Error("Sitemap contains an ineligible discovery URL.");
}
const keyLocation = new URL(`/${config.keyFile}`, origin).href;
if (!args.includes("--submit")) {
  console.log(JSON.stringify({ mode: "dry-run", publicUrlCount: urls.length, submissionRequiredAfterDeployment: true }));
} else {
  const keyResponse = await fetch(keyLocation, { signal: timeout() });
  if (!keyResponse.ok || (await keyResponse.text()).trim() !== key) throw new Error("The deployed verification file does not match. Publish before submitting.");
  const response = await fetch(config.endpoint, { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ host: origin.hostname, key, keyLocation, urlList: urls }), signal: timeout() });
  if (![200,202].includes(response.status)) throw new Error(`IndexNow submission failed (${response.status}). Do not retry repeatedly.`);
  console.log(JSON.stringify({ mode: "submitted", status: response.status, publicUrlCount: urls.length, keyValidationPending: response.status === 202, note: "Receipt is not proof of indexing or ranking." }));
}
