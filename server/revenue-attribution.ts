import { exactSum } from "../domain/executive-metrics";
import { providerDisplayName } from "../domain/display-labels";
import { normalizedSourceTimestamp } from "./data-trust";

type RevenueRow = {
  businessDate: string;
  netSalesCents: number;
  sourceProvider?: string | null;
  sourceConnectionId?: string | null;
  sourceImportId?: string | null;
  updatedAt?: Date | string | number | null;
};

/** Attribute the already-authorized canonical rows, never raw payments or deposits.
 * Net amounts already contain returns/discounts. Subtracting them again is wrong. */
export function revenueAttribution(rows: readonly RevenueRow[], options: {
  from: string; to: string; expectedCents: number | null; revealSources: boolean; now?: number;
}) {
  if (options.expectedCents === null) return null;
  const current = rows.filter(row => row.businessDate >= options.from && row.businessDate <= options.to);
  if (!current.length) return null;
  const now = options.now ?? Date.now();
  const groups = new Map<string, RevenueRow[]>();
  for (const row of current) {
    const key = !options.revealSources ? "approved" : row.sourceConnectionId ? row.sourceProvider || "connected" : row.sourceImportId ? "import" : "manual";
    const group = groups.get(key);
    if (group) group.push(row); else groups.set(key, [row]);
  }
  const sources = [...groups].map(([key, sourceRows]) => {
    const timestamps = sourceRows.map(row => {
      const iso = row.updatedAt == null ? null : normalizedSourceTimestamp(row.updatedAt);
      return iso && Date.parse(iso) <= now && Date.parse(iso) >= Date.UTC(2000, 0, 1) ? iso : null;
    });
    // The least-recent imported contributor is conservative for mixed accounts.
    // A newly imported row must not make older or undated records look fresh.
    const updatedAt = timestamps.every(Boolean) ? (timestamps as string[]).sort()[0] : null;
    return {
      key,
      label: key === "approved" ? "Approved sales records" : key === "import" ? "File imports" : key === "manual" ? "Reviewed entries" : providerDisplayName(key),
      cents: exactSum(sourceRows.map(row => row.netSalesCents)),
      recordCount: sourceRows.length,
      updatedAt,
    };
  }).sort((a, b) => b.cents - a.cents || a.label.localeCompare(b.label));
  const totalCents = exactSum(sources.map(source => source.cents));
  // Fail closed instead of publishing a plausible-looking breakdown that does
  // not account for exactly the value selected on the dashboard.
  if (totalCents !== options.expectedCents) throw Error("Revenue source attribution does not reconcile with the selected metric.");
  return { totalCents, sources, recordCount: current.length };
}
export type RevenueAttribution = ReturnType<typeof revenueAttribution>;
