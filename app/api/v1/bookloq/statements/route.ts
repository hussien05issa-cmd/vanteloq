import { getD1, getR2 } from "../../../../../db";
import { requireAccess } from "../../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../server/api";
import { requirePermission } from "../../../../../server/permissions";
import { requireAddon } from "../../../../../server/entitlements/engine";
import { requireOrganizationWideLocationAccess } from "../../../../../server/location-access";
import { recordAudit } from "../../../../../server/audit";
import { businessClock } from "../../../../../domain/intraday-sales";
import { reviewedBankStatement, statementFingerprint, StatementInputError } from "../../../../../domain/bank-statement";
import { commitStatement, prepareStatement, statementAccounts, statementDocument, statementExtraction, statementImportContext, undoStatement, STATEMENT_BOUNDARY } from "../../../../../server/bank-statement";

const readers = ["owner", "admin", "manager", "employee", "read_only"] as const;
async function access(request: Request) {
  const context = await requireAccess(request, readers, "bookloq.transactions");
  await requireAddon(context, "bookloq");
  await requireOrganizationWideLocationAccess(context);
  for (const permission of ["documents.view", "documents.review", "finance.bank_transactions", "finance.bank_balances", "payroll.totals", "finance.reconcile"] as const) await requirePermission(context, permission);
  return context;
}
export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await access(request), database = getD1();
    await enforceRateLimit("bookloq:statements:read", context.userId, 90, 60);
    const configuration = await statementImportContext(database, context.organizationId, context.organization.currency);
    const accounts = await statementAccounts(database, context.organizationId, configuration.currency, configuration.demoRecord);
    const documents = await database.prepare("SELECT id,file_name fileName,document_type documentType,extraction_status='complete' extractionReady FROM workspace_documents WHERE organization_id=? AND document_type IN ('other','bank_statement') AND security_state='clean' AND scan_status='clean' AND status IN ('uploaded','review_required') ORDER BY created_at DESC LIMIT 100").bind(context.organizationId).all();
    const imports = await database.prepare("SELECT id,document_id documentId,bank_account_id bankAccountId,start_date startDate,end_date endDate,row_count rowCount,inflow_cents inflowCents,outflow_cents outflowCents,opening_balance_cents openingBalanceCents,closing_balance_cents closingBalanceCents,currency,demo_record demoRecord FROM bank_statement_imports WHERE organization_id=? AND status='approved' AND demo_record=? ORDER BY end_date DESC LIMIT 100").bind(context.organizationId, Number(configuration.demoRecord)).all();
    const documentId = new URL(request.url).searchParams.get("documentId");
    const document = documentId ? await statementDocument(database, getR2(), context.organizationId, documentId, true) : null;
    return jsonResponse({ ...configuration, accounts, documents: documents.results ?? [], imports: imports.results ?? [], extraction: document ? statementExtraction(document) : null, boundary: STATEMENT_BOUNDARY });
  });
}
export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await access(request), database = getD1();
    await enforceRateLimit("bookloq:statements:write", context.userId, 30, 3600);
    const body = await readJsonObject(request, 400_000);
    if (body.action === "undo") {
      if (typeof body.importId !== "string" || !body.importId || body.importId.length>80 || body.confirmation!=="UNDO IMPORT" || typeof body.reason!=="string" || !body.reason.trim() || body.reason.trim().length>1000 || /[\u0000-\u001f\u007f]/.test(body.reason)) throw new ApiError(400,"STATEMENT_UNDO_CONFIRMATION_REQUIRED","Enter a reason and type UNDO IMPORT to remove this import's unposted bank movements.");
      const imported = await undoStatement(database,context.organizationId,body.importId);
      await recordAudit({request,requestId,organizationId:context.organizationId,actorUserId:context.userId,action:"bank_statement.undone",resourceType:"bookloq_statement",resourceId:imported.id,details:{documentId:imported.documentId,bankAccountId:imported.bankAccountId,removedRows:imported.rowCount,periodStart:imported.startDate,periodEnd:imported.endDate,currency:imported.currency,reason:body.reason.trim(),postedToLedger:false}});
      return jsonResponse({undone:true,id:imported.id,removedRows:imported.rowCount,documentId:imported.documentId,postedToLedger:false});
    }
    if (body.action !== "preview" && body.action !== "confirm") throw new ApiError(400, "STATEMENT_ACTION_INVALID", "Preview the statement before confirming its import.");
    const configuration = await statementImportContext(database, context.organizationId, context.organization.currency);
    let input;
    try { input = reviewedBankStatement({ ...body, demoRecord: configuration.demoRecord }, businessClock(new Date(), context.organization.timezone)!.date); }
    catch (error) { if (error instanceof StatementInputError) throw new ApiError(400, "STATEMENT_INPUT_INVALID", error.message); throw error; }
    const fingerprint = await statementFingerprint(input);
    const prepared = await prepareStatement(database, getR2(), context.organizationId, input, context.organization.currency, body.documentKindConfirmed);
    if (prepared.prior) {
      if (prepared.prior.fingerprint !== fingerprint || prepared.prior.status !== "approved") throw new ApiError(409, "STATEMENT_ALREADY_IMPORTED", "This document already has a different import. Review its existing transactions.");
      if (body.action === "preview") return jsonResponse({ preview: input, previewFingerprint: fingerprint, replayed: true, statementCashEnabled: prepared.configuration.statementCashEnabled, boundary: STATEMENT_BOUNDARY });
      return jsonResponse({ imported: true, replayed: true, id: prepared.prior.id, rowCount: input.rowCount, postedToLedger: false, statementCashEnabled: prepared.configuration.statementCashEnabled, boundary: STATEMENT_BOUNDARY });
    }
    if (body.action === "preview") return jsonResponse({ preview: input, previewFingerprint: fingerprint, statementCashEnabled: prepared.configuration.statementCashEnabled, boundary: STATEMENT_BOUNDARY });
    if (body.reviewConfirmed !== true || body.previewFingerprint !== fingerprint) throw new ApiError(409, "STATEMENT_REVIEW_REQUIRED", "Review the exact statement preview and confirm its account, dates, rows and balances before importing.");
    const result = await commitStatement(database, context.organizationId, context.userId, input, fingerprint, prepared.account ?? null);
    await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "bank_statement.imported", resourceType: "bookloq_statement", resourceId: result.id, details: { documentId: input.documentId, bankAccountId: result.bankAccountId, rowCount: input.rowCount, periodStart: input.startDate, periodEnd: input.endDate, currency: input.currency, postedToLedger: false } });
    return jsonResponse({ imported: true, ...result, statementCashEnabled: prepared.configuration.statementCashEnabled, boundary: STATEMENT_BOUNDARY }, { status: 201 });
  });
}
