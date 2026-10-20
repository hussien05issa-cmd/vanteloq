import { STUDIO_MAX_RECORDS, STUDIO_MAX_RESULT_BYTES, studioQuantityMilli, type StudioExecutiveReview, type StudioSalesRow } from "./data-studio.ts";
import { isCalendarDate } from "./calendar-date.ts";

export const STUDIO_SQL_LIMITS = Object.freeze({ sqlBytes: 8192, tokens: 512, columns: 16, predicates: 16, grouping: 2, sorting: 3, sourceRows: STUDIO_MAX_RECORDS, resultRows: 2000, defaultLimit: 500, estimatedOperations: 100000, resultBytes: STUDIO_MAX_RESULT_BYTES });
export type StudioQueryValue = string | number | null;
export type StudioQueryField = "record_id" | "business_date" | "location_ref" | "source_kind" | "net_sales_cents" | "transaction_count" | "units_sold" | "discounts_cents" | "refunds_cents" | "cost_of_goods_cents" | "gross_profit_cents";
export type StudioQueryType = "text" | "date" | "cents" | "count" | "quantity";
export type StudioQueryAggregate = "SUM" | "COUNT" | "MIN" | "MAX";
export type StudioQueryFieldSpec = { field: StudioQueryField; type: StudioQueryType; nullable: boolean; description: string };
export type StudioQueryProjection = { field: StudioQueryField | "*"; aggregate: StudioQueryAggregate | null; key: string };
export type StudioQueryPredicate = { field: StudioQueryField; operator: "=" | "!=" | "<>" | "<" | "<=" | ">" | ">=" | "IS NULL" | "IS NOT NULL"; value: StudioQueryValue };
export type StudioQueryPlan = {
  version: "studio-sql-v1"; table: "sales"; select: StudioQueryProjection[]; where: StudioQueryPredicate[];
  groupBy: ("business_date" | "location_ref")[]; orderBy: { key: string; direction: "ASC" | "DESC" }[]; limit: number; normalizedSql: string;
};
export type StudioQueryColumn = { key: string; label: string; field: StudioQueryField | "*"; type: StudioQueryType; aggregate: StudioQueryAggregate | null; nullable: boolean };
export type StudioQueryResult = {
  columns: string[]; columnDetails: StudioQueryColumn[]; rows: Record<string, StudioQueryValue>[];
  matchedRows: number; totalResultRows: number; truncated: boolean; plan: StudioQueryPlan;
  warnings: string[]; snapshotHash: string; currency: string; estimatedOperations: number;
};
export class StudioQueryError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "StudioQueryError"; }
}
function fail(code: string, message: string): never { throw new StudioQueryError(code, message); }
const fields: readonly StudioQueryFieldSpec[] = [
  { field: "record_id", type: "text", nullable: false, description: "The recorded daily row identifier." },
  { field: "business_date", type: "date", nullable: false, description: "Business date, YYYY-MM-DD, in the review's time zone." },
  { field: "location_ref", type: "text", nullable: false, description: "The authorized reporting location reference." },
  { field: "source_kind", type: "text", nullable: false, description: "owner_summary or provider_summary. Each row is a daily summary." },
  { field: "net_sales_cents", type: "cents", nullable: false, description: "Recorded net sales in integer cents, including negative return days." },
  { field: "transaction_count", type: "count", nullable: false, description: "Recorded nonnegative whole transaction count." },
  { field: "units_sold", type: "quantity", nullable: false, description: "Recorded units with at most three decimal places, including returns." },
  { field: "discounts_cents", type: "cents", nullable: true, description: "Recorded discounts in integer cents. Missing evidence is NULL." },
  { field: "refunds_cents", type: "cents", nullable: true, description: "Recorded refunds in integer cents. Missing evidence is NULL." },
  { field: "cost_of_goods_cents", type: "cents", nullable: true, description: "Recorded costs in integer cents, when margin access permits them." },
  { field: "gross_profit_cents", type: "cents", nullable: true, description: "Net sales less known recorded costs for this row. Unknown costs give NULL." },
];
/** Current authorization controls the schema, without reading source rows. */
export function studioQuerySchema(review: StudioExecutiveReview): StudioQueryFieldSpec[] {
  return fields.filter(spec => review.margin.state !== "restricted" || (spec.field !== "cost_of_goods_cents" && spec.field !== "gross_profit_cents")).map(spec => ({ ...spec }));
}
type Token = { kind: "word" | "string" | "number" | "symbol"; value: string; position: number };
function tokenize(sql: string): Token[] {
  if (typeof sql !== "string" || !sql.trim() || new TextEncoder().encode(sql).length > STUDIO_SQL_LIMITS.sqlBytes) fail("STUDIO_SQL_SIZE", "Enter one SELECT query of at most 8 KiB.");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(sql)) fail("STUDIO_SQL_SYNTAX", "Remove unsupported control characters from the query.");
  const tokens: Token[] = []; let index = 0;
  const push = (kind: Token["kind"], value: string, position: number) => {
    tokens.push({ kind, value, position });
    if (tokens.length > STUDIO_SQL_LIMITS.tokens) fail("STUDIO_SQL_COMPLEXITY", "The query exceeds 512 tokens. Simplify the query.");
  };
  while (index < sql.length) {
    if (/\s/.test(sql[index])) { index++; continue; }
    const start = index;
    if (sql[index] === "'") {
      index++; let value = "", closed = false;
      while (index < sql.length) {
        if (sql[index] === "'") {
          if (sql[index + 1] === "'") { value += "'"; index += 2; continue; }
          index++; closed = true; break;
        }
        value += sql[index++];
      }
      if (!closed) fail("STUDIO_SQL_SYNTAX", `Close the quoted value at character ${start + 1}.`);
      if (value.length > 256) fail("STUDIO_SQL_SIZE", "Quoted values may contain at most 256 characters.");
      push("string", value, start); continue;
    }
    const rest = sql.slice(index), word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (word) {
      if (word[0].length > 64) fail("STUDIO_SQL_SIZE", "Field names and aliases may contain at most 64 characters.");
      push("word", word[0].toLowerCase(), start); index += word[0].length; continue;
    }
    const number = /^-?\d+(?:\.\d+)?/.exec(rest);
    if (number) { push("number", number[0], start); index += number[0].length; continue; }
    const symbol = /^(?:<=|>=|<>|!=|[(),*;=<>])/.exec(rest);
    if (symbol) { push("symbol", symbol[0], start); index += symbol[0].length; continue; }
    fail("STUDIO_SQL_SYNTAX", `Unsupported syntax at character ${index + 1}. Use the documented SELECT grammar.`);
  }
  return tokens;
}
const reserved = new Set(["select", "from", "where", "and", "or", "as", "group", "by", "order", "asc", "desc", "limit", "null", "is", "not", "sum", "count", "min", "max", "constructor", "prototype", "__proto__"]);
function safeInteger(value: number): number {
  if (!Number.isSafeInteger(value)) fail("STUDIO_SQL_EXACT_VALUE", "A value exceeds exact supported integer units. Narrow the scope or review the source.");
  return value;
}
function boundedBigInteger(value: bigint): number {
  const bound = BigInt(Number.MAX_SAFE_INTEGER);
  if (value > bound || value < -bound) fail("STUDIO_SQL_OVERFLOW", "The calculation exceeds exact supported integer units. Narrow the scope.");
  return Number(value);
}
function numericLiteral(token: Token, spec: StudioQueryFieldSpec): number {
  if (spec.type === "cents" || spec.type === "count") {
    if (!/^-?\d+$/.test(token.value)) fail("STUDIO_SQL_LITERAL", `${spec.field} comparisons require whole ${spec.type === "cents" ? "cents" : "counts"}.`);
    return boundedBigInteger(BigInt(token.value));
  }
  if (!/^-?\d+(?:\.\d{1,3})?$/.test(token.value)) fail("STUDIO_SQL_LITERAL", "Unit comparisons support at most three decimal places.");
  const negative = token.value.startsWith("-"), [whole, fraction = ""] = token.value.replace(/^-/, "").split(".");
  const value = BigInt(whole) * BigInt(1000) + BigInt(fraction.padEnd(3, "0"));
  return boundedBigInteger(negative ? -value : value) / 1000;
}
function normalize(plan: Omit<StudioQueryPlan, "normalizedSql">): string {
  const literal = (value: StudioQueryValue) => value === null ? "NULL" : typeof value === "string" ? `'${value.replace(/'/g, "''")}'` : String(value);
  const select = plan.select.map(item => {
    const expression = item.aggregate ? `${item.aggregate}(${item.field})` : item.field;
    const defaultKey = item.aggregate ? `${item.aggregate.toLowerCase()}_${item.field === "*" ? "rows" : item.field}` : item.field;
    return expression + (item.key === defaultKey ? "" : ` AS ${item.key}`);
  }).join(", ");
  return `SELECT ${select} FROM sales${plan.where.length ? ` WHERE ${plan.where.map(item => `${item.field} ${item.operator}${item.operator.startsWith("IS ") ? "" : ` ${literal(item.value)}`}`).join(" AND ")}` : ""}${plan.groupBy.length ? ` GROUP BY ${plan.groupBy.join(", ")}` : ""}${plan.orderBy.length ? ` ORDER BY ${plan.orderBy.map(item => `${item.key} ${item.direction}`).join(", ")}` : ""} LIMIT ${plan.limit}`;
}
/** Parse every token before execution. No text reaches a database or evaluator. */
export function parseStudioQuery(review: StudioExecutiveReview, sql: string): StudioQueryPlan {
  const schema = studioQuerySchema(review), permitted = new Map(schema.map(spec => [spec.field, spec]));
  const tokens = tokenize(sql); let index = 0;
  const peek = () => tokens[index];
  const accept = (value: string) => { if (peek()?.value === value && peek()?.kind !== "string") { index++; return true; } return false; };
  const expect = (value: string) => { if (!accept(value)) fail("STUDIO_SQL_SYNTAX", `Expected ${value.toUpperCase()} at character ${(peek()?.position ?? sql.length) + 1}.`); };
  const word = () => { const token = peek(); if (!token || token.kind !== "word") fail("STUDIO_SQL_SYNTAX", "Use an unquoted field name from the permitted schema."); index++; return token.value; };
  const field = () => { const name = word(); if (!permitted.has(name as StudioQueryField)) fail("STUDIO_SQL_FIELD", `The field ${name} is not available in your permitted sales schema.`); return name as StudioQueryField; };
  const select: StudioQueryProjection[] = [], where: StudioQueryPredicate[] = [];
  const groupBy: StudioQueryPlan["groupBy"] = [], orderBy: StudioQueryPlan["orderBy"] = [];
  expect("select");
  if (accept("*")) for (const spec of schema) select.push({ field: spec.field, aggregate: null, key: spec.field });
  else do {
    let aggregate: StudioQueryAggregate | null = null, name: StudioQueryField | "*";
    if (peek()?.kind === "word" && tokens[index + 1]?.value === "(") {
      const fn = word().toUpperCase();
      if (!["SUM", "COUNT", "MIN", "MAX"].includes(fn)) fail("STUDIO_SQL_FUNCTION", "Use only SUM, COUNT, MIN or MAX aggregate functions.");
      aggregate = fn as StudioQueryAggregate; expect("("); name = accept("*") ? "*" : field(); expect(")");
      if (name === "*" && aggregate !== "COUNT") fail("STUDIO_SQL_FUNCTION", "Only COUNT(*) accepts the star argument.");
      if (aggregate === "SUM" && name !== "*" && ["text", "date"].includes(permitted.get(name)!.type)) fail("STUDIO_SQL_FUNCTION", "SUM requires a numeric field.");
    } else name = field();
    let key = aggregate ? `${aggregate.toLowerCase()}_${name === "*" ? "rows" : name}` : name;
    if (accept("as")) {
      key = word();
      if (reserved.has(key) || (fields.some(spec => spec.field === key) && key !== name)) fail("STUDIO_SQL_ALIAS", "Choose a unique alias that is not a keyword or another schema field.");
    }
    if (select.some(item => item.key === key)) fail("STUDIO_SQL_ALIAS", "Give each selected result a unique alias.");
    select.push({ field: name, aggregate, key });
    if (select.length > STUDIO_SQL_LIMITS.columns) fail("STUDIO_SQL_COMPLEXITY", "Select at most 16 result columns.");
  } while (accept(","));
  expect("from"); expect("sales");
  if (accept("where")) do {
    const name = field(), spec = permitted.get(name)!;
    let operator: StudioQueryPredicate["operator"], value: StudioQueryValue = null;
    if (accept("is")) { operator = accept("not") ? "IS NOT NULL" : "IS NULL"; expect("null"); }
    else {
      const token = peek();
      if (!token || token.kind !== "symbol" || !["=", "!=", "<>", "<", "<=", ">", ">="].includes(token.value)) fail("STUDIO_SQL_SYNTAX", "Use a comparison operator or IS NULL in WHERE.");
      index++; operator = token.value as StudioQueryPredicate["operator"];
      const input = peek();
      if (accept("null")) value = null;
      else if (input?.kind === "string" && ["text", "date"].includes(spec.type)) {
        index++; value = input.value;
        if (spec.type === "date" && !isCalendarDate(value)) fail("STUDIO_SQL_LITERAL", "Business dates must be valid YYYY-MM-DD dates.");
      } else if (input?.kind === "number" && !["text", "date"].includes(spec.type)) { index++; value = numericLiteral(input, spec); }
      else fail("STUDIO_SQL_LITERAL", "Compare text and dates with single quoted text, and numeric fields with exact numbers.");
    }
    where.push({ field: name, operator, value });
    if (where.length > STUDIO_SQL_LIMITS.predicates) fail("STUDIO_SQL_COMPLEXITY", "Use at most 16 WHERE comparisons.");
  } while (accept("and"));
  if (accept("group")) { expect("by"); do {
    const name = field();
    if (name !== "business_date" && name !== "location_ref") fail("STUDIO_SQL_GROUP", "Group only by business_date, location_ref, or both.");
    if (groupBy.includes(name)) fail("STUDIO_SQL_GROUP", "List each grouping field once.");
    groupBy.push(name);
  } while (accept(",")); }
  const grouped = groupBy.length > 0 || select.some(item => item.aggregate !== null);
  if (grouped && select.some(item => item.aggregate === null && !groupBy.includes(item.field as "business_date" | "location_ref"))) fail("STUDIO_SQL_GROUP", "Include each nonaggregate selected field in GROUP BY.");
  if (accept("order")) { expect("by"); do {
    const key = word();
    if (!select.some(item => item.key === key)) fail("STUDIO_SQL_ORDER", "ORDER BY must name a selected field or its result alias from your permitted schema.");
    if (orderBy.some(item => item.key === key)) fail("STUDIO_SQL_ORDER", "List each sorting result once.");
    const direction = accept("desc") ? "DESC" : (accept("asc"), "ASC");
    orderBy.push({ key, direction });
    if (orderBy.length > STUDIO_SQL_LIMITS.sorting) fail("STUDIO_SQL_COMPLEXITY", "Use at most three ORDER BY results.");
  } while (accept(",")); }
  let limit: number = STUDIO_SQL_LIMITS.defaultLimit;
  if (accept("limit")) {
    const token = peek();
    if (!token || token.kind !== "number" || !/^\d+$/.test(token.value)) fail("STUDIO_SQL_LIMIT", "LIMIT must be a whole number from 0 through 2000.");
    index++; limit = Number(token.value);
    if (!Number.isSafeInteger(limit) || limit > STUDIO_SQL_LIMITS.resultRows) fail("STUDIO_SQL_LIMIT", "LIMIT must be a whole number from 0 through 2000.");
  }
  accept(";");
  if (index !== tokens.length) fail("STUDIO_SQL_SYNTAX", `Unsupported syntax at character ${peek()!.position + 1}. Only one complete supported SELECT is allowed.`);
  const plan: Omit<StudioQueryPlan, "normalizedSql"> = { version: "studio-sql-v1", table: "sales", select, where, groupBy, orderBy, limit };
  return { ...plan, normalizedSql: normalize(plan) };
}
function sourceValue(row: StudioSalesRow, field: StudioQueryField): StudioQueryValue {
  let value: StudioQueryValue | undefined;
  switch (field) {
    case "record_id": value = row.id; break;
    case "business_date": value = row.businessDate; break;
    case "location_ref": value = row.locationRef; break;
    case "source_kind": value = row.sourceKind; break;
    case "net_sales_cents": value = row.netSalesCents; break;
    case "transaction_count": value = row.transactionCount; break;
    case "units_sold": try { return studioQuantityMilli(row.unitsSold) / 1000; } catch { return fail("STUDIO_SQL_SOURCE", "A recorded quantity is outside exact supported thousandths."); }
    case "discounts_cents": value = row.discountsCents ?? null; break;
    case "refunds_cents": value = row.refundsCents ?? null; break;
    case "cost_of_goods_cents": value = row.costOfGoodsCents ?? null; break;
    case "gross_profit_cents": return row.costOfGoodsCents === null || row.costOfGoodsCents === undefined ? null : boundedBigInteger(BigInt(safeInteger(row.netSalesCents)) - BigInt(safeInteger(row.costOfGoodsCents)));
  }
  const spec = fields.find(item => item.field === field)!;
  if (value === null && spec.nullable) return null;
  if (spec.type === "text" || spec.type === "date") {
    if (typeof value !== "string" || !value || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value) || (spec.type === "date" && !isCalendarDate(value)) || (field === "source_kind" && value !== "owner_summary" && value !== "provider_summary")) fail("STUDIO_SQL_SOURCE", "A recorded text or date field needs review before querying.");
    return value;
  }
  if (typeof value !== "number") fail("STUDIO_SQL_SOURCE", "A required numeric source value is missing.");
  safeInteger(value);
  if (field === "transaction_count" && value < 0) fail("STUDIO_SQL_SOURCE", "A recorded transaction count must be nonnegative.");
  return value;
}
function compare(left: StudioQueryValue, right: StudioQueryValue): number {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  return left < right ? -1 : 1;
}
function matches(row: Record<string, StudioQueryValue>, predicate: StudioQueryPredicate): boolean {
  const value = row[predicate.field];
  if (predicate.operator === "IS NULL") return value === null;
  if (predicate.operator === "IS NOT NULL") return value !== null;
  if (value === null || predicate.value === null) return false;
  const relation = compare(value, predicate.value);
  switch (predicate.operator) {
    case "=": return relation === 0;
    case "!=": case "<>": return relation !== 0;
    case "<": return relation < 0;
    case "<=": return relation <= 0;
    case ">": return relation > 0;
    case ">=": return relation >= 0;
  }
}
function aggregate(rows: Record<string, StudioQueryValue>[], projection: StudioQueryProjection): StudioQueryValue {
  if (projection.aggregate === "COUNT" && projection.field === "*") return rows.length;
  const values = rows.map(row => row[projection.field]).filter((value): value is string | number => value !== null);
  if (projection.aggregate === "COUNT") return values.length;
  if (!values.length) return null;
  if (projection.aggregate === "SUM") {
    const quantity = projection.field === "units_sold"; let sum = BigInt(0);
    for (const value of values) { const integer = quantity ? Math.round(Number(value) * 1000) : Number(value); sum += BigInt(safeInteger(integer)); boundedBigInteger(sum); }
    return boundedBigInteger(sum) / (quantity ? 1000 : 1);
  }
  return values.reduce((best, value) => (projection.aggregate === "MIN" ? compare(value, best) < 0 : compare(value, best) > 0) ? value : best);
}
/** Execute on a complete, already authorized review. Source rows stay in memory. */
export function runStudioQuery(review: StudioExecutiveReview, sql: string): StudioQueryResult {
  const plan = parseStudioQuery(review, sql);
  if (review.version !== "studio-v1" || review.metadata.truncated !== false || !Array.isArray(review.sales.rows) || review.metadata.rowCount !== review.sales.rows.length || review.sales.rows.length > STUDIO_SQL_LIMITS.sourceRows) fail("STUDIO_SQL_SNAPSHOT", "The recorded snapshot is incomplete or exceeds 2000 daily rows. Refresh a narrower review.");
  if (review.sales.state !== "recorded") fail("STUDIO_SQL_UNAVAILABLE", "Recorded sales are unavailable for this review. Choose a scope with available records.");
  const count = review.sales.rows.length;
  const estimatedOperations = count * (1 + plan.select.length + plan.where.length + plan.groupBy.length) + Math.ceil(count * Math.log2(Math.max(2, count))) * plan.orderBy.length;
  if (estimatedOperations > STUDIO_SQL_LIMITS.estimatedOperations) fail("STUDIO_SQL_COST", "The query exceeds the supported work budget. Reduce columns, comparisons or sorting.");
  const referenced = new Set<StudioQueryField>([...plan.select.flatMap(item => item.field === "*" ? [] : [item.field]), ...plan.where.map(item => item.field), ...plan.groupBy]);
  const permitted = new Map(studioQuerySchema(review).map(spec => [spec.field, spec]));
  const rows = review.sales.rows.map(row => Object.fromEntries([...referenced].map(field => [field, sourceValue(row, field)])) as Record<string, StudioQueryValue>).filter(row => plan.where.every(predicate => matches(row, predicate)));
  const warnings: string[] = [];
  for (const field of referenced) { const missing = rows.filter(row => row[field] === null).length; if (missing) warnings.push(`${field}: ${missing} of ${rows.length} matched daily rows have missing evidence. SUM, MIN, MAX and COUNT(field) use only known values.`); }
  const columnDetails = plan.select.map(item => ({ key: item.key, label: item.key, field: item.field, type: item.aggregate === "COUNT" ? "count" as const : permitted.get(item.field as StudioQueryField)!.type, aggregate: item.aggregate, nullable: item.aggregate === "COUNT" ? false : item.aggregate !== null || permitted.get(item.field as StudioQueryField)!.nullable }));
  const project = (group: Record<string, StudioQueryValue>[]) => Object.fromEntries(plan.select.map(item => [item.key, item.aggregate ? aggregate(group, item) : group[0][item.field]])) as Record<string, StudioQueryValue>;
  let result: Record<string, StudioQueryValue>[];
  if (plan.groupBy.length) {
    const groups = new Map<string, Record<string, StudioQueryValue>[]>();
    for (const row of rows) { const key = JSON.stringify(plan.groupBy.map(field => row[field])); const group = groups.get(key); if (group) group.push(row); else groups.set(key, [row]); }
    result = [...groups.values()].map(project);
  } else if (plan.select.some(item => item.aggregate)) result = [project(rows)];
  else result = rows.map(row => project([row]));
  if (plan.orderBy.length) result.sort((left, right) => { for (const item of plan.orderBy) { const relation = compare(left[item.key], right[item.key]); if (relation) return item.direction === "DESC" ? -relation : relation; } return 0; });
  const totalResultRows = result.length;
  const output: StudioQueryResult = { columns: plan.select.map(item => item.key), columnDetails, rows: result.slice(0, plan.limit), matchedRows: rows.length, totalResultRows, truncated: totalResultRows > plan.limit, plan, warnings, snapshotHash: review.metadata.snapshotHash, currency: review.metadata.currency, estimatedOperations };
  if (new TextEncoder().encode(JSON.stringify(output)).length > STUDIO_SQL_LIMITS.resultBytes) fail("STUDIO_SQL_RESULT_SIZE", "The result exceeds 2 MiB. Select fewer columns or lower LIMIT.");
  return output;
}

