import { recordedLabourCost } from "../../../../../domain/labour-evidence";
import { advisorProviderStatus, callAdvisor } from "../../../../../server/advisor-providers";
import { prepareAdvisorAttachments, readAdvisorRequest } from "../../../../../server/advisor-attachments";
import { ADVISOR_ATTACHMENT_NOTICE_VERSION } from "../../../../../shared/advisor-attachments";
import { isAdvisorMode } from "../../../../../domain/advisor-providers";
import { advisorKpis, advisorDailySeries, type AdvisorDay } from "../../../../../domain/advisor-kpis";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb, getD1, getRuntimeEnv } from "../../../../../db";
import { dailyBusinessMetrics, integrationConnections, bankAccounts } from "../../../../../db/schema";
import { requireAccess, requirePrivacyAccess } from "../../../../../server/authorization";
import { ApiError, clientSource, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../server/api";
import { effectivePermissions, requirePermission } from "../../../../../server/permissions";
import { authorizedLocationDataScope } from "../../../../../server/location-access";
import { approvedBankSource, approvedFactSource } from "../../../../../server/integrations/trusted-data";
import { recordAudit } from "../../../../../server/audit";
import { requireAdvisorConsent } from "../../../../../server/privacy";
import { assertAdvisorAuthority, captureAdvisorAuthority, completeAdvisorTurn } from "../../../../../server/advisor-completion";
import { sessionLeaseId } from "../../../../../server/session-policy";
import { advisorMarketingEvidence } from "../../../../../server/marketing-evidence";
import { advisorEvidenceFingerprint, advisorHistoryFingerprint, permittedAdvisorMemory, type AdvisorHistoryScope } from "../../../../../domain/advisor-memory";
import { projectAdvisorBookloq } from "../../../../../domain/advisor-bookloq";
import { GET as readBookloq } from "../../bookloq/route";
import { GET as readRetail } from "../../retail-intelligence/route";
import { projectAdvisorRetail } from "../../../../../domain/advisor-retail";
import { advisorUnavailableReason } from "../../../../../domain/advisor-availability";
import { retailPeriod } from "../../../../../server/retail-intelligence";
import {
  ADVISOR_CONSENT_NOTICE_VERSION,
  PRIVACY_POLICY_VERSION,
} from "../../../../../domain/privacy-controls";

const readers = ["owner", "admin", "manager", "employee", "read_only"] as const;


type Evidence = {
  retail?: ReturnType<typeof projectAdvisorRetail> | { status: "unavailable"; reason: string };
  requestedRetailPeriod?: { from: string; to: string };
  purpose?: "analysis" | "help";
  bookloq?: ReturnType<typeof projectAdvisorBookloq>;
  currency: string;
  scope?: "selected_location" | "organization" | "permitted_locations";
  marketing?: Awaited<ReturnType<typeof advisorMarketingEvidence>>;
  latestDate: string | null;
  days: Array<{ date: string; netSalesCents: number | null; grossProfitCents: number | null; transactions: number | null; discountsCents: number | null; refundsCents: number | null }>;
  sources: Array<{ provider: string; status: string; lastSyncAt: string | null }>;
  cashAvailableCents: number | null;
  kpis: ReturnType<typeof advisorKpis>;
};

function cleanQuestion(value: unknown) {
  if (typeof value !== "string") throw new ApiError(400, "QUESTION_REQUIRED", "Ask a question before analyzing.");
  const question = value.trim();
  if (!question || question.length > 800) throw new ApiError(400, "QUESTION_INVALID", "Use a question between 1 and 800 characters.");
  if (/[\w.+-]+@[\w.-]+\.[a-z]{2,}|https?:\/\/|\b(?:sk-|AIza)[a-zA-Z0-9_-]{12,}|\b\d{9,}\b/i.test(question)) {
    throw new ApiError(400, "QUESTION_SENSITIVE_DATA", "Remove email addresses, links, account numbers and credentials from your question. Ask about aggregate business measures instead.");
  }
  return question;
}

function cleanConversationId(value: unknown) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{8,80}$/.test(value)) {
    throw new ApiError(400, "CONVERSATION_ID_INVALID", "Choose a valid advisor conversation.");
  }
  return value;
}

