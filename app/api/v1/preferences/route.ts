import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { accountPreferences } from "../../../../db/schema";
import {
  NAVIGATION_VIEW_IDS,
  PROTECTED_NAVIGATION_VIEW_IDS,
  normalizeHiddenNavigation,
} from "../../../../domain/navigation-preferences";
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
    locations,
  };
}

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, readers);
    await enforceRateLimit("preferences:read", context.userId, 120, 60);
    return jsonResponse(await preferencePayload(context));
  });
}

export async function POST(request: Request) {
  return handleApi(request, async () => {
    requireSameOrigin(request);
    const context = await requireAccess(request, readers);
    await enforceRateLimit("preferences:write", context.userId, 60, 3_600);
    const input = await readJsonObject(request, 16_000);
    const hiddenNavigation = normalizeHiddenNavigation(
      Array.isArray(input.hiddenNavigation)
        ? input.hiddenNavigation.filter((item): item is string => typeof item === "string")
        : [],
      NAVIGATION_VIEW_IDS,
      PROTECTED_NAVIGATION_VIEW_IDS,
    );
    const preferredLocationId = typeof input.preferredLocationId === "string" && input.preferredLocationId
      ? input.preferredLocationId
      : null;
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
        preferredLocationId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: accountPreferences.userId,
        set: {
          hiddenNavigationJson: JSON.stringify(hiddenNavigation),
          preferredLocationId,
          updatedAt: now,
        },
      });
    return jsonResponse(await preferencePayload(context));
  });
}
