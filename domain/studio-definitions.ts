import { StudioValidationError, validateStudioScope, type StudioScope } from "./data-studio.ts";
import { StudioSheetValidationError, validateStudioSheetDraft, type StudioSheetDraft } from "./studio-formulas.ts";

export const STUDIO_DEFINITION_BODY_BYTES = 16_384;
export const STUDIO_DEFINITION_LIMIT = 50;
export type StudioDefinitionApp = "dashboards" | "sheets" | "sql";
export type StudioDefinitionSheet = StudioSheetDraft;
export type StudioDefinitionContent = {
  sql?: string;
  metric?: "net_sales_cents" | "gross_profit_cents" | "transaction_count";
  group?: "business_date" | "location_ref";
  chart?: "line" | "bar";
  sheet?: StudioDefinitionSheet;
  pinned?: boolean;
};
export type StudioDefinitionDraft = { title: string; app: StudioDefinitionApp; scope: StudioScope; content: StudioDefinitionContent };
export type StudioDefinition = StudioDefinitionDraft & { id: string; version: number; updatedAt: string };
export type StudioDefinitionWriteInput = StudioDefinitionDraft & { id?: string; expectedVersion?: number };
export type StudioDefinitionDeleteInput = { id: string; expectedVersion: number };

function invalid(message: string): never { throw new StudioValidationError("STUDIO_DEFINITION_INVALID", message); }
function object(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`Use a valid ${label}.`);
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some(key => !keys.includes(key))) invalid(`Use only supported ${label} fields. Saved definitions cannot contain source rows, results or credentials.`);
  return raw;
}
function boundedText(value: unknown, maximum: number, label: string, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > maximum || (!allowEmpty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) invalid(`Use a valid ${label} of at most ${maximum} characters.`);
  return value;
}
function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) invalid("Choose a valid saved analysis.");
  return value;
}
function version(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value >= Number.MAX_SAFE_INTEGER) invalid("Refresh the saved analysis before updating it. Your draft can be kept.");
  return value;
}
export function validateStudioDefinitionApp(value: unknown): StudioDefinitionApp {
  if (value !== "dashboards" && value !== "sheets" && value !== "sql") invalid("Choose Dashboards, Sheets or SQL.");
  return value;
}
export function validateStudioDefinitionContent(value: unknown): StudioDefinitionContent {
  const raw = object(value, ["sql", "metric", "group", "chart", "sheet", "pinned"], "definition content");
  const content: StudioDefinitionContent = {};
  if ("sql" in raw) content.sql = boundedText(raw.sql, 8_000, "SQL draft", true);
  if ("metric" in raw) {
    if (raw.metric !== "net_sales_cents" && raw.metric !== "gross_profit_cents" && raw.metric !== "transaction_count") invalid("Choose a supported chart metric.");
    content.metric = raw.metric;
  }
  if ("group" in raw) {
    if (raw.group !== "business_date" && raw.group !== "location_ref") invalid("Choose a supported grouping.");
    content.group = raw.group;
  }
  if ("chart" in raw) {
    if (raw.chart !== "line" && raw.chart !== "bar") invalid("Choose a line or bar chart.");
    content.chart = raw.chart;
  }
  if ("pinned" in raw) {
    if (typeof raw.pinned !== "boolean") invalid("Choose a valid pin setting.");
    content.pinned = raw.pinned;
  }
  if ("sheet" in raw) {
    try { content.sheet = validateStudioSheetDraft(raw.sheet); }
    catch (error) { if (error instanceof StudioSheetValidationError) invalid(error.message); throw error; }
  }
  return content;
}
export function validateStudioDefinitionWrite(value: unknown, today: string): StudioDefinitionWriteInput {
  const raw = object(value, ["title", "app", "scope", "content", "id", "expectedVersion"], "saved analysis");
  if (("id" in raw) !== ("expectedVersion" in raw)) invalid("Supply the saved ID and its current version together. Your draft can be kept.");
  return { title: boundedText(raw.title, 100, "analysis title").trim(), app: validateStudioDefinitionApp(raw.app),
    scope: validateStudioScope(raw.scope, today), content: validateStudioDefinitionContent(raw.content),
    ...("id" in raw ? { id: identifier(raw.id), expectedVersion: version(raw.expectedVersion) } : {}) };
}
export function validateStudioDefinitionDelete(value: unknown): StudioDefinitionDeleteInput {
  const raw = object(value, ["id", "expectedVersion"], "delete request");
  return { id: identifier(raw.id), expectedVersion: version(raw.expectedVersion) };
}
