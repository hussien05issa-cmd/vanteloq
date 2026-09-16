import { ApiError } from "./api.ts";
import { readProcessing } from "./document-processing.ts";
import type { ReviewedBankStatement } from "../domain/bank-statement.ts";

export const STATEMENT_BOUNDARY = "Reviewed statement imports add historical bank movements only. They do not post journals, establish profit, or turn a dated closing balance into available cash. Statement activity is withheld while an approved Plaid feed is active to prevent duplicate reporting.";
type StatementDocument = { id: string; fileName: string; documentType: string; objectKey: string; securityState: string; scanStatus: string; status: string; extractedJson: string; extractionStatus: string };
export type StatementAccount = { id: string; financialAccountId: string; name: string; institutionName: string; maskedNumber: string; currency: string; accountType: string; provider: string; connectionStatus: string; demoRecord: number; active: number };

export async function statementDocument(database: D1Database, bucket: R2Bucket, organizationId: string, documentId: string, allowApproved = false) {
  const document = await database.prepare(`SELECT id,file_name fileName,document_type documentType,object_key objectKey,security_state securityState,scan_status scanStatus,status,extracted_json extractedJson,extraction_status extractionStatus FROM workspace_documents WHERE organization_id=? AND id=?`).bind(organizationId, documentId).first<StatementDocument>();
  if (!document) throw new ApiError(404, "STATEMENT_DOCUMENT_NOT_FOUND", "Select a bank statement uploaded to this workspace.");
  if (!["bank_statement", "other"].includes(document.documentType)) throw new ApiError(400, "STATEMENT_DOCUMENT_TYPE", "Choose a bank statement document.");
  if (document.securityState !== "clean" || document.scanStatus !== "clean" || !["uploaded", "review_required", ...(allowApproved ? ["approved"] : [])].includes(document.status)) throw new ApiError(409, "STATEMENT_DOCUMENT_UNAVAILABLE", "The statement must pass security scanning and remain available for review.");
  const stored = await bucket.get(document.objectKey);
  if (!stored || stored.customMetadata?.organizationId !== organizationId || stored.customMetadata?.securityState !== "clean") throw new ApiError(409, "STATEMENT_DOCUMENT_UNAVAILABLE", "The original statement is unavailable or its security scan is incomplete.");
  return document;
}

export async function statementAccounts(database: D1Database, organizationId: string, currency: string, demoRecord: boolean) {
  const result = await database.prepare(`SELECT b.id,b.financial_account_id financialAccountId,b.name,b.institution_name institutionName,b.masked_number maskedNumber,b.currency,b.account_type accountType,b.provider,b.connection_status connectionStatus,b.demo_record demoRecord,a.active FROM bank_accounts b JOIN financial_accounts a ON a.id=b.financial_account_id AND a.organization_id=b.organization_id WHERE b.organization_id=? AND UPPER(b.currency)=? AND b.demo_record=? AND b.provider='manual' AND b.connection_status='manual' AND b.account_type IN ('chequing','savings','merchant') AND a.active=1 AND a.account_type='asset' ORDER BY b.name`).bind(organizationId, currency, Number(demoRecord)).all<StatementAccount>();
  return result.results ?? [];
}

export async function statementImportContext(database: D1Database, organizationId: string, defaultCurrency: string) {
  const settings = await database.prepare("SELECT base_currency currency,data_mode dataMode FROM bookloq_settings WHERE organization_id=?").bind(organizationId).first<{ currency: string; dataMode: string }>();
  const plaid = await database.prepare("SELECT id FROM integration_connections WHERE organization_id=? AND provider='plaid' AND status='connected' AND data_promotion_status='approved' LIMIT 1").bind(organizationId).first();
  return { currency: (settings?.currency ?? defaultCurrency).toUpperCase(), demoRecord: settings?.dataMode === "demonstration", statementCashEnabled: !plaid };
}

