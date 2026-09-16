import { isCalendarDate } from "./calendar-date.ts";

export class StatementInputError extends Error {}
export type StatementRow = { postingDate: string; description: string; amountCents: number };
export type ReviewedBankStatement = {
  documentId: string; bankAccountId: string | null;
  newAccount: { name: string; institutionName: string; last4: string } | null;
  currency: string; startDate: string; endDate: string;
  openingBalanceCents: number; closingBalanceCents: number; demoRecord: boolean;
  rows: StatementRow[]; rowCount: number; inflowCents: number; outflowCents: number; netCashFlowCents: number; differenceCents: number;
};
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function text(value: unknown, label: string, limit: number) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > limit || /[\u0000-\u001f\u007f]/.test(value)) throw new StatementInputError(`Enter a valid ${label}.`);
  return value.trim().normalize("NFC");
}
function cents(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new StatementInputError(`${label} must use exact whole cents.`);
  return value;
}
function add(a: number, b: number) { return cents(a + b, "Statement total"); }

/** Normalize reviewed input only. OCR text is never treated as approved bank activity. */
export function reviewedBankStatement(value: unknown, asOf: string): ReviewedBankStatement {
  const input = object(value);
  if (!isCalendarDate(asOf) || !isCalendarDate(input.startDate) || !isCalendarDate(input.endDate) || input.startDate > input.endDate || input.endDate > asOf) throw new StatementInputError("Choose a valid statement period that does not end in the future.");
  const startDate = input.startDate, endDate = input.endDate;
  const currency = text(input.currency, "currency", 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new StatementInputError("Choose a valid statement currency.");
  const documentId = text(input.documentId, "document", 80);
  const bankAccountId = input.bankAccountId ? text(input.bankAccountId, "bank account", 80) : null;
  const account = input.newAccount ? object(input.newAccount) : null;
  if (Boolean(bankAccountId) === Boolean(account)) throw new StatementInputError("Select an existing account or create one manual account.");
  const newAccount = account ? { name: text(account.name, "account name", 100), institutionName: text(account.institutionName, "institution name", 100).replace(/\s+/g, " "), last4: text(account.last4, "last 4 account digits", 4) } : null;
  if (newAccount && !/^\d{4}$/.test(newAccount.last4)) throw new StatementInputError("Enter only the last 4 account digits.");
  if (input.demoRecord !== undefined && typeof input.demoRecord !== "boolean") throw new StatementInputError("Choose the statement data mode.");
  if (!Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > 500) throw new StatementInputError("Review 1 to 500 statement transactions per import.");
  const rows = input.rows.map((raw): StatementRow => {
    const row = object(raw);
    if (!isCalendarDate(row.postingDate) || row.postingDate < startDate || row.postingDate > endDate) throw new StatementInputError("Every transaction date must fall inside the statement period.");
    if (row.currency !== undefined && row.currency !== currency) throw new StatementInputError("A statement must contain one currency.");
    const amountCents = cents(row.amountCents, "Transaction amount");
    if (amountCents === 0) throw new StatementInputError("Remove empty or zero-amount rows. Keep every actual bank movement.");
    return { postingDate: row.postingDate, description: text(row.description, "transaction description", 300), amountCents };
  });
  const inflowCents = rows.filter(row => row.amountCents > 0).reduce((sum, row) => add(sum, row.amountCents), 0);
  const outflowCents = rows.filter(row => row.amountCents < 0).reduce((sum, row) => add(sum, -row.amountCents), 0);
  const openingBalanceCents = cents(input.openingBalanceCents, "Opening balance"), closingBalanceCents = cents(input.closingBalanceCents, "Closing balance");
  const netCashFlowCents = add(inflowCents, -outflowCents), differenceCents = add(add(openingBalanceCents, netCashFlowCents), -closingBalanceCents);
  if (differenceCents !== 0) throw new StatementInputError("Opening balance plus money in minus money out must equal the closing balance exactly. Review missing, duplicated or misread rows.");
  return { documentId, bankAccountId, newAccount, currency, startDate: input.startDate, endDate: input.endDate, openingBalanceCents, closingBalanceCents, demoRecord: input.demoRecord === true, rows, rowCount: rows.length, inflowCents, outflowCents, netCashFlowCents, differenceCents };
}

export async function statementFingerprint(input: ReviewedBankStatement) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(input)));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}
