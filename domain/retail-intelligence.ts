import { businessClock, businessDateForTimestamp } from "./intraday-sales";
import type { CommercePeriod } from "./commerce-intelligence";

/** Money is signed integer minor units. Quantities use thousandths of a unit. */
export type RetailLine = {
  provider: string; connectionId: string; saleId: string; lineId: string;
  productRef: string | null; sku: string | null; name: string; category: string | null; itemType: string | null;
  customerRef: string | null; outletRef: string | null; soldAt: string;
  quantityMilli: number; netCents: number; discountCents: number; costCents: number | null;
};
export type RetailStock = {
  key: string; name: string; sku: string; provider: string; connectionId: string; outletRef: string;
  onHand: number; reorderPoint: number; updatedAt: number;
};
export type RetailLot = { name: string; sku: string; locationRef: string; expirationDate: string | null; quantity: number; costCents: number | null };
export type RetailMeasurement = {
  kind: "stock" | "labour" | "loyalty" | "catalog";
  provider: string; connectionId: string; outletRef: string; reference: string;
  from: string; to: string; source: string; values: Record<string, string | number | boolean | null>;
};
export const retailKey = (...parts: Array<string | null>) => JSON.stringify(parts);
export const retailProductKey = (line: Pick<RetailLine, "provider" | "connectionId" | "productRef" | "sku" | "name">) =>
  retailKey(line.provider, line.connectionId, line.productRef ? "product" : line.sku ? "sku" : "unclassified", line.productRef ?? line.sku ?? line.name);
const sourceKey = (line: { provider: string; connectionId: string }) => retailKey(line.provider, line.connectionId);
const ratio = (numerator: number, denominator: number) => denominator > 0 ? numerator / denominator : null;
const sum = <T>(rows: T[], fn: (row: T) => number) => rows.reduce((total, row) => {
  const value = fn(row), next = total + value;
  if (!Number.isFinite(next) || Number.isInteger(total) && Number.isInteger(value) && !Number.isSafeInteger(next)) throw new Error("Retail totals exceed exact integer arithmetic.");
  return next;
}, 0);
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const checked = (value: number) => { if (!Number.isSafeInteger(value)) throw new Error("Retail totals exceed exact integer arithmetic."); return value; };
const hourFor = (value: string, zone: string) => {
  const local = /^\d{4}-\d{2}-\d{2}T(\d{2}):\d{2}(?::\d{2}(?:\.\d+)?)?$/.exec(value);
  return local ? +local[1] : Math.floor((businessClock(new Date(value), zone)?.second ?? 0) / 3600);
};
type Basket = { key: string; source: string; soldAt: string; netCents: number; unitsMilli: number; discounted: boolean; customers: Set<string>; products: Map<string, number>; categories: Map<string, number> };
type Product = {
  key: string; provider: string; connectionId: string; reference: string; sku: string | null; name: string;
  category: string; itemType: string; netCents: number; priorNetCents: number; unitsMilli: number; purchasedUnitsMilli: number;
  discountCents: number; grossBeforeDiscountCents: number; grossProfitCents: number | null; costCoverage: number;
  basketCount: number; repeatPurchaseRate: number | null; identifiedBuyers: number; score: number | null;
  discountRate: number | null; marginRate: number | null; growthRate: number | null;
};

function uniqueLines(input: RetailLine[]) {
  const seen = new Map<string, RetailLine>();
  for (const row of input) {
    for (const value of [row.quantityMilli, row.netCents, row.discountCents, ...(row.costCents == null ? [] : [row.costCents])]) checked(value);
    const key = retailKey(row.provider, row.connectionId, row.saleId, row.lineId);
    const previous = seen.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(row)) throw new Error("Conflicting versions of a sale line need reconciliation.");
    seen.set(key, row);
  }
  return [...seen.values()];
}