export async function prepareStatement(database: D1Database, bucket: R2Bucket, organizationId: string, input: ReviewedBankStatement, defaultCurrency: string, documentKindConfirmed: unknown) {
  const configuration = await statementImportContext(database, organizationId, defaultCurrency);
  if (input.currency !== configuration.currency || input.demoRecord !== configuration.demoRecord) throw new ApiError(400, "STATEMENT_SCOPE_MISMATCH", "Use the workspace base currency and current live or demonstration data mode.");
  const document = await statementDocument(database, bucket, organizationId, input.documentId, true);
  if (document.documentType === "other" && documentKindConfirmed !== "bank_statement") throw new ApiError(400, "STATEMENT_KIND_CONFIRMATION_REQUIRED", "Confirm that this uploaded document is a bank statement.");
  const prior = await database.prepare("SELECT id,fingerprint,status FROM bank_statement_imports WHERE organization_id=? AND document_id=?").bind(organizationId, input.documentId).first<{ id: string; fingerprint: string; status: string }>();
  if (document.status === "approved" && !prior) throw new ApiError(409, "STATEMENT_DOCUMENT_UNAVAILABLE", "This document has already been approved for another workflow.");
  const account = input.bankAccountId ? (await statementAccounts(database, organizationId, configuration.currency, configuration.demoRecord)).find(item => item.id === input.bankAccountId) : null;
  if (input.bankAccountId && !account) throw new ApiError(409, "STATEMENT_ACCOUNT_UNAVAILABLE", "Select an active manual cash account. Plaid accounts and credit accounts cannot receive statement imports.");
  if (!prior && account) {
    const overlap = await database.prepare("SELECT id FROM bank_statement_imports WHERE organization_id=? AND bank_account_id=? AND start_date<=? AND end_date>=? LIMIT 1").bind(organizationId, account.id, input.endDate, input.startDate).first();
    if (overlap) throw new ApiError(409, "STATEMENT_PERIOD_OVERLAP", "This account already has an imported statement covering part of these dates. Review the existing import instead of adding duplicate movements.");
  }
  if (!prior && input.newAccount) {
    const duplicate = await database.prepare("SELECT id FROM bank_accounts WHERE organization_id=? AND lower(trim(institution_name))=lower(?) AND substr(masked_number,-4)=? AND currency=? AND demo_record=? LIMIT 1").bind(organizationId, input.newAccount.institutionName, input.newAccount.last4, input.currency, Number(input.demoRecord)).first();
    if (duplicate) throw new ApiError(409, "STATEMENT_ACCOUNT_EXISTS", "An account with this institution and last 4 digits already exists. Select it if it is manual; do not duplicate a connected bank account.");
  }
  return { configuration, document, account, prior };
}

export function statementExtraction(document: StatementDocument) {
  return document.extractionStatus === "complete" ? readProcessing(document.extractedJson).extraction ?? null : null;
}

