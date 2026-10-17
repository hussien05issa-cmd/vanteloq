import { isCalendarDate } from "./calendar-date";
import { exactSum } from "./executive-metrics";
import { buildCollectionsDashboard, type CollectionRecord } from "./collections-dashboard";
import { buildRetailIntelligence, type RetailLine } from "./retail-intelligence";
import { parseCommercePeriod, type CommercePeriod } from "./commerce-intelligence";
import { calculateReorderRecommendation, type ReorderInputs } from "./reorder-engine";
import { assessInventoryLot, fefoSort, type InventoryLotEvidence } from "./inventory-lifecycle";
import { foodserviceRecordReport, type FoodSavedRecord } from "./foodservice";
import { dealerHoldingScenario, type DealerHoldingAssumptions, type DealerScenarioPermissions } from "./dealer-holding-scenario";
import type { DealershipStock } from "./dealership";
import type { ThirteenWeekCashFlow } from "./thirteen-week-cash-flow";
import { settlementFacts, type SavedBusinessWorkflow } from "./business-workflows";
import type { MarketingReport } from "./marketing-reporting";

export const DECISION_CARD_KINDS = ["expiry_risk", "order_affordability", "margin_change", "reorder", "overdue_invoices", "bills_due", "payout_difference", "food_variance", "vehicle_holding", "campaign_budget"] as const;
export type DecisionCardKind = typeof DECISION_CARD_KINDS[number];
export type DecisionCardValue = { amount: number; unit: "minor_currency" | "units" | "basis_points"; currency: string | null };
/** Inputs have already passed workspace, location, entitlement and consent checks. */
export type DecisionEvidenceContext = {
  period: { from: string; to: string };
  asOf: string;
  currency: string;
  freshness: "current" | "stale" | "missing";
  coverage: "complete" | "partial" | "missing";
  sources: readonly { system: string; recordIds: readonly string[]; currency: string; recordCount?: number }[];
};
export type DecisionCard = {
  id: string;
  kind: DecisionCardKind;
  title: string;
  status: "recorded" | "estimate" | "unavailable";
  value: DecisionCardValue | null;
  summary: string;
  evidence: {
    period: { from: string; to: string } | null;
    asOf: string | null;
    sources: { system: string; recordIds: string[]; currency: string; recordCount: number; referencesTruncated: boolean }[];
    formula: string;
    limitations: string[];
  };
  action: { label: string; destination: string };
  missingFields: string[];
};
type Bundle<T> = { context: DecisionEvidenceContext } & T;
export type DecisionCardsInput = {
  asOf: string;
  currency: string;
  kinds?: readonly DecisionCardKind[];
  collections?: Bundle<{ records: CollectionRecord[] }>;
  expiry?: Bundle<{ lots: InventoryLotEvidence[] }>;
  reorder?: Bundle<{ inputs: ReorderInputs; sku: string }>;
  cash?: Bundle<{ forecast: ThirteenWeekCashFlow; proposedOrderCostCents: number | null }>;
  margin?: Bundle<{ lines: RetailLine[]; period: CommercePeriod; timeZone: string; comparisonComplete: boolean }>;
  food?: Bundle<{ record: FoodSavedRecord }>;
  dealer?: Bundle<{ stock: DealershipStock; permissions: DealerScenarioPermissions; assumptions: DealerHoldingAssumptions }>;
  settlement?: Bundle<{ record: SavedBusinessWorkflow }>;
  marketing?: Bundle<{ report: MarketingReport }>;
};

