import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { accountPreferences } from "../../../../db/schema";
import {
  NAVIGATION_VIEW_IDS,
  PROTECTED_NAVIGATION_VIEW_IDS,
  normalizeHiddenNavigation,
} from "../../../../domain/navigation-preferences";
import { normalizeDashboardPreferences, parseDashboardPreferencesJson } from "../../../../domain/dashboard-preferences";
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
    hiddenNavigation: normalizeHiddenNavigation(
      jsonStrings(preferences?.hiddenNavigationJson),
      NAVIGATION_VIEW_IDS,
      PROTECTED_NAVIGATION_VIEW_IDS,
    ),
    preferredLocationId,
    dashboardPreferences: parseDashboardPreferencesJson(preferences?.dashboardPreferencesJson),
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
    const input = await readJsonObject(request, 16_000);
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
      : parseDashboardPreferencesJson(existing?.dashboardPreferencesJson);
    if (preferredLocationId) {
      await requireAccessibleLocation(context, preferredLocationId).catch(() => {
        throw new ApiError(400, "INVALID_LOCATION", "Select an active location available to this account.");
      });
    }
    const now = new Date();
    await getDb()
      .insert(accountPreferences)
      .values({
        userId: context.userId,
        emailNotifications: true,
        rememberedProfile: true,
        hiddenNavigationJson: JSON.stringify(hiddenNavigation),
        dashboardPreferencesJson: JSON.stringify(dashboardPreferences),
        preferredLocationId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: accountPreferences.userId,
        set: {
          hiddenNavigationJson: JSON.stringify(hiddenNavigation),
          dashboardPreferencesJson: JSON.stringify(dashboardPreferences),
          preferredLocationId,
          updatedAt: now,
        },
      });
    return jsonResponse(await preferencePayload(context));
  });
}
