import type { StudioExecutiveReview } from "./data-studio.ts";

export const STUDIO_SHEET_MAX_CELLS = 32;
export const STUDIO_SHEET_MAX_INPUT = 256;
export const STUDIO_SHEET_MAX_SCALE = 12;
export type StudioSheetFormat = "number" | "money" | "percent";
export type StudioSheetCell = { address: string; name: string; input: string; format: StudioSheetFormat };
/** Only user-authored definitions belong in persistence. Source rows and calculated results never do. */
export type StudioSheetDraft = { version: "studio-sheet-v1"; title: string; cells: StudioSheetCell[] };
export type StudioSourceName = "NET_SALES" | "GROSS_PROFIT" | "TRANSACTIONS";
export const STUDIO_SHEET_SOURCE_NAMES: readonly StudioSourceName[] = ["NET_SALES", "GROSS_PROFIT", "TRANSACTIONS"];
export type StudioFormulaErrorCode = "SYNTAX" | "NAME" | "REFERENCE" | "EMPTY" | "CYCLE" | "DIV_ZERO" | "PRECISION" | "LIMIT" | "TYPE" | "MISSING_SOURCE" | "RESTRICTED";
export type StudioFormulaResult =
  | { state: "value"; value: string; code?: never; message?: never }
  | { state: "error"; code: StudioFormulaErrorCode; message: string; value?: never };
export type StudioSheetCalculation = {
  snapshotHash: string; cells: Record<string, StudioFormulaResult>; sources: Record<StudioSourceName, StudioFormulaResult>;
};

export class StudioSheetValidationError extends Error {
  constructor(message: string) { super(message); this.name = "StudioSheetValidationError"; }
}
const addressPattern = /^[A-Z][1-9][0-9]?$/;
const printable = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const hasOnly = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key));
/** Validate at the persistence boundary as well as in the UI. Refuse extra keys rather than storing source payloads. */
export function validateStudioSheetDraft(value: unknown): StudioSheetDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new StudioSheetValidationError("Choose a valid assumption sheet.");
  const raw = value as Record<string, unknown>;
  if (!hasOnly(raw, ["version", "title", "cells"]) || raw.version !== "studio-sheet-v1" || !printable(raw.title, 80) || !Array.isArray(raw.cells) || raw.cells.length < 1 || raw.cells.length > STUDIO_SHEET_MAX_CELLS) {
    throw new StudioSheetValidationError("An assumption sheet needs a title of up to 80 characters and 1 to 32 declared cells.");
  }
  const seen = new Set<string>();
  const cells = raw.cells.map((item): StudioSheetCell => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new StudioSheetValidationError("Each assumption needs a valid cell definition.");
    const cell = item as Record<string, unknown>;
    if (!hasOnly(cell, ["address", "name", "input", "format"]) || typeof cell.address !== "string" || !addressPattern.test(cell.address) || seen.has(cell.address) || !printable(cell.name, 40) || !printable(cell.input, STUDIO_SHEET_MAX_INPUT) || typeof cell.format !== "string" || !["number", "money", "percent"].includes(cell.format)) {
      throw new StudioSheetValidationError("Use unique A1 to Z99 addresses, names of up to 40 characters and values or formulas of up to 256 characters.");
    }
    seen.add(cell.address);
    return { address: cell.address, name: cell.name, input: cell.input, format: cell.format as StudioSheetFormat };
  });
  return { version: "studio-sheet-v1", title: raw.title, cells };
}

