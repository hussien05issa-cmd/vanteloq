import type { ResourceArticleSummary } from "./metadata";

// Lightweight homepage listings. resource-index.test.ts checks parity with the full articles.
export const RESOURCE_ARTICLE_SUMMARIES = [
  {
    "slug": "how-to-track-inventory-small-business",
    "title": "How to Track Inventory for a Small Business",
    "description": "Learn a practical small-business inventory tracking system covering SKU records, stock movements, cycle counts, reorder inputs and common accuracy problems.",
    "category": "inventory",
    "readingTime": 5
  },
  {
    "slug": "how-to-calculate-gross-margin-small-business",
    "title": "How to Calculate Gross Margin for a Small Business",
    "description": "Calculate gross profit and gross margin correctly, understand which costs belong in COGS and avoid common small-business margin mistakes.",
    "category": "finance",
    "readingTime": 5
  },
  {
    "slug": "what-should-small-business-dashboard-show",
    "title": "What Should a Small Business Dashboard Show?",
    "description": "Learn which sales, margin, cash, inventory and operations measures belong on a useful small-business dashboard, plus the context each metric needs.",
    "category": "analytics",
    "readingTime": 8
  },
  {
    "slug": "how-to-analyze-business-data-for-growth",
    "title": "How to Analyze Business Data for Sustainable Growth",
    "description": "Learn how to analyze sales, margin, cash, inventory and marketing data, test growth decisions, and scale a small business without losing control.",
    "category": "analytics",
    "readingTime": 8
  },
  {
    "slug": "data-analytics-for-small-business",
    "title": "Data Analytics for Small Business: A Practical Guide",
    "description": "Learn how to use data analytics in a small business to improve sales, margin, inventory, cash flow and daily decisions with a practical, trusted process.",
    "category": "analytics",
    "readingTime": 13
  },
  {
    "slug": "small-business-bookkeeping-system",
    "title": "A Practical Bookkeeping System for a Small Business",
    "description": "Build a reliable small-business bookkeeping system with source documents, bank reconciliation, month-end controls and an accountant-ready review process.",
    "category": "finance",
    "readingTime": 7
  },
  {
    "slug": "small-business-cash-flow-management-guide",
    "title": "Small-Business Cash Flow: A Practical Control and Forecasting Guide",
    "description": "Learn how to build a source-backed cash-flow statement, 13-week forecast, category budget and receipt-review routine without confusing profit with cash.",
    "category": "finance",
    "readingTime": 6
  },
  {
    "slug": "business-consulting-vs-business-software",
    "title": "Do You Need Vanteloq Advisory, Workspace or Both?",
    "description": "Decide whether your business needs clearer priorities, a more dependable operating workspace or both, with practical questions for comparing the full commitment.",
    "category": "operations",
    "readingTime": 4
  },
  {
    "slug": "bookloq-vs-traditional-accounting-software",
    "title": "BookLoQ vs. Traditional Accounting Software",
    "description": "Compare BookLoQ with other financial tools and see how sales, payouts, transaction review, documents and cash decisions can work together.",
    "category": "finance",
    "readingTime": 7
  },
  {
    "slug": "calculate-break-even-point",
    "title": "How to Calculate the Break-Even Point for a Small Business",
    "description": "Calculate break-even sales in units or dollars, understand contribution margin, test assumptions and use the result for pricing and operating decisions.",
    "category": "finance",
    "readingTime": 3
  },
  {
    "slug": "customer-acquisition-cost-and-lifetime-value",
    "title": "How to Calculate Customer Acquisition Cost and Lifetime Value",
    "description": "Calculate customer acquisition cost and lifetime value with consistent definitions, gross margin, payback timing and practical cohort analysis.",
    "category": "marketing",
    "readingTime": 3
  },
  {
    "slug": "marketing-strategy-that-drives-growth",
    "title": "How to Build a Marketing Strategy That Drives Growth",
    "description": "Build a focused marketing strategy around a commercial goal, priority audience, clear offer, channel roles, measurement and a practical learning rhythm.",
    "category": "marketing",
    "readingTime": 3
  },
  {
    "slug": "how-much-should-a-business-spend-on-marketing",
    "title": "How Much Should a Small Business Spend on Marketing?",
    "description": "Set a practical marketing budget using growth goals, customer economics, delivery capacity, channel evidence and a disciplined testing reserve.",
    "category": "marketing",
    "readingTime": 3
  },
  {
    "slug": "improve-website-conversion-rate",
    "title": "How to Improve Your Website Conversion Rate",
    "description": "Improve website conversion by clarifying the offer, strengthening proof, reducing friction, measuring the full journey and testing meaningful changes.",
    "category": "marketing",
    "readingTime": 3
  },
  {
    "slug": "marketing-channels-that-are-working",
    "title": "How to Know Which Marketing Channels Are Working",
    "description": "Evaluate marketing channels with clear outcomes, reliable tracking, attribution context, customer economics and practical investment decisions.",
    "category": "marketing",
    "readingTime": 3
  },
  {
    "slug": "business-systems-before-scaling",
    "title": "What Systems Does a Business Need Before Scaling?",
    "description": "Build essential systems for demand, sales, delivery, finance and leadership before adding more volume, people or locations.",
    "category": "operations",
    "readingTime": 3
  },
  {
    "slug": "repeatable-sales-process",
    "title": "How to Build a Repeatable Sales Process",
    "description": "Build a repeatable sales process with clear stages, exit criteria, qualification, evidence, follow-up, forecasting and continuous improvement.",
    "category": "operations",
    "readingTime": 3
  },
  {
    "slug": "vanteloq-retail-analytics-how-it-works",
    "title": "How Vanteloq Workspace Turns Retail Records Into Decisions",
    "description": "See how Vanteloq Workspace connects retail records, sales drivers, basket analysis and inventory signals to assigned follow-up with source limits visible.",
    "category": "pos",
    "readingTime": 4
  },
  {
    "slug": "vanteloq-ai-business-data-and-privacy",
    "title": "How Vanteloq AI Uses Business Data and Privacy Controls",
    "description": "Learn how Vanteloq AI uses permitted Workspace summaries, separates business data from memory, handles selected attachments and keeps decisions under human review.",
    "category": "ai",
    "readingTime": 5
  },
  {
    "slug": "bookloq-accounting-and-cash-flow-planning",
    "title": "How BookLoQ Connects Bookkeeping and 13-Week Cash Flow Planning",
    "description": "Explore how BookLoQ connects reviewed records, journals, financial statements and a 13-week cash forecast to support better business decisions.",
    "category": "finance",
    "readingTime": 5
  },
  {
    "slug": "retail-inventory-turnover-sell-through-gmroi",
    "title": "Inventory Turnover, Sell-Through and GMROI: What Should Retailers Track?",
    "description": "Learn how inventory turnover, sell-through and GMROI answer different retail questions, with clear formulas, limits and a worked example.",
    "category": "inventory",
    "readingTime": 5
  },
  {
    "slug": "retail-standard-operating-procedures",
    "title": "How Do You Write Retail SOPs That Staff Can Actually Use?",
    "description": "Write usable retail SOPs with clear owners, triggers, steps, handoffs and exceptions. Includes a receiving checklist and a practical review process.",
    "category": "operations",
    "readingTime": 5
  },
  {
    "slug": "customer-journey-audit-for-small-business",
    "title": "How to Audit a Small Business Customer Journey",
    "description": "Audit discovery, inquiries, quotes, purchases and customer handoffs with a practical checklist, a worked example and a clear way to prioritize improvements.",
    "category": "operations",
    "readingTime": 5
  },
  {
    "slug": "retail-founder-perspective-business-intelligence",
    "title": "What Running a Retail Business Taught Hussien Issa About Business Intelligence",
    "description": "Hussien Issa's retail experience exposed gaps between POS records and decisions, shaping Vanteloq Workspace and the approach behind Vanteloq Advisory.",
    "category": "analytics",
    "readingTime": 6
  },
  {
    "slug": "dealership-inventory-aging-carrying-costs",
    "title": "Dealership Inventory Aging: What Each Extra Day Costs",
    "description": "Review dealership inventory aging, recorded vehicle costs and carrying-cost assumptions with a practical weekly stock review and clear calculation examples.",
    "category": "inventory",
    "readingTime": 4
  },
  {
    "slug": "cafe-recipe-cost-margin-food-waste",
    "title": "Café Recipe Costs: Measure Food Contribution and Waste",
    "description": "Calculate café recipe costs, compare theoretical and actual food use, and review recorded waste without confusing food contribution with operating profit.",
    "category": "operations",
    "readingTime": 4
  },
  {
    "slug": "retail-inventory-turnover-cash-flow",
    "title": "Retail Inventory Turnover: Connect Stock to Cash Flow",
    "description": "Connect retail inventory turnover with stock age, supplier payment dates and cash forecasts, using clear cost-based formulas and fictional examples.",
    "category": "finance",
    "readingTime": 4
  }
] as const satisfies readonly ResourceArticleSummary[];
