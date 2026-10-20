import { readFile } from "node:fs/promises";
import { selectDiscoveryUrls } from "./discovery-url-policy.mjs";

// The verification key is deliberately served as a public ownership file.
// This script sends only canonical public URLs, never workspace records.
const config = JSON.parse(await readFile(new URL("../.openai/discovery.json", import.meta.url), "utf8"));
const origin = new URL(config.origin);
if (origin.href !== "https://vanteloq.com/" || config.endpoint !== "https://api.indexnow.org/indexnow" || !/^[a-f0-9]{32}\.txt$/.test(config.keyFile)) throw new Error("Invalid discovery submission configuration.");
const key = (await readFile(new URL(`../public/${config.keyFile}`, import.meta.url), "utf8")).trim();
if (!/^[a-f0-9]{32}$/.test(key) || config.keyFile !== `${key}.txt`) throw new Error("Invalid public verification file.");
const args = process.argv.slice(2);
if (args.some(arg => arg !== "--submit" && !arg.startsWith("--path="))) throw new Error("Use --path=/advisory to select changed public paths, and --submit only after deployment.");
const requestedPaths = args.filter(arg => arg.startsWith("--path=")).map(arg => arg.slice("--path=".length));
const timeout = () => AbortSignal.timeout(30_000);
const sitemapResponse = await fetch(new URL("/sitemap.xml", origin), { signal: timeout() });
if (!sitemapResponse.ok) throw new Error(`Public sitemap check failed (${sitemapResponse.status}).`);
const sitemap = await sitemapResponse.text();
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
// Select only changed pages when requested instead of resubmitting the catalogue.
const urls = selectDiscoveryUrls(sitemapUrls, requestedPaths, origin.origin);
const keyLocation = new URL(`/${config.keyFile}`, origin).href;
if (!args.includes("--submit")) {
  console.log(JSON.stringify({ mode: "dry-run", publicUrlCount: urls.length, selectedUrls: requestedPaths.length ? urls : undefined, submissionRequiredAfterDeployment: true }));
} else {
  const keyResponse = await fetch(keyLocation, { signal: timeout() });
  if (!keyResponse.ok || (await keyResponse.text()).trim() !== key) throw new Error("The deployed verification file does not match. Publish before submitting.");
  const response = await fetch(config.endpoint, { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ host: origin.hostname, key, keyLocation, urlList: urls }), signal: timeout() });
  if (![200,202].includes(response.status)) throw new Error(`IndexNow submission failed (${response.status}). Do not retry repeatedly.`);
  console.log(JSON.stringify({ mode: "submitted", status: response.status, publicUrlCount: urls.length, keyValidationPending: response.status === 202, note: "Receipt is not proof of indexing or ranking." }));
}
