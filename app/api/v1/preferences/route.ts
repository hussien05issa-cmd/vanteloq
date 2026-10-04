import { eq, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import { accountPreferences } from "../../../../db/schema";
import {
  NAVIGATION_VIEW_IDS,
  PROTECTED_NAVIGATION_VIEW_IDS,
  normalizeHiddenNavigation,
} from "../../../../domain/navigation-preferences";
import { businessClock } from "../../../../domain/intraday-sales";
import { normalizeDashboardPreferences } from "../../../../domain/dashboard-preferences";
import { workspaceDashboardJson } from "../../../../domain/dashboard-personalization";
import { normalizeCollectionsPreferences } from "../../../../domain/collections-dashboard";
import {
  ApiError,
  enforceRateLimit,
  handleApi,
  jsonResponse,
  readJsonObject,
  requireSameOrigin,
} from "../../../../server/api";
import { requireAccess } from "../../../../server/authorization";
import { accessibleLocations, requireAccessibleLocation } from "../../../../server/location-access";

const readers = ["owner", "admin", "manager", "employee", "read_only"] as const;

function jsonStrings(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

async function preferencePayload(context: Awaited<ReturnType<typeof requireAccess>>) {
  const [preferences] = await getDb()
    .select()
    .from(accountPreferences)
    .where(eq(accountPreferences.userId, context.userId))
    .limit(1);
  const locations = (await accessibleLocations(context)).map(({ id, name, status }) => ({ id, name, status }));
  const validLocationIds = new Set(locations.map((location) => location.id));
  const preferredLocationId = preferences?.preferredLocationId && validLocationIds.has(preferences.preferredLocationId)
    ? preferences.preferredLocationId
    : null;
  return {
    preferenceScope: { userId: context.userId, workspaceId: context.organizationId },
    hiddenNavigation: normalizeHiddenNavigation(
      jsonStrings(preferences?.hiddenNavigationJson),
      NAVIGATION_VIEW_IDS,
      PROTECTED_NAVIGATION_VIEW_IDS,
    ),
    preferredLocationId,
    dashboardPreferences: workspaceDashboardJson(preferences?.dashboardPreferencesJson, context.organizationId),
    locations,
  };
}

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, readers, "business.settings");
    await enforceRateLimit("preferences:read", context.userId, 120, 60);
    return jsonResponse(await preferencePayload(context));
  });
}

export async function POST(request: Request) {
  return handleApi(request, async () => {
    requireSameOrigin(request);
    const context = await requireAccess(request, readers, "business.settings");
    await enforceRateLimit("preferences:write", context.userId, 60, 3_600);
    const input = await readJsonObject(request, 48_000);
    const [existing] = await getDb()
      .select()
      .from(accountPreferences)
      .where(eq(accountPreferences.userId, context.userId))
      .limit(1);
    const hiddenNavigation = normalizeHiddenNavigation(
      Array.isArray(input.hiddenNavigation)
        ? input.hiddenNavigation.filter((item): item is string => typeof item === "string")
        : jsonStrings(existing?.hiddenNavigationJson),
      NAVIGATION_VIEW_IDS,
      PROTECTED_NAVIGATION_VIEW_IDS,
    );
    const preferredLocationId = Object.prototype.hasOwnProperty.call(input, "preferredLocationId")
      ? (typeof input.preferredLocationId === "string" && input.preferredLocationId ? input.preferredLocationId : null)
      : existing?.preferredLocationId ?? null;
    const dashboardPreferences = Object.prototype.hasOwnProperty.call(input, "dashboardPreferences")
      ? normalizeDashboardPreferences(input.dashboardPreferences)
      : workspaceDashboardJson(existing?.dashboardPreferencesJson, context.organizationId);
    // Independent layout writes must not overwrite the other dashboard's state.
    dashboardPreferences.collections = Object.prototype.hasOwnProperty.call(input, "collectionsPreferences")
      ? normalizeCollectionsPreferences(input.collectionsPreferences)
      : workspaceDashboardJson(existing?.dashboardPreferencesJson, context.organizationId).collections;
    if (preferredLocationId) {
      await requireAccessibleLocation(context, preferredLocationId).catch(() => {
        throw new ApiError(400, "INVALID_LOCATION", "Select an active location available to this account.");
      });
    }
    const allowed = new Set((await accessibleLocations(context)).map(location=>location.id));
    for(const layout of Object.prototype.hasOwnProperty.call(input,"dashboardPreferences") ? [dashboardPreferences,...dashboardPreferences.views.map(view=>view.layout)] : []) {
      if(layout.defaultPeriod==="custom"&&layout.customDates.to>businessClock(new Date(),context.organization.timezone)!.date) throw new ApiError(400,"REPORT_PERIOD_INVALID","Custom report dates cannot be in the future.");
      for(const rule of Object.values(layout.goalRules)) if(rule?.locationId && !allowed.has(rule.locationId)) throw new ApiError(400,"INVALID_LOCATION","Choose a location available to your account before saving this view.");
    }
    const envelope = JSON.stringify({workspaceId:context.organizationId,dashboard:dashboardPreferences});
    // Patch only the submitted section against the latest database value. Concurrent
    // collections and overview saves cannot replace one another's settings.
    const current = sql`CASE WHEN json_valid(${accountPreferences.dashboardPreferencesJson}) AND json_extract(${accountPreferences.dashboardPreferencesJson}, '$.workspaceId') = ${context.organizationId} THEN ${accountPreferences.dashboardPreferencesJson} ELSE ${envelope} END`;
    let dashboardWrite = current;
    if(Object.prototype.hasOwnProperty.call(input,"dashboardPreferences")) {
      const {collections: _collections,...overview}=dashboardPreferences;
      void _collections;
      dashboardWrite=sql`json_set(${current}, '$.dashboard', json_set(json(${JSON.stringify(overview)}), '$.collections', json_extract(${current}, '$.dashboard.collections')))`;
    }
    if(Object.prototype.hasOwnProperty.call(input,"collectionsPreferences")) dashboardWrite=sql`json_set(${dashboardWrite}, '$.dashboard.collections', json(${JSON.stringify(dashboardPreferences.collections)}))`;
    const now = new Date();
    await getDb()
      .insert(accountPreferences)
      .values({
        userId: context.userId,
        emailNotifications: true,
        rememberedProfile: true,
        hiddenNavigationJson: JSON.stringify(hiddenNavigation),
        dashboardPreferencesJson: envelope,
        preferredLocationId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: accountPreferences.userId,
        set: {
          hiddenNavigationJson: JSON.stringify(hiddenNavigation),
          dashboardPreferencesJson: dashboardWrite,
          preferredLocationId,
          updatedAt: now,
        },
      });
    return jsonResponse(await preferencePayload(context));
  });
}
