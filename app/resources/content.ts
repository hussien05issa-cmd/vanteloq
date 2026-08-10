export const RESOURCE_CATEGORIES = [
  {
    slug: "inventory",
    name: "Inventory",
    shortName: "Inventory",
    description: "Practical methods for stock accuracy, turnover, replenishment, expiry risk and product-level decisions.",
  },
  {
    slug: "finance",
    name: "Finance",
    shortName: "Finance",
    description: "Clear explanations of margin, cash flow, cost of goods sold and the financial measures operators use every week.",
  },
  {
    slug: "analytics",
    name: "Business analytics",
    shortName: "Analytics",
    description: "Build useful dashboards, choose decision-ready KPIs and turn operating data into actions with traceable definitions.",
  },
  {
    slug: "marketing",
    name: "Marketing",
    shortName: "Marketing",
    description: "Measure advertising and local marketing without confusing platform-reported conversions with proven business profit.",
  },
  {
    slug: "operations",
    name: "Operations",
    shortName: "Operations",
    description: "Systems for daily work, management routines, accountability and multi-location operating visibility.",
  },
  {
    slug: "ai",
    name: "AI for business",
    shortName: "AI",
    description: "Responsible ways to use AI for analysis and decision support while keeping evidence, privacy and human review in the loop.",
  },
  {
    slug: "pos",
    name: "POS data",
    shortName: "POS",
    description: "Get more value from point-of-sale reports, transaction data, product performance and source-system reconciliation.",
  },
] as const;

export type ResourceCategory = (typeof RESOURCE_CATEGORIES)[number]["slug"];

export type ArticleTable = {
  caption: string;
  headers: readonly string[];
  rows: readonly (readonly string[])[];
};

export type ArticleSection = {
  id: string;
  heading: string;
  paragraphs?: readonly string[];
  bullets?: readonly string[];
  numbered?: readonly string[];
  formula?: {
    label: string;
    value: string;
    example?: string;
  };
  table?: ArticleTable;
  callout?: {
    title: string;
    body: string;
  };
};

export type ArticleSource = {
  title: string;
  publisher: string;
  url: string;
};

export type ResourceArticle = {
  slug: string;
  title: string;
  seoTitle: string;
  description: string;
  dek: string;
  quickAnswer: string;
  searchIntent: string;
  category: ResourceCategory;
  author: string;
  published: string;
  updated: string;
  sections: readonly ArticleSection[];
  sources: readonly ArticleSource[];
  related: readonly string[];
};