const definitions: Record<DecisionCardKind, { title: string; action: string; destination: string; formula: string; required: string[] }> = {
  expiry_risk: { title: "What may remain at its shelf-life date?", action: "Review lot rotation and replenishment", destination: "Inventory", formula: "Allocate SKU demand once to dated lots in FEFO order; cost at risk = forecast remaining whole units × recorded unit cost.", required: ["dated_sellable_lots", "in_stock_demand_history", "lot_costs"] },
  order_affordability: { title: "Does this order fit reserved cash?", action: "Review the order and cash commitments", destination: "BookLoQ", formula: "Funding headroom = verified current purchasing capacity − proposed immediate order cost. Expected receipts never increase purchasing authority.", required: ["current_bank_cash", "reviewed_dated_commitments", "proposed_order_amount"] },
  margin_change: { title: "Which product's gross margin changed most?", action: "Review product prices, discounts and costs", destination: "Sales", formula: "Product margin change in basis points = current (net sales − COGS) / positive net sales − prior (net sales − COGS) / positive net sales, multiplied by 10,000.", required: ["comparable_sale_lines", "historical_costs_and_return_cost_reversals"] },
  reorder: { title: "What should I reorder?", action: "Review a draft order and its constraints", destination: "Purchasing", formula: "Use the existing demand, safety-stock and supplier-pack calculation, constrained by reserved cash, storage and shelf life.", required: ["current_inventory", "demand_history", "lead_time", "supplier_terms", "unit_cost", "cash_commitments"] },
  overdue_invoices: { title: "Which overdue invoices should I review?", action: "Review overdue invoices before following up", destination: "BookLoQ", formula: "Overdue open balance = sum of recorded invoice total − recorded applied payments/adjustments for open invoices whose due date precedes the business date.", required: ["current_invoice_balances", "due_dates"] },
  bills_due: { title: "Which bills need cash this week?", action: "Review the payment queue against cash", destination: "BookLoQ", formula: "Seven-day cash obligations = sum of open bill balances due through business date + 6 days, including overdue and disputed obligations.", required: ["current_bill_balances", "due_dates"] },
  payout_difference: { title: "Does this reviewed payout match the bank?", action: "Review the mapped components and bank reference", destination: "Workflows", formula: "Reviewed settlement difference = recorded bank deposit − sum of explicitly mapped signed settlement components.", required: ["reviewed_payout_mapping", "signed_component_references", "bank_deposit_reference"] },
  food_variance: { title: "Which food-cost variance needs review?", action: "Review portions, recipes, receipts and logged waste", destination: "Food Operations", formula: "Unexplained food-cost variance = actual inventory depletion cost − theoretical recipe cost − recorded waste cost for the same reviewed location and period.", required: ["reviewed_food_period", "inventory_counts_and_movements", "theoretical_recipe_cost", "recorded_waste_cost"] },
  vehicle_holding: { title: "What will another month of holding cost?", action: "Compare a reviewed price or wholesale option", destination: "Dealership", formula: "Additional 30-day holding cost = explicitly confirmed additional daily holding cost × 30. Posted cost and price assumptions remain separate.", required: ["owned_current_stock", "reviewed_posted_cost", "additional_daily_holding_cost"] },
  campaign_budget: { title: "Which campaign deserves another budget test?", action: "Link qualified outcomes before changing budget", destination: "Marketing", formula: "Qualified CPL = spend / deduplicated qualified leads; contribution return = (attributed contribution − spend) / spend. Provider conversion events are not qualified people.", required: ["deduplicated_qualified_leads", "permitted_campaign_sale_links", "matched_costs", "mature_attribution_window"] },
};