/** Recover all authorized source rows behind a query, retaining every WHERE
 * predicate. Grouping, result order and result LIMIT do not change lineage.
 * Reparse the original SQL first so revoked projection permissions still fail. */
export function studioQuerySourceRows(review: StudioExecutiveReview, sql: string): StudioSalesRow[] {
  const original = parseStudioQuery(review, sql);
  const sourcePlan: Omit<StudioQueryPlan, "normalizedSql"> = {
    version: "studio-sql-v1", table: "sales",
    select: [{ field: "record_id", aggregate: null, key: "record_id" }],
    where: original.where, groupBy: [], orderBy: [], limit: STUDIO_SQL_LIMITS.sourceRows,
  };
  // Go through the public parser and bounded execution path again. A parsed
  // plan is never treated as an unchecked execution capability.
  const result = runStudioQuery(review, normalize(sourcePlan));
  if (result.truncated) fail("STUDIO_SQL_SNAPSHOT", "Source query rows were incomplete. Refresh a narrower review.");
  const allIds = new Set<string>();
  for (const row of review.sales.rows) {
    if (allIds.has(row.id)) fail("STUDIO_SQL_SOURCE", "Source row identifiers must be unique before opening their source sheet.");
    allIds.add(row.id);
  }
  const matchedIds = new Set(result.rows.map(row => row.record_id));
  return review.sales.rows.filter(row => matchedIds.has(row.id));
}
