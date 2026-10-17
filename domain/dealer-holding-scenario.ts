import type { DealershipPermissions, DealershipStock } from "./dealership";

export type DealerScenarioStock = Pick<DealershipStock, "currency" | "ownership" | "availability" | "postedCostCents" | "costComplete">;
export type DealerScenarioPermissions = Pick<DealershipPermissions, "costs" | "profit">;
export type DealerHoldingAssumptions = {
  offerNowCents: number | null; futurePriceCents: number | null;
  dailyHoldingCents: number | null; waitingDays: number | null; additionalCostConfirmed: boolean;
};
export type DealerHoldingResult = {
  available: boolean; reason: string | null; holdingCostCents: number | null;
  offerContributionCents: number | null; futureContributionCents: number | null;
  differenceCents: number | null; futurePriceToMatchCents: number | null;
};
const validAmount = (value: number | null): value is number => value !== null && Number.isSafeInteger(value) && value >= 0;
const unavailable = (reason: string): DealerHoldingResult => ({ available: false, reason, holdingCostCents: null, offerContributionCents: null, futureContributionCents: null, differenceCents: null, futurePriceToMatchCents: null });

export function dealerHoldingEligibility(stock: DealerScenarioStock, permissions: DealerScenarioPermissions): string | null {
  if (!permissions.costs || !permissions.profit) return "Cost and profit access are required for this comparison.";
  if (stock.ownership !== "owned") return "This comparison requires owned stock. Consignment proceeds need a separate review of the agreement.";
  if (!["available", "held", "reserved"].includes(stock.availability)) return "Use a current stock episode, rather than a closed or archived vehicle.";
  if (!stock.costComplete || !validAmount(stock.postedCostCents)) return "Review a complete posted-cost total for this stock episode before comparing offers.";
  try {
    if (new Intl.NumberFormat("en-CA", { style: "currency", currency: stock.currency }).resolvedOptions().maximumFractionDigits !== 2) return "Use a supported vehicle currency with two decimal minor units.";
  } catch { return "Use a valid vehicle currency."; }
  return null;
}

/** Owner assumptions for one owned stock episode. No accounting, financing or inventory mutation. */
export function dealerHoldingScenario(stock: DealerScenarioStock, permissions: DealerScenarioPermissions, assumptions: DealerHoldingAssumptions): DealerHoldingResult {
  const blocked = dealerHoldingEligibility(stock, permissions);
  if (blocked) return unavailable(blocked);
  const { offerNowCents, futurePriceCents, dailyHoldingCents, waitingDays } = assumptions;
  if ([offerNowCents, futurePriceCents, dailyHoldingCents, waitingDays].some(value => value === null)) return unavailable("Enter both vehicle amounts, additional daily holding cost and additional waiting days. Unknown amounts must stay blank.");
  if (!validAmount(offerNowCents) || !validAmount(futurePriceCents) || !validAmount(dailyHoldingCents) || !Number.isSafeInteger(waitingDays) || waitingDays! < 0 || waitingDays! > 730) return unavailable("Use nonnegative integer minor-unit amounts and whole waiting days from 0 through 730.");
  if (assumptions.additionalCostConfirmed !== true) return unavailable("Confirm that the daily holding cost is additional and excludes costs already included in the posted-cost total.");
  const cost = BigInt(stock.postedCostCents!), offer = BigInt(offerNowCents), future = BigInt(futurePriceCents);
  const holding = BigInt(dailyHoldingCents) * BigInt(waitingDays!);
  const values = [holding, offer - cost, future - cost - holding, future - offer - holding, offer + holding];
  const maximum = BigInt(Number.MAX_SAFE_INTEGER);
  if (values.some(value => value > maximum || value < -maximum)) return unavailable("The scenario exceeds the supported calculation range. Review the amounts and waiting period.");
  const [holdingCostCents, offerContributionCents, futureContributionCents, differenceCents, futurePriceToMatchCents] = values.map(Number);
  return { available: true, reason: null, holdingCostCents, offerContributionCents, futureContributionCents, differenceCents, futurePriceToMatchCents };
}

/** Parse decimal vehicle amounts exactly, within the existing vehicle-entry limit. */
export function dealerScenarioAmount(text: string): number | null {
  const value = text.trim();
  if (!value) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error("Use a nonnegative amount with up to two decimal places, without symbols or separators.");
  const [whole, fraction = ""] = value.split(".");
  const minor = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  if (minor > BigInt(1_000_000_000)) throw new Error("Use an amount no greater than 10,000,000.00.");
  return Number(minor);
}
export function dealerScenarioDays(text: string): number | null {
  const value = text.trim();
  if (!value) return null;
  if (!/^\d+$/.test(value) || BigInt(value) > BigInt(730)) throw new Error("Use whole additional waiting days from 0 through 730.");
  return Number(value);
}