const articles: readonly ResourceArticle[] = [
  {
    slug: "how-to-track-inventory-small-business",
    title: "How to Track Inventory for a Small Business",
    seoTitle: "How to Track Inventory for a Small Business: A Practical System",
    description: "Learn a practical small-business inventory tracking system covering SKU records, stock movements, cycle counts, reorder inputs and common accuracy problems.",
    dek: "A reliable inventory system is a repeatable record of what came in, what went out, what remains and why the quantity changed.",
    quickAnswer: "Start with one record per SKU and location, record every receipt, sale, return, transfer and adjustment, then verify the records with regular physical counts. Track quantity on hand, available quantity, unit cost, reorder inputs and the timestamp of the last verified count. The system matters more than the software: every stock change needs a source and an owner.",
    searchIntent: "Informational — the reader wants a workable method to set up or improve inventory tracking.",
    category: "inventory",
    author: "Vanteloq Editorial Team",
    published: "2026-08-10",
    updated: "2026-08-10",
    sections: [
      {
        id: "inventory-record",
        heading: "1. Create one inventory record for every SKU and location",
        paragraphs: [
          "A product name is not precise enough for inventory control. Each sellable variation should have a stable stock-keeping unit, or SKU. If a shirt comes in three sizes, each size needs its own record. If the same SKU is held at two stores, each location needs its own balance.",
          "Keep the record small enough that staff will maintain it. A useful minimum is SKU, product name, location, quantity on hand, committed quantity, available quantity, unit cost, supplier, reorder point and last-counted time. Add lot or expiry fields only when the product and process actually require them.",
        ],
        table: {
          caption: "Minimum inventory record",
          headers: ["Field", "What it tells you", "Common mistake"],
          rows: [
            ["SKU", "Exactly which item or variation is being counted", "Reusing one code for several sizes or flavours"],
            ["Location", "Where the units physically belong", "Combining all stores into one balance"],
            ["On hand", "Units physically recorded at the location", "Treating purchase orders as stock on hand"],
            ["Committed", "Units reserved for open orders", "Ignoring units already promised"],
            ["Available", "On hand minus committed units", "Using on hand as the sellable balance"],
            ["Unit cost", "Recorded acquisition cost used for analysis", "Substituting retail price for cost"],
          ],
        },
      },
      {
        id: "stock-movements",
        heading: "2. Record every stock movement, not just the final balance",
        paragraphs: [
          "A balance tells you where inventory ended. A movement ledger explains how it got there. That explanation is what lets you investigate shrinkage, receiving errors and negative inventory instead of repeatedly overwriting the count.",
          "For each movement, store the SKU, location, quantity change, movement type, timestamp, source document and person or system responsible. A sale might be linked to a receipt; a receipt to a purchase order; a transfer to both its sending and receiving locations; and an adjustment to a count or damage record.",
        ],
        bullets: [
          "Receipts increase stock only when goods are actually received, not when a purchase order is created.",
          "Sales and write-offs decrease the relevant location balance.",
          "Returns need a condition decision before units become sellable again.",
          "Transfers should create linked outbound and inbound records so stock is not counted twice.",
          "Adjustments should require a reason such as count correction, damage, expiry or theft.",
        ],
      },
      {
        id: "physical-counts",
        heading: "3. Reconcile the system with physical counts",
        paragraphs: [
          "Even a well-designed system drifts when a barcode is missed, a return is put back incorrectly or a receiving quantity is entered twice. A physical count is the control that tests the record against reality.",
          "A full count checks everything at once but can interrupt operations. Cycle counting checks a manageable set of SKUs each day or week. Count high-value, high-volume and frequently adjusted items more often than stable low-risk items. Freeze or carefully control movements while a count is underway so the comparison uses the same point in time.",
        ],
        formula: {
          label: "Inventory accuracy",
          value: "Accurate counted records ÷ Total counted records × 100",
          example: "If 190 of 200 counted SKU-location records match the system within your approved tolerance, record accuracy is 95%.",
        },
        callout: {
          title: "Do not erase the evidence",
          body: "When a count differs from the system, post a documented adjustment. Replacing the balance without a movement record removes the audit trail and hides recurring process problems.",
        },
      },
      {
        id: "reorder-inputs",
        heading: "4. Separate tracking from reorder planning",
        paragraphs: [
          "Inventory tracking answers how many units are available. Reorder planning asks whether more units should be purchased. The second decision needs more than a low-stock flag: demand rate, lead time, incoming stock, case packs, minimum order quantities, shelf life, storage space and available cash can all change the right order quantity.",
          "Begin with a simple reorder point and review it whenever demand or supplier timing changes. If the inputs are uncertain, show the uncertainty rather than presenting a precise recommendation that the data cannot support.",
        ],
        formula: {
          label: "Basic reorder point",
          value: "Average daily demand × Lead time in days + Safety stock",
          example: "At 4 units per day, a 7-day lead time and 10 units of safety stock, the basic reorder point is 38 units.",
        },
      },
      {
        id: "weekly-routine",
        heading: "5. Use a simple operating rhythm",
        numbered: [
          "Daily: investigate negative quantities, failed sales imports and unreceived transfers.",
          "Two or three times per week: review items below their reorder point and confirm incoming purchase orders.",
          "Weekly: cycle-count the highest-risk SKUs and review unexplained adjustments.",
          "Monthly: compare slow movers, stockouts, sell-through and inventory value by category.",
          "Quarterly: review SKU naming, duplicate records, obsolete items and supplier lead-time assumptions.",
        ],
        paragraphs: [
          "Assign each check to a role and define what requires approval. Inventory accuracy improves when the routine is visible and owned, not when everyone assumes someone else is watching it.",
        ],
      },
      {
        id: "software-checklist",
        heading: "What inventory software should make easier",
        paragraphs: [
          "Choose software after defining the process. A useful system should preserve movement history, separate locations, connect counts to adjustments, export records, show source freshness and restrict sensitive actions. Integration does not automatically equal accuracy: imported data still needs mapping, duplicate controls and reconciliation.",
          "Vanteloq currently supports tenant-separated operating records, purchase-order and receiving workflows, aggregate inventory visibility and a review-based reorder calculation. Automatic SKU recommendations still depend on verified SKU history and supplier inputs, so they should not be treated as live until those sources are connected and reconciled.",
        ],
      },
    ],
    sources: [
      {
        title: "Inventory and cost of goods sold",
        publisher: "Canada Revenue Agency",
        url: "https://www.canada.ca/en/revenue-agency/services/tax/businesses/small-businesses-self-employed-income/business-income-tax-reporting/inventory-cost-goods-sold.html",
      },
      {
        title: "IAS 2 Inventories",
        publisher: "IFRS Foundation",
        url: "https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/",
      },
      {
        title: "Managing inventory",
        publisher: "Lightspeed Retail Support",
        url: "https://retail-support.lightspeedhq.com/hc/en-us/sections/8355677665435-Managing-inventory",
      },
    ],
    related: ["how-to-calculate-gross-margin-small-business"],
  },
  {
    slug: "how-to-calculate-gross-margin-small-business",
    title: "How to Calculate Gross Margin for a Small Business",
    seoTitle: "How to Calculate Gross Margin for a Small Business (With Examples)",
    description: "Calculate gross profit and gross margin correctly, understand which costs belong in COGS and avoid common small-business margin mistakes.",
    dek: "Gross margin shows how much of each sales dollar remains after the recorded cost of the goods or services sold—not how much the entire business earned.",
    quickAnswer: "Subtract cost of goods sold from net sales to get gross profit. Divide gross profit by net sales and multiply by 100 to get gross margin percentage. Use the same period and a consistent cost method for both figures. Gross margin excludes operating expenses such as rent, office payroll, interest and income tax, so it is not the same as net profit margin.",
    searchIntent: "Informational — the reader wants the formula, an example and guidance on interpreting the result.",
    category: "finance",
    author: "Vanteloq Editorial Team",
    published: "2026-08-10",
    updated: "2026-08-10",
    sections: [
      {
        id: "formulas",
        heading: "Gross profit and gross margin formulas",
        paragraphs: [
          "Gross profit is a dollar amount. Gross margin is that amount expressed as a share of net sales. Keep both: the percentage helps compare periods or products, while the dollar amount shows how much money remains to cover operating expenses.",
        ],
        formula: {
          label: "Gross margin percentage",
          value: "(Net sales − Cost of goods sold) ÷ Net sales × 100",
          example: "If net sales are $80,000 and cost of goods sold is $44,000, gross profit is $36,000 and gross margin is 45%.",
        },
      },
      {
        id: "net-sales",
        heading: "Use net sales for the same reporting period",
        paragraphs: [
          "Start with a clearly defined sales figure. Net sales usually reflects the source system's treatment of discounts, returns and refunds. Do not mix gross sales from one report with net costs from another without reconciling the difference.",
          "The reporting period must match. Comparing a month of cost with a quarter of sales produces a number that looks precise but has no useful meaning. Record the date range, currency, locations and source used for every margin calculation.",
        ],
      },
      {
        id: "cogs",
        heading: "Calculate cost of goods sold consistently",
        paragraphs: [
          "For a product business, cost of goods sold is the recorded cost attached to the items sold during the period. A periodic accounting calculation begins with opening inventory, adds purchases and other eligible product costs, and subtracts ending inventory. Canadian businesses should follow the tax and accounting rules that apply to their circumstances and confirm classifications with a qualified professional.",
          "The Canada Revenue Agency explains that inventory is used to calculate cost of goods sold and net income. Its T4002 guidance identifies opening inventory, purchases net of discounts and ending inventory as inputs to the calculation. Internal management reports may update more often, but they still need a consistent cost source.",
        ],
        formula: {
          label: "Periodic cost of goods sold",
          value: "Opening inventory + Net purchases and eligible direct costs − Ending inventory",
          example: "Opening inventory of $25,000 plus $70,000 of net purchases minus $29,000 of ending inventory gives $66,000 of cost of goods sold.",
        },
      },
      {
        id: "included-costs",
        heading: "Know what the percentage does and does not include",
        table: {
          caption: "Typical gross-margin boundaries",
          headers: ["Usually part of the calculation", "Usually outside gross margin"],
          rows: [
            ["Net sales for the period", "Rent and general office costs"],
            ["Recorded cost of products sold", "Interest and financing costs"],
            ["Eligible freight or direct acquisition costs under the chosen policy", "Income tax"],
            ["Direct production costs where applicable", "Owner draws and unrelated overhead"],
          ],
        },
        paragraphs: [
          "The exact classification depends on the business and accounting policy. The important management control is consistency: document the definition, apply it across periods and disclose when it changes.",
        ],
      },
      {
        id: "product-margin",
        heading: "Calculate product margin carefully",
        paragraphs: [
          "Product-level margin can reveal whether sales growth is coming from profitable items or low-margin volume. Use actual net selling price after item-level discounts and the best supported unit cost. Allocate shared costs only when the method is defensible and useful for the decision.",
          "A product with a high margin percentage can still contribute little gross profit if it rarely sells. Review margin percentage alongside units sold, gross profit dollars, return rate and inventory carrying risk.",
        ],
        formula: {
          label: "Unit gross margin",
          value: "(Net unit selling price − Recorded unit cost) ÷ Net unit selling price × 100",
          example: "A product sold for $40 after discount with a $22 recorded cost has $18 of unit gross profit and a 45% unit gross margin.",
        },
      },
      {
        id: "mistakes",
        heading: "Common gross-margin mistakes",
        bullets: [
          "Calling gross margin net profit or cash flow.",
          "Using retail price instead of actual net sales after discounts and returns.",
          "Leaving unit costs blank and treating the missing amount as zero.",
          "Comparing locations that use different cost or refund definitions.",
          "Averaging product margin percentages without weighting them by sales.",
          "Changing inventory valuation or cost classifications without marking the break in comparability.",
        ],
        callout: {
          title: "Missing cost is not zero cost",
          body: "If product cost coverage is incomplete, label the margin unavailable or provisional. Treating missing costs as zero overstates gross profit and can reverse a purchasing decision.",
        },
      },
      {
        id: "operating-use",
        heading: "Turn margin into an operating question",
        paragraphs: [
          "When gross margin changes, split the problem before acting. Check selling-price changes, discount mix, product mix, supplier cost changes, returns and missing cost records. A single blended percentage cannot tell you which cause moved.",
          "Vanteloq's current metric registry calculates source-backed gross profit as net sales less recorded cost of goods sold and gross margin as gross profit divided by net sales. It returns unavailable when required inputs are missing instead of substituting zero, and its contribution-after-labour measure remains separate from net operating profit.",
        ],
      },
    ],
    sources: [
      {
        title: "Part 3D — Cost of goods sold and gross profit",
        publisher: "Canada Revenue Agency",
        url: "https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/t4002/t4002-4.html",
      },
      {
        title: "Inventory and cost of goods sold",
        publisher: "Canada Revenue Agency",
        url: "https://www.canada.ca/en/revenue-agency/services/tax/businesses/small-businesses-self-employed-income/business-income-tax-reporting/inventory-cost-goods-sold.html",
      },
      {
        title: "Financial Performance Data",
        publisher: "Innovation, Science and Economic Development Canada",
        url: "https://ised-isde.canada.ca/site/financial-performance-data/en",
      },
    ],
    related: ["what-should-small-business-dashboard-show"],
  },
  {
    slug: "what-should-small-business-dashboard-show",
    title: "What Should a Small Business Dashboard Show?",
    seoTitle: "What Should a Small Business Dashboard Show? Practical Guide",
    description: "Learn which sales, margin, cash, inventory and operations measures belong on a useful small-business dashboard—and what context each metric needs.",
    dek: "A useful dashboard is not a wall of charts. It is a short, consistent view of current performance, important changes, data limits and the decisions that need attention.",
    quickAnswer: "Start with a small executive snapshot: net sales, transactions, average basket, gross profit and gross margin when cost coverage is reliable, current cash with known obligations, inventory value and risk, and open operational exceptions. Every metric should show its period, comparison, source and freshness. Add product, location or channel detail only when it helps explain a change or supports an action.",
    searchIntent: "Informational — the reader wants to choose practical dashboard sections and KPIs for a small business.",
    category: "analytics",
    author: "Vanteloq Editorial Team",
    published: "2026-08-10",
    updated: "2026-08-10",
    sections: [
      {
        id: "decision-first",
        heading: "Start with the decisions the dashboard needs to support",
        paragraphs: [
          "The best dashboard design begins with a management routine, not a list of available charts. A daily operating view might answer whether sales imported correctly, whether a stockout needs attention and whether a deadline has an owner. A weekly view might compare sales mix, gross margin, purchasing and staffing. A monthly view can go deeper into financial results, inventory turnover and location performance.",
          "Write down the decisions first. Then include the smallest set of measures that makes those decisions faster or more reliable. If a number never changes a question, investigation or action, it probably does not deserve the most valuable space on the page.",
        ],
        callout: {
          title: "A dashboard is an operating interface",
          body: "It should help someone notice, understand and act. A metric without a definition, comparison or owner is only decoration.",
        },
      },
      {
        id: "executive-snapshot",
        heading: "Build a focused executive snapshot",
        paragraphs: [
          "Most small businesses can begin with six to ten measures. The exact set depends on the business model, reporting cadence and available records. A retailer needs inventory and product-mix context that a professional-services firm may not. A multi-location operator needs location comparison that a single-store owner does not.",
          "Use a snapshot to show the current value and a meaningful comparison, such as the previous equivalent period, a target or a plan. Comparisons should use the same definition, currency, locations and time boundaries.",
        ],
        table: {
          caption: "Practical dashboard starting points",
          headers: ["Area", "Useful starting measure", "Context the measure needs"],
          rows: [
            ["Sales", "Net sales and transactions", "Date range, locations, refunds, tax treatment and comparison period"],
            ["Customer activity", "Average basket or revenue per transaction", "Transaction definition and exclusions"],
            ["Margin", "Gross profit and gross margin", "Recorded cost coverage and the same period as sales"],
            ["Cash", "Current operating cash", "Source time, known obligations and restricted amounts"],
            ["Inventory", "Value, stockouts and at-risk items", "Cost basis, location and last verified quantity"],
            ["Operations", "Open exceptions and overdue work", "Owner, priority, due date and approval status"],
          ],
        },
      },
      {
        id: "metric-context",
        heading: "Give every metric enough context to be trusted",
        paragraphs: [
          "A card that says sales are $42,000 is incomplete. The reader still needs to know whether the amount is gross or net, which dates and locations it covers, whether returns are included and when the source last refreshed. The same problem applies to inventory, cash and margin.",
          "Define each metric once and reuse that definition across views. Show unavailable when a required input is missing. If an estimate is useful, label it as an estimate and preserve the method and assumptions. This prevents a provisional number from quietly becoming an accepted fact after it is copied into a meeting or spreadsheet.",
        ],
        bullets: [
          "Metric name and plain-language definition",
          "Current value and comparison value",
          "Date range, location and currency",
          "Source system and last successful refresh",
          "Actual, estimated, forecast or unavailable status",
          "Known limitations, such as incomplete product costs",
        ],
      },
      {
        id: "sales-margin",
        heading: "Show sales and margin together",
        paragraphs: [
          "Revenue growth is easier to interpret when the dashboard also shows transactions, average basket, discounts, returns, product mix and supported margin. Sales can rise while gross profit falls if discounts deepen, supplier costs increase or the mix shifts toward lower-margin products.",
          "Do not treat missing cost as zero. If recorded cost coverage is incomplete, show gross margin as unavailable or provisional and identify which products or records are missing cost. Product and location detail should be used to explain a top-level change, not to overwhelm the first screen.",
        ],
        formula: {
          label: "Average basket",
          value: "Net sales ÷ Completed transactions",
          example: "Net sales of $24,000 across 600 completed transactions produces an average basket of $40, assuming the same transaction and refund rules are used throughout.",
        },
      },
      {
        id: "inventory-cash-operations",
        heading: "Connect inventory, cash and operational follow-through",
        paragraphs: [
          "Inventory ties up cash and creates service risk when the wrong items are unavailable. A retail dashboard should separate basic quantity visibility from decisions about purchasing. Useful inventory sections may include stockouts, negative balances, products below a reviewed reorder point, slow-moving items, expiry risk, incoming purchase orders and inventory value by location.",
          "Cash should not be reduced to the bank balance. Known supplier bills, payroll, tax obligations and approved purchase commitments can materially change the amount available to commit. Keep confirmed obligations separate from expected or possible amounts, and show the source and as-of time.",
          "Finally, connect important findings to work. An exception becomes useful when it has a priority, owner, due date, source reference and approval state. A dashboard that raises the same warning every day without recording the response is not closing the operating loop.",
        ],
      },
      {
        id: "alerts",
        heading: "Reserve alerts for conditions that deserve attention",
        paragraphs: [
          "Colour alone does not explain urgency. Define what makes an item informational, medium, high or critical, and include text that states the condition. A useful alert explains what changed, how much it changed, which source supports it and what review is appropriate.",
          "Avoid fixed thresholds that ignore business context. A five-percent sales decline may be expected after a promotion ends, while a smaller margin change on a high-volume category may deserve immediate review. Thresholds should be documented, reviewable and paired with human judgment.",
        ],
        numbered: [
          "State the change and affected period.",
          "Show the supporting measure and source freshness.",
          "Identify missing information or calculation limits.",
          "Assign the review to a role or named owner.",
          "Record the decision and outcome so the alert can close.",
        ],
      },
      {
        id: "dashboard-mistakes",
        heading: "Avoid common dashboard mistakes",
        bullets: [
          "Adding every available metric to the first screen.",
          "Mixing gross sales, net sales and cash receipts without clear labels.",
          "Comparing periods with different store counts or operating days.",
          "Showing margin when product cost coverage is incomplete.",
          "Using charts where a value, change and short explanation would be clearer.",
          "Hiding data freshness, source failures or estimated values.",
          "Creating alerts that have no owner, approval path or resolution state.",
          "Designing only for a wide desktop screen and losing priority on mobile.",
        ],
      },
      {
        id: "vanteloq-dashboard",
        heading: "How Vanteloq approaches the operating dashboard",
        paragraphs: [
          "Vanteloq's current command centre can organize supported sales measures, gross-profit context, cash and obligation inputs, inventory status, data quality and operational decisions. The metric registry keeps actual, estimate, forecast and unavailable states distinct, and protected actions remain subject to workspace permissions.",
          "The depth of the dashboard depends on connected or imported records. Lightspeed R-Series has a built read-only sales and inventory import, Lightspeed X-Series remains a read-only pilot and Stripe financial data remains staged for reconciliation. Vanteloq does not present unsupported connectors or missing source coverage as live business intelligence.",
        ],
      },
    ],
    sources: [
      {
        title: "Managing Books and Records",
        publisher: "Canada Revenue Agency",
        url: "https://www.canada.ca/en/revenue-agency/news/cra-multimedia-library/businesses-video-gallery/managing-books-and-records.html",
      },
      {
        title: "Key Performance Indicator (KPI) visuals",
        publisher: "Microsoft Learn",
        url: "https://learn.microsoft.com/en-us/power-bi/visuals/power-bi-visualization-kpi",
      },
      {
        title: "Financial Performance Data",
        publisher: "Innovation, Science and Economic Development Canada",
        url: "https://ised-isde.canada.ca/site/financial-performance-data/en",
      },
    ],
    related: ["how-to-track-inventory-small-business", "how-to-calculate-gross-margin-small-business"],
  },
];

export const RESOURCE_ARTICLES = articles;

export function getCategory(slug: string) {
  return RESOURCE_CATEGORIES.find((category) => category.slug === slug);
}

export function getArticle(slug: string) {
  return RESOURCE_ARTICLES.find((article) => article.slug === slug);
}

export function getArticlesByCategory(category: ResourceCategory) {
  return RESOURCE_ARTICLES.filter((article) => article.category === category);
}

export function getReadingTime(article: ResourceArticle) {
  const words = [
    article.title,
    article.dek,
    article.quickAnswer,
    ...article.sections.flatMap((section) => [
      section.heading,
      ...(section.paragraphs ?? []),
      ...(section.bullets ?? []),
      ...(section.numbered ?? []),
      section.formula?.label ?? "",
      section.formula?.value ?? "",
      section.formula?.example ?? "",
      section.callout?.title ?? "",
      section.callout?.body ?? "",
      ...(section.table?.headers ?? []),
      ...(section.table?.rows.flat() ?? []),
    ]),
  ]
    .join(" ")
    .trim()
    .split(/\s+/).length;

  return Math.max(3, Math.ceil(words / 200));
}
