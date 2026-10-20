#!/usr/bin/env node
// Protocol: https://www.indexnow.org/documentation
// Global endpoint: https://www.indexnow.org/faq
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ORIGIN = "https://vanteloq.com";
const ENDPOINT = "https://api.indexnow.org/indexnow";
const PUBLIC_DIRECTORY = new URL("../public/", import.meta.url);
const KEY_FILE_PATTERN = /^indexnow-([a-f0-9]{64})\.txt$/;
const APPROVED_PATH = /^\/resources(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?$/;
const USAGE = "Usage: node scripts/submit-indexnow.mjs [--submit] /resources /resources/article-slug\nWithout --submit, this only validates and previews the URL list. It makes no network requests.";

class SubmissionError extends Error {}

export function canonicalUrl(input) {
  if (typeof input !== "string" || !input || /[\s\\?#%]/u.test(input)) {
    throw new SubmissionError("Use canonical paths or HTTPS Vanteloq URLs without whitespace, queries, fragments, escapes, or backslashes.");
  }
  let url;
  try {
    url = new URL(input, ORIGIN);
  } catch {
    throw new SubmissionError("One supplied URL is invalid.");
  }
  if (url.origin !== ORIGIN || url.username || url.password || !APPROVED_PATH.test(url.pathname)) {
    throw new SubmissionError("Only canonical Vanteloq Resources URLs are allowed. API and other namespaces are excluded.");
  }
  if (input !== url.pathname && input !== url.href) {
    throw new SubmissionError("Supply an exact canonical path or URL, without relative paths, redundant segments, or trailing slashes.");
  }
  return url.href;
}

async function readOwnership() {
  let names;
  try {
    names = (await readdir(PUBLIC_DIRECTORY)).filter((name) => name.startsWith("indexnow-") && name.endsWith(".txt"));
  } catch {
    throw new SubmissionError("The public directory could not be read.");
  }
  if (names.length !== 1 || !KEY_FILE_PATTERN.test(names[0])) {
    throw new SubmissionError("Expected exactly one valid public/indexnow-<key>.txt ownership file.");
  }
  const fileName = names[0];
  const expectedKey = KEY_FILE_PATTERN.exec(fileName)[1];
  let key;
  try {
    key = await readFile(new URL(fileName, PUBLIC_DIRECTORY), "utf8");
  } catch {
    throw new SubmissionError("The local ownership file could not be read.");
  }
  if (key !== expectedKey) {
    throw new SubmissionError("The ownership file must contain exactly its filename key, encoded as UTF-8, without additional text.");
  }
  return { key, keyLocation: `${ORIGIN}/${fileName}` };
}

export async function run(args, { fetchImpl = globalThis.fetch, log = console.log } = {}) {
  if (args.length === 1 && args[0] === "--help") {
    log(USAGE);
    return;
  }
  const flags = args.filter((argument) => argument.startsWith("--"));
  if (flags.some((flag) => flag !== "--submit") || flags.length > 1) {
    throw new SubmissionError(USAGE);
  }
  const submit = flags.includes("--submit");
  const paths = args.filter((argument) => argument !== "--submit");
  if (!paths.length) throw new SubmissionError(USAGE);
  const urlList = [...new Set(paths.map(canonicalUrl))];
  if (urlList.length > 10000) throw new SubmissionError("IndexNow accepts no more than 10,000 URLs in one request.");
  const { key, keyLocation } = await readOwnership();
  const host = new URL(ORIGIN).hostname;

  if (!submit) {
    log(JSON.stringify({ mode: "dry-run", endpoint: ENDPOINT, host, urlCount: urlList.length, urlList, localOwnership: "valid", liveOwnership: "not checked", message: "No network requests made. After deployment, use --submit once to verify ownership and notify IndexNow." }, null, 2));
    return;
  }

  let ownership;
  try {
    ownership = await fetchImpl(keyLocation, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20000) });
  } catch {
    throw new SubmissionError("Live ownership verification failed or timed out. No URLs were submitted. Deploy the key file and check availability before trying again.");
  }
  if (ownership.status !== 200) {
    throw new SubmissionError(`Live ownership verification returned HTTP ${ownership.status}. No URLs were submitted.`);
  }
  let liveKey;
  try {
    liveKey = await ownership.text();
  } catch {
    throw new SubmissionError("The live ownership file could not be read. No URLs were submitted.");
  }
  if (liveKey !== key) {
    throw new SubmissionError("The live ownership file does not exactly match the local key. No URLs were submitted.");
  }

  for (const url of urlList) {
    let page;
    try {
      page = await fetchImpl(url, { method: "HEAD", redirect: "error", signal: AbortSignal.timeout(20000) });
    } catch {
      throw new SubmissionError("A submitted page is unreachable or redirects. No URLs were submitted.");
    }
    if (page.status !== 200 || /noindex/i.test(page.headers.get("X-Robots-Tag") ?? "")) {
      throw new SubmissionError("Only live, indexable HTTP 200 pages can be submitted by this release helper. No URLs were submitted.");
    }
  }

  let response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host, key, keyLocation, urlList }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new SubmissionError("The IndexNow request failed or timed out; receipt is unknown. No automatic retry was made.");
  }
  const received = response.status === 200;
  const pending = response.status === 202;
  log(JSON.stringify({
    mode: "submitted",
    endpoint: ENDPOINT,
    host,
    urlCount: urlList.length,
    httpStatus: response.status,
    result: received ? "received" : pending ? "validation_pending" : "not_accepted",
    message: received
      ? "IndexNow received the URLs. Crawling, indexing, ranking, and AI recommendations are not guaranteed."
      : pending
        ? "IndexNow received the URLs and ownership validation is pending. Crawling, indexing, ranking, and AI recommendations are not guaranteed."
        : "IndexNow did not confirm acceptance. Review the HTTP status before any manual retry; no automatic retry was made.",
  }, null, 2));
  if (!received && !pending) throw new SubmissionError("IndexNow submission was not accepted.");
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  run(process.argv.slice(2)).catch((error) => {
    // Never expose the ownership key, request body, or a provider response body.
    console.error(error instanceof SubmissionError ? error.message : "IndexNow preparation failed. No automatic retry was made.");
    process.exitCode = 1;
  });
}