async function evidenceFor(
  organizationId: string,
  locationRefs: string[] | null,
  includeRevenue: boolean,
  includeProfit: boolean,
  includeCash: boolean,
  permissions: readonly string[],
  currency: string,
): Promise<Evidence> {
  const db = getDb();
  const metricScope = and(
    eq(dailyBusinessMetrics.organizationId, organizationId),
    locationRefs === null ? undefined : locationRefs.length ? inArray(dailyBusinessMetrics.locationRef, locationRefs) : sql`0 = 1`,
    approvedFactSource(dailyBusinessMetrics.organizationId, dailyBusinessMetrics.sourceProvider, dailyBusinessMetrics.sourceConnectionId),
  );
  const [latest] = await db.select({ date: dailyBusinessMetrics.businessDate }).from(dailyBusinessMetrics).where(metricScope).orderBy(desc(dailyBusinessMetrics.businessDate)).limit(1);
  const startDate = latest ? new Date(Date.parse(`${latest.date}T00:00:00Z`) - 55 * 86400000).toISOString().slice(0, 10) : "9999-12-31";
  const rows = await db.select({
    sourceProvider: dailyBusinessMetrics.sourceProvider,
    sourceConnectionId: dailyBusinessMetrics.sourceConnectionId,
    businessDate: dailyBusinessMetrics.businessDate,
    netSalesCents: dailyBusinessMetrics.netSalesCents,
    costOfGoodsCents: dailyBusinessMetrics.costOfGoodsCents,
    transactionCount: dailyBusinessMetrics.transactionCount,
    discountsCents: dailyBusinessMetrics.discountsCents,
    refundsCents: dailyBusinessMetrics.refundsCents,
    locationRef: dailyBusinessMetrics.locationRef,
    unitsSold: dailyBusinessMetrics.unitsSold,
    labourCostCents: dailyBusinessMetrics.labourCostCents,
    labourCostReported: dailyBusinessMetrics.labourCostReported,
    inventoryValueCents: dailyBusinessMetrics.inventoryValueCents,
    accountsPayableCents: dailyBusinessMetrics.accountsPayableCents,
  }).from(dailyBusinessMetrics).where(and(metricScope, gte(dailyBusinessMetrics.businessDate, startDate))).orderBy(desc(dailyBusinessMetrics.businessDate)).limit(5001);
  if (rows.length > 5000) throw new ApiError(413, "ADVISOR_EVIDENCE_LIMIT", "The available evidence exceeds the safe analysis limit. Ask your administrator to narrow the reporting scope.");
  if (rows.some(row => row.locationRef === "all" && rows.some(other => other.businessDate === row.businessDate && other.locationRef !== "all"))) throw new ApiError(409, "ADVISOR_SOURCE_OVERLAP", "Organization and location summaries overlap. Reconcile their scope before requesting AI analysis.");
  // Attribution follows the actual permitted rows, not every connected account.
  // Excluded test accounts and other locations must not look like evidence sources.
  const connectionIds = [...new Set(rows.flatMap(row => row.sourceConnectionId ? [row.sourceConnectionId] : []))];
  const connections = connectionIds.length ? await db.select({ provider: integrationConnections.provider, status: integrationConnections.status, lastSyncAt: integrationConnections.lastSuccessfulSyncAt }).from(integrationConnections).where(and(eq(integrationConnections.organizationId, organizationId), inArray(integrationConnections.id, connectionIds))) : [];
  const recordedSources = [...new Set(rows.filter(row => !row.sourceConnectionId).map(row => row.sourceProvider ?? "Recorded business summaries"))];
  let cashAvailableCents: number | null = null;
  if (includeCash) {
    const accounts = await db.select({ available: bankAccounts.availableBalanceCents, live: bankAccounts.liveBalanceCents, lastSyncAt: bankAccounts.lastSyncAt, status: bankAccounts.connectionStatus }).from(bankAccounts).where(and(eq(bankAccounts.organizationId, organizationId), eq(bankAccounts.provider, "plaid"), eq(bankAccounts.currency, currency), inArray(bankAccounts.accountType, ["chequing", "savings"]), approvedBankSource(bankAccounts.organizationId, bankAccounts.provider, bankAccounts.externalItemRef)));
    if (accounts.length && accounts.every((row) => row.status === "healthy" && row.lastSyncAt && Date.now() - row.lastSyncAt.getTime() < 36 * 60 * 60 * 1000 && (row.available ?? row.live) !== null)) cashAvailableCents = accounts.reduce((sum, row) => sum + (row.available ?? row.live)!, 0);
  }
  const permittedRefs = locationRefs === null ? null : new Set(locationRefs);
  const days = [...rows].reverse()
    .filter((row) => permittedRefs === null || permittedRefs.has(row.locationRef))
    .map((row) => ({
      date: row.businessDate,
      locationRef: row.locationRef,
      unitsSold: includeRevenue ? row.unitsSold : null,
      labourCostCents: permissions.includes("payroll.totals") ? recordedLabourCost(row) : null,
      inventoryValueCents: permissions.includes("inventory.value") ? row.inventoryValueCents : null,
      accountsPayableCents: permissions.includes("finance.ap_ar") ? row.accountsPayableCents : null,
      netSalesCents: includeRevenue ? row.netSalesCents : null,
      grossProfitCents: includeProfit && (row.costOfGoodsCents !== 0 || row.netSalesCents === 0) ? row.netSalesCents - row.costOfGoodsCents : null,
      transactions: includeRevenue ? row.transactionCount : null,
      discountsCents: includeRevenue ? row.discountsCents : null,
      refundsCents: includeRevenue ? row.refundsCents : null,
    }));
  const kpis = advisorKpis(days as AdvisorDay[]);
  return { currency, latestDate: days.at(-1)?.date ?? null, kpis, days: advisorDailySeries(days), sources: [...connections.map((row) => ({ provider: row.provider, status: row.status, lastSyncAt: row.lastSyncAt?.toISOString() ?? null })), ...recordedSources.map(provider => ({ provider, status: "recorded", lastSyncAt: null }))], cashAvailableCents };
}

