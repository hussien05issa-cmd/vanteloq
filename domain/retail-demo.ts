import { buildRetailIntelligence, retailKey, type RetailLine, type RetailMeasurement, type RetailStock } from "./retail-intelligence";
import { parseCommercePeriod } from "./commerce-intelligence";
import { businessDateOffset } from "./intraday-sales";

const catalogue = [
  { sku: "WHEY-01", name: "Whey protein · vanilla", category: "Protein", itemType: "Powder", price: 6499, cost: 3400 },
  { sku: "CRE-01", name: "Creatine monohydrate", category: "Performance", itemType: "Powder", price: 2999, cost: 1200 },
  { sku: "BAR-01", name: "Protein bar · chocolate", category: "Protein", itemType: "Snack", price: 399, cost: 180 },
  { sku: "BOT-01", name: "Steel shaker", category: "Accessories", itemType: "Drinkware", price: 2499, cost: 850 },
  { sku: "HYD-01", name: "Electrolyte hydration", category: "Hydration", itemType: "Powder", price: 3499, cost: 1400 },
  { sku: "VIT-01", name: "Daily multivitamin", category: "Wellness", itemType: "Capsule", price: 2199, cost: 800 },
];
export function retailDemoInput(location = "all", missingCost = false) {
  const period = parseCommercePeriod("2026-05-29", "2026-06-25"), now = Date.parse("2026-06-25T19:00:00Z");
  const lines: RetailLine[] = [], stock: RetailStock[] = [], measurements: RetailMeasurement[] = [];
  const outlets = location === "central" || location === "riverside" ? [location] : ["central", "riverside"];
  for (const outlet of outlets) {
    const shop = outlet === "riverside" ? 1 : 0;
    for (let day = 0; day < 56; day++) {
      const date = businessDateOffset(period.comparisonFrom, day), current = day >= 28;
      for (let basket = 0; basket < (current ? 6 + shop : 8 + shop) + day % 3; basket++) {
        const chosen = (basket + shop) % 3 === 0 ? [0, 1, 2] : (basket + shop) % 3 === 1 ? [2, 3] : [4, 5];
        for (const item of chosen) {
          const product = catalogue[item], quantity = item === 2 ? 2 : 1, discount = current && basket % 2 === 0 ? Math.round(product.price * quantity * (shop ? .1 : .2)) : 0;
          lines.push({ provider: "sample-pos", connectionId: "northline-demo", saleId: outlet + "-" + day + "-" + basket, lineId: product.sku, productRef: product.sku, sku: product.sku, name: product.name, category: product.category, itemType: product.itemType,
            customerRef: basket === 5 ? null : outlet + "-buyer-" + ((day + basket) % 19), outletRef: outlet,
            soldAt: date + "T" + (10 + basket).toString().padStart(2, "0") + ":15:00", quantityMilli: quantity * 1000,
            netCents: product.price * quantity - discount, discountCents: discount, costCents: missingCost && item === 0 ? null : (product.cost + (current ? 50 : 0)) * quantity });
        }
      }
    }
    for (const product of catalogue) {
      const onHand = product.sku === "VIT-01" ? 320 : product.sku === "CRE-01" ? 8 + shop * 10 : 80 + shop * 20;
      const sold = lines.filter(line => line.outletRef === outlet && line.sku === product.sku && line.soldAt.slice(0, 10) >= period.from).reduce((total, line) => total + line.quantityMilli / 1000, 0);
      const opening = Math.max(0, onHand + sold - 50), received = onHand + sold - opening;
      stock.push({ key: retailKey(outlet, product.sku), name: product.name, sku: product.sku, provider: "sample-pos", connectionId: "northline-demo", outletRef: outlet, onHand, reorderPoint: 12, updatedAt: now });
      measurements.push({ kind: "stock", provider: "sample-pos", connectionId: "northline-demo", outletRef: outlet, reference: product.sku, from: period.from, to: period.to, source: "Fictional stock ledger", values: { openingUnits: opening, receivedUnits: received, openingValueCents: opening * product.cost, closingValueCents: onHand * product.cost } });
    }
    measurements.push({ kind: "labour", provider: "sample-pos", connectionId: "northline-demo", outletRef: outlet, reference: "location", from: period.from, to: period.to, source: "Fictional paid-hours ledger", values: { paidMinutes: 112 * 60, wagesCents: 268800, complete: true, attributedSalesCents: 420000, attributedTransactions: 100 } });
    for (let buyer = 0; buyer < 12; buyer++) measurements.push({ kind: "loyalty", provider: "sample-pos", connectionId: "northline-demo", outletRef: "", reference: outlet + "-buyer-" + buyer, from: "", to: "", source: "Fictional enrollment ledger", values: { memberSince: buyer < 6 ? "2026-04-01" : "2026-06-01" } });
  }
  return { lines, stock, measurements, period, timeZone: "America/Edmonton", asOfDate: period.to, now,
    lots: outlets.map(outlet => ({ name: "Protein bar · chocolate", sku: "BAR-01", locationRef: outlet, expirationDate: "2026-07-02", quantity: 12, costCents: 180 })) };
}

export function retailDemo(location = "all", missingCost = false) {
  return buildRetailIntelligence(retailDemoInput(location, missingCost));
}
