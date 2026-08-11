import { and, asc, desc, eq, gte } from "drizzle-orm";
import { getDb } from "../../../../db";
import {
  bankAccounts,
  bookloqSettings,
  commerceCustomers,
  dailyBusinessMetrics,
  growthTouchpoints,
  growthTransactions,
  integrationLocationMappings,
  inventoryBalances,
  marketingCalendarEntries,
  marketingProfiles,
  organizationLocations,
  searchVisibilityObservations,
  workspaces,
} from "../../../../db/schema";
import { buildGrowthIntelligence } from "../../../../domain/growth-intelligence";
import { buildMarketingRecommendations, type EvidenceCoverage, type MarketingOperatingCoverage } from "../../../../domain/marketing-recommendations";
import { recordAudit } from "../../../../server/audit";
import { requireAccess } from "../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../server/api";
import { effectivePermissions, requirePermission } from "../../../../server/permissions";
import { authorizedLocationDataScope, requireOrganizationWideLocationAccess } from "../../../../server/location-access";
import { approvedBankSource, approvedCommerceSource, approvedFactSource } from "../../../../server/integrations/trusted-data";

const readers = ["owner", "admin", "manager", "employee", "read_only"] as const;
const writers = ["owner", "admin"] as const;
const stages = new Set(["discovery", "website", "phone_call", "lead", "customer"]);
const goals = new Set(["leads", "visits", "sales", "awareness"]);
const googleStatuses = new Set(["not_set", "claimed", "verified"]);
const calendarChannels = new Set(["content", "google", "meta", "email", "local", "website"]);
const calendarTypes = new Set(["campaign", "content", "audit", "offer", "follow_up"]);
const calendarStatuses = new Set(["planned", "in_progress", "completed", "cancelled"]);
const isoDate = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/;
const calendarDate = /^\d{4}-\d{2}-\d{2}$/;

const textValue = (value: unknown, name: string, max = 160) => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new ApiError(400, "INVALID_GROWTH_RECORD", `${name} is required and must be at most ${max} characters.`);
  return value.trim();
};

const optionalTextValue = (value: unknown, name: string, max = 500) => {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.trim().length > max) throw new ApiError(400, "INVALID_GROWTH_RECORD", `${name} must be at most ${max} characters.`);
  return value.trim();
};

const integerValue = (value: unknown, name: string, nullable = false) => {
  if (nullable && (value === null || value === undefined || value === "")) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new ApiError(400, "INVALID_GROWTH_RECORD", `${name} must be a non-negative integer.`);
  return value as number;
};

const websiteValue = (value: unknown) => {
  const website = optionalTextValue(value, "websiteUrl", 300);
  if (!website) return "";
  let url: URL;
  try { url = new URL(website); } catch { throw new ApiError(400, "INVALID_GROWTH_RECORD", "websiteUrl must be a complete web address."); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ApiError(400, "INVALID_GROWTH_RECORD", "websiteUrl must use http or https.");
  return url.toString();
};

const timeValue = (value: Date | string | null | undefined) => {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value.length === 10 ? `${value}T00:00:00Z` : value).getTime();
  return Number.isFinite(time) ? time : null;
};

const latestValue = (values: Array<Date | string | null | undefined>) => {
  let latest: Date | string | null = null;
  let latestTime = -1;
  for (const value of values) {
    const time = timeValue(value);
    if (value && time !== null && time > latestTime) {
      latest = value;
      latestTime = time;
    }
  }
  return latest;
};

