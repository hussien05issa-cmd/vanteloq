import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { integrationConnections, integrationLocationMappings, integrationSyncRuns, retailMeasurements } from "../../../db/schema";
import { scopeExternalRef } from "../../../domain/integration-source";
import { recordAudit } from "../../audit";
import type { AccessContext } from "../../authorization";
import { ApiError, enforceRateLimit, jsonResponse } from "../../api";
import {
  DEEL_PROVIDER, fetchDeelGrossToNetSummary, fetchDeelOrganization,
  fetchFinalizedDeelPayrollCycles,
} from "../deel";
import {
  acquireIntegrationSyncLease, releaseIntegrationSyncLease, renewIntegrationSyncLease,
  requireOwnedIntegrationConnection,
} from "../connection";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(value: unknown, fallback: string): string {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string" || !DATE_PATTERN.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new ApiError(400, "DEEL_DATE_INVALID", "Use valid YYYY-MM-DD dates for the Deel payroll range.");
  }
  return value;
}

function defaultDates() {
  const end = new Date();
  const start = new Date(end.getTime() - 120 * 24 * 60 * 60 * 1000);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function validateRange(start: string, end: string) {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T23:59:59Z`);
  if (startMs > endMs) throw new ApiError(400, "DEEL_DATE_RANGE_INVALID", "The payroll start date must not be after the end date.");
  if (endMs > Date.now() + 24 * 60 * 60 * 1000) throw new ApiError(400, "DEEL_DATE_RANGE_INVALID", "The payroll date range cannot extend into the future.");
  if (endMs - startMs > 366 * 24 * 60 * 60 * 1000) throw new ApiError(400, "DEEL_DATE_RANGE_TOO_LARGE", "Import at most 366 days of finalized payroll evidence at a time.");
}

export async function runDeelSync(
  request: Request,
  requestId: string,
  context: AccessContext,
  input: Record<string, unknown>,
) {
  const connection = await requireOwnedIntegrationConnection(
    context.organizationId, DEEL_PROVIDER,
    typeof input.connectionId === "string" ? input.connectionId : null,
    { connected: true },
  );
  if (!connection.externalAccountRef) throw new ApiError(409, "DEEL_NOT_CONNECTED", "Authorize a Deel organization before synchronizing payroll evidence.");
  const defaults = defaultDates();
  const dateStart = isoDate(input.dateStart, defaults.start);
  const dateEnd = isoDate(input.dateEnd, defaults.end);
  validateRange(dateStart, dateEnd);
  await enforceRateLimit("deel:manual-sync", context.organizationId, 12, 3_600);
  const lease = await acquireIntegrationSyncLease(context.organizationId, DEEL_PROVIDER, connection.id, 15 * 60_000);
  if (!lease) return jsonResponse({ provider: DEEL_PROVIDER, connectionId: connection.id, coalesced: true, nextStep: "This Deel organization is already synchronizing." });

  const runId = `deel-${crypto.randomUUID()}`;
  const startedAt = new Date();
  let recordsRead = 0;
  let recordsStaged = 0;
  let warnings = 0;
  try {
    await getDb().insert(integrationSyncRuns).values({
      id: runId, organizationId: context.organizationId, provider: DEEL_PROVIDER,
      connectionId: connection.id, mode: "incremental", status: "running",
      cursorBefore: connection.lastSyncCursor, cursorAfter: null,
      recordsRead: 0, recordsStaged: 0, duplicatesSkipped: 0, warningCount: 0,
      errorCode: null, startedAt, completedAt: null, createdByUserId: context.userId,
    });
    const providerOrganization = await fetchDeelOrganization(context.organizationId, connection.id);
    if (providerOrganization.id !== connection.externalAccountRef) {
      throw new ApiError(409, "DEEL_ORGANIZATION_CHANGED", "The authorized Deel organization changed. Reconnect before importing payroll evidence.");
    }
    const mappings = await getDb().select({
      legalEntityId: integrationLocationMappings.externalLocationRef,
      localLocationId: integrationLocationMappings.localLocationId,
    }).from(integrationLocationMappings).where(and(
      eq(integrationLocationMappings.organizationId, context.organizationId),
      eq(integrationLocationMappings.provider, DEEL_PROVIDER),
      eq(integrationLocationMappings.connectionId, connection.id),
      eq(integrationLocationMappings.status, "mapped"),
    ));
    const usableMappings = mappings.filter((mapping): mapping is { legalEntityId: string; localLocationId: string } => Boolean(mapping.localLocationId));
    if (!usableMappings.length) throw new ApiError(409, "DEEL_LOCATION_MAPPING_REQUIRED", "Map at least one Deel legal entity to a Vanteloq location before importing payroll evidence.");

    for (const mapping of usableMappings) {
      const cycles = await fetchFinalizedDeelPayrollCycles(context.organizationId, connection.id, mapping.legalEntityId, dateStart, dateEnd);
      recordsRead += cycles.length;
      for (const cycle of cycles) {
        const summaries = await fetchDeelGrossToNetSummary(context.organizationId, connection.id, cycle.id);
        if (!summaries.length) { warnings += 1; continue; }
        for (const summary of summaries) {
          const now = new Date();
          const outletRef = scopeExternalRef(connection.sourceNamespace, mapping.legalEntityId)!;
          const valuesJson = JSON.stringify([{ reference: "location", values: {
            finalized: true,
            reportingEligible: false,
            complete: false,
            currency: summary.currency,
            additionsCents: summary.categoryTotalsCents.ADDITIONS,
            deductionsCents: summary.categoryTotalsCents.DEDUCTIONS,
            benefitsCents: summary.categoryTotalsCents.BENEFITS,
            contributionsCents: summary.categoryTotalsCents.CONTRIBUTIONS,
            reportedTotalsCents: summary.categoryTotalsCents.TOTALS,
            informationalCents: summary.categoryTotalsCents.INFOS,
            paidMinutes: null,
            wagesCents: null,
            cycleType: cycle.type,
            sourceUpdatedAt: summary.sourceUpdatedAt,
            evidenceBoundary: "Finalized Deel category-group aggregate. Not promoted as wages, paid hours, or an accounting classification.",
          } }]);
          await getDb().insert(retailMeasurements).values({
            id: crypto.randomUUID(), organizationId: context.organizationId,
            connectionId: connection.id, provider: DEEL_PROVIDER, outletRef,
            kind: "labour", reference: `deel-payroll-cycle:${cycle.id}:${summary.currency}`,
            periodFrom: cycle.dateStart.slice(0, 10), periodTo: cycle.dateEnd.slice(0, 10),
            sourceLabel: "Deel finalized payroll-cycle aggregate", valuesJson,
            updatedByUserId: context.userId, version: 1, updatedAt: now,
          }).onConflictDoUpdate({
            target: [retailMeasurements.organizationId, retailMeasurements.connectionId, retailMeasurements.outletRef, retailMeasurements.kind, retailMeasurements.reference, retailMeasurements.periodFrom, retailMeasurements.periodTo],
            set: { valuesJson, sourceLabel: "Deel finalized payroll-cycle aggregate", updatedByUserId: context.userId,
              version: sql`${retailMeasurements.version} + 1`, updatedAt: now },
          });
          recordsStaged += 1;
        }
        await renewIntegrationSyncLease(lease, 15 * 60_000);
      }
    }
    const completedAt = new Date();
    const cursor = JSON.stringify({ version: 1, dateStart, dateEnd, completedAt: completedAt.toISOString() });
    await getDb().update(integrationSyncRuns).set({
      status: "completed", cursorAfter: cursor, recordsRead, recordsStaged,
      warningCount: warnings, completedAt,
    }).where(eq(integrationSyncRuns.id, runId));
    await getDb().update(integrationConnections).set({
      dataPromotionStatus: "staging", lastSuccessfulSyncAt: completedAt,
      lastSyncCursor: cursor, lastErrorCode: null, updatedAt: completedAt,
    }).where(and(
      eq(integrationConnections.id, connection.id), eq(integrationConnections.organizationId, context.organizationId), eq(integrationConnections.provider, DEEL_PROVIDER),
    ));
    await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
      action: "integration.sync_completed", resourceType: "integration_connection", resourceId: connection.id,
      details: { provider: DEEL_PROVIDER, recordsRead, aggregateRecordsStaged: recordsStaged, warnings,
        finalizedCyclesOnly: true, employeeRecordsStored: false, dataPromotionEnabled: false },
    });
    return jsonResponse({
      provider: DEEL_PROVIDER, connectionId: connection.id, dateStart, dateEnd,
      finalizedCyclesRead: recordsRead, aggregateRecordsStaged: recordsStaged, warnings,
      employeeRecordsStored: false, dataPromotionEnabled: false, requiresReview: true,
      nextStep: "Finalized payroll category totals are staged for owner review. Vanteloq will not treat them as wages or paid hours without a verified mapping.",
    });
  } catch (error) {
    const errorCode = error instanceof ApiError ? error.code : "DEEL_SYNC_FAILED";
    await getDb().update(integrationSyncRuns).set({
      status: "failed", recordsRead, recordsStaged, warningCount: warnings,
      errorCode, completedAt: new Date(),
    }).where(eq(integrationSyncRuns.id, runId));
    await getDb().update(integrationConnections).set({ lastErrorCode: errorCode, updatedAt: new Date() }).where(and(
      eq(integrationConnections.id, connection.id), eq(integrationConnections.organizationId, context.organizationId), eq(integrationConnections.provider, DEEL_PROVIDER),
    ));
    throw error;
  } finally {
    await releaseIntegrationSyncLease(lease);
  }
}