export function createStudioSheetDraft(): StudioSheetDraft {
  return { version: "studio-sheet-v1", title: "Gross Profit Scenario", cells: [
    { address: "A1", name: "Sales growth assumption", input: "0.05", format: "percent" },
    { address: "A2", name: "Cost growth assumption", input: "0.03", format: "percent" },
    { address: "A3", name: "Additional operating costs", input: "0", format: "money" },
    { address: "A4", name: "Scenario net sales", input: "=NET_SALES*(1+A1)", format: "money" },
    { address: "A5", name: "Recorded cost of goods", input: "=NET_SALES-GROSS_PROFIT", format: "money" },
    { address: "A6", name: "Scenario cost of goods", input: "=A5*(1+A2)", format: "money" },
    { address: "A7", name: "Scenario gross profit", input: "=A4-A6", format: "money" },
    { address: "A8", name: "After additional operating costs", input: "=A7-A3", format: "money" },
  ] };
}

type Decimal = { units: bigint; scale: number };
const zero = BigInt(0), one = BigInt(1), ten = BigInt(10);
const maxDigits = 40;
const pow10 = (scale: number) => ten ** BigInt(scale);
class FormulaIssue extends Error {
  constructor(readonly code: StudioFormulaErrorCode, message: string) { super(message); this.name = "FormulaIssue"; }
}
function decimal(units: bigint, scale: number): Decimal {
  while (scale > 0 && units % ten === zero) { units /= ten; scale--; }
  if (scale > STUDIO_SHEET_MAX_SCALE) throw new FormulaIssue("PRECISION", "This calculation needs more than 12 decimal places. Change the inputs; no result was rounded.");
  if (String(units < zero ? -units : units).length > maxDigits) throw new FormulaIssue("LIMIT", "This calculation exceeds the 40-digit exact value limit.");
  return { units, scale };
}
function literal(text: string): Decimal {
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) throw new FormulaIssue("SYNTAX", "Enter a decimal number or begin a supported formula with =.");
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > STUDIO_SHEET_MAX_SCALE) throw new FormulaIssue("PRECISION", "Enter at most 12 decimal places.");
  return decimal(BigInt(`${whole || "0"}${fraction}`), fraction.length);
}
function decimalText(value: Decimal): string {
  const sign = value.units < zero ? "-" : "", digits = String(value.units < zero ? -value.units : value.units);
  if (!value.scale) return `${sign}${digits}`;
  const padded = digits.padStart(value.scale + 1, "0");
  return `${sign}${padded.slice(0, -value.scale)}.${padded.slice(-value.scale)}`;
}
function align(a: Decimal, b: Decimal): [bigint, bigint, number] {
  const scale = Math.max(a.scale, b.scale);
  return [a.units * pow10(scale - a.scale), b.units * pow10(scale - b.scale), scale];
}
function gcd(a: bigint, b: bigint): bigint {
  a = a < zero ? -a : a; b = b < zero ? -b : b;
  while (b !== zero) { const next = a % b; a = b; b = next; }
  return a;
}
function divide(a: Decimal, b: Decimal): Decimal {
  if (b.units === zero) throw new FormulaIssue("DIV_ZERO", "The divisor is zero. Choose a nonzero value or guard it with IF.");
  let numerator = a.units * pow10(b.scale), denominator = b.units * pow10(a.scale);
  if (denominator < zero) { numerator = -numerator; denominator = -denominator; }
  const factor = gcd(numerator, denominator); numerator /= factor; denominator /= factor;
  let twos = 0, fives = 0;
  while (denominator % BigInt(2) === zero) { denominator /= BigInt(2); twos++; }
  while (denominator % BigInt(5) === zero) { denominator /= BigInt(5); fives++; }
  const scale = Math.max(twos, fives);
  if (denominator !== one || scale > STUDIO_SHEET_MAX_SCALE) throw new FormulaIssue("PRECISION", "This division cannot be represented exactly within 12 decimal places. No result was rounded.");
  return decimal(numerator * BigInt(2) ** BigInt(scale - twos) * BigInt(5) ** BigInt(scale - fives), scale);
}
type Operator = "+" | "-" | "*" | "/" | "=" | "<>" | "<" | ">" | "<=" | ">=";
type Expression =
  | { kind: "number"; text: string }
  | { kind: "reference"; name: string }
  | { kind: "range"; start: string; end: string }
  | { kind: "unary"; op: "+" | "-"; value: Expression }
  | { kind: "binary"; op: Operator; left: Expression; right: Expression }
  | { kind: "call"; name: "SUM" | "IF"; args: Expression[] };