const sourceFreshness = (value: Date | string | null | undefined, maxAgeDays: number, missingLabel: string) => {
  const time = timeValue(value);
  if (time === null) return { status: "missing" as const, freshness: missingLabel };
  const date = new Date(time).toISOString().slice(0, 10);
  const ageDays = Math.max(0, Math.floor((Date.now() - time) / 86_400_000));
  if (ageDays > maxAgeDays) return { status: "stale" as const, freshness: `Last updated ${date}, ${ageDays} days ago` };
  return { status: "ready" as const, freshness: `Current through ${date}` };
};

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, readers);
    await requirePermission(context, "marketing.view");
    await enforceRateLimit("growth:read", context.userId, 60, 60);
    const permissions = await effectivePermissions(context);
    const requestedLocationId = new URL(request.url).searchParams.get("location");
    const locationAccess = await authorizedLocationDataScope(context, requestedLocationId);
    const selectedLocation = locationAccess.selectedLocation;
    const since = new Date(Date.now() - 366 * 86_400_000).toISOString().slice(0, 10);
    const [touchpoints, transactions, visibility, storedProfile, calendar, workspace, inventory, dailyMetrics, customers, locations, locationMappings, bookkeepingSettings, cashAccounts] = await Promise.all([
      getDb().select({ id: growthTouchpoints.id, occurredAt: growthTouchpoints.occurredAt, source: growthTouchpoints.source, stage: growthTouchpoints.stage, journeyRef: growthTouchpoints.journeyRef }).from(growthTouchpoints).where(and(eq(growthTouchpoints.organizationId, context.organizationId), gte(growthTouchpoints.occurredAt, since))).orderBy(asc(growthTouchpoints.occurredAt)).limit(10_000),
      getDb().select({ id: growthTransactions.id, occurredAt: growthTransactions.occurredAt, journeyRef: growthTransactions.journeyRef, revenueCents: growthTransactions.revenueCents, grossProfitCents: growthTransactions.grossProfitCents }).from(growthTransactions).where(and(eq(growthTransactions.organizationId, context.organizationId), gte(growthTransactions.occurredAt, since))).orderBy(asc(growthTransactions.occurredAt)).limit(10_000),
      getDb().select({ query: searchVisibilityObservations.query, observedDate: searchVisibilityObservations.observedDate, positionMilli: searchVisibilityObservations.positionMilli, discoveryActions: searchVisibilityObservations.discoveryActions, sourceSystem: searchVisibilityObservations.sourceSystem }).from(searchVisibilityObservations).where(and(eq(searchVisibilityObservations.organizationId, context.organizationId), gte(searchVisibilityObservations.observedDate, since))).orderBy(asc(searchVisibilityObservations.observedDate)).limit(2_000),
      getDb().select().from(marketingProfiles).where(eq(marketingProfiles.organizationId, context.organizationId)).limit(1),
      getDb().select({ id: marketingCalendarEntries.id, title: marketingCalendarEntries.title, channel: marketingCalendarEntries.channel, eventType: marketingCalendarEntries.eventType, startDate: marketingCalendarEntries.startDate, dueDate: marketingCalendarEntries.dueDate, status: marketingCalendarEntries.status, objective: marketingCalendarEntries.objective, notes: marketingCalendarEntries.notes }).from(marketingCalendarEntries).where(eq(marketingCalendarEntries.organizationId, context.organizationId)).orderBy(asc(marketingCalendarEntries.startDate)).limit(500),
      getDb().select({ businessName: workspaces.businessName, industry: workspaces.industry, city: workspaces.city, province: workspaces.province, website: workspaces.website }).from(workspaces).where(eq(workspaces.id, context.organizationId)).limit(1),
      getDb().select({ id: inventoryBalances.id, locationRef: inventoryBalances.locationRef, updatedAt: inventoryBalances.updatedAt }).from(inventoryBalances).where(and(
        eq(inventoryBalances.organizationId, context.organizationId),
        approvedFactSource(inventoryBalances.organizationId, inventoryBalances.sourceProvider, inventoryBalances.sourceConnectionId),
      )).orderBy(desc(inventoryBalances.updatedAt)).limit(1_000),
      getDb().select({ businessDate: dailyBusinessMetrics.businessDate, locationRef: dailyBusinessMetrics.locationRef, netSalesCents: dailyBusinessMetrics.netSalesCents, costOfGoodsCents: dailyBusinessMetrics.costOfGoodsCents, cashBalanceCents: dailyBusinessMetrics.cashBalanceCents, updatedAt: dailyBusinessMetrics.updatedAt }).from(dailyBusinessMetrics).where(and(
        eq(dailyBusinessMetrics.organizationId, context.organizationId),
        gte(dailyBusinessMetrics.businessDate, since),
        approvedFactSource(dailyBusinessMetrics.organizationId, dailyBusinessMetrics.sourceProvider, dailyBusinessMetrics.sourceConnectionId),
      )).orderBy(desc(dailyBusinessMetrics.businessDate)).limit(1_000),
      getDb().select({ id: commerceCustomers.id, updatedAt: commerceCustomers.updatedAt }).from(commerceCustomers).where(and(
        eq(commerceCustomers.organizationId, context.organizationId),
        approvedCommerceSource(commerceCustomers.organizationId, commerceCustomers.provider, commerceCustomers.connectionId),
      )).orderBy(desc(commerceCustomers.updatedAt)).limit(1_000),
      getDb().select({ id: organizationLocations.id, validationStatus: organizationLocations.validationStatus, updatedAt: organizationLocations.updatedAt }).from(organizationLocations).where(and(eq(organizationLocations.organizationId, context.organizationId), eq(organizationLocations.status, "active"))).orderBy(desc(organizationLocations.updatedAt)).limit(100),
      getDb().select({ localLocationId: integrationLocationMappings.localLocationId, provider: integrationLocationMappings.provider, externalLocationRef: integrationLocationMappings.externalLocationRef, updatedAt: integrationLocationMappings.updatedAt }).from(integrationLocationMappings).where(and(
        eq(integrationLocationMappings.organizationId, context.organizationId),
        eq(integrationLocationMappings.status, "mapped"),
        approvedCommerceSource(integrationLocationMappings.organizationId, integrationLocationMappings.provider, integrationLocationMappings.connectionId),
      )).orderBy(desc(integrationLocationMappings.updatedAt)).limit(500),
      getDb().select({ status: bookloqSettings.status, cashSafetyThresholdCents: bookloqSettings.cashSafetyThresholdCents, updatedAt: bookloqSettings.updatedAt }).from(bookloqSettings).where(eq(bookloqSettings.organizationId, context.organizationId)).limit(1),
      getDb().select({ availableBalanceCents: bankAccounts.availableBalanceCents, liveBalanceCents: bankAccounts.liveBalanceCents, lastSyncAt: bankAccounts.lastSyncAt, updatedAt: bankAccounts.updatedAt }).from(bankAccounts).where(and(
        eq(bankAccounts.organizationId, context.organizationId),
        approvedBankSource(bankAccounts.organizationId, bankAccounts.provider, bankAccounts.externalItemRef),
      )).orderBy(desc(bankAccounts.updatedAt)).limit(100),
    ]);
    const selectedLocationRefs = new Set(locationAccess.locationRefs ?? []);
    const locationDataRestricted = locationAccess.locationRefs !== null;
    const authorizationRestricted = !locationAccess.organizationWide;
    const scopedInventory = locationDataRestricted ? inventory.filter((row) => selectedLocationRefs.has(row.locationRef)) : inventory;
    const scopedDailyMetrics = locationDataRestricted ? dailyMetrics.filter((row) => selectedLocationRefs.has(row.locationRef)) : dailyMetrics;
    const scopedLocations = locationAccess.locationIds === null
      ? locations
      : locations.filter((location) => locationAccess.locationIds?.includes(location.id));
    const scopedLocationMappings = locationAccess.locationIds === null
      ? locationMappings
      : locationMappings.filter((mapping) => Boolean(mapping.localLocationId && locationAccess.locationIds?.includes(mapping.localLocationId)));
    const authorizedTouchpoints = authorizationRestricted ? [] : touchpoints;
    const authorizedTransactions = authorizationRestricted ? [] : transactions;
    const authorizedVisibility = authorizationRestricted ? [] : visibility;
    const saved = storedProfile[0];
    const organization = workspace[0];
    const profile = saved ?? {
      organizationId: context.organizationId,
      businessModel: organization?.industry ?? "",
      primaryOffer: "",
      targetAudience: "",
      serviceArea: [organization?.city, organization?.province].filter(Boolean).join(", "),
      primaryGoal: "leads" as const,
      websiteUrl: organization?.website ?? "",
      googleProfileStatus: "not_set" as const,
      notes: "",
      updatedByUserId: context.userId,
      createdAt: null,
      updatedAt: null,
    };
    const growth = buildGrowthIntelligence({ touchpoints: authorizedTouchpoints, transactions: authorizedTransactions, searchVisibility: authorizedVisibility.map((row) => ({ ...row, position: row.positionMilli / 1000 })) });
    const hasAttributionData = growth.status === "available" && (growth.channels.length > 0 || authorizedTransactions.length > 0);
    const hasSearchData = authorizedVisibility.length > 0;
    const marketingLatest = latestValue([
      ...authorizedVisibility.map((row) => row.observedDate),
      ...authorizedTouchpoints.map((row) => row.occurredAt),
      ...authorizedTransactions.map((row) => row.occurredAt),
    ]);
    const marketingFreshness = sourceFreshness(marketingLatest, 31, "No marketing source date");
    const marketingEvidence: EvidenceCoverage = {
      status: marketingFreshness.status === "ready" && (!hasAttributionData || !hasSearchData) ? "limited" : marketingFreshness.status,
      freshness: marketingFreshness.freshness,
      evidence: [
        ...(hasSearchData ? [`${authorizedVisibility.length} owner-entered or imported search observations`] : []),
        ...(hasAttributionData ? [`${authorizedTouchpoints.length} touchpoints and ${authorizedTransactions.length} matched transaction records`] : []),
      ],
      missingInputs: [
        ...(!hasSearchData ? ["Search observations"] : []),
        ...(!hasAttributionData ? ["Matched journey outcomes"] : []),
        ...(locationDataRestricted ? ["Location-tagged marketing journeys and outcomes"] : []),
      ],
    };
    if (locationDataRestricted && marketingEvidence.status === "ready") marketingEvidence.status = "limited";

    const inventoryFreshness = sourceFreshness(scopedInventory[0]?.updatedAt, 14, "No inventory source date");
    const inventoryCoverage: EvidenceCoverage = !permissions.includes("inventory.view")
      ? { status: "limited", freshness: "Inventory freshness is permission restricted", evidence: [], missingInputs: ["Permission to view inventory readiness"] }
      : !scopedInventory.length
        ? { status: "missing", freshness: inventoryFreshness.freshness, evidence: [], missingInputs: ["Location inventory balances"] }
        : { status: inventoryFreshness.status, freshness: inventoryFreshness.freshness, evidence: [`${scopedInventory.length} location inventory balances are recorded`], missingInputs: inventoryFreshness.status === "stale" ? ["Current inventory balance"] : [] };

    const marginRow = scopedDailyMetrics.find((row) => row.netSalesCents > 0);
    const marginFreshness = sourceFreshness(marginRow?.businessDate, 31, "No margin source date");
    const marginCoverage: EvidenceCoverage = !permissions.includes("metrics.profit")
      ? { status: "limited", freshness: "Margin freshness is permission restricted", evidence: [], missingInputs: ["Permission to view margin coverage"] }
      : !marginRow
        ? { status: "missing", freshness: marginFreshness.freshness, evidence: [], missingInputs: ["Net sales and cost of goods"] }
        : { status: marginFreshness.status, freshness: marginFreshness.freshness, evidence: [`Net sales and cost of goods are recorded through ${marginRow.businessDate}`], missingInputs: marginFreshness.status === "stale" ? ["Current margin evidence"] : [] };

    const settings = bookkeepingSettings[0];
    const cashMetric = scopedDailyMetrics.find((row) => row.cashBalanceCents !== null);
    const cashAccount = authorizationRestricted ? undefined : cashAccounts.find((row) => row.availableBalanceCents !== null || row.liveBalanceCents !== null);
    const cashLatest = latestValue([cashMetric?.businessDate, cashAccount?.lastSyncAt, cashAccount?.updatedAt]);
    const cashFreshness = sourceFreshness(cashLatest, 14, "No cash source date");
    const hasCashBalance = Boolean(cashMetric || cashAccount);
    const hasCashGuard = !authorizationRestricted && settings?.status === "active" && settings.cashSafetyThresholdCents > 0;
    const canViewCash = permissions.includes("metrics.cash") || permissions.includes("finance.bank_balances");
    const cashCoverage: EvidenceCoverage = !canViewCash
      ? { status: "limited", freshness: "Cash freshness is permission restricted", evidence: [], missingInputs: ["Permission to view cash readiness"] }
      : !hasCashBalance && !hasCashGuard
        ? { status: "missing", freshness: cashFreshness.freshness, evidence: [], missingInputs: ["Current cash balance", "Cash safety threshold"] }
        : {
            status: hasCashBalance && hasCashGuard ? cashFreshness.status : "limited",
            freshness: cashFreshness.freshness,
            evidence: [
              ...(hasCashBalance ? ["A current cash balance source is recorded"] : []),
              ...(hasCashGuard ? ["An active cash safety threshold is configured"] : []),
            ],
            missingInputs: [
              ...(!hasCashBalance || cashFreshness.status === "stale" ? ["Current cash balance"] : []),
              ...(!hasCashGuard ? ["Cash safety threshold"] : []),
            ],
          };

    const validatedLocations = scopedLocations.filter((row) => row.validationStatus === "validated");
    const mappedLocationIds = new Set(scopedLocationMappings.map((row) => row.localLocationId).filter((value): value is string => Boolean(value)));
    const inventoryLocationRefs = new Set(scopedInventory.map((row) => row.locationRef));
    const locationMapped = validatedLocations.some((row) => mappedLocationIds.has(row.id) || inventoryLocationRefs.has(row.id));
    const locationLatest = latestValue([...scopedLocations.map((row) => row.updatedAt), ...scopedLocationMappings.map((row) => row.updatedAt)]);
    const locationFreshness = sourceFreshness(locationLatest, 90, "No location source date");
    const locationCoverage: EvidenceCoverage = !scopedLocations.length
      ? { status: "missing", freshness: locationFreshness.freshness, evidence: [], missingInputs: ["Validated operating location"] }
      : !validatedLocations.length || !locationMapped
        ? {
            status: "limited",
            freshness: locationFreshness.freshness,
            evidence: [`${scopedLocations.length} active location records are available`],
            missingInputs: [
              ...(!validatedLocations.length ? ["Validated operating location"] : []),
              ...(!locationMapped ? ["Verified inventory to location mapping"] : []),
            ],
          }
        : { status: locationFreshness.status, freshness: locationFreshness.freshness, evidence: [`${validatedLocations.length} validated locations include an operating source mapping`], missingInputs: locationFreshness.status === "stale" ? ["Current location mapping review"] : [] };

    const customerFreshness = sourceFreshness(customers[0]?.updatedAt, 31, "No customer source date");
    const customerCoverage: EvidenceCoverage = !permissions.includes("customers.totals")
      ? { status: "limited", freshness: "Customer freshness is permission restricted", evidence: [], missingInputs: ["Permission to view customer records"] }
      : locationDataRestricted
        ? { status: "limited", freshness: customerFreshness.freshness, evidence: [], missingInputs: ["Customer outcomes linked to the selected location"] }
      : !customers.length
        ? { status: "missing", freshness: customerFreshness.freshness, evidence: [], missingInputs: ["Customer records"] }
        : { status: customerFreshness.status, freshness: customerFreshness.freshness, evidence: [`${customers.length} customer records are available`], missingInputs: customerFreshness.status === "stale" ? ["Current customer records"] : [] };

    const operatingCoverage: MarketingOperatingCoverage = {
      customers: customerCoverage,
      inventory: inventoryCoverage,
      margin: marginCoverage,
      cashReadiness: cashCoverage,
      location: locationCoverage,
    };
    const recommendations = buildMarketingRecommendations({
      businessModel: profile.businessModel,
      primaryOffer: profile.primaryOffer,
      targetAudience: profile.targetAudience,
      serviceArea: profile.serviceArea,
      primaryGoal: profile.primaryGoal,
      websiteUrl: profile.websiteUrl,
      googleProfileStatus: profile.googleProfileStatus,
      hasAttributionData,
      hasSearchData,
      asOfDate: new Date().toISOString().slice(0, 10),
      operatingCoverage,
      marketingEvidence,
    });
    return jsonResponse({
      growth,
      profile: { ...profile, saved: Boolean(saved) },
      organization: { businessName: organization?.businessName ?? "Your business" },
      recommendations,
      operatingCoverage,
      marketingEvidence,
      locationScope: locationDataRestricted ? { id: selectedLocation?.id ?? "accessible", name: selectedLocation?.name ?? "Accessible locations" } : null,
      calendar: authorizationRestricted ? [] : calendar,
      searchSeries: authorizedVisibility.slice(-24).map((row) => ({ query: row.query, observedDate: row.observedDate, position: row.positionMilli / 1000, discoveryActions: row.discoveryActions, sourceSystem: row.sourceSystem })),
      importCounts: {
        touchpoints: authorizedTouchpoints.length,
        transactions: authorizedTransactions.length,
        searchObservations: authorizedVisibility.length,
      },
      canManage: context.role === "owner" || context.role === "admin",
      connections: [
        { provider: "Google", status: "coming_soon", label: "Coming soon!", availableNow: "Owner-entered Search and Business Profile observations" },
        { provider: "Meta", status: "coming_soon", label: "Coming soon!", availableNow: "Owner-entered campaign context and calendar planning" },
      ],
      period: { since, through: new Date().toISOString().slice(0, 10) },
      sourceBoundary: "Recommendations use saved business context, tenant operating records and recorded observations. First-touch attribution requires a shared pseudonymous journey reference across discovery, website or call, customer and POS events. Association is not proof of causation. Google and Meta connectors remain unavailable, and this workspace does not store or aggregate automated Google Business Profile performance data.",
      scopeBoundary: locationDataRestricted
        ? `Inventory and daily operating evidence are filtered to ${selectedLocation?.name ?? "accessible locations"}. Marketing journeys and customer outcomes are not location-tagged, so location-specific promotion confidence remains limited.`
        : "All authorized organization evidence is included.",
    });
  });
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, writers);
    await requirePermission(context, "marketing.manage");
    await requireOrganizationWideLocationAccess(context);
    await enforceRateLimit("growth:ingest", context.userId, 120, 60);
    const body = await readJsonObject(request, 65_536);
    const type = textValue(body.type, "type", 40);
    const now = new Date();
    const id = crypto.randomUUID();

    if (type === "marketing_profile") {
      const primaryGoal = textValue(body.primaryGoal, "primaryGoal", 24);
      const googleProfileStatus = textValue(body.googleProfileStatus, "googleProfileStatus", 24);
      if (!goals.has(primaryGoal)) throw new ApiError(400, "INVALID_GROWTH_RECORD", "primaryGoal is not supported.");
      if (!googleStatuses.has(googleProfileStatus)) throw new ApiError(400, "INVALID_GROWTH_RECORD", "googleProfileStatus is not supported.");
      const profile = {
        businessModel: optionalTextValue(body.businessModel, "businessModel", 120),
        primaryOffer: optionalTextValue(body.primaryOffer, "primaryOffer", 180),
        targetAudience: optionalTextValue(body.targetAudience, "targetAudience", 180),
        serviceArea: optionalTextValue(body.serviceArea, "serviceArea", 180),
        primaryGoal: primaryGoal as "leads" | "visits" | "sales" | "awareness",
        websiteUrl: websiteValue(body.websiteUrl),
        googleProfileStatus: googleProfileStatus as "not_set" | "claimed" | "verified",
        notes: optionalTextValue(body.notes, "notes", 1_000),
        updatedByUserId: context.userId,
        updatedAt: now,
      };
      await getDb().insert(marketingProfiles).values({ organizationId: context.organizationId, ...profile, createdAt: now }).onConflictDoUpdate({ target: marketingProfiles.organizationId, set: profile });
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "marketing.profile_updated", resourceType: "marketing_profile", resourceId: context.organizationId, details: { primaryGoal, googleProfileStatus } });
      return jsonResponse({ saved: true });
    }

    if (type === "marketing_calendar") {
      const channel = textValue(body.channel, "channel", 24);
      const eventType = textValue(body.eventType, "eventType", 24);
      const status = optionalTextValue(body.status, "status", 24) || "planned";
      const startDate = textValue(body.startDate, "startDate", 10);
      const dueDate = optionalTextValue(body.dueDate, "dueDate", 10) || null;
      if (!calendarChannels.has(channel)) throw new ApiError(400, "INVALID_GROWTH_RECORD", "channel is not supported.");
      if (!calendarTypes.has(eventType)) throw new ApiError(400, "INVALID_GROWTH_RECORD", "eventType is not supported.");
      if (!calendarStatuses.has(status)) throw new ApiError(400, "INVALID_GROWTH_RECORD", "status is not supported.");
      if (!calendarDate.test(startDate) || (dueDate && !calendarDate.test(dueDate))) throw new ApiError(400, "INVALID_GROWTH_RECORD", "Calendar dates must use YYYY-MM-DD.");
      if (dueDate && dueDate < startDate) throw new ApiError(400, "INVALID_GROWTH_RECORD", "dueDate cannot be before startDate.");
      await getDb().insert(marketingCalendarEntries).values({ id, organizationId: context.organizationId, title: textValue(body.title, "title", 180), channel: channel as "content" | "google" | "meta" | "email" | "local" | "website", eventType: eventType as "campaign" | "content" | "audit" | "offer" | "follow_up", startDate, dueDate, status: status as "planned" | "in_progress" | "completed" | "cancelled", objective: optionalTextValue(body.objective, "objective", 500), notes: optionalTextValue(body.notes, "notes", 1_000), createdByUserId: context.userId, createdAt: now, updatedAt: now });
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "marketing.calendar_created", resourceType: "marketing_calendar_entry", resourceId: id, details: { channel, eventType, startDate } });
      return jsonResponse({ created: true, id }, { status: 201 });
    }

    if (type === "marketing_calendar_status") {
      const entryId = textValue(body.id, "id", 80);
      const status = textValue(body.status, "status", 24);
      if (!calendarStatuses.has(status)) throw new ApiError(400, "INVALID_GROWTH_RECORD", "status is not supported.");
      const updated = await getDb().update(marketingCalendarEntries).set({ status: status as "planned" | "in_progress" | "completed" | "cancelled", updatedAt: now }).where(and(eq(marketingCalendarEntries.id, entryId), eq(marketingCalendarEntries.organizationId, context.organizationId))).returning({ id: marketingCalendarEntries.id });
      if (!updated.length) throw new ApiError(404, "MARKETING_CALENDAR_NOT_FOUND", "The marketing calendar entry was not found.");
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "marketing.calendar_status_updated", resourceType: "marketing_calendar_entry", resourceId: entryId, details: { status } });
      return jsonResponse({ updated: true });
    }

    const sourceSystem = textValue(body.sourceSystem, "sourceSystem", 80);
    const sourceEventId = textValue(body.sourceEventId, "sourceEventId", 160);
    if (type === "touchpoint") {
      const stage = textValue(body.stage, "stage", 24);
      if (!stages.has(stage)) throw new ApiError(400, "INVALID_GROWTH_RECORD", "stage is not supported.");
      const occurredAt = textValue(body.occurredAt, "occurredAt", 32);
      if (!isoDate.test(occurredAt)) throw new ApiError(400, "INVALID_GROWTH_RECORD", "occurredAt must be an ISO date or UTC timestamp.");
      await getDb().insert(growthTouchpoints).values({ id, organizationId: context.organizationId, occurredAt, source: textValue(body.source, "source", 80), stage: stage as "discovery" | "website" | "phone_call" | "lead" | "customer", journeyRef: textValue(body.journeyRef, "journeyRef", 160), sourceSystem, sourceEventId, createdAt: now }).onConflictDoNothing();
    } else if (type === "transaction") {
      const occurredAt = textValue(body.occurredAt, "occurredAt", 32);
      if (!isoDate.test(occurredAt)) throw new ApiError(400, "INVALID_GROWTH_RECORD", "occurredAt must be an ISO date or UTC timestamp.");
      await getDb().insert(growthTransactions).values({ id, organizationId: context.organizationId, occurredAt, journeyRef: textValue(body.journeyRef, "journeyRef", 160), revenueCents: integerValue(body.revenueCents, "revenueCents")!, grossProfitCents: integerValue(body.grossProfitCents ?? null, "grossProfitCents", true), sourceSystem, sourceEventId, createdAt: now }).onConflictDoNothing();
    } else if (type === "search_visibility") {
      const observedDate = textValue(body.observedDate, "observedDate", 10);
      if (!calendarDate.test(observedDate)) throw new ApiError(400, "INVALID_GROWTH_RECORD", "observedDate must be YYYY-MM-DD.");
      const position = Number(body.position);
      if (!Number.isFinite(position) || position <= 0 || position > 1_000) throw new ApiError(400, "INVALID_GROWTH_RECORD", "position must be greater than zero and no more than 1000.");
      await getDb().insert(searchVisibilityObservations).values({ id, organizationId: context.organizationId, query: textValue(body.query, "query", 180), observedDate, positionMilli: Math.round(position * 1_000), discoveryActions: integerValue(body.discoveryActions ?? null, "discoveryActions", true), sourceSystem, sourceEventId, createdAt: now }).onConflictDoNothing();
    } else throw new ApiError(400, "INVALID_GROWTH_RECORD", "type must be a supported marketing profile, calendar, touchpoint, transaction, or search record.");
    await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "growth.record_ingested", resourceType: "growth_record", resourceId: id, details: { type, sourceSystem } });
    return jsonResponse({ accepted: true, id }, { status: 202 });
  });
}