function prompt(question: string, evidence: Evidence, memory: Array<{ role: string; content: string }>) {
  return [
    `Question: ${JSON.stringify(question)}`,
    `Evidence JSON: ${JSON.stringify(evidence.purpose === "help" ? { purpose: "help", workspaceDataAttached: false } : evidence)}`,
    `Conversation memory: ${JSON.stringify(memory.slice(-6))}`,
  ].join("\n\n");
}

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, readers, "ai.basic");
    await requirePermission(context, "insights.view");
    return jsonResponse({ providers: advisorProviderStatus(getRuntimeEnv()) });
  });
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, readers, "ai.basic");
    await requirePermission(context, "insights.view");
    await enforceRateLimit("advisor:chat", `${context.userId}:${clientSource(request)}`, 20, 60);
    const { body, files } = await readAdvisorRequest(request);
    const question = cleanQuestion(body.question);
    if (body.purpose !== undefined && body.purpose !== "analysis" && body.purpose !== "help") throw new ApiError(400, "ADVISOR_PURPOSE_INVALID", "Choose a valid workspace-data setting.");
    const purpose = body.purpose === "help" ? "help" : "analysis";
    if (body.memoryEnabled !== undefined && typeof body.memoryEnabled !== "boolean") throw new ApiError(400, "ADVISOR_MEMORY_INVALID", "Choose whether to enable conversation memory.");
    // A file answer can reproduce private file contents. Never persist either
    // side of an attachment turn, even if a client forges memoryEnabled:true.
    const memoryEnabled = files.length === 0 && body.memoryEnabled === true;
    const mode = body.provider ?? "openai";
    if (!isAdvisorMode(mode)) throw new ApiError(400, "ADVISOR_PROVIDER_INVALID", "Vanteloq AI supports OpenAI only. Refresh the app and try again.");
    if (body.dataUseAccepted !== true) {
      throw new ApiError(409, "ADVISOR_CONSENT_REQUIRED", "Review and accept the Vanteloq AI data-use notice before asking a question.");
    }
    await requireAdvisorConsent({
      purpose,
      organizationId: context.organizationId,
      actorUserId: context.userId,
      noticeVersion: typeof body.noticeVersion === "string" ? body.noticeVersion : "",
      privacyPolicyVersion: typeof body.privacyPolicyVersion === "string" ? body.privacyPolicyVersion : "",
    });
    const attachments = await prepareAdvisorAttachments(files);
    const authorityActor = { organizationId: context.organizationId, userId: context.userId, role: context.role, subject: context.identity.subject!, sessionId: await sessionLeaseId(context) };
    const authorityStamp = await captureAdvisorAuthority(getD1(), authorityActor);
    const permissions = await effectivePermissions(context);
    if (body.locationId != null && (typeof body.locationId !== "string" || !body.locationId.trim() || body.locationId.length > 200)) throw new ApiError(400, "ADVISOR_LOCATION_INVALID", "Choose a valid reporting location.");
    const locationId = typeof body.locationId === "string" ? body.locationId : null;
    if ((body.from != null || body.to != null) && (typeof body.from !== "string" || typeof body.to !== "string")) throw new ApiError(400, "ADVISOR_PERIOD_INVALID", "Supply both reporting dates.");
    const requestedPeriod = typeof body.from === "string" && typeof body.to === "string" ? retailPeriod(body.from, body.to, context.organization.timezone) : null;
    const locationAccess = await authorizedLocationDataScope(context, locationId);
    const evidence: Evidence = purpose === "help" || requestedPeriod ? { currency: context.organization.currency, latestDate: null, days: [], sources: [], cashAvailableCents: null, kpis: advisorKpis([]) } : await evidenceFor(
      context.organizationId,
      locationAccess.locationRefs,
      permissions.includes("metrics.revenue"),
      permissions.includes("metrics.revenue") && permissions.includes("metrics.profit"),
      locationAccess.locationIds === null && locationAccess.organizationWide && permissions.includes("finance.bank_balances"),
      permissions,
      context.organization.currency,
    );
    evidence.scope = locationId ? "selected_location" : locationAccess.organizationWide ? "organization" : "permitted_locations";
    evidence.purpose = purpose;
    let retailCoverage: { sourceCount: number; days: number } | null = null;
    await Promise.all([
    (async () => {
    if (purpose === "analysis" && permissions.includes("metrics.revenue")) {
      const retailUrl = new URL("/api/v1/retail-intelligence", request.url);
      if (locationId) retailUrl.searchParams.set("location", locationId);
      if (requestedPeriod) { retailUrl.searchParams.set("from", requestedPeriod.from); retailUrl.searchParams.set("to", requestedPeriod.to); evidence.requestedRetailPeriod = { from: requestedPeriod.from, to: requestedPeriod.to }; }
      // Reuse all retail entitlement, source, location and redaction checks.
      const retailResponse = await readRetail(new Request(retailUrl, { headers: request.headers }));
      if (retailResponse.ok) {
        const retailBody = await retailResponse.json();
        evidence.retail = projectAdvisorRetail(retailBody.report);
        if (requestedPeriod) { evidence.latestDate = retailBody.report.days.at(-1)?.date ?? null; retailCoverage = { sourceCount: retailBody.source.sourceCount, days: retailBody.report.comparison.currentObservedDays }; }
      } else evidence.retail = { status: "unavailable", reason: advisorUnavailableReason("retail", await retailResponse.json().catch(() => null)) };
    }
    })(),
    (async () => {
      if (purpose === "analysis" && permissions.includes("marketing.view")) evidence.marketing = await advisorMarketingEvidence(context, locationId);
    })(),
    (async () => {
    if (purpose === "analysis") {
      evidence.bookloq = { status: "unavailable", reason: "Select All locations with the required BookLoQ and finance access to include organization-wide summaries." };
      if (locationAccess.organizationWide && locationAccess.locationIds === null && permissions.includes("finance.statements")) {
        // Reuse BookLoQ's complete authorization, entitlement and redaction path.
        // The allowlist strips identifiers and raw records before provider use.
        const bookloqResponse = await readBookloq(new Request(new URL("/api/v1/bookloq", request.url), { headers: request.headers }));
        if (bookloqResponse.ok) evidence.bookloq = projectAdvisorBookloq(await bookloqResponse.json());
        else evidence.bookloq = { status: "unavailable", reason: advisorUnavailableReason("bookloq", await bookloqResponse.json().catch(() => null)) };
      }
    }
    })(),
    ]);
    const suppliedId = memoryEnabled && body.conversationId != null ? cleanConversationId(body.conversationId) : null;
    const conversationId = suppliedId ?? crypto.randomUUID();
    const existingConversation = suppliedId ? await getD1().prepare("SELECT organization_id, user_id FROM assistant_conversations WHERE id = ?").bind(conversationId).first<{ organization_id: string; user_id: string }>() : null;
    if (suppliedId && (!existingConversation || existingConversation.organization_id !== context.organizationId || existingConversation.user_id !== context.userId)) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "This conversation is unavailable. Start a new chat.");
    const accessFingerprint = await advisorEvidenceFingerprint(evidence, [...permissions, `advisor-provider:${mode}`], locationAccess.locationRefs);
    const historyScope: AdvisorHistoryScope = { purpose, locationId, from: requestedPeriod?.from ?? null, to: requestedPeriod?.to ?? null };
    const authorityFingerprint = await advisorHistoryFingerprint(authorityStamp, historyScope);
    if (memoryEnabled) await getD1().prepare("DELETE FROM assistant_conversations WHERE organization_id = ? AND user_id = ? AND updated_at < ?").bind(context.organizationId, context.userId, Date.now() - 90 * 24 * 60 * 60 * 1_000).run();
    const memoryRows = memoryEnabled ? await getD1().prepare("SELECT role, content, evidence_json FROM assistant_messages WHERE conversation_id = ? AND organization_id = ? AND user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 6").bind(conversationId, context.organizationId, context.userId).all<{ role: string; content: string; evidence_json: string }>() : { results: [] };
    const memory = permittedAdvisorMemory(memoryRows.results ?? [], authorityFingerprint, "authorityFingerprint");
    const coverage = retailCoverage as { sourceCount: number; days: number } | null;
    const evidenceSummary = { latestDate: evidence.latestDate, sourceCount: coverage?.sourceCount ?? evidence.sources.length, days: coverage?.days ?? evidence.days.length };
    // Recheck current access before sending evidence, including a revocation
    // that happened between the initial access check and authority capture.
    const sendingAccess = await requireAccess(request, readers, "ai.basic");
    await requirePermission(sendingAccess, "insights.view");
    if (sendingAccess.organizationId !== context.organizationId || sendingAccess.userId !== context.userId)
      throw new ApiError(409, "ADVISOR_CONTEXT_CHANGED", "Your workspace access changed. Refresh before trying again.");
    // Consent may be withdrawn from another tab while evidence is loading.
    await requireAdvisorConsent({ organizationId: context.organizationId, actorUserId: context.userId, purpose, noticeVersion: body.noticeVersion, privacyPolicyVersion: body.privacyPolicyVersion });
    await assertAdvisorAuthority(getD1(), authorityActor, authorityStamp);
    if (files.length) await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "privacy.advisor_attachments_authorized", resourceType: "advisor_request", resourceId: requestId, details: { noticeVersion: ADVISOR_ATTACHMENT_NOTICE_VERSION, fileCount: files.length, bytes: files.reduce((sum, file) => sum + file.size, 0), provider: "openai", memoryEnabled: false } });
    const result = await callAdvisor(mode, prompt(question, evidence, memory), getRuntimeEnv(), undefined, purpose, request.signal, attachments);
    // Provider calls can take long enough for another tab or administrator to
    // revoke consent, suspend membership, expire the session or change access.
    const currentAccess = await requireAccess(request, readers, "ai.basic");
    await requirePermission(currentAccess, "insights.view");
    if (currentAccess.organizationId !== context.organizationId || currentAccess.userId !== context.userId)
      throw new ApiError(409, "ADVISOR_CONTEXT_CHANGED", "Your workspace access changed. Refresh before trying again.");
    await requireAdvisorConsent({ organizationId: context.organizationId, actorUserId: context.userId, purpose, noticeVersion: body.noticeVersion, privacyPolicyVersion: body.privacyPolicyVersion });
    await completeAdvisorTurn(getD1(), authorityActor, authorityStamp, result.configured && memoryEnabled ? {
      conversationId, existing: Boolean(suppliedId), question, answer: result.text, model: result.model,
      userEvidence: JSON.stringify({ accessFingerprint, authorityFingerprint, historyScope }), answerEvidence: JSON.stringify({ accessFingerprint, authorityFingerprint, historyScope, ...evidenceSummary }),
    } : null);
    if (!result.configured) {
      return jsonResponse({ status: "configuration_required", conversationId: suppliedId, memoryEnabled, model: result.model, answer: null, evidence: evidenceSummary, message: result.message });
    }
    return jsonResponse({ status: "answered", providers: result.providers, partial: result.partial, kpis: evidence.kpis, conversationId: memoryEnabled ? conversationId : null, memoryEnabled, model: result.model, answer: result.text, evidence: evidenceSummary });
  });
}

