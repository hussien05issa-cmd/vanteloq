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
  hero?: {
    src: string;
    alt: string;
    width: number;
    height: number;
  };
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
    searchIntent: "Informational: the reader wants a workable method to set up or improve inventory tracking.",
    category: "inventory",
    author: "Vanteloq Editorial Team",
    published: "2026-08-10",
    updated: "2026-08-10",
    hero: {
      src: "/brand/inventory-tracking-editorial-v2.webp",
      alt: "Organized product shelves, a handheld scanner and clear paths for receiving, stocking and selling inventory.",
      width: 1672,
      height: 941,
    },
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
    dek: "Gross margin shows how much of each sales dollar remains after the recorded cost of the goods or services sold. It does not show how much the entire business earned.",
    quickAnswer: "Subtract cost of goods sold from net sales to get gross profit. Divide gross profit by net sales and multiply by 100 to get gross margin percentage. Use the same period and a consistent cost method for both figures. Gross margin excludes operating expenses such as rent, office payroll, interest and income tax, so it is not the same as net profit margin.",
    searchIntent: "Informational: the reader wants the formula, an example and guidance on interpreting the result.",
    category: "finance",
    author: "Vanteloq Editorial Team",
    published: "2026-08-10",
    updated: "2026-08-10",
    hero: {
      src: "/brand/gross-margin-editorial-v2.webp",
      alt: "Sales value passing through visible cost layers into a smaller remaining gross margin stack.",
      width: 1672,
      height: 941,
    },
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
        title: "Part 3D: Cost of goods sold and gross profit",
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
    description: "Learn which sales, margin, cash, inventory and operations measures belong on a useful small-business dashboard, plus the context each metric needs.",
    dek: "A useful dashboard is not a wall of charts. It is a short, consistent view of current performance, important changes, data limits and the decisions that need attention.",
    quickAnswer: "Start with a small executive snapshot: net sales, transactions, average basket, gross profit and gross margin when cost coverage is reliable, current cash with known obligations, inventory value and risk, and open operational exceptions. Every metric should show its period, comparison, source and freshness. Add product, location or channel detail only when it helps explain a change or supports an action.",
    searchIntent: "Informational: the reader wants to choose practical dashboard sections and KPIs for a small business.",
    category: "analytics",
    author: "Vanteloq Editorial Team",
    published: "2026-08-10",
    updated: "2026-08-10",
    hero: {
      src: "/brand/dashboard-measures-editorial-v2.webp",
      alt: "Sales, cash, inventory and action signals connected to one central decision hub.",
      width: 1672,
      height: 941,
    },
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
  {
    slug: "how-to-analyze-business-data-for-growth",
    title: "How to Analyze Business Data for Sustainable Growth",
    seoTitle: "How to Analyze Business Data for Sustainable Growth",
    description: "Learn how to analyze sales, margin, cash, inventory and marketing data, test growth decisions, and scale a small business without losing control.",
    dek: "Sustainable growth comes from a repeatable decision loop: define the question, verify the inputs, explain the change, test one action and review the result against operational limits.",
    quickAnswer: "Begin with one decision, not a collection of charts. Compare a clearly defined metric with an equivalent period, then split the change into its likely drivers. Check whether margin, cash, inventory, staffing and location capacity can support the next action. Run a bounded test with a primary measure, a guardrail and a review date. Keep provider-attributed marketing results separate from verified sales and record what the evidence can and cannot prove.",
    searchIntent: "Informational: the reader wants a practical method for analyzing business data and using it to guide controlled growth.",
    category: "analytics",
    author: "Vanteloq Editorial Team",
    published: "2026-08-11",
    updated: "2026-08-11",
    hero: {
      src: "/brand/scaling-decision-editorial-hero.webp",
      alt: "An editorial still life with a payment terminal, product blocks, customer markers, coins and translucent planning panels.",
      width: 1672,
      height: 941,
    },
    sections: [
      {
        id: "decision-question",
        heading: "1. Start with a decision the business can make",
        paragraphs: [
          "Analysis is useful when it changes a decision, a priority or a follow-up. A broad request such as \"show me growth\" invites a broad dashboard and a vague conclusion. A stronger question is specific: should this location extend weekend hours, should this product receive more stock, or should this campaign receive another two weeks of budget?",
          "Write the decision, owner, scope and deadline before choosing metrics. Then identify the minimum evidence needed to answer it. A product promotion, for example, needs demand evidence, available stock, replenishment timing, supported unit economics and a cash limit. If one of those inputs is material and missing, the responsible result is blocked or provisional, not a confident recommendation.",
        ],
        callout: {
          title: "Decision first",
          body: "A metric earns space when it helps someone choose, investigate or verify an action. More data does not automatically create a better answer.",
        },
      },
      {
        id: "metric-contract",
        heading: "2. Give every number a metric contract",
        paragraphs: [
          "Two reports can use the same label and still measure different things. Net sales may include or exclude returns, taxes, tips, shipping or cancelled orders. A customer count may mean profiles, purchasers or transactions. Record the definition before comparing the values.",
          "A useful metric contract states the numerator, denominator, currency, date boundaries, time zone, locations, source system, refresh time and exclusions. It also states whether the value is an actual business record, a provider-attributed result, an external estimate, a forecast or unavailable. This context prevents a clean-looking chart from hiding incompatible records.",
        ],
        table: {
          caption: "Minimum context for a growth measure",
          headers: ["Field", "Question it answers", "Why it matters"],
          rows: [
            ["Definition", "What exactly was counted?", "Prevents similar labels from being treated as identical"],
            ["Scope", "Which dates, locations, products and channels are included?", "Keeps comparisons equivalent"],
            ["Source", "Which authorized record produced the value?", "Makes the result traceable"],
            ["Freshness", "When did the source last update successfully?", "Separates a current signal from a stale one"],
            ["Status", "Is it actual, attributed, estimated, forecast or unavailable?", "Keeps uncertainty visible"],
          ],
        },
      },
      {
        id: "explain-change",
        heading: "3. Separate what changed from why it changed",
        paragraphs: [
          "First calculate the absolute and percentage change using comparable periods. Then decompose the result. Sales can move because the number of transactions changed, the average basket changed, the mix shifted, prices moved, refunds changed or a location operated for a different number of days. Margin can move because of discounting, product mix, supplier costs, returns or missing cost records.",
          "Percentage change is unavailable when the comparison value is zero. Report the absolute movement and label the result as new activity instead of dividing by zero or inventing a percentage.",
          "Treat each explanation as supported, plausible or untested. Timing alone does not prove cause. A campaign and a sales increase can occur together while seasonality, a new location, a price change or an unrelated event explains some of the movement. The next analysis should be designed to distinguish those possibilities.",
        ],
        formula: {
          label: "Period-over-period change",
          value: "(Current value - Comparison value) / Comparison value x 100",
          example: "If equivalent weekly net sales move from $40,000 to $44,000, the increase is $4,000 or 10%. The formula describes the change, not its cause.",
        },
      },
      {
        id: "growth-constraints",
        heading: "4. Check whether the operation can support growth",
        paragraphs: [
          "Growth is not only a demand problem. A plan can increase revenue and still create a cash shortage, a stockout, weak contribution or a service failure. Before committing money, connect the proposed action to the constraints that could make it unsafe.",
          "Use a range when an input is uncertain. Supplier lead time, future demand and campaign response are not fixed facts. A conservative scenario, a working scenario and an upside scenario are more useful than one precise forecast that hides uncertainty.",
        ],
        table: {
          caption: "Growth readiness checks",
          headers: ["Area", "Evidence to check", "Stop or revise when"],
          rows: [
            ["Margin", "Net selling price, discounts, refunds, recorded cost and included variable costs", "Cost coverage is incomplete or the action breaks the approved contribution floor"],
            ["Cash", "Available balance, protected cash floor and known near-term obligations", "The commitment would reduce cash below the approved floor"],
            ["Inventory", "Available units, incoming stock, demand history, safety stock and supplier lead time", "Fulfilment risk is not supported by enough stock or replenishment time"],
            ["Capacity", "Staffing, operating hours, storage and service constraints", "The location cannot deliver the expected volume reliably"],
          ],
        },
      },
      {
        id: "segments-locations",
        heading: "5. Compare useful segments without losing scope",
        paragraphs: [
          "A blended result can hide the part of the business that moved. Break a supported change into product, category, location, channel, customer type or time-of-day segments only when those dimensions are recorded consistently. Start with the largest absolute contributors rather than chasing the largest percentages from tiny samples.",
          "Location comparisons need special care. Align operating days, currency, tax treatment and store mappings. A new store should not be compared with a mature store as though both had the same history. Regional demand should not be inferred from one location unless broader evidence supports it.",
        ],
        bullets: [
          "Compare the same metric definition across every segment.",
          "Show the denominator so a small sample is visible.",
          "Separate a location-specific pattern from a business-wide pattern.",
          "Mark unmapped or shared transactions instead of assigning them to a convenient location.",
        ],
      },
      {
        id: "marketing-seo-evidence",
        heading: "6. Use marketing and SEO data without double counting",
        paragraphs: [
          "Marketing platforms report valuable evidence, but each platform can assign credit under its own attribution model and time window. Keep Google Analytics, advertising-platform, commerce, CRM and POS outcomes separate at ingestion. Compare them in one decision packet, but do not add their conversion totals together or call provider-attributed revenue verified profit.",
          "For SEO, begin with the business's own Search Console clicks, impressions, pages and queries. Search Console can omit anonymized and lower-volume query rows, so a detailed query table may not equal the headline total. Use third-party keyword or traffic estimates for discovery, label them as external estimates and validate important opportunities against site-owned evidence.",
          "A useful SEO review asks which relevant pages receive impressions, whether clicks and click-through rate changed, which search intent the page serves, and whether the visit leads to a supported business outcome. Publishing more pages is not the goal. Clear, original content that helps the intended reader and is reviewed before publication is the safer operating standard.",
        ],
        callout: {
          title: "Attribution is a provider view",
          body: "A platform-reported conversion is evidence from that platform. It becomes a matched business outcome only after an approved identifier, scope and timing rule links it to a verified record.",
        },
      },
      {
        id: "bounded-test",
        heading: "7. Run a bounded test and measure the result",
        paragraphs: [
          "Turn the leading explanation into a testable action. State the hypothesis, baseline, primary measure, guardrail, budget ceiling, owner, start date, review date and rollback condition. Change one important variable when practical so the result can teach the team something.",
          "Choose a review window that matches the decision. A daily stockout response and an SEO content change do not mature on the same schedule. Record the outcome even when the test fails. A decision journal prevents the same unsupported idea from returning every quarter and gives future analysis better context.",
        ],
        numbered: [
          "State what you believe will change and why.",
          "Record the baseline and the exact source definition.",
          "Approve the spending, inventory and cash limits.",
          "Measure the primary result and at least one guardrail.",
          "Record what happened, what remains uncertain and the next decision.",
        ],
      },
      {
        id: "vanteloq-analysis",
        heading: "How Vanteloq strengthens the analysis loop",
        paragraphs: [
          "Vanteloq is designed to keep the decision beside its supporting records. A connected operating view can align sales, recorded cost, cash context, inventory, purchasing, location and assigned work while preserving source, period, status and missing-input warnings. That reduces the manual effort of rebuilding the same comparison across separate exports.",
          "The platform should not make unsupported growth promises. A recommendation is useful when it shows what changed, the calculation, the evidence used, the operational constraints, the missing inputs, the responsible owner and the method for reviewing the result. When a source or permission is unavailable, Vanteloq should say so and keep the decision blocked or provisional.",
        ],
      },
    ],
    sources: [
      {
        title: "Google Analytics Data API reporting basics",
        publisher: "Google for Developers",
        url: "https://developers.google.com/analytics/devguides/reporting/data/v1/basics",
      },
      {
        title: "Search Console common tasks and performance guidance",
        publisher: "Google Search Central",
        url: "https://support.google.com/webmasters/answer/17010961",
      },
      {
        title: "Search Analytics query method and data boundaries",
        publisher: "Google for Developers",
        url: "https://developers.google.com/webmaster-tools/v1/searchanalytics/query",
      },
      {
        title: "SEO Starter Guide",
        publisher: "Google Search Central",
        url: "https://developers.google.com/search/docs/fundamentals/seo-starter-guide",
      },
      {
        title: "Financial Performance Data",
        publisher: "Innovation, Science and Economic Development Canada",
        url: "https://ised-isde.canada.ca/site/financial-performance-data/en",
      },
    ],
    related: ["what-should-small-business-dashboard-show", "how-to-calculate-gross-margin-small-business", "small-business-bookkeeping-system"],
  },
  {
    slug: "small-business-bookkeeping-system",
    title: "A Practical Bookkeeping System for a Small Business",
    seoTitle: "A Practical Bookkeeping System for a Small Business",
    description: "Build a reliable small-business bookkeeping system with source documents, bank reconciliation, month-end controls and an accountant-ready review process.",
    dek: "Reliable books come from a disciplined evidence, review, reconciliation and close routine. Software can reduce the work, but it cannot turn an unsupported transaction into an accounting conclusion.",
    quickAnswer: "Keep the original invoice, receipt or statement for every material entry, record who paid or was paid, categorize the transaction under a documented policy, and reconcile bank, card, merchant and POS clearing balances regularly. Close each month only after unexplained differences, duplicate records and missing evidence are resolved or assigned. Preserve corrections through review and reversal instead of silently replacing history, then export an accountant-ready package with the source documents and open questions.",
    searchIntent: "Informational: the reader wants a practical bookkeeping workflow, reconciliation method and month-end checklist for a small business.",
    category: "finance",
    author: "Vanteloq Editorial Team",
    published: "2026-08-11",
    updated: "2026-08-11",
    hero: {
      src: "/brand/bookkeeping-month-end-editorial.webp",
      alt: "An editorial bookkeeping still life with source documents, a card reader, a secure connection marker, review tabs and a bound ledger.",
      width: 1672,
      height: 941,
    },
    sections: [
      {
        id: "source-evidence",
        heading: "1. Treat source records as evidence",
        paragraphs: [
          "A bank line proves that money moved. It does not, by itself, prove the correct account, tax treatment, customer, supplier or business purpose. Keep the original invoice, receipt, contract, statement or other source record that explains the transaction and link it to the entry under review.",
          "For each document, preserve the original file, supplier or customer, document date, amount, currency, tax fields, payment reference and review status. A clear file name helps, but searchable structured fields and a stable link to the original are what make the record useful during month-end work or a professional review.",
        ],
        callout: {
          title: "Evidence before entry",
          body: "A transaction feed is a starting point. The accounting treatment remains provisional until the supporting record, business purpose and reviewer are clear.",
        },
      },
      {
        id: "bank-feed-boundary",
        heading: "2. Keep the bank feed separate from the ledger",
        paragraphs: [
          "Connected bank data can reduce manual entry and make missing transactions easier to spot. Preserve the account, date, amount, description, pending or posted state, provider reference and import time. Do not overwrite a pending item with a posted item unless the relationship is traceable, and do not assume every deposit is revenue or every withdrawal is an expense.",
          "Use cached balances for ordinary context and request a current balance only when the decision needs it and the provider supports it. Available balance can be absent or defined differently by an institution. Show the balance type, source time and any limitation instead of presenting a single number as unrestricted cash.",
        ],
        bullets: [
          "Separate imported, reviewed, posted and reconciled states.",
          "Detect duplicates without deleting the original evidence trail.",
          "Record transfers as movement between accounts, not income and expense.",
          "Keep personal or unsupported transactions in a review queue.",
        ],
      },
      {
        id: "weekly-routine",
        heading: "3. Use a weekly capture and review routine",
        paragraphs: [
          "A short weekly routine prevents month-end from becoming a search for missing documents. Import or record the latest bank, card, POS and merchant activity, attach source records, review duplicates and clarify unusual items while the details are still familiar.",
          "Use a documented chart of accounts and a consistent categorization policy. If the correct treatment is uncertain, leave the item visibly uncategorized with an owner and due date. Guessing creates a cleaner-looking dashboard and a less reliable ledger.",
        ],
        numbered: [
          "Capture invoices, receipts and statements in the private document workspace.",
          "Review new bank and card activity, including pending-to-posted changes.",
          "Match merchant deposits to POS payout batches and their fees.",
          "Categorize supported items and assign uncertain items for review.",
          "Check overdue receivables, supplier bills and near-term cash commitments.",
        ],
      },
      {
        id: "reconciliation",
        heading: "4. Reconcile bank, card and merchant clearing accounts",
        paragraphs: [
          "Reconciliation explains the difference between an external statement and the books at the same date. Begin with the statement ending balance, compare it with the reconciled book balance, and account for timing items such as deposits in transit or outstanding payments. An unexplained difference should be zero before the period is marked complete.",
          "Retail businesses also need payout reconciliation. A processor deposit may combine several sales, subtract fees, include refunds and arrive on a different day. Match the payout batch to the POS and processor records rather than recording the net deposit as sales. This preserves gross sales, refunds, fees and clearing activity as separate facts.",
        ],
        formula: {
          label: "Unexplained reconciliation difference",
          value: "Adjusted statement balance - Reconciled book balance",
          example: "After valid timing items are recorded, the target is $0. A remaining amount stays open with its evidence and reviewer rather than being forced into a miscellaneous account.",
        },
      },
      {
        id: "invoice-capture",
        heading: "5. Review every uploaded invoice and receipt",
        paragraphs: [
          "A secure capture flow should validate the file type and size, detect duplicates, scan or quarantine files according to the configured security process, store the original privately and record who uploaded it. Mobile camera capture is useful only when the image is readable and the full document is present.",
          "Text extraction can suggest supplier, date, subtotal, tax and total fields, but it can misread a digit, duplicate tax or select the wrong page. Show field-level confidence and the source page when extraction is enabled. Require a person to compare the proposed fields with the original before posting, paying or using the amount in a tax claim.",
        ],
        callout: {
          title: "Extraction is not approval",
          body: "Keep the original document and the proposed fields side by side. A machine-readable value remains provisional until an authorized reviewer accepts or corrects it.",
        },
      },
      {
        id: "month-end-close",
        heading: "6. Close the month with visible controls",
        paragraphs: [
          "Month-end is the point where ordinary records become a reviewed reporting period. Complete the bank, card and merchant reconciliations; review accounts receivable and payable; confirm payroll and tax-related balances; investigate unusual or duplicate entries; and resolve or disclose missing documents.",
          "After approval, lock the period according to the business's policy. A later correction should use a documented adjusting entry or reversal with the original entry, reason, author and approval preserved. Silent edits make prior reports impossible to reproduce.",
        ],
        table: {
          caption: "Practical month-end close checklist",
          headers: ["Control", "Evidence", "Completion test"],
          rows: [
            ["Bank and card reconciliation", "Statements, imported transactions and timing items", "Unexplained difference is zero"],
            ["Merchant and POS clearing", "Sales batches, refunds, processor fees and deposits", "Each payout is matched or assigned"],
            ["Receivables and payables", "Open invoices, bills, credits and payment status", "Overdue and disputed items have an owner"],
            ["Source documents", "Original invoices, receipts and review status", "Missing evidence is resolved or disclosed"],
            ["Period approval", "Checklist, reviewer and close timestamp", "Reports can be reproduced from the locked records"],
          ],
        },
      },
      {
        id: "accountant-package",
        heading: "7. Prepare an accountant-ready package",
        paragraphs: [
          "A useful handoff includes the trial balance or ledger export, reconciliations, statements, source documents, receivable and payable listings, sales-tax working values, payroll summaries when applicable, inventory support and a list of unresolved questions. Use stable references so the reviewer can move from a figure to the entry and its evidence.",
          "Retention depends on the record and the rules that apply to the business. The Canada Revenue Agency generally requires relevant records and supporting documents to be kept for six years from the end of the last tax year to which they relate, with exceptions. Confirm the required period and format for the business with a qualified professional before deleting source records.",
        ],
      },
      {
        id: "bookloq-role",
        heading: "How BookLoQ supports the bookkeeping routine",
        paragraphs: [
          "BookLoQ is designed to keep connected financial activity, source documents, reconciliation work, exceptions, journal controls and reporting context in one governed workspace. Plaid-connected data can support reviewed transaction imports and balance context when the connection is configured, authorized and available. Private invoice and receipt uploads can preserve source evidence and duplicate checks for human review.",
          "BookLoQ does not turn a bank feed or extracted field into an approved accounting entry. It does not replace an accountant or tax professional, and it does not file returns, remit tax, move money or pay an invoice unless a separate feature is explicitly identified, authorized and operational. Its value is a clearer close process with visible evidence, ownership and unresolved work.",
        ],
      },
    ],
    sources: [
      {
        title: "Keeping records",
        publisher: "Canada Revenue Agency",
        url: "https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/rc188/keeping-records.html",
      },
      {
        title: "Input tax credits and required supporting documents",
        publisher: "Canada Revenue Agency",
        url: "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/calculate-prepare-report/input-tax-credit.html",
      },
      {
        title: "Transactions product overview",
        publisher: "Plaid",
        url: "https://plaid.com/docs/transactions/",
      },
      {
        title: "Balance product overview",
        publisher: "Plaid",
        url: "https://plaid.com/docs/balance/",
      },
      {
        title: "Bank reconciliation in Xero",
        publisher: "Xero Central",
        url: "https://central.xero.com/s/article/Bank-reconciliation-in-Xero",
      },
      {
        title: "File upload security guidance",
        publisher: "OWASP Foundation",
        url: "https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html",
      },
    ],
    related: ["how-to-calculate-gross-margin-small-business", "how-to-analyze-business-data-for-growth", "what-should-small-business-dashboard-show"],
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