function card(kind: DecisionCardKind, context?: DecisionEvidenceContext): DecisionCard {
  const definition = definitions[kind];
  return { id: `decision-card:${kind}`, kind, title: definition.title, status: "unavailable", value: null,
    summary: "The required source evidence is not available for this decision.",
    evidence: { period: context ? { ...context.period } : null, asOf: context?.asOf ?? null,
      sources: context?.sources.map(source => ({ ...source, recordIds: [...new Set(source.recordIds)].slice(0, 100), recordCount: source.recordCount ?? source.recordIds.length, referencesTruncated: (source.recordCount ?? source.recordIds.length) > 100 })).slice(0, 20) ?? [], formula: definition.formula,
      limitations: context?.sources.some(source => (source.recordCount ?? source.recordIds.length) > 100) ? ["Source references are a preview of up to 100 IDs per source. The full record count and calculations are retained; open the source record pager for all evidence."] : [] },
    action: { label: definition.action, destination: definition.destination }, missingFields: [...definition.required] };
}
function withhold(result: DecisionCard, fields: readonly string[], summary: string): DecisionCard {
  return { ...result, status: "unavailable", value: null, summary, missingFields: [...new Set(fields)] };
}
function ready(context: DecisionEvidenceContext, input: Pick<DecisionCardsInput, "asOf" | "currency">): string[] {
  const fields: string[] = [];
  if (!isCalendarDate(context.period.from) || !isCalendarDate(context.period.to) || context.period.from > context.period.to || context.period.to > input.asOf) fields.push("valid_evidence_period");
  if (!isCalendarDate(context.asOf) || context.asOf > input.asOf || context.asOf < context.period.to) fields.push("valid_source_as_of");
  if (context.currency !== input.currency || context.sources.some(source => source.currency !== input.currency)) fields.push("single_currency_scope");
  if (context.freshness !== "current") fields.push("current_source_evidence");
  if (context.coverage !== "complete") fields.push("complete_scope_coverage");
  if (!context.sources.length || context.sources.some(source => !source.system.trim() || (!source.recordIds.length && source.recordCount !== 0) || source.recordIds.some(id => !id.trim())
    || source.recordCount !== undefined && (!Number.isSafeInteger(source.recordCount) || source.recordCount < source.recordIds.length))) fields.push("source_record_references");
  return fields;
}
function amount(value: number, unit: DecisionCardValue["unit"], currency: string): DecisionCardValue {
  if (!Number.isSafeInteger(value)) throw new Error("Decision values require exact safe integers.");
  return { amount: value, unit, currency: unit === "minor_currency" ? currency : null };
}
function report(result: DecisionCard, value: number, unit: DecisionCardValue["unit"], currency: string, status: "recorded" | "estimate", summary: string, limitations: string[] = []): DecisionCard {
  return { ...result, status, value: amount(value, unit, currency), summary, missingFields: [], evidence: { ...result.evidence, limitations: [...result.evidence.limitations, ...limitations].slice(0, 25) } };
}
function marginChangeBasisPoints(profit: number, sales: number, priorProfit: number, priorSales: number) {
  if (![profit, sales, priorProfit, priorSales].every(Number.isSafeInteger) || sales <= 0 || priorSales <= 0) throw new Error("Margins require exact amounts and positive sales.");
  const n = BigInt(profit) * BigInt(priorSales) - BigInt(priorProfit) * BigInt(sales), d = BigInt(sales) * BigInt(priorSales), absolute = n < BigInt(0) ? -n : n;
  const value = (absolute * BigInt(10_000) + d / BigInt(2)) / d;
  const signed = n < BigInt(0) ? -value : value;
  if (signed > BigInt(Number.MAX_SAFE_INTEGER) || signed < -BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Margin exceeds safe precision.");
  return Number(signed);
}

/** Pure adapters. They load no additional data and never execute a recommendation. */
export function buildDecisionCards(input: DecisionCardsInput): DecisionCard[] {
  if (!isCalendarDate(input.asOf) || !/^[A-Z]{3}$/.test(input.currency)) throw new Error("Decision cards require a valid business date and explicit currency.");
  const kinds = [...new Set(input.kinds ?? DECISION_CARD_KINDS)];
  if (kinds.some(kind => !DECISION_CARD_KINDS.includes(kind))) throw new Error("Choose a supported decision card.");
  return kinds.map(kind => {
    const bundle = kind === "expiry_risk" ? input.expiry : kind === "reorder" ? input.reorder : kind === "order_affordability" ? input.cash
      : kind === "margin_change" ? input.margin : ["overdue_invoices", "bills_due"].includes(kind) ? input.collections
        : kind === "food_variance" ? input.food : kind === "vehicle_holding" ? input.dealer : kind === "payout_difference" ? input.settlement : input.marketing;
    const result = card(kind, bundle?.context);
    if (!bundle) return result;
    const blocks = ready(bundle.context, input);
    if (blocks.length) return withhold(result, blocks, "Refresh or review the source scope before using this decision.");
    try {
      if (kind === "overdue_invoices" || kind === "bills_due") return collectionsCard(result, input.collections!, input);
      if (kind === "order_affordability") {
        const { forecast, proposedOrderCostCents } = input.cash!;
        if (forecast.asOf !== input.asOf || forecast.capacityStatus !== "available" || forecast.purchasingCapacityCents === null || forecast.decisionBlocks.length) return withhold(result, ["current_reconciled_cash_and_complete_commitments", ...forecast.decisionBlocks], "Current purchasing authority is withheld until cash and obligations are reviewed.");
        if (proposedOrderCostCents === null || !Number.isSafeInteger(proposedOrderCostCents) || proposedOrderCostCents < 0) return withhold(result, ["proposed_order_amount"], "Enter the complete immediate order amount, including freight and applicable tax.");
        const headroom = exactSum([forecast.purchasingCapacityCents, -proposedOrderCostCents]);
        return report(result, headroom, "minor_currency", input.currency, "estimate", headroom >= 0 ? "This immediate order fits the currently reserved purchasing cash." : "This immediate order exceeds currently reserved purchasing cash.", ["This is a conservative immediate-payment check. Review staged payments, unrecorded obligations and later bank movements separately.", forecast.boundary]);
      }
      if (kind === "reorder") {
        const { inputs, sku } = input.reorder!;
        if (inputs.dataAgeHours > 72 || inputs.demandHistoryDays < 28) return withhold(result, ["current_inventory_and_28_day_demand_history"], "Refresh inventory and a complete demand window before reviewing an order quantity.");
        const recommendation = calculateReorderRecommendation(inputs);
        if (recommendation.status === "blocked") return withhold(result, recommendation.constrainedBy, "Supplier or operating constraints block this order. Review them before ordering.");
        return report(result, recommendation.recommendedUnits, "units", input.currency, "estimate", `${sku}: review the suggested whole-unit quantity.`, [recommendation.formula, ...recommendation.assumptions, ...recommendation.missingInputs.map(field => `Additional review: ${field}`), "Incoming stock must cover the horizon; reservations and uncovered backorders must be reflected in inventory position. Recorded demand may understate lost sales."]);
      }
      if (kind === "margin_change") return marginCard(result, input.margin!, input);
      if (kind === "expiry_risk") return expiryCard(result, input.expiry!, input);
      if (kind === "food_variance") {
        const { record } = input.food!;
        if (record.kind !== "period" || record.payload.currency !== input.currency || record.from !== bundle.context.period.from || record.to !== bundle.context.period.to || record.asOfDate !== bundle.context.asOf) return withhold(result, ["matched_reviewed_food_period"], "Choose one reviewed food period with matching dates and currency.");
        const review = foodserviceRecordReport(record);
        if (review.kind !== "period") return result;
        const variance = review.metrics.unexplainedCostVariance;
        if (variance.status !== "available") return withhold(result, variance.fields, "Complete the inventory, recipe and waste evidence before interpreting food-cost variance.");
        return report(result, variance.value.minor, "minor_currency", input.currency, "recorded", "Recorded food-cost depletion differs from theoretical cost and logged waste by this amount.", ["Cost variance for the reviewed period, not ingredient quantities or a menu-item diagnosis. Unexplained variance does not establish theft or prove a cause."]);
      }
      if (kind === "vehicle_holding") {
        const { stock, permissions, assumptions } = input.dealer!;
        if (stock.currency !== input.currency) return withhold(result, ["single_currency_scope"], "Review this vehicle in its own currency.");
        const scenario = dealerHoldingScenario(stock, permissions, { ...assumptions, waitingDays: 30 });
        if (!scenario.available || scenario.holdingCostCents === null) return withhold(result, ["complete_owned_stock_and_confirmed_holding_assumptions"], scenario.reason ?? "Review the vehicle holding assumptions.");
        return report(result, scenario.holdingCostCents, "minor_currency", input.currency, "estimate", `${stock.stockNumber}: additional holding cost over the next 30 days under the entered assumptions.`, ["Owner-entered additional daily cost excludes costs already posted. This does not estimate a floorplan rate or treat principal repayment as profit expense."]);
      }
      if (kind === "payout_difference") {
        const { record } = input.settlement!;
        if (record.kind !== "settlement" || record.state === "draft" || record.currency !== input.currency || record.asOfDate !== bundle.context.asOf
          || !isCalendarDate(record.values.payoutDate) || record.values.payoutDate > record.asOfDate) return withhold(result, ["matched_reviewed_settlement"], "Use a reviewed payout record with matching source date, payout date and currency.");
        const facts = settlementFacts(record);
        if (facts.differenceCents === null || facts.missingFields.length) return withhold(result, facts.missingFields, "Map the payout components and retained bank evidence before comparing amounts.");
        return report({ ...result, evidence: { ...result.evidence, period: { from: record.values.payoutDate, to: record.values.payoutDate } } }, facts.differenceCents, "minor_currency", input.currency, "recorded", facts.differenceCents === 0 ? "The reviewed signed components equal the recorded bank deposit." : "The reviewed signed components differ from the recorded bank deposit.", ["User-reviewed payout mapping. This does not infer Stripe payout membership or verify a third-party bank connection. Manual and instant payouts require their own reviewed mapping.", ...facts.references.slice(0, 20).map(reference => `Component: ${reference}`)]);
      }
      // Current provider reports contain events and spend, not the qualified,
      // deduplicated people and matched contribution required for this decision.
      return withhold(result, definitions.campaign_budget.required, "Link qualified customer outcomes, costs and permitted attribution before judging campaign contribution. Provider conversion events cannot supply these facts.");
    } catch (error) {
      return withhold(result, ["valid_exact_source_inputs"], error instanceof Error ? error.message : "Review the source values before calculating this decision.");
    }
  });
}

function collectionsCard(result: DecisionCard, bundle: NonNullable<DecisionCardsInput["collections"]>, input: Pick<DecisionCardsInput, "asOf" | "currency">): DecisionCard {
  if (bundle.context.asOf !== input.asOf || bundle.context.period.to !== input.asOf) return withhold(result, ["current_collection_snapshot"], "Invoice and bill balances are current snapshots; refresh them for the business date.");
  const invoice = result.kind === "overdue_invoices";
  const scopedRecords = bundle.records.filter(record => record.kind === (invoice ? "receivable" : "payable"));
  if (new Set(scopedRecords.map(record => record.id)).size !== scopedRecords.length) return withhold(result, ["deduplicated_document_balances"], "A document balance appears more than once. Review the source selection.");
  const dashboard = buildCollectionsDashboard(scopedRecords, input.asOf, input.currency, 7);
  if (dashboard.invalidCount || dashboard.otherCurrencyCount || dashboard.undatedCents) return withhold(result, [dashboard.invalidCount ? "valid_payment_balances" : "", dashboard.otherCurrencyCount ? "single_currency_scope" : "", dashboard.undatedCents ? "document_due_dates" : ""].filter(Boolean), "Some open balances cannot be dated or reconciled in this currency. Review them before prioritising the queue.");
  const rows = dashboard.records.filter(record => invoice ? record.kind === "receivable" && (record.daysOverdue ?? 0) > 0 : record.kind === "payable" && record.dueDate! <= new Date(Date.parse(`${input.asOf}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10));
  const total = exactSum(rows.map(row => row.outstandingCents));
  const disputed = rows.filter(row => row.status === "disputed").length;
  const evidence = { ...result.evidence, sources: [{ system: `${bundle.context.sources.map(source => source.system).join("; ")} (${invoice ? "invoices" : "bills"})`, recordIds: rows.map(row => row.id).slice(0, 100), currency: input.currency, recordCount: rows.length, referencesTruncated: rows.length > 100 }], limitations: rows.length > 100 ? ["Source references are a preview of 100 contributing document IDs. Open the source record pager to inspect every document."] : [] };
  return report({ ...result, evidence }, total, "minor_currency", input.currency, "recorded", `${rows.length} ${invoice ? "overdue invoice" : "bill due within seven days"}${rows.length === 1 ? "" : "s"} in the reviewed document balances.`, [dashboard.boundary, ...(disputed ? [`${disputed} disputed ${invoice ? "invoice" : "bill"}${disputed === 1 ? "" : "s"} remain included; review them separately before sending a reminder or payment.`] : []), ...(rows.length > 20 ? [`${rows.length} documents contribute; the next 20 references are a preview. Open the full source queue to inspect every document.`] : []), ...rows.slice(0, 20).map(row => `${row.reference}: ${row.outstandingCents} ${input.currency} minor units; due ${row.dueDate}.`)]);
}

function marginCard(result: DecisionCard, bundle: NonNullable<DecisionCardsInput["margin"]>, input: Pick<DecisionCardsInput, "asOf" | "currency">): DecisionCard {
  const { period, lines, timeZone } = bundle;
  if (!bundle.comparisonComplete || period.from !== bundle.context.period.from || period.to !== bundle.context.period.to) return withhold(result, ["complete_aligned_comparison_period"], "Verify complete matching source periods before comparing product margins.");
  const current = buildRetailIntelligence({ lines, period, timeZone, asOfDate: input.asOf });
  const previous = buildRetailIntelligence({ lines, period: parseCommercePeriod(period.comparisonFrom, period.comparisonTo, input.asOf), timeZone, asOfDate: input.asOf });
  if (!current.comparison.comparable || current.invalidTimestampRows || current.current.costCoverage !== 1 || current.prior.costCoverage !== 1) return withhold(result, ["matched_sources_and_complete_historical_costs"], "Missing historical costs, timestamps or comparable source outlets block the margin comparison.");
  const prior = new Map(previous.products.map(product => [product.key, product]));
  const changes = current.products.flatMap(product => {
    const old = prior.get(product.key);
    if (!old || product.netCents <= 0 || old.netCents <= 0 || product.grossProfitCents === null || old.grossProfitCents === null) return [];
    return [{ name: product.name, change: marginChangeBasisPoints(product.grossProfitCents, product.netCents, old.grossProfitCents, old.netCents), key: product.key }];
  }).sort((a, b) => a.change - b.change || a.key.localeCompare(b.key));
  if (!changes.length) return withhold(result, ["positive_product_sales_in_both_periods"], "No product has supported positive net sales and complete costs in both periods.");
  const selected = changes[0];
  return report(result, selected.change, "basis_points", input.currency, "recorded", `${selected.name}: recorded gross margin change versus ${period.comparisonFrom} to ${period.comparisonTo}.`, ["Basis points measure percentage-point change; 100 basis points = 1 percentage point. This movement does not establish its cause. Inspect prices, discounts, supplier costs and sales mix."]);
}

function expiryCard(result: DecisionCard, bundle: NonNullable<DecisionCardsInput["expiry"]>, input: Pick<DecisionCardsInput, "asOf" | "currency">): DecisionCard {
  const lots = bundle.lots;
  if (!lots.length) return withhold(result, ["dated_sellable_lots"], "Add lot quantities and shelf-life dates before forecasting exposure.");
  if (new Set(lots.map(lot => lot.id)).size !== lots.length) return withhold(result, ["deduplicated_lots"], "A lot appears more than once. Reconcile the selection.");
  const groups = new Map<string, InventoryLotEvidence[]>();
  for (const lot of lots) {
    if (!lot.sku || !lot.locationRef || !isCalendarDate(lot.receivedDate) || lot.receivedDate > input.asOf || !Number.isSafeInteger(lot.quantityRemaining) || lot.quantityRemaining < 0
      || !Number.isSafeInteger(lot.unitCostCents) || lot.unitCostCents! < 0 || !isCalendarDate(lot.expirationDate ?? lot.bestBeforeDate)
      || lot.expirationDate !== null && !isCalendarDate(lot.expirationDate) || lot.bestBeforeDate !== null && !isCalendarDate(lot.bestBeforeDate)
      || lot.unitsSold30Days === null || !Number.isSafeInteger(lot.unitsSold30Days) || lot.unitsSold30Days < 0 || !Number.isSafeInteger(lot.demandHistoryDays) || lot.demandHistoryDays < 7) return withhold(result, ["valid_dated_sellable_lots_costs_and_in_stock_demand"], "Complete dated sellable quantities, exact costs and verified in-stock demand for every selected lot.");
    const key = JSON.stringify([lot.sku, lot.locationRef]);
    groups.set(key, [...(groups.get(key) ?? []), lot]);
  }
  const costs: number[] = [], limitations: string[] = ["A steady-demand FEFO scenario, not guaranteed waste or a safety determination. History must cover in-stock trading days; seasonal demand, promotions and lost sales are not inferred."];
  for (const group of groups.values()) {
    const first = group[0], denominator = BigInt(Math.min(30, first.demandHistoryDays)), velocity = BigInt(first.unitsSold30Days!);
    if (group.some(lot => lot.unitsSold30Days !== first.unitsSold30Days || Math.min(30, lot.demandHistoryDays) !== Number(denominator))) return withhold(result, ["one_verified_sku_location_demand_rate"], "Conflicting demand rates for the same SKU and location need review.");
    let consumed = BigInt(0);
    for (const lot of fefoSort(group)) {
      const assessment = assessInventoryLot(lot, new Date(`${input.asOf}T00:00:00Z`));
      const date = assessment.trackedDate!, days = Math.max(0, (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${input.asOf}T00:00:00Z`)) / 86_400_000);
      const availableDemand = BigInt(days) * velocity - consumed;
      const sellable = availableDemand > BigInt(0) ? availableDemand < BigInt(lot.quantityRemaining) * denominator ? availableDemand : BigInt(lot.quantityRemaining) * denominator : BigInt(0);
      consumed += sellable;
      const riskNumerator = BigInt(lot.quantityRemaining) * denominator - sellable;
      const riskUnits = (riskNumerator + denominator - BigInt(1)) / denominator;
      const cost = riskUnits * BigInt(lot.unitCostCents!);
      if (cost > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Lot cost exposure exceeds exact precision.");
      costs.push(Number(cost));
      limitations.push(`${lot.id}: ${riskUnits} whole units may remain at ${assessment.trackedDateKind === "expiration" ? "expiration" : "best-before"} ${date}.`);
    }
  }
  return report(result, exactSum(costs), "minor_currency", input.currency, "estimate", "Estimated cost of whole units remaining at their recorded shelf-life date after allocating demand once across lots.", limitations);
}