function aggregate(lines: RetailLine[]) {
  const baskets = new Map<string, Basket>();
  for (const line of lines) {
    if (line.quantityMilli <= 0) continue;
    const key = retailKey(line.provider, line.connectionId, line.saleId);
    const basket = baskets.get(key) ?? { key, source: sourceKey(line), soldAt: line.soldAt, netCents: 0, unitsMilli: 0, discounted: false, customers: new Set<string>(), products: new Map<string, number>(), categories: new Map<string, number>() };
    basket.netCents = checked(basket.netCents + line.netCents); basket.unitsMilli = checked(basket.unitsMilli + line.quantityMilli); basket.discounted ||= line.discountCents > 0;
    if (line.customerRef) basket.customers.add(retailKey(line.provider, line.connectionId, line.customerRef));
    const product = retailProductKey(line), category = line.category || "Unclassified";
    basket.products.set(product, checked((basket.products.get(product) ?? 0) + line.quantityMilli));
    basket.categories.set(category, checked((basket.categories.get(category) ?? 0) + line.quantityMilli));
    baskets.set(key, basket);
  }
  // Return lines in the same receipt remove fully returned items from co-purchase sets.
  for (const line of lines.filter(row => row.quantityMilli < 0)) {
    const basket = baskets.get(retailKey(line.provider, line.connectionId, line.saleId));
    if (!basket) continue;
    const product = retailProductKey(line), category = line.category || "Unclassified";
    if (basket.products.has(product)) basket.products.set(product, basket.products.get(product)! + line.quantityMilli);
    if (basket.categories.has(category)) basket.categories.set(category, basket.categories.get(category)! + line.quantityMilli);
  }
  const purchased = lines.filter(row => row.quantityMilli > 0);
  const netCents = checked(sum(lines, row => row.netCents));
  const purchaseNetCents = checked(sum(purchased, row => row.netCents));
  const discounts = checked(sum(purchased, row => Math.max(0, row.discountCents)));
  const knownCosts = lines.filter(row => row.costCents != null);
  return {
    baskets: [...baskets.values()], netCents, purchaseNetCents, adjustmentsCents: checked(netCents - purchaseNetCents),
    purchaseBaskets: baskets.size, units: sum(purchased, row => row.quantityMilli) / 1000,
    netUnits: sum(lines, row => row.quantityMilli) / 1000,
    averageBasketCents: ratio(purchaseNetCents, baskets.size), itemsPerBasket: ratio(sum(purchased, row => row.quantityMilli) / 1000, baskets.size),
    discountCents: discounts, discountRate: ratio(discounts, purchaseNetCents + discounts),
    discountedBasketRate: ratio([...baskets.values()].filter(row => row.discounted).length, baskets.size),
    grossProfitCents: lines.length && knownCosts.length === lines.length ? checked(netCents - sum(knownCosts, row => row.costCents!)) : null,
    costCoverage: ratio(knownCosts.length, lines.length), lineCount: lines.length,
  };
}

/** Symmetric two-factor bridge: count × average basket, plus return/adjustment change.
 * Rounded effects reconcile to the exact integer-cent change, including the residual cent. */
export function revenueBridge(current: { purchaseBaskets: number; purchaseNetCents: number; adjustmentsCents: number }, prior: typeof current) {
  if (!current.purchaseBaskets || !prior.purchaseBaskets) return null;
  const n1 = BigInt(current.purchaseBaskets), n0 = BigInt(prior.purchaseBaskets);
  const numerator = (n1 - n0) * (BigInt(current.purchaseNetCents) * n0 + BigInt(prior.purchaseNetCents) * n1), denominator = BigInt(2) * n1 * n0;
  const rounded = numerator < BigInt(0) ? -((-numerator + denominator / BigInt(2)) / denominator) : (numerator + denominator / BigInt(2)) / denominator;
  const countCents = checked(Number(rounded));
  return [
    { label: "Purchase frequency", impactCents: countCents, detail: "Change in purchase-basket count, valued at the average of both periods' basket values." },
    { label: "Basket value", impactCents: checked(current.purchaseNetCents - prior.purchaseNetCents - countCents), detail: "Change in value per purchase basket, with the interaction shared equally." },
    { label: "Returns & adjustments", impactCents: checked(current.adjustmentsCents - prior.adjustmentsCents), detail: "Change in revenue on returned or zero-quantity lines. Separate from new purchases." },
  ];
}