type Token = { kind: "number" | "name" | "symbol" | "end"; text: string };
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (let offset = 0; offset < text.length;) {
    const rest = text.slice(offset);
    const whitespace = /^\s+/.exec(rest); if (whitespace) { offset += whitespace[0].length; continue; }
    const numeric = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(rest);
    const name = /^[A-Za-z_][A-Za-z_0-9]*/.exec(rest);
    const symbol = /^(?:<>|<=|>=|[+*/=<>(),:\-])/.exec(rest);
    const match = numeric ?? name ?? symbol;
    if (!match) throw new FormulaIssue("SYNTAX", "Use decimal numbers, cell references, arithmetic, SUM or IF. This formula contains an unsupported character.");
    tokens.push({ kind: numeric ? "number" : name ? "name" : "symbol", text: match[0].toUpperCase() }); offset += match[0].length;
    if (tokens.length > 128) throw new FormulaIssue("LIMIT", "This formula exceeds the 128-token limit. Split it into separate cells.");
  }
  return [...tokens, { kind: "end", text: "" }];
}
function parse(input: string): Expression {
  const text = input.trim(); if (!text) throw new FormulaIssue("EMPTY", "This cell is empty. Enter a number or formula before using it.");
  if (!text.startsWith("=")) {
    const signed = /^([+-]?)(\d+(?:\.\d*)?|\.\d+)$/.exec(text);
    if (!signed) throw new FormulaIssue("SYNTAX", "Enter a decimal number or begin a supported formula with =.");
    const number: Expression = { kind: "number", text: signed[2] };
    return signed[1] === "-" ? { kind: "unary", op: "-", value: number } : number;
  }
  const tokens = tokenize(text.slice(1)); let position = 0, nesting = 0;
  const peek = () => tokens[position];
  const take = (text: string) => { if (peek().text !== text) return false; position++; return true; };
  const requireToken = (text: string) => { if (!take(text)) throw new FormulaIssue("SYNTAX", `Expected ${text} in this formula.`); };
  const primary = (): Expression => {
    if (++nesting > 40) throw new FormulaIssue("LIMIT", "This formula is nested too deeply. Split it into separate cells.");
    try {
      if (take("+") || take("-")) return { kind: "unary", op: tokens[position - 1].text as "+" | "-", value: primary() };
      if (take("(")) { const value = comparison(); requireToken(")"); return value; }
      const token = peek();
      if (token.kind === "number") { position++; return { kind: "number", text: token.text }; }
      if (token.kind === "name") {
        position++;
        if (take("(")) {
          if (token.text !== "SUM" && token.text !== "IF") throw new FormulaIssue("NAME", "Only SUM and IF functions are supported.");
          const args: Expression[] = [];
          if (!take(")")) { do { args.push(comparison()); } while (take(",")); requireToken(")"); }
          if ((token.text === "SUM" && args.length < 1) || (token.text === "IF" && args.length !== 3)) throw new FormulaIssue("SYNTAX", token.text === "IF" ? "IF needs a test, a true result and a false result." : "SUM needs at least one argument.");
          return { kind: "call", name: token.text, args };
        }
        if (take(":")) {
          const end = peek(); position++;
          if (!addressPattern.test(token.text) || end.kind !== "name" || !addressPattern.test(end.text)) throw new FormulaIssue("REFERENCE", "Use an A1 to Z99 cell range inside SUM.");
          return { kind: "range", start: token.text, end: end.text };
        }
        return { kind: "reference", name: token.text };
      }
      throw new FormulaIssue("SYNTAX", "This formula is incomplete. Check its numbers, operators and parentheses.");
    } finally { nesting--; }
  };
  const product = (): Expression => {
    let left = primary(); while (["*", "/"].includes(peek().text)) { const op = tokens[position++].text as Operator; left = { kind: "binary", op, left, right: primary() }; } return left;
  };
  const addition = (): Expression => {
    let left = product(); while (["+", "-"].includes(peek().text)) { const op = tokens[position++].text as Operator; left = { kind: "binary", op, left, right: product() }; } return left;
  };
  const comparison = (): Expression => {
    const left = addition(); if (!["=", "<>", "<", ">", "<=", ">="].includes(peek().text)) return left;
    const op = tokens[position++].text as Operator; return { kind: "binary", op, left, right: addition() };
  };
  const expression = comparison();
  if (peek().kind !== "end") throw new FormulaIssue("SYNTAX", "This formula contains extra or unsupported text.");
  return expression;
}
function asNumber(value: Decimal | boolean): Decimal {
  if (typeof value === "boolean") throw new FormulaIssue("TYPE", "Use a comparison as an IF test; calculation results must be numbers.");
  return value;
}
function issueResult(error: unknown): StudioFormulaResult {
  return error instanceof FormulaIssue ? { state: "error", code: error.code, message: error.message }
    : { state: "error", code: "SYNTAX", message: "This formula could not be calculated. Review its supported syntax." };
}
function sourceDecimal(name: StudioSourceName, review: StudioExecutiveReview): Decimal {
  if (name === "GROSS_PROFIT" && review.margin.state === "restricted") throw new FormulaIssue("RESTRICTED", "Gross profit and cost references require margin permission.");
  const summary = review.sales.summary;
  const amount = name === "NET_SALES" ? summary?.netSalesCents : name === "GROSS_PROFIT" ? summary?.grossProfitCents : summary?.transactionCount;
  if (review.sales.state !== "recorded" || (name === "GROSS_PROFIT" && review.margin.state !== "recorded") || amount === undefined || amount === null) {
    throw new FormulaIssue("MISSING_SOURCE", `${name} is unavailable for the current source scope. No substitute value was used.`);
  }
  if (!Number.isSafeInteger(amount) || (name === "TRANSACTIONS" && amount < 0)) throw new FormulaIssue("LIMIT", `${name} exceeds the supported exact source units. Review the source records.`);
  return decimal(BigInt(amount), name === "TRANSACTIONS" ? 0 : 2);
}

