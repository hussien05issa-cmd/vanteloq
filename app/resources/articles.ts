export const resourceArticles = [
  {
    slug: "daily-retail-command-centre",
    category: "OPERATING RHYTHM",
    readTime: "6 min",
    title: "Build a daily retail command centre that earns attention",
    summary: "A practical framework for turning POS, inventory and cash signals into a short owner decision queue.",
    intro: "A useful command centre does not display every available number. It proves which data is current, shows the change that matters and gives the next decision a clear owner.",
    sections: [
      ["Start with four operating questions", "What sold today? What changed from the right comparison period? Which stock or cash constraint is approaching? What needs approval now? Every card should answer one of these questions or leave the screen."],
      ["Compare like with like", "Compare a partial day with the same elapsed hours on a comparable weekday. Compare month to date with the same number of days in the prior month. Label incomplete coverage so an owner never mistakes missing data for weak performance."],
      ["Keep the evidence attached", "Show the connected source, latest transaction time, distinct verified days and calculation definition beside the decision. When a required source is missing, say so directly instead of estimating a confident answer."],
    ],
  },
  {
    slug: "inventory-ordering-with-cash-constraints",
    category: "INVENTORY",
    readTime: "7 min",
    title: "Reorder inventory without trapping cash on the shelf",
    summary: "How velocity, lead time, margin, expiry and purchasing capacity combine into a defensible order recommendation.",
    intro: "A minimum-stock alert is not an order recommendation. The quantity should reflect how fast the item sells, how long replenishment takes, what the supplier requires and what the business can safely commit.",
    sections: [
      ["Calculate the coverage gap", "Estimate demand through the supplier lead time plus a transparent safety window. Subtract sellable on-hand stock and confirmed inbound units. Respect case packs, minimums and shelf capacity."],
      ["Constrain the result", "Prioritize high-velocity, high-margin and stockout-sensitive products. Reduce or defer orders when expiry risk, slow movement or upcoming cash obligations make the recommended quantity unsafe."],
      ["Record the decision", "Keep the inputs, calculation version, confidence and approving user with the purchase recommendation. The result should be explainable after demand or supplier conditions change."],
    ],
  },
  {
    slug: "pos-data-trust-checklist",
    category: "CONNECTED DATA",
    readTime: "5 min",
    title: "What to verify before trusting a connected POS dashboard",
    summary: "A field guide to ownership, completeness, totals, time zones, tender mix and reconciliation.",
    intro: "A successful OAuth connection proves account access. It does not prove that sales, refunds, payments, products and inventory have been imported correctly.",
    sections: [
      ["Confirm scope and ownership", "Verify the authorized account, selected locations, requested permissions and organization boundary. Credentials must remain encrypted and server-side, with every imported record tenant-scoped."],
      ["Reconcile the totals", "Match a known POS day to net sales, completed transactions, discounts, refunds and taxes. Check that voids and incomplete sales are excluded and that the business time zone determines the day boundary."],
      ["Measure coverage", "Report distinct business dates, expected dates, earliest and latest records and the last successful sync. Rate limits should queue a safe retry; they should not create duplicate records or an endless manual-sync loop."],
    ],
  },
  {
    slug: "cash-forecast-owner-can-use",
    category: "CASH CONTROL",
    readTime: "6 min",
    title: "Build a cash forecast an owner can actually use",
    summary: "Separate the bank balance from committed cash, uncertain inflows and safe supplier capacity.",
    intro: "The balance in the bank is not the amount available to spend. A useful forecast makes timing visible and keeps confirmed obligations separate from probable or estimated cash movement.",
    sections: [
      ["Anchor the opening position", "Start with a verified balance and timestamp. Add posted deposits and scheduled receivables only once their source and expected date are known."],
      ["Layer obligations by certainty", "Rent, payroll, tax reserves, approved purchase orders and committed bills belong in the confirmed layer. Forecast sales and uncertain collections should remain visibly separate."],
      ["Show the lowest point", "The most important output is often the date and value of the projected low point, not the closing balance. Use it to explain whether paying a supplier today creates a deficit before payroll."],
    ],
  },
] as const;

export function findResourceArticle(slug: string) {
  return resourceArticles.find((article) => article.slug === slug);
}