function associations(baskets: Basket[], kind: "products" | "categories", names: Map<string, string>) {
  const counts = new Map<string, number>(), pairs = new Map<string, { a: string; b: string; source: string; count: number }>(), sourceCounts = new Map<string, number>();
  // Do not silently sample unusually large receipts. Other metrics remain available.
  if (baskets.some(b => [...b[kind].values()].filter(q => q > 0).length > 100)) return { status: "large_basket" as const, pairs: [] };
  for (const basket of baskets) {
    sourceCounts.set(basket.source, (sourceCounts.get(basket.source) ?? 0) + 1);
    const keys = [...basket[kind]].filter(([key, quantity]) => quantity > 0 && (kind !== "categories" || key !== "Unclassified")).map(([key]) => key).sort();
    for (const a of keys) { const key = retailKey(basket.source, a); counts.set(key, (counts.get(key) ?? 0) + 1); }
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const key = retailKey(basket.source, keys[i], keys[j]), pair = pairs.get(key) ?? { a: keys[i], b: keys[j], source: basket.source, count: 0 };
      pair.count++; pairs.set(key, pair);
      if (pairs.size > 100_000) return { status: "pair_limit" as const, pairs: [] };
    }
  }
  return { status: "available" as const, pairs: [...pairs.values()].filter(pair => pair.count >= 3).map(pair => {
    const total = sourceCounts.get(pair.source)!, aCount = counts.get(retailKey(pair.source, pair.a))!, bCount = counts.get(retailKey(pair.source, pair.b))!;
    return { ...pair, aName: names.get(pair.a) ?? pair.a, bName: names.get(pair.b) ?? pair.b, baskets: total, aCount, bCount, support: pair.count / total, confidence: pair.count / aCount, reverseConfidence: pair.count / bCount, lift: pair.count * total / (aCount * bCount) };
  }).sort((a, b) => b.count - a.count || b.lift - a.lift || a.aName.localeCompare(b.aName)).slice(0, 100) };
}

