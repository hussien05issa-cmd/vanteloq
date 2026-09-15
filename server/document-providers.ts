import type { VanteloqRuntimeEnv } from "../db/index.ts";
import type { DocumentExtraction, ExtractedField } from "../shared/document-processing.ts";
import { PDFDocument } from "pdf-lib";

type Json = Record<string, unknown>;
export class DocumentProviderError extends Error {
  constructor(readonly code: string) { super(code); }
}
const object = (value: unknown): Json => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown, limit = 2000) => typeof value === "string" ? value.slice(0, limit) : "";
const positiveInteger = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;

/** Only server-configured vendor origins are accepted. Never forward keys on redirects. */
export function providerOrigin(value: string | undefined, vendor: "cloudmersive" | "azure") {
  let url: URL;
  try { url = new URL(value || ""); } catch { throw new DocumentProviderError("PROVIDER_NOT_CONFIGURED"); }
  const allowed = vendor === "cloudmersive"
    ? /^(?:[a-z0-9-]+\.)*cloudmersive\.com$/.test(url.hostname)
    : /^[a-z0-9-]+\.cognitiveservices\.azure\.com$/.test(url.hostname);
  if (!allowed || url.protocol !== "https:" || url.port || url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new DocumentProviderError("PROVIDER_ENDPOINT_INVALID");
  return url.origin;
}

export function documentProviderConfiguration(env: VanteloqRuntimeEnv) {
  const valid = (endpoint: string | undefined, vendor: "cloudmersive" | "azure") => {
    try { providerOrigin(endpoint, vendor); return true; } catch { return false; }
  };
  return {
    scanning: Boolean(env.CLOUDMERSIVE_API_KEY?.trim()) && valid(env.CLOUDMERSIVE_ENDPOINT, "cloudmersive"),
    extraction: Boolean(env.AZURE_DOCUMENT_INTELLIGENCE_KEY?.trim()) && valid(env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT, "azure"),
  };
}

async function request(url: string, init: RequestInit, transport: typeof fetch) {
  try {
    const response = await transport(url, { ...init, redirect: "error", signal: AbortSignal.timeout(25_000) });
    if (!response.ok) throw new DocumentProviderError(response.status === 429 ? "PROVIDER_RATE_LIMIT" : response.status === 401 || response.status === 403 ? "PROVIDER_ACCESS_DENIED" : response.status === 413 ? "PROVIDER_FILE_LIMIT" : "PROVIDER_UNAVAILABLE");
    return response;
  } catch (error) {
    if (error instanceof DocumentProviderError) throw error;
    throw new DocumentProviderError("PROVIDER_UNAVAILABLE");
  }
}
async function json(response: Response): Promise<Json> {
  // Provider payloads can contain confidential text. Do not log response bodies.
  const body = await response.text();
  if (body.length > 4_000_000) throw new DocumentProviderError("EXTRACTION_TOO_LARGE");
  try { return object(JSON.parse(body)); } catch { throw new DocumentProviderError("PROVIDER_RESPONSE_INVALID"); }
}

export function scanVerdict(value: unknown): "clean" | "blocked" | "unknown" {
  const body = object(value);
  if (body.CleanResult === false || array(body.FoundViruses).length || Object.entries(body).some(([key, val]) => key.startsWith("Contains") && val === true)) return "blocked";
  if (Object.entries(body).some(([key, value]) => key.startsWith("Contains") && typeof value !== "boolean") || (body.FoundViruses != null && !Array.isArray(body.FoundViruses))) return "unknown";
  return body.CleanResult === true ? "clean" : "unknown";
}

export async function scanDocument(env: VanteloqRuntimeEnv, bytes: Uint8Array, contentType: string, transport: typeof fetch = fetch) {
  const endpoint = providerOrigin(env.CLOUDMERSIVE_ENDPOINT, "cloudmersive");
  if (!env.CLOUDMERSIVE_API_KEY) throw new DocumentProviderError("PROVIDER_NOT_CONFIGURED");
  const extensions: Record<string, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
  if (!extensions[contentType]) throw new DocumentProviderError("DOCUMENT_FORMAT_UNSUPPORTED");
  const form = new FormData();
  // No customer name, object key, account number or workspace ID in the filename.
  form.set("inputFile", new Blob([new Uint8Array(bytes)], { type: contentType }), `document.${extensions[contentType]}`);
  const headers: Record<string, string> = { Apikey: env.CLOUDMERSIVE_API_KEY, Accept: "application/json", restrictFileTypes: ".pdf,.jpg,.jpeg,.png,.webp" };
  for (const rule of ["allowExecutables", "allowInvalidFiles", "allowScripts", "allowPasswordProtectedFiles", "allowMacros", "allowXmlExternalEntities", "allowInsecureDeserialization", "allowHtml", "allowUnsafeArchives", "allowOleEmbeddedObject", "allowUnwantedAction"]) headers[rule] = "false";
  const verdict = scanVerdict(await json(await request(`${endpoint}/virus/scan/file/advanced`, { method: "POST", headers, body: form }, transport)));
  if (verdict === "unknown") throw new DocumentProviderError("SCAN_RESULT_UNKNOWN");
  return verdict;
}

export function extractionModel(documentType: string) {
  return documentType === "invoice" ? "prebuilt-invoice" : documentType === "receipt" ? "prebuilt-receipt" : "prebuilt-layout";
}
export function azureOperationUrl(env: VanteloqRuntimeEnv, value: string) {
  const origin = providerOrigin(env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT, "azure");
  let url: URL;
  try { url = new URL(value); } catch { throw new DocumentProviderError("PROVIDER_RESPONSE_INVALID"); }
  if (url.origin !== origin || url.username || url.password || url.hash || !/^\/documentintelligence\/documentModels\/[a-zA-Z0-9._~-]+\/analyzeResults\/[a-f0-9-]{36}$/.test(url.pathname) || url.search !== "?api-version=2024-11-30") throw new DocumentProviderError("PROVIDER_RESPONSE_INVALID");
  return url.href;
}
export async function startExtraction(env: VanteloqRuntimeEnv, bytes: Uint8Array, contentType: string, documentType: string, transport: typeof fetch = fetch) {
  if (!env.AZURE_DOCUMENT_INTELLIGENCE_KEY) throw new DocumentProviderError("PROVIDER_NOT_CONFIGURED");
  if (!["application/pdf", "image/jpeg", "image/png"].includes(contentType)) throw new DocumentProviderError("EXTRACTION_FORMAT_UNSUPPORTED");
  let expectedPages = 1;
  if (contentType === "application/pdf") {
    let pdf: PDFDocument;
    try { pdf = await PDFDocument.load(bytes, { updateMetadata: false }); } catch { throw new DocumentProviderError("DOCUMENT_FORMAT_UNSUPPORTED"); }
    expectedPages = pdf.getPageCount();
    if (pdf.getPageCount() > 50) throw new DocumentProviderError("EXTRACTION_PAGE_LIMIT");
  }
  const origin = providerOrigin(env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT, "azure");
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const response = await request(`${origin}/documentintelligence/documentModels/${extractionModel(documentType)}:analyze?api-version=2024-11-30`, {
    method: "POST", headers: { "Content-Type": "application/json", "Ocp-Apim-Subscription-Key": env.AZURE_DOCUMENT_INTELLIGENCE_KEY }, body: JSON.stringify({ base64Source: btoa(binary) }),
  }, transport);
  if (response.status !== 202) throw new DocumentProviderError("PROVIDER_RESPONSE_INVALID");
  return { operation: azureOperationUrl(env, response.headers.get("operation-location") || ""), expectedPages };
}

function field(value: unknown): ExtractedField {
  const data = object(value), currency = object(data.valueCurrency);
  const scalar = data.valueString ?? data.valueDate ?? data.valueNumber ?? data.valueInteger ?? currency.amount ?? data.content;
  const result: ExtractedField = {
    value: typeof scalar === "number" && Number.isFinite(scalar) ? scalar : typeof scalar === "string" ? scalar.slice(0, 2000) : null,
    confidenceBasisPoints: typeof data.confidence === "number" && data.confidence >= 0 && data.confidence <= 1 ? Math.round(data.confidence * 10000) : null,
    page: positiveInteger(object(array(data.boundingRegions)[0]).pageNumber),
  };
  if (/^[A-Z]{3}$/.test(text(currency.currencyCode))) result.currency = text(currency.currencyCode);
  return result;
}
export function normalizeExtraction(value: unknown): DocumentExtraction {
  const result = object(value), documents = array(result.documents), source = object(documents[0]);
  const rawFields = object(source.fields);
  const fields = Object.fromEntries(Object.entries(rawFields).filter(([name]) => name !== "Items").slice(0, 80).map(([name, value]) => [name, field(value)]));
  const rawLines = array(object(rawFields.Items).valueArray);
  const lines = rawLines.slice(0, 300).map(line => Object.fromEntries(Object.entries(object(object(line).valueObject)).slice(0, 30).map(([name, value]) => [name, field(value)])));
  const rawTables = array(result.tables);
  let tableTruncated = false;
  const tables = rawTables.slice(0, 30).map(value => {
    const table = object(value);
    const rowCount = Math.min(positiveInteger(table.rowCount) ?? 0, 150), columns = Math.min(positiveInteger(table.columnCount) ?? 0, 20);
    if (Number(table.rowCount) > rowCount || Number(table.columnCount) > columns) tableTruncated = true;
    const rows = Array.from({ length: rowCount }, () => Array<string>(columns).fill(""));
    for (const cellValue of array(table.cells)) {
      const cell = object(cellValue), row = cell.rowIndex, column = cell.columnIndex;
      if (typeof row === "number" && typeof column === "number" && Number.isInteger(row) && Number.isInteger(column) && row >= 0 && row < rowCount && column >= 0 && column < columns) rows[row][column] = text(cell.content, 500);
    }
    return { page: positiveInteger(object(array(table.boundingRegions)[0]).pageNumber), rows };
  });
  const checks: DocumentExtraction["checks"] = [];
  const model = text(result.modelId, 80);
  if (documents.length > 1) checks.push({ label: "Multiple documents", state: "review", detail: "Fields show the first detected document. Review the full text and tables for additional documents." });
  const money = (name: string) => {
    const value = fields[name]?.value;
    if (typeof value !== "number" || Math.abs(value) > 1e12 || Math.abs(value * 100 - Math.round(value * 100)) > 0.0001) return null;
    return Math.round(value * 100);
  };
  const totalName = model === "prebuilt-invoice" ? "InvoiceTotal" : "Total";
  const total = money(totalName), subtotal = money("SubTotal") ?? money("Subtotal"), tax = money("TotalTax");
  const currencies = new Set([fields[totalName]?.currency, fields.SubTotal?.currency, fields.Subtotal?.currency, fields.TotalTax?.currency].filter(Boolean));
  if (total !== null && subtotal !== null && tax !== null && currencies.size <= 1) {
    const matches = Math.abs(total - subtotal - tax) <= 1;
    checks.push({ label: "Subtotal + tax", state: matches ? "passed" : "review", detail: matches ? "The extracted subtotal and tax agree with the total within 0.01. Verify currency and source figures." : "The subtotal and tax do not match the total. Check discounts, tips, freight and extraction errors." });
  } else checks.push({ label: "Total reconciliation", state: "review", detail: "Not enough comparable amounts for an automatic total check. Review the original and confirm the currency." });
  const uncertain = Object.values(fields).filter(field => field.confidenceBasisPoints === null || field.confidenceBasisPoints < 9000).length;
  if (uncertain) checks.push({ label: "Field confidence", state: "review", detail: `${uncertain} fields have low or unavailable confidence. Compare them with the original.` });
  if (model === "prebuilt-layout") checks.push({ label: "Statement mapping", state: "review", detail: "Text and tables were read without assuming a US bank format. Dates, debit/credit direction, currency and balances still need review." });
  const fullText = text(result.content, 4_000_000);
  const truncated = fullText.length > 60000 || rawLines.length > 300 || rawTables.length > 30 || tableTruncated;
  if (truncated) checks.push({ label: "Large document", state: "review", detail: "The review preview is limited. Use the original to check all pages and rows." });
  const normalized: DocumentExtraction = { provider: "azure-document-intelligence", model, pages: array(result.pages).length, text: fullText.slice(0, 60000), fields, lines, tables, checks, truncated };
  if (new TextEncoder().encode(JSON.stringify(normalized)).length > 750_000) throw new DocumentProviderError("EXTRACTION_TOO_LARGE");
  return normalized;
}

export async function pollExtraction(env: VanteloqRuntimeEnv, operation: string, transport: typeof fetch = fetch) {
  const body = await json(await request(azureOperationUrl(env, operation), { headers: { "Ocp-Apim-Subscription-Key": env.AZURE_DOCUMENT_INTELLIGENCE_KEY || "" } }, transport));
  if (body.status === "running" || body.status === "notStarted") return null;
  if (body.status !== "succeeded" || !body.analyzeResult) throw new DocumentProviderError("EXTRACTION_FAILED");
  return normalizeExtraction(body.analyzeResult);
}
export async function deleteExtractionResult(env: VanteloqRuntimeEnv, operation: string, transport: typeof fetch = fetch) {
  await request(azureOperationUrl(env, operation), { method: "DELETE", headers: { "Ocp-Apim-Subscription-Key": env.AZURE_DOCUMENT_INTELLIGENCE_KEY || "" } }, transport);
}
