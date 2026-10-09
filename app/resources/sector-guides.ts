import type { ResourceArticle } from "./content";

// Publication dates assume these guides are first published on October 9, 2026.
export const SECTOR_GUIDES: readonly ResourceArticle[] = [
  {
    "slug": "dealership-inventory-aging-carrying-costs",
    "title": "Dealership Inventory Aging: What Each Extra Day Costs",
    "seoTitle": "Dealership Inventory Aging and Carrying Costs | Vanteloq",
    "description": "Review dealership inventory aging, recorded vehicle costs and carrying-cost assumptions with a practical weekly stock review and clear calculation examples.",
    "dek": "An aging report becomes useful when it connects elapsed time, vehicle readiness, recorded investment and the next decision.",
    "quickAnswer": "Review each vehicle's age alongside acquisition and preparation costs, the amount actually financed, readiness and recent customer activity. Keep recorded costs separate from estimated future holding costs. A 60 day flag can start a review, but it does not determine the right price or sale channel.",
    "searchIntent": "Understand aged vehicle stock, estimate holding costs and choose a review action without relying on an arbitrary age threshold.",
    "category": "inventory",
    "author": "Vanteloq Editorial Team",
    "published": "2026-10-09",
    "updated": "2026-10-09",
    "hero": {
      "src": "/brand/sector-operating-guides-2026-10-09.webp",
      "alt": "Editorial illustration accompanying guides to dealership inventory, café recipe costs and retail working capital.",
      "width": 1344,
      "height": 768
    },
    "sections": [
      {
        "id": "age-clock",
        "heading": "1. Choose an age clock that explains the delay",
        "paragraphs": [
          "Start with a clear acquisition date and an as-of date. Also track when the vehicle arrived, became ready for sale and was first advertised. A vehicle acquired 45 days ago but ready for only 10 days needs a different discussion from one that has been advertised for the full 45 days.",
          "Use calendar dates consistently in the location's time zone. Mark a missing acquisition date as unknown. A transfer between locations should not silently reset total time in stock. Keep each acquisition episode distinct so a returned or reacquired vehicle does not inherit the wrong clock."
        ],
        "callout": {
          "title": "About the examples",
          "body": "All dollar amounts in the examples are fictional Canadian dollars. Rates, time windows, portion sizes and planning buffers illustrate a method; they are not industry targets or promised results."
        }
      },
      {
        "id": "recorded-and-holding-costs",
        "heading": "2. Separate recorded investment from ongoing holding costs",
        "paragraphs": [
          "Recorded vehicle investment may include acquisition and reviewed preparation costs. Financing, storage and other time-related costs require their own evidence and definitions. Do not apply an assumed interest rate to the entire purchase price when only part of the vehicle is financed.",
          "The relationship is commercially meaningful. In its May 14, 2025 first-quarter release, AutoCanada attributed lower floorplan financing expenses partly to reduced new and used inventory levels and lower interest rates. That is one company's dated experience, not a benchmark or forecast for an independent dealership."
        ]
      },
      {
        "id": "holding-cost-scenario",
        "heading": "3. Calculate a holding-cost scenario",
        "paragraphs": [
          "A fictional vehicle has a $22,000 acquisition cost and $1,000 of recorded preparation costs. Its recorded investment is $23,000. Assume $20,000 remains financed at a constant 8% annual rate for 45 days, using a basis of 365 days.",
          "Assumed storage of $1.50 per day adds $67.50. The scenario's selected holding costs total $264.76. A $24,000 sale would leave $1,000 above the recorded investment, or $735.24 after these selected holding costs, before other selling costs and overhead.",
          "This is a management scenario. Actual financing can involve changing balances, fees, subsidies and another day-count basis. Keep actual charges and estimates separate, and avoid counting an already recorded financing charge again. A management holding-cost estimate does not determine the vehicle's accounting carrying amount. For businesses reporting under IFRS, inventory measurement follows IAS 2's cost and net realisable value requirements."
        ],
        "formula": {
          "label": "Estimated financing cost",
          "value": "$20,000 × 8% × 45 ÷ 365 = $197.26",
          "example": "Fictional interest estimate using a constant $20,000 balance, 8% annual rate, 45 days and a basis of 365 days."
        }
      },
      {
        "id": "weekly-stock-review",
        "heading": "4. Review the oldest stock with its readiness and demand",
        "paragraphs": [
          "Use a weekly table with stock identifier, acquisition date, days held, ready date, asking price, recorded investment, financing balance, recent inquiries and next action. Add cost completeness and source date so a precise-looking amount does not hide missing preparation invoices.",
          "Possible actions include completing preparation, checking the advert, reassessing comparable vehicles, changing the sales approach or reviewing a wholesale offer. Document the reason and owner. An illustrative 30, 60 and 90 day review policy is a workflow choice, not a universal industry standard."
        ]
      },
      {
        "id": "source-backed-decision",
        "heading": "5. Keep the decision tied to its source",
        "paragraphs": [
          "Retain the source stock export, cost records and assumptions used in the review. Recheck them before acting. Faster turnover can support liquidity, but an immediate sale at any price is not automatically the best outcome. BDC distinguishes inventory from more liquid current assets when discussing working capital.",
          "In Vanteloq, dealership review starts with reviewed DMS stock CSV exports and dealership records. Aging and recorded investment depend on those inputs and the loaded stock view's coverage. Use a documented external calculation for any financing scenario that is not represented by recorded costs."
        ]
      }
    ],
    "sources": [
      {
        "title": "First-quarter results for 2025",
        "publisher": "AutoCanada",
        "url": "https://investors.autocan.ca/2025/05/autocanada-announces-first-quarter-results-2025/"
      },
      {
        "title": "IAS 2 Inventories",
        "publisher": "IFRS Foundation",
        "url": "https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/"
      },
      {
        "title": "What is working capital?",
        "publisher": "BDC",
        "url": "https://www.bdc.ca/en/articles-tools/entrepreneur-toolkit/templates-business-guides/glossary/working-capital"
      }
    ],
    "related": [
      "how-to-track-inventory-small-business",
      "how-to-calculate-gross-margin-small-business",
      "small-business-cash-flow-management-guide"
    ]
  },
  {
    "slug": "cafe-recipe-cost-margin-food-waste",
    "title": "Café Recipe Costs: Measure Food Contribution and Waste",
    "seoTitle": "Café Recipe Cost, Food Contribution and Waste | Vanteloq",
    "description": "Calculate café recipe costs, compare theoretical and actual food use, and review recorded waste without confusing food contribution with operating profit.",
    "dek": "A recipe calculation shows expected ingredient cost. Inventory counts and waste records show what the café actually used.",
    "quickAnswer": "Standardize portions and ingredient units, apply purchase prices and preparation yields, then compare recipe-based theoretical cost with actual inventory depletion for the same period. Recorded waste explains part of the difference; it should not be deducted twice. Food contribution remains before labour and other operating costs.",
    "searchIntent": "Cost a café recipe, investigate ingredient-use differences and understand why a healthy recipe margin may coexist with weak profit.",
    "category": "operations",
    "author": "Vanteloq Editorial Team",
    "published": "2026-10-09",
    "updated": "2026-10-09",
    "hero": {
      "src": "/brand/sector-operating-guides-2026-10-09.webp",
      "alt": "Editorial illustration accompanying guides to dealership inventory, café recipe costs and retail working capital.",
      "width": 1344,
      "height": 768
    },
    "sections": [
      {
        "id": "measurable-recipe",
        "heading": "1. Make the recipe measurable",
        "paragraphs": [
          "Record ingredient purchase quantity, purchase unit, purchase cost, usable preparation yield, recipe quantity and expected portions. Convert kilograms to grams or litres to millilitres before calculating. A box, bag or scoop needs a measured conversion rather than an assumed unit weight.",
          "For a fictional ingredient bought at $6 for 3,000 ml with 90% usable yield, usable quantity is 2,700 ml. A recipe using 100 ml therefore consumes about $0.22 of that ingredient. Retain calculation precision and round money for display. Apply yield only once, and check whether the recipe quantity is stated before or after preparation."
        ],
        "callout": {
          "title": "About the examples",
          "body": "All dollar amounts in the examples are fictional Canadian dollars. Rates, time windows, portion sizes and planning buffers illustrate a method; they are not industry targets or promised results."
        }
      },
      {
        "id": "recipe-food-contribution",
        "heading": "2. Define what the recipe margin includes",
        "paragraphs": [
          "Suppose a batch costs $16.50 in ingredients and produces 10 reviewed portions. Cost per portion is $1.65. At a selling price of $5.50 excluding sales tax, theoretical food cost is 30% of sales. The remaining $3.85 is recipe-only food contribution before packaging, labour, payment fees, rent and other costs.",
          "That percentage is not the café's operating profit margin. Statistics Canada's March 9, 2026 release reported a 4.1% operating profit margin for Canada's food services and drinking places subsector in 2024. The broad annual figure is context, not a café-specific target, a 2026 result or a substitute for the business's own accounts."
        ]
      },
      {
        "id": "actual-and-theoretical-cost",
        "heading": "3. Compare theoretical cost with actual food depletion",
        "paragraphs": [
          "Use the same location, period and cost basis for inventory, purchases, transfers and recipe-based sales calculations.",
          "In a fictional week, opening food inventory is $60, purchases are $170 and closing inventory is $45. With no credits or transfers, depletion is $185. Sales of 100 portions at the recipe cost above imply $165 of theoretical ingredient use. The difference is $20.",
          "If $8 of waste was recorded at the same cost basis, $12 remains unexplained. This can reflect portions, recipe substitutions, count errors, unrecorded consumption or missing data. It is not proof of theft or another single cause. Review the evidence before assigning a reason."
        ],
        "formula": {
          "label": "Actual food depletion at consistent cost",
          "value": "Opening inventory + purchases received − supplier returns/credits + transfers in − transfers out − closing inventory",
          "example": "Fictional week: $60 + $170 − $45 = $185, with no credits or transfers."
        }
      },
      {
        "id": "waste-without-double-counting",
        "heading": "4. Record waste without charging it twice",
        "paragraphs": [
          "Record waste quantity, ingredient or prepared item, cost, date and reason. Distinguish preparation losses from spoilage, overproduction and customer returns. British Columbia's Ministry provides separate food service and retail waste prevention toolkits, reflecting the value of operational controls rather than relying only on disposal.",
          "Waste already reduces closing stock and is therefore inside depletion. With $550 of net food sales and $185 of depletion, food contribution is $365 before other costs. Subtracting the recorded $8 again would count the same loss twice."
        ]
      },
      {
        "id": "weekly-food-review",
        "heading": "5. Turn the difference into a small weekly action",
        "paragraphs": [
          "Review high-volume recipes first. Check portion measurements, current supplier prices, count timing and missing recipes, then choose one change such as a smaller preparation batch. Compare equivalent trading periods after the change. Keep missing inputs visible rather than treating them as zero.",
          "Vanteloq's foodservice workspace uses reviewed recipe and period records. Its food contribution and variance calculations do not post to BookLoQ or change stock balances. A useful review keeps the recipe assumptions, inventory counts and recorded waste together so the next action has a clear basis."
        ]
      }
    ],
    "sources": [
      {
        "title": "Food services and drinking places, annual 2024",
        "publisher": "Statistics Canada",
        "url": "https://www150.statcan.gc.ca/n1/daily-quotidien/260309/dq260309a-eng.htm"
      },
      {
        "title": "Food waste prevention for businesses",
        "publisher": "Province of British Columbia",
        "url": "https://www2.gov.bc.ca/gov/content/environment/waste-management/food-and-organic-waste/prevent-food-waste/prevent-business-food-waste?keyword=2022+&keyword=business"
      }
    ],
    "related": [
      "how-to-calculate-gross-margin-small-business",
      "how-to-track-inventory-small-business",
      "what-should-small-business-dashboard-show"
    ]
  },
  {
    "slug": "retail-inventory-turnover-cash-flow",
    "title": "Retail Inventory Turnover: Connect Stock to Cash Flow",
    "seoTitle": "Retail Inventory Turnover and Cash Flow | Vanteloq",
    "description": "Connect retail inventory turnover with stock age, supplier payment dates and cash forecasts, using clear cost-based formulas and fictional examples.",
    "dek": "A shop can own valuable stock and still struggle to pay next week's bills. Connect inventory decisions to the dates cash actually moves.",
    "quickAnswer": "Calculate turnover using cost of goods sold and average inventory on the same cost basis. Then review aged stock, supplier due dates and expected cash receipts by product and location. Inventory value is not available cash, and a markdown only helps liquidity when stock sells and the payment is received.",
    "searchIntent": "Understand how slow stock affects liquidity and prioritize a stock review without confusing inventory value, sales or profit with available cash.",
    "category": "finance",
    "author": "Vanteloq Editorial Team",
    "published": "2026-10-09",
    "updated": "2026-10-09",
    "hero": {
      "src": "/brand/sector-operating-guides-2026-10-09.webp",
      "alt": "Editorial illustration accompanying guides to dealership inventory, café recipe costs and retail working capital.",
      "width": 1344,
      "height": 768
    },
    "sections": [
      {
        "id": "reliable-stock-cost",
        "heading": "1. Start with a reliable stock and cost record",
        "paragraphs": [
          "Use counted quantities and reviewed unit costs. Keep stock at cost separate from potential sales value. A shelf holding 100 units bought for $20 each represents $2,000 of recorded acquisition cost, even if the asking price is $35 per unit.",
          "Show missing costs and stale counts. A high-level stock balance can conceal products that are not moving or goods that are no longer saleable. BDC identifies inventory as a less liquid current asset than cash and highlights how slow inventory can lengthen the working capital cycle."
        ],
        "callout": {
          "title": "About the examples",
          "body": "All dollar amounts in the examples are fictional Canadian dollars. Rates, time windows, portion sizes and planning buffers illustrate a method; they are not industry targets or promised results."
        }
      },
      {
        "id": "cost-based-turnover",
        "heading": "2. Calculate turnover on a consistent basis",
        "paragraphs": [
          "For a fictional full year with $180,000 of cost of goods sold and $45,000 of average inventory, turnover is four times. Using 365 days, estimated inventory days are 365 ÷ 4 = 91.25 days. This is an average holding measure, not the exact age of every item.",
          "Monthly or weekly inventory snapshots can describe average stock better than only opening and closing balances when the business is seasonal. Do not divide selling-price revenue by cost-valued stock and label the result the same turnover measure. Return an unavailable result when average inventory or cost coverage is inadequate."
        ],
        "formula": {
          "label": "Inventory turnover",
          "value": "Cost of goods sold for the period ÷ average inventory at cost",
          "example": "Fictional year: $180,000 ÷ $45,000 = 4 times; estimated inventory days = 365 ÷ 4 = 91.25 days."
        }
      },
      {
        "id": "slow-stock-review",
        "heading": "3. Review the products hidden by the average",
        "paragraphs": [
          "Group units by product, variation and location. For each slow item, check its last movement, count date, outstanding purchase orders, expected demand and practical action. Consider a transfer, supplier return, focused promotion or purchasing pause before automatically ordering more.",
          "BDC's inventory guidance supports monitoring stock to identify slow-moving items and manage the working capital tied up in inventory. It does not establish a universal ideal turnover rate for every retailer."
        ]
      },
      {
        "id": "cash-versus-profit",
        "heading": "4. Model a sale's cash effect separately from profit",
        "paragraphs": [
          "Assume all 100 units above sell for $25 each excluding sales tax. Revenue would be $2,500 and the difference from their $2,000 acquisition cost would be $500 before other relevant costs. That is a fictional outcome, not guaranteed demand at the lower price.",
          "The cash forecast needs the actual collection or card settlement date, fees, refunds and any unpaid supplier balance. Inventory sold on credit does not become cash on the sale date. Repaying an inventory loan may also absorb part of the receipts. A fall in stock value alone does not establish cash released.",
          "An operational clearance decision and an accounting inventory write-down are different events. Businesses using IFRS follow IAS 2's lower-of-cost-and-net-realisable-value measurement; applicable reporting and tax policies need their own review."
        ]
      },
      {
        "id": "replenishment-cash-plan",
        "heading": "5. Put replenishment beside the cash forecast",
        "paragraphs": [
          "A planning reorder point can combine expected daily demand, supplier lead time and a chosen safety buffer. Four units per day over a seven day lead time, plus eight safety units, produces a 36 unit planning point. These are assumptions to check against seasonality, stockouts, supplier reliability and committed or incoming stock.",
          "Before placing the order, put its payment date in the cash forecast and compare it with expected receipts. Keep the inventory record, source invoices and purchasing decision linked. The related inventory and cash flow guides extend this routine in more detail."
        ]
      }
    ],
    "sources": [
      {
        "title": "What is working capital?",
        "publisher": "BDC",
        "url": "https://www.bdc.ca/en/articles-tools/entrepreneur-toolkit/templates-business-guides/glossary/working-capital"
      },
      {
        "title": "Inventory monitoring: 4 money-saving tips",
        "publisher": "BDC",
        "url": "https://www.bdc.ca/en/articles-tools/operations/inventory-management/inventory-monitoring-4-money-saving-tips"
      },
      {
        "title": "IAS 2 Inventories",
        "publisher": "IFRS Foundation",
        "url": "https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/"
      }
    ],
    "related": [
      "how-to-track-inventory-small-business",
      "small-business-cash-flow-management-guide",
      "how-to-calculate-gross-margin-small-business"
    ]
  }
];