export function buildRetailIntelligence(input: {
  lines: RetailLine[]; period: CommercePeriod; timeZone: string; stock?: RetailStock[]; lots?: RetailLot[];
  measurements?: RetailMeasurement[]; asOfDate: string; now?: number;
}) {
  const { period, timeZone } = input;
  const measurements = input.measurements ?? [];
  const catalog = new Map(measurements.filter(m => m.kind === "catalog").map(m => [retailKey(m.provider, m.connectionId, m.reference), m.values]));
  const dated = uniqueLines(input.lines).map(line => {
    const labels = catalog.get(retailKey(line.provider, line.connectionId, line.productRef ?? line.sku ?? ""));
    const date = businessDateForTimestamp(line.soldAt, timeZone);
    return { ...line, category: typeof labels?.category === "string" && labels.category ? labels.category : line.category, itemType: typeof labels?.itemType === "string" && labels.itemType ? labels.itemType : line.itemType, date, hour: date ? hourFor(line.soldAt, timeZone) : null };
  });
  const currentLines = dated.filter(row => row.date && row.date >= period.from && row.date <= period.to);
  const priorLines = dated.filter(row => row.date && row.date >= period.comparisonFrom && row.date <= period.comparisonTo);
  const current = aggregate(currentLines), prior = aggregate(priorLines);
  const currentSources = [...new Set(currentLines.map(row => retailKey(row.provider, row.connectionId, row.outletRef)))].sort(), priorSources = [...new Set(priorLines.map(row => retailKey(row.provider, row.connectionId, row.outletRef)))].sort();
  const sameSources = currentSources.length > 0 && JSON.stringify(currentSources) === JSON.stringify(priorSources);
  const comparable = sameSources && current.purchaseBaskets > 0 && prior.purchaseBaskets > 0;
  const names = new Map(currentLines.map(line => [retailProductKey(line), line.name]));
  const groups = new Map<string, typeof currentLines>();
  for (const row of [...currentLines, ...priorLines]) { const key = retailProductKey(row); if (!groups.has(key)) groups.set(key, []); groups.get(key)!.push(row); }
  const buyerBaskets = new Map<string, Set<string>>();
  const basketsByProduct = new Map<string, Basket[]>();
  for (const basket of current.baskets) for (const [key, quantity] of basket.products) if (quantity > 0) {
    if (!basketsByProduct.has(key)) basketsByProduct.set(key, []);
    basketsByProduct.get(key)!.push(basket);
  }
  for (const basket of current.baskets) if (basket.customers.size === 1) {
    const buyer = [...basket.customers][0]; if (!buyerBaskets.has(buyer)) buyerBaskets.set(buyer, new Set()); buyerBaskets.get(buyer)!.add(basket.key);
  }
  const products: Product[] = [...groups].map(([key, rows]) => {
    const first = rows[0], active = rows.filter(row => row.date! >= period.from), previous = rows.filter(row => row.date! <= period.comparisonTo);
    const costsKnown = active.filter(row => row.costCents != null).length;
    const netCents = checked(sum(active, row => row.netCents)), priorNetCents = checked(sum(previous, row => row.netCents));
    const positive = active.filter(row => row.quantityMilli > 0), discountCents = sum(positive, row => Math.max(0, row.discountCents));
    const grossBeforeDiscountCents = sum(positive, row => row.netCents) + discountCents;
    const productBaskets = basketsByProduct.get(key) ?? [], buyers = new Map<string, number>();
    for (const basket of productBaskets) if (basket.customers.size === 1) { const buyer = [...basket.customers][0]; buyers.set(buyer, (buyers.get(buyer) ?? 0) + 1); }
    const grossProfitCents = active.length && costsKnown === active.length ? checked(netCents - sum(active, row => row.costCents!)) : null;
    return { key, provider: first.provider, connectionId: first.connectionId, reference: first.productRef ?? first.sku ?? "", sku: first.sku, name: first.name,
      category: first.category || "Unclassified", itemType: first.itemType || "Not classified", netCents, priorNetCents,
      unitsMilli: sum(active, row => row.quantityMilli), purchasedUnitsMilli: sum(positive, row => row.quantityMilli), discountCents, grossBeforeDiscountCents, grossProfitCents,
      costCoverage: active.length ? costsKnown / active.length : 0, basketCount: productBaskets.length, identifiedBuyers: buyers.size, repeatPurchaseRate: ratio([...buyers.values()].filter(n => n >= 2).length, buyers.size),
      score: null, discountRate: ratio(discountCents, grossBeforeDiscountCents), marginRate: grossProfitCents == null ? null : ratio(grossProfitCents, netCents),
      growthRate: comparable ? ratio(netCents - priorNetCents, priorNetCents) : null };
  }).sort((a, b) => b.netCents - a.netCents || a.name.localeCompare(b.name));
  const eligible = products.filter(p => p.netCents > 0 && p.purchasedUnitsMilli > 0);
  // Transparent merchandising heuristic, not a predictive model or industry benchmark.
  const ranks = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b), output = new Map<number, number>();
    for (let start = 0; start < sorted.length;) {
      let end = start + 1; while (end < sorted.length && sorted[end] === sorted[start]) end++;
      output.set(sorted[start], (start + (end - start - 1) / 2) / (sorted.length - 1)); start = end;
    }
    return output;
  };
  const revenueRanks = ranks(eligible.map(p => p.netCents)), unitRanks = ranks(eligible.map(p => p.purchasedUnitsMilli));
  if (current.purchaseBaskets >= 10 && eligible.length >= 3) for (const product of eligible) product.score = Math.round(100 * (
    .4 * revenueRanks.get(product.netCents)! + .3 * unitRanks.get(product.purchasedUnitsMilli)! + .3 * (1 - Math.max(0, Math.min(1, product.discountRate ?? 0)))));
  const categoryProducts = new Map<string, Product[]>();
  for (const product of products) { if (!categoryProducts.has(product.category)) categoryProducts.set(product.category, []); categoryProducts.get(product.category)!.push(product); }
  const categories = [...categoryProducts].map(([name, rows]) => {
    const netCents = checked(sum(rows, p => p.netCents)), priorNetCents = checked(sum(rows, p => p.priorNetCents));
    return { name, netCents, priorNetCents, impactCents: netCents - priorNetCents, units: sum(rows, p => p.unitsMilli) / 1000, growthRate: comparable ? ratio(netCents - priorNetCents, priorNetCents) : null };
  }).sort((a, b) => b.netCents - a.netCents);
  const hours = Array.from({ length: 24 }, (_, hour) => {
    const rows = currentLines.filter(row => row.hour === hour), baskets = new Set(rows.filter(r => r.quantityMilli > 0).map(r => retailKey(r.provider, r.connectionId, r.saleId)));
    return { hour, netCents: rows.length ? checked(sum(rows, row => row.netCents)) : null, purchaseBaskets: baskets.size, observedDates: new Set(rows.map(r => r.date)).size };
  });
  const daily = new Map<string, number>();
  for (const row of [...currentLines, ...priorLines]) daily.set(row.date!, checked((daily.get(row.date!) ?? 0) + row.netCents));
  const days = [...daily].sort(([a], [b]) => a.localeCompare(b)).map(([date, netCents]) => ({ date, netCents }));
  const linesByStock = new Map<string, typeof currentLines>();
  for (const row of currentLines) {
    const key = retailKey(row.provider, row.connectionId, row.outletRef, row.sku);
    if (!linesByStock.has(key)) linesByStock.set(key, []);
    linesByStock.get(key)!.push(row);
  }
  const anomalies = days.filter(day => day.date >= period.from).flatMap(day => {
    const weekday = new Date(day.date + "T12:00:00Z").getUTCDay();
    const baseline = days.filter(other => other.date < day.date && new Date(other.date + "T12:00:00Z").getUTCDay() === weekday).slice(-8).map(row => row.netCents);
    if (baseline.length < 4 || !sameSources) return [];
    const center = median(baseline), mad = median(baseline.map(value => Math.abs(value - center)));
    if (!mad || Math.abs(day.netCents - center) <= 3.5 * 1.4826 * mad) return [];
    return [{ date: day.date, netCents: day.netCents, baselineCents: center, differenceCents: day.netCents - center, observations: baseline.length }];
  });
  const stocks = (input.stock ?? []).map(stock => {
    const rows = linesByStock.get(retailKey(stock.provider, stock.connectionId, stock.outletRef, stock.sku)) ?? [];
    const units = sum(rows, row => row.quantityMilli) / 1000, velocity = Math.max(0, units) / period.days;
    const measurement = measurements.find(m => m.kind === "stock" && m.provider === stock.provider && m.connectionId === stock.connectionId && m.outletRef === stock.outletRef && m.reference === stock.sku && m.from === period.from && m.to === period.to);
    const values = measurement?.values;
    const averageValue = values && typeof values.openingValueCents === "number" && typeof values.closingValueCents === "number" ? (values.openingValueCents + values.closingValueCents) / 2 : null;
    const cogs = rows.length && rows.every(row => row.costCents != null) ? sum(rows, row => row.costCents!) : null;
    const turnover = averageValue != null && cogs != null && cogs >= 0 ? ratio(cogs, averageValue) : null;
    const stockAvailable = values && typeof values.openingUnits === "number" && typeof values.receivedUnits === "number" ? values.openingUnits + values.receivedUnits : null;
    const sellThrough = stockAvailable != null && units >= 0 && units <= stockAvailable ? ratio(units, stockAvailable) : null;
    const fresh = (input.now ?? Date.now()) - stock.updatedAt <= 36 * 3600_000 && stock.updatedAt <= (input.now ?? Date.now()) + 300_000;
    const forward = period.to === input.asOfDate && fresh;
    return { ...stock, units, dailyVelocity: velocity, daysOfCover: forward && velocity > 0 ? Math.max(0, stock.onHand) / velocity : null,
      reorderUnits: forward && units > 0 ? Math.max(0, Math.ceil(Math.max(stock.reorderPoint, velocity * 21) - stock.onHand)) : null,
      overstock: forward && units > 0 ? stock.onHand > Math.max(stock.reorderPoint, velocity * 90) : null,
      turnover, daysOnHand: turnover != null && turnover > 0 ? period.days / turnover : null, sellThrough, measurementSource: measurement?.source ?? null,
      stockInputIssue: stockAvailable != null && units > stockAvailable ? "Recorded sales exceed opening units plus receipts. Reconcile stock movements." : null, fresh };
  });
  const lots = (input.lots ?? []).filter(lot => lot.quantity > 0 && lot.expirationDate).map(lot => ({
    ...lot, daysToExpiry: Math.round((Date.parse(lot.expirationDate! + "T00:00:00Z") - Date.parse(input.asOfDate + "T00:00:00Z")) / 86400000),
    valueAtRiskCents: lot.costCents == null ? null : Math.round(lot.quantity * lot.costCents),
  })).filter(lot => lot.daysToExpiry <= 30).sort((a, b) => a.daysToExpiry - b.daysToExpiry);
  const labour = measurements.filter(m => m.kind === "labour" && m.from === period.from && m.to === period.to);
  // Each location is measured once, even when multiple source accounts map to it.
  const paidMinutes = sum(labour, m => Number(m.values.paidMinutes ?? 0));
  const labourSourceKeys = new Set(labour.flatMap(m => typeof m.values.outletKeys === "string" ? JSON.parse(m.values.outletKeys) as string[] : [retailKey(m.provider, m.connectionId, m.outletRef)]));
  const soldSourceKeys = new Set(currentLines.map(l => retailKey(l.provider, l.connectionId, l.outletRef)));
  const labourComplete = currentLines.length > 0 && labour.length > 0 && labour.every(m => m.values.complete === true) && [...soldSourceKeys].every(key => labourSourceKeys.has(key));
  const labourNet = sum(currentLines.filter(l => labourSourceKeys.has(retailKey(l.provider, l.connectionId, l.outletRef))), l => l.netCents);
  const wagesKnown = labour.length > 0 && labour.every(m => typeof m.values.wagesCents === "number");
  const employeeTransactions = sum(labour, m => Number(m.values.attributedTransactions ?? 0));
  const employeeSales = sum(labour, m => Number(m.values.attributedSalesCents ?? 0));
  const loyalty = new Map(measurements.filter(m => m.kind === "loyalty").map(m => [retailKey(m.provider, m.connectionId, m.reference), m.values]));
  const cohorts = { member: [] as Basket[], nonMember: [] as Basket[], unknown: [] as Basket[] };
  for (const basket of current.baskets) {
    const buyer = basket.customers.size === 1 ? [...basket.customers][0] : null, state = buyer ? loyalty.get(buyer) : null;
    const date = businessDateForTimestamp(basket.soldAt, timeZone)!;
    if (!state || typeof state.memberSince !== "string") cohorts.unknown.push(basket);
    else if (state.memberSince <= date) cohorts.member.push(basket);
    else cohorts.nonMember.push(basket);
  }
  const cohort = (baskets: Basket[]) => ({ baskets: baskets.length, netCents: sum(baskets, b => b.netCents), averageBasketCents: ratio(sum(baskets, b => b.netCents), baskets.length) });
  const { baskets: _currentBaskets, ...currentTotals } = current, { baskets: _priorBaskets, ...priorTotals } = prior;
  void _currentBaskets; void _priorBaskets;
  return {
    period, timeZone, current: currentTotals, prior: priorTotals,
    comparison: { comparable, sameSources, growthRate: comparable ? ratio(current.netCents - prior.netCents, prior.netCents) : null, deltaCents: comparable ? current.netCents - prior.netCents : null,
      currentObservedDays: new Set(currentLines.map(r => r.date)).size, priorObservedDays: new Set(priorLines.map(r => r.date)).size,
      note: "Change in recorded sales across equal calendar periods. Missing records and closed days cannot be distinguished from this feed; confirm sync coverage before interpreting a business trend." },
    bridge: comparable ? revenueBridge(current, prior) : null, products, categories,
    baskets: { products: associations(current.baskets, "products", names), categories: associations(current.baskets, "categories", new Map()),
      sizeBands: [1, 2, 3, 4, 5].map(size => ({ label: size === 5 ? "Over 4 items" : "Up to " + size + " item" + (size === 1 ? "" : "s"), baskets: current.baskets.filter(b => size === 5 ? b.unitsMilli > 4000 : b.unitsMilli > (size - 1) * 1000 && b.unitsMilli <= size * 1000).length })) },
    customers: { identifiedBuyers: buyerBaskets.size, repeatBuyers: [...buyerBaskets.values()].filter(b => b.size >= 2).length,
      repeatPurchaseRate: ratio([...buyerBaskets.values()].filter(b => b.size >= 2).length, buyerBaskets.size), identityCoverage: ratio(current.baskets.filter(b => b.customers.size === 1).length, current.purchaseBaskets),
      loyalty: { member: cohort(cohorts.member), beforeEnrollment: cohort(cohorts.nonMember), unknown: cohort(cohorts.unknown) } },
    inventory: stocks, expiry: lots, hours, days, anomalies,
    operations: { paidHours: labour.length ? paidMinutes / 60 : null, labourComplete, salesPerLabourHourCents: labourComplete && paidMinutes > 0 ? labourNet * 60 / paidMinutes : null,
      averagePaidRateCents: wagesKnown && paidMinutes > 0 ? sum(labour, m => Number(m.values.wagesCents)) * 60 / paidMinutes : null,
      attributedAverageBasketCents: labour.every(m => m.values.attributedSalesCents != null && m.values.attributedTransactions != null) && employeeTransactions > 0 ? employeeSales / employeeTransactions : null },
    invalidTimestampRows: dated.filter(row => !row.date).length,
    dataQualityWarnings: dated.some(row => !row.date) ? ["Records with invalid timestamps were excluded. Reconcile the source before relying on period comparisons."] : [] as string[],
    methodology: {
      score: "Sales performance score: 40% revenue percentile + 30% purchased-unit percentile + 30% full-price share. Relative to products in this selection; at least 10 baskets and 3 selling products. Not a forecast.",
      baskets: "Distinct purchase receipts; returned items within the same receipt are removed from pairs. Minimum 3 paired baskets. Support, confidence and lift use only baskets from the same source account. Association does not prove causation.",
      repeat: "Identified buyers with at least two purchase baskets in this period / identified buyers. Per-SKU repeat uses distinct baskets containing that SKU. This is observed repeat activity, not cohort retention.",
      inventory: "Turnover = period COGS / mean of opening and closing inventory cost. Days on hand = period days / turnover. Sell-through = net units sold / (opening units + receipts). Recorded stock adjustments may require reconciliation.",
      planning: "Reorder review targets 21 days of recent velocity or the configured reorder point, whichever is larger. Overstock review threshold is 90 days. Assumptions exclude lead times, seasonality and lost sales. Current stock must be at most 36 hours old.",
      hours: "Revenue grouped by business-local hour. Hours without sale records are unknown, not verified closed or zero. Sales per labour hour requires reviewed, complete paid minutes for every observed source outlet.",
      anomalies: "Observed-day net revenue versus the previous 4–8 observations of the same weekday. Flag above 3.5 × 1.4826 × median absolute deviation. Missing days are not zero; a flag is a review prompt, not a cause.",
    },
  };
}
export type RetailIntelligence = ReturnType<typeof buildRetailIntelligence>;
export type RetailAccess = { inventory: boolean; customers: boolean; labour: boolean; profit: boolean; costs: boolean; expiry: boolean; edit: boolean };
export type RetailReport = Omit<RetailIntelligence, "customers" | "operations"> & { customers: RetailIntelligence["customers"] | null; operations: RetailIntelligence["operations"] | null };