/** Safe bounded parser and exact decimal arithmetic. No eval, dynamic code, providers or workbook mutation. */
export function evaluateStudioSheet(value: StudioSheetDraft, review: StudioExecutiveReview): StudioSheetCalculation {
  const draft = validateStudioSheetDraft(value), definitions = new Map(draft.cells.map(cell => [cell.address, cell]));
  const cache = new Map<string, Decimal>(), errors = new Map<string, FormulaIssue>(), visiting = new Set<string>();
  const readCell = (address: string): Decimal => {
    const cached = cache.get(address); if (cached) return cached;
    const existingError = errors.get(address); if (existingError) throw existingError;
    if (visiting.has(address)) throw new FormulaIssue("CYCLE", `Circular reference includes ${address}. Remove the dependency loop.`);
    const cell = definitions.get(address); if (!cell) throw new FormulaIssue("REFERENCE", `${address} is not a declared assumption cell. Add it or correct the reference.`);
    visiting.add(address);
    try { const result = asNumber(evaluate(parse(cell.input))); cache.set(address, result); return result; }
    catch (error) { if (error instanceof FormulaIssue) errors.set(address, error); throw error; }
    finally { visiting.delete(address); }
  };
  const evaluate = (expression: Expression): Decimal | boolean => {
    switch (expression.kind) {
      case "number": return literal(expression.text);
      case "reference":
        if (STUDIO_SHEET_SOURCE_NAMES.includes(expression.name as StudioSourceName)) return sourceDecimal(expression.name as StudioSourceName, review);
        if (addressPattern.test(expression.name)) return readCell(expression.name);
        throw new FormulaIssue("NAME", `${expression.name} is not a supported source name or assumption cell.`);
      case "range": throw new FormulaIssue("TYPE", "Cell ranges are supported only as SUM arguments.");
      case "unary": { const value = asNumber(evaluate(expression.value)); return decimal(expression.op === "-" ? -value.units : value.units, value.scale); }
      case "binary": {
        const left = asNumber(evaluate(expression.left)), right = asNumber(evaluate(expression.right));
        if (expression.op === "*") return decimal(left.units * right.units, left.scale + right.scale);
        if (expression.op === "/") return divide(left, right);
        const [a, b, scale] = align(left, right);
        switch (expression.op) {
          case "+": return decimal(a + b, scale); case "-": return decimal(a - b, scale);
          case "=": return a === b; case "<>": return a !== b; case "<": return a < b; case ">": return a > b; case "<=": return a <= b; case ">=": return a >= b;
        }
      }
      case "call": {
        if (expression.name === "IF") {
          const test = evaluate(expression.args[0]), truth = typeof test === "boolean" ? test : test.units !== zero;
          return evaluate(expression.args[truth ? 1 : 2]);
        }
        let total = decimal(zero, 0);
        const add = (value: Decimal) => { const [a, b, scale] = align(total, value); total = decimal(a + b, scale); };
        for (const arg of expression.args) {
          if (arg.kind !== "range") { add(asNumber(evaluate(arg))); continue; }
          const firstColumn = arg.start.charCodeAt(0), lastColumn = arg.end.charCodeAt(0), firstRow = Number(arg.start.slice(1)), lastRow = Number(arg.end.slice(1));
          if (firstColumn > lastColumn || firstRow > lastRow) throw new FormulaIssue("REFERENCE", "A SUM range must run from its upper left cell to its lower right cell.");
          if ((lastColumn - firstColumn + 1) * (lastRow - firstRow + 1) > STUDIO_SHEET_MAX_CELLS) throw new FormulaIssue("LIMIT", "A SUM range can contain at most 32 declared cells.");
          for (let column = firstColumn; column <= lastColumn; column++) for (let row = firstRow; row <= lastRow; row++) add(readCell(`${String.fromCharCode(column)}${row}`));
        }
        return total;
      }
    }
  };
  const cells: Record<string, StudioFormulaResult> = {};
  for (const cell of draft.cells) { try { cells[cell.address] = { state: "value", value: decimalText(readCell(cell.address)) }; } catch (error) { cells[cell.address] = issueResult(error); } }
  const sources = Object.fromEntries(STUDIO_SHEET_SOURCE_NAMES.map(name => {
    try { return [name, { state: "value", value: decimalText(sourceDecimal(name, review)) }]; } catch (error) { return [name, issueResult(error)]; }
  })) as Record<StudioSourceName, StudioFormulaResult>;
  return { snapshotHash: review.metadata.snapshotHash, cells, sources };
}

/** Presentation rounding is separate from calculation. Currency and percentages display two decimal places. */
export function formatStudioDecimal(text: string, format: StudioSheetFormat, currency: string): string {
  const sign = text.startsWith("-") ? "-" : "", unsigned = sign ? text.slice(1) : text;
  const [whole, fraction = ""] = unsigned.split(".");
  let units = BigInt(`${whole}${fraction}`), scale = fraction.length;
  if (format === "percent") units *= BigInt(100);
  if (format !== "number") {
    if (scale > 2) { const factor = pow10(scale - 2); units = (units + factor / BigInt(2)) / factor; }
    else units *= pow10(2 - scale);
    scale = 2;
  }
  const digits = String(units).padStart(scale + 1, "0"), integer = scale ? digits.slice(0, -scale) : digits;
  const decimals = scale ? `.${digits.slice(-scale)}` : "";
  const display = `${units === zero ? "" : sign}${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${decimals}`;
  return format === "money" ? `${currency} ${display}` : format === "percent" ? `${display}%` : display;
}