export async function commitStatement(database: D1Database, organizationId: string, userId: string, input: ReviewedBankStatement, fingerprint: string, account: StatementAccount | null) {
  const id = `bs_${fingerprint.slice(0, 32)}`, bankAccountId = account?.id ?? `bank_${id}`, financialAccountId = account?.financialAccountId ?? `account_${id}`;
  const now = Math.floor(Date.now() / 1000);
  const statements: D1PreparedStatement[] = [];
  if (input.newAccount) {
    statements.push(database.prepare(`INSERT INTO financial_accounts(id,organization_id,code,name,account_type,account_subtype,normal_balance,description,plain_language,created_at,updated_at) VALUES (?,?,?,?,'asset','cash','debit','Manual bank statement account','Historical bank movements. Statement balances are not live cash availability.',?,?)`).bind(financialAccountId, organizationId, `BS-${fingerprint.slice(0, 10)}`, input.newAccount.name, now, now));
    statements.push(database.prepare(`INSERT INTO bank_accounts(id,organization_id,financial_account_id,name,account_type,institution_name,masked_number,currency,provider,connection_status,demo_record,created_at,updated_at) VALUES (?,?,?,?,'chequing',?,?,?,'manual','manual',?,?,?)`).bind(bankAccountId, organizationId, financialAccountId, input.newAccount.name, input.newAccount.institutionName, `••••${input.newAccount.last4}`, input.currency, Number(input.demoRecord), now, now));
  }
  statements.push(database.prepare(`INSERT INTO bank_statement_imports(id,organization_id,document_id,bank_account_id,financial_account_id,start_date,end_date,currency,opening_balance_cents,closing_balance_cents,row_count,inflow_cents,outflow_cents,fingerprint,demo_record,status,approved_by_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'staging',?,?)`).bind(id, organizationId, input.documentId, bankAccountId, financialAccountId, input.startDate, input.endDate, input.currency, input.openingBalanceCents, input.closingBalanceCents, input.rowCount, input.inflowCents, input.outflowCents, fingerprint, Number(input.demoRecord), userId, now));
  const rows = JSON.stringify(input.rows.map((row, index) => ({ ...row, id: `${id}:${index + 1}`, rowNumber: index + 1 })));
  statements.push(database.prepare(`INSERT INTO financial_transactions(id,organization_id,transaction_date,posting_date,description,original_description,amount_cents,currency,account_id,source_system,external_source_id,source_state,location_ref,reconciliation_status,categorization_status,confidence_basis_points,approval_status,demo_record,created_at,updated_at) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.postingDate'),json_extract(value,'$.postingDate'),json_extract(value,'$.description'),json_extract(value,'$.description'),json_extract(value,'$.amountCents'),?,?,'bank_statement',json_extract(value,'$.id'),'posted','all','unreconciled','missing',0,'approved',?,?,? FROM json_each(?)`).bind(organizationId, input.currency, financialAccountId, Number(input.demoRecord), now, now, rows));
  statements.push(database.prepare("INSERT INTO bank_statement_rows(import_id,transaction_id,row_number) SELECT ?,json_extract(value,'$.id'),json_extract(value,'$.rowNumber') FROM json_each(?)").bind(id, rows));
  statements.push(database.prepare("UPDATE bank_statement_imports SET status='approved' WHERE id=? AND organization_id=? AND status='staging'").bind(id, organizationId));
  statements.push(database.prepare("UPDATE workspace_documents SET status='approved',updated_at=? WHERE id=? AND organization_id=?").bind(now, input.documentId, organizationId));
  try { await database.batch(statements); }
  catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = ["STATEMENT_DOCUMENT_UNAVAILABLE", "STATEMENT_ACCOUNT_UNAVAILABLE", "STATEMENT_PERIOD_OVERLAP", "STATEMENT_ACCOUNT_EXISTS"].find(code => message.includes(code));
    if (code || /UNIQUE constraint failed/.test(message)) throw new ApiError(409, code ?? "STATEMENT_ALREADY_IMPORTED", "The document, account or statement period changed or was already imported. Refresh and review the existing records.");
    throw error;
  }
  return { id, bankAccountId, rowCount: input.rowCount, postedToLedger: false };
}

export async function undoStatement(database: D1Database, organizationId: string, importId: string) {
  const imported = await database.prepare("SELECT id,document_id documentId,bank_account_id bankAccountId,start_date startDate,end_date endDate,row_count rowCount,currency FROM bank_statement_imports WHERE id=? AND organization_id=? AND status='approved'").bind(importId,organizationId).first<{ id:string;documentId:string;bankAccountId:string;startDate:string;endDate:string;rowCount:number;currency:string }>();
  if (!imported) throw new ApiError(404,"STATEMENT_IMPORT_NOT_FOUND","This approved statement import is unavailable or has already been undone.");
  try {
    // The deletion trigger rechecks every linked row, removes only this import's
    // unposted transactions and reopens its document in one database operation.
    const result = await database.prepare("DELETE FROM bank_statement_imports WHERE id=? AND organization_id=? AND status='approved'").bind(importId,organizationId).run();
    if (!result.meta.changes) throw new ApiError(404,"STATEMENT_IMPORT_NOT_FOUND","This statement import has already been undone.");
  } catch (error) {
    if (error instanceof Error && error.message.includes("STATEMENT_UNDO_REVIEW_REQUIRED")) throw new ApiError(409,"STATEMENT_UNDO_REVIEW_REQUIRED","This import has posted, matched, reconciled or changed records. Review and resolve those accounting links before undoing it.");
    throw error;
  }
  return imported;
}