export async function DELETE(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requirePrivacyAccess(request, readers);
    await enforceRateLimit("advisor:delete", `${context.userId}:${clientSource(request)}`, 12, 60);
    const body = await readJsonObject(request, 1_000);
    const conversationId = cleanConversationId(body.conversationId);
    const database = getD1();
    const [, deletion] = await database.batch([
      database.prepare("DELETE FROM assistant_messages WHERE conversation_id = ? AND organization_id = ? AND user_id = ?").bind(conversationId, context.organizationId, context.userId),
      database.prepare("DELETE FROM assistant_conversations WHERE id = ? AND organization_id = ? AND user_id = ?").bind(conversationId, context.organizationId, context.userId),
    ]);
    if (Number(deletion.meta.changes ?? 0) !== 1) {
      throw new ApiError(404, "CONVERSATION_NOT_FOUND", "This advisor conversation is no longer available.");
    }
    await recordAudit({
      request,
      requestId,
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "privacy.advisor_conversation_deleted",
      resourceType: "assistant_conversation",
      resourceId: conversationId,
      details: { contentDeleted: true },
    });
    return jsonResponse({ deleted: true, conversationId });
  });
}

export const ADVISOR_CONSENT_VERSIONS = {
  noticeVersion: ADVISOR_CONSENT_NOTICE_VERSION,
  privacyPolicyVersion: PRIVACY_POLICY_VERSION,
};
