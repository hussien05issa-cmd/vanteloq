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
    "readingTime": 6
  },
  {
    "slug": "how-to-analyze-business-data-for-growth",
    "title": "How to Analyze Business Data for Sustainable Growth",
    "description": "Learn how to analyze sales, margin, cash, inventory and marketing data, test growth decisions, and scale a small business without losing control.",
    "category": "analytics",
    "readingTime": 7
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
    "readingTime": 5
  }
] as const satisfies readonly ResourceArticleSummary[];
