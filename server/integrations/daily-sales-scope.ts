import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { dailyBusinessMetrics } from "../../db/schema";
import type { commerceSourceAuthority } from "./source-authority";

/** One scope contract for the executive dashboard and its supporting reports.
 * A payment or bank feed is not a sale. A manual summary cannot be added again
 * for a location whose sales are already supplied by its selected connector. */
export function authoritativeDailySalesScope(input: {
  authority: Awaited<ReturnType<typeof commerceSourceAuthority>>;
  localLocationIds: readonly string[];
  locationRestricted: boolean;
  requestedConnectionId?: string | null;
  blocked?: boolean;
}) {
  const { authority, requestedConnectionId } = input;
  const salesProviders = new Set(["lightspeed", "lightspeed-r", "square", "shopify", "shopify-pos", "clover", "doordash", "uber-eats"]);
  if (input.blocked || (!requestedConnectionId && authority.status === "conflict")) return sql`0 = 1`;
  if (requestedConnectionId) {
    const refs = [...new Set(authority.candidates.filter(row => row.connectionId === requestedConnectionId && salesProviders.has(row.provider)).flatMap(row => row.metricLocationRef ? [row.metricLocationRef] : []))];
    return refs.length ? and(eq(dailyBusinessMetrics.sourceConnectionId, requestedConnectionId), inArray(dailyBusinessMetrics.locationRef, refs))! : sql`0 = 1`;
  }
  const selectedLocations = new Set(authority.selections.map(row => row.localLocationId));
  const manualLocations = input.localLocationIds.filter(id => !selectedLocations.has(id));
  const selections = authority.selections.filter(row => row.metricLocationRef && salesProviders.has(row.provider)).map(row => and(
    eq(dailyBusinessMetrics.sourceConnectionId, row.connectionId),
    eq(dailyBusinessMetrics.locationRef, row.metricLocationRef!),
  ));
  const manual = !input.locationRestricted && !authority.selections.length
    ? isNull(dailyBusinessMetrics.sourceConnectionId)
    : manualLocations.length ? and(isNull(dailyBusinessMetrics.sourceConnectionId), inArray(dailyBusinessMetrics.locationRef, manualLocations)) : undefined;
  return or(...selections, ...(manual ? [manual] : [])) ?? sql`0 = 1`;
}
