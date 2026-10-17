import type { IndustryId } from "../../domain/industry-templates";

export type SolutionSector = {
  slug: "dealerships" | "cafes" | "restaurants";
  industryId: IndustryId;
  label: string;
  title: string;
  description: string;
  headline: string;
  introduction: string;
  fit: string;
  question: string;
  inputHeading: string;
  inputs: readonly string[];
  workflows: readonly { title: string; records: string; decision: string }[];
  example: {
    title: string;
    rows: readonly { label: string; value: string }[];
    resultLabel: string;
    result: string;
    explanation: string;
    boundary: string;
  };
  boundaries: readonly { title: string; detail: string }[];
  guides: readonly { href: string; title: string; description: string }[];
  tool: { href: string; title: string; description: string };
};

// Public descriptions of the existing industry templates, sector review records
// and dealership workspace. These are not evidence of a connected customer system.
export const SOLUTION_SECTORS: readonly SolutionSector[] = [
  {
    slug: "dealerships",
    industryId: "dealership",
    label: "Dealerships",
    title: "Dealership inventory and operating reviews | Vanteloq",
    description: "Review vehicle stock age, preparation, recorded deliveries and funding differences. Keep cost evidence and holding assumptions visible in Vanteloq.",
    headline: "Know which vehicles need your attention.",
    introduction: "Bring stock age, preparation blockers, recorded deliveries and funding checks into one operating review. See the records behind each figure before deciding the next step.",
    fit: "For independent used dealerships, new and used dealerships, and teams reviewing vehicle operations across authorised locations.",
    question: "Which vehicles are waiting, and what needs to happen next?",
    inputHeading: "Start with the vehicle and its evidence.",
    inputs: [
      "VIN or legacy identifier, stock number, acquisition date and location.",
      "Reviewed ownership, physical status, preparation status and availability.",
      "Actual delivery dates, vehicle sale amounts and attributable posted cost evidence.",
      "Funding, payoff and customer contribution records, plus document and release checks.",
    ],
    workflows: [
      { title: "Vehicle stock and age", records: "Enter vehicle records or preview a stock CSV, then confirm the import. Each acquisition has its own stock episode.", decision: "Review ageing stock, its recorded investment and its availability. Asking prices remain separate from costs and collected cash." },
      { title: "Preparation and follow-up", records: "Link assigned tasks to a vehicle or lead, record blockers, and keep appointments and reservations visible.", decision: "Find the missing preparation step or follow-up owner before treating a vehicle as ready for delivery." },
      { title: "Delivery and operational gross", records: "Record an actual delivery and reviewed sales credit. Operational gross uses deliveries with complete posted cost evidence.", decision: "Compare recorded delivery activity and supported gross. Missing-cost deliveries stay excluded, and reversals remain visible separately." },
      { title: "Funding and handover", records: "Compare expected and received funding, payoff amounts and customer contributions. Review documents, release readiness and optional daily holding assumptions.", decision: "Identify outstanding differences before completing the review. Keep the holding estimate beside the actual cost evidence." },
    ],
    example: {
      title: "A funding difference still needs review.",
      rows: [{ label: "Expected lender funding", value: "C$24,000" }, { label: "Recorded funding received", value: "C$20,000" }],
      resultLabel: "Recorded funding outstanding",
      result: "C$4,000",
      explanation: "C$24,000 expected less C$20,000 received leaves C$4,000 to verify against lender and bank records. A signed sale or a reservation does not establish receipt of that money.",
      boundary: "Fictional amounts, not a customer result. The funding review does not approve credit, instruct a lender or move funds.",
    },
    boundaries: [
      { title: "Source entry and review", detail: "Vehicle stock supports manual entry and a reviewed CSV import. A DMS connection, vehicle history service and automatic VIN decoding are not established by these workflows." },
      { title: "Operational figures", detail: "A delivery records vehicle activity. It does not collect payment or post an accounting journal. Sales credit is attribution, not a commission calculation." },
      { title: "Holding assumptions", detail: "The funding review can estimate a constant daily holding cost over recorded dates. It is separate from posted expenses, and overlapping cost categories need review." },
      { title: "Your authorisation", detail: "Appointments record times but do not send reminders. Reservations change availability but do not prove a deposit or signed contract. Funding checks do not make lender decisions." },
    ],
    guides: [
      { href: "/resources/dealership-inventory-aging-carrying-costs", title: "Vehicle age and carrying costs", description: "Separate posted vehicle costs from estimates and review what another day in stock means." },
      { href: "/resources/small-business-cash-flow-management-guide", title: "Cash flow and timing", description: "Keep expected receipts, actual collections and payment dates in the same cash review." },
    ],
    tool: { href: "/tools/vehicle-holding-cost", title: "Vehicle holding cost calculator", description: "Explore a holding scenario with your own cost and rate assumptions before reviewing a vehicle." },
  },
  {
    slug: "cafes",
    industryId: "cafe",
    label: "Cafés",
    title: "Café recipe costs and daily operating reviews | Vanteloq",
    description: "Review café recipe costs, usable yields, prep quantities, supplier receipts and daily labour. Keep source inputs and food-cost limits visible in Vanteloq.",
    headline: "Understand the cost behind each serving.",
    introduction: "Review ingredient purchases, usable yields and recipe portions alongside prep and daily service. Keep the explanation close to the number when a price, pack size or yield changes.",
    fit: "For coffee shops, bakery cafés and counter service teams reviewing menu items, ingredients and daily operations.",
    question: "What does each serving cost, and what should we prepare?",
    inputHeading: "Start with purchase units, yields and portions.",
    inputs: [
      "Supplier purchase units and costs, ingredient quantities, measured usable yields and recipe portions.",
      "Reviewed demand, usable prepared stock, planned portions and batch size.",
      "Purchase orders, received and invoiced quantities, and documented supplier credits.",
      "Net sales, completed orders, planned and actual paid time, and reviewed labour cost for the same service period.",
    ],
    workflows: [
      { title: "Recipe costs and history", records: "Record compatible ingredient units, purchase costs, usable yields and recipe portions. Save reviewed versions with their source and date.", decision: "Trace the ingredient cost of a serving and review the effect of a changed price or yield before revising the recipe." },
      { title: "Prep plans and batches", records: "Enter expected demand, an additional buffer, usable portions, already planned portions and batch size. Production records retain the recipe version and measured usage.", decision: "Review a quantity rounded to complete batches, then check ingredient availability, capacity and your documented handling process." },
      { title: "Supplier receipt checks", records: "Compare the purchase order with received and invoiced base units. Keep expected and confirmed credits visible.", decision: "Find a quantity discrepancy or outstanding supplier credit before completing the receipt review." },
      { title: "Daily service review", records: "Match sales, paid minutes, labour costs and completed orders to the same service period. Confirm that coverage is complete.", decision: "Compare planned and actual activity, sales per paid hour and recorded late orders without interpreting incomplete ratios." },
    ],
    example: {
      title: "A serving cost with a visible denominator.",
      rows: [{ label: "Reviewed ingredient cost per batch", value: "C$6.00" }, { label: "Usable portions per batch", value: "10" }],
      resultLabel: "Ingredient cost per serving",
      result: "C$0.60",
      explanation: "C$6.00 divided by 10 usable portions gives C$0.60 per serving. Purchase quantities and usable ingredient yields must already be reflected in the reviewed batch cost.",
      boundary: "Fictional amounts, not a customer result. Ingredient cost excludes labour, rent, packaging and other costs, so it does not establish operating profit.",
    },
    boundaries: [
      { title: "Reviewed demand", detail: "Prep quantities use the demand and buffer you enter. They are planning calculations, not an automatic demand forecast or a food safety determination." },
      { title: "Stock movement", detail: "Saving a recipe does not consume stock. Approved production batches use explicitly opened Vanteloq-managed stock positions; they do not change imported POS balances or post financial journals." },
      { title: "Cost coverage", detail: "Food-cost periods need matching opening stock, movements, closing stock and sales. Waste already forms part of actual depletion and must not be deducted twice." },
      { title: "Connection scope", detail: "Recipe, prep and service records need source entry and review. A live supplier, payroll or delivery feed is not established by choosing the café template." },
    ],
    guides: [
      { href: "/resources/cafe-recipe-cost-margin-food-waste", title: "Recipe cost, contribution and waste", description: "Work through unit conversions, usable yield and the difference between food contribution and profit." },
      { href: "/resources/how-to-track-inventory-small-business", title: "Ingredient and stock records", description: "Build a repeatable count and movement routine before relying on recorded stock." },
    ],
    tool: { href: "/tools/cash-order-planner", title: "Cash order planner", description: "Test an ingredient purchase against payment timing and a chosen cash reserve." },
  },
  {
    slug: "restaurants",
    industryId: "restaurant",
    label: "Restaurants",
    title: "Restaurant food, labour and delivery reviews | Vanteloq",
    description: "Review restaurant food use, recipe costs, service labour and delivery settlements. Separate contribution, payout differences and missing evidence in Vanteloq.",
    headline: "See what is left after food and service costs.",
    introduction: "Connect menu economics with stock movements, labour and delivery records. Review the remaining differences before assigning a cause or treating a payout as profit.",
    fit: "For full service, quick service, takeaway and delivery teams reviewing a consistent location, currency and operating period.",
    question: "Where are food, labour and delivery costs changing?",
    inputHeading: "Start with a period you can reconcile.",
    inputs: [
      "Opening and closing inventory at cost, net purchases, transfers and supplier returns for the same period.",
      "Reviewed recipe quantities, usable yields, portions, net food sales and recorded waste.",
      "Net service sales, planned and actual paid minutes, reviewed labour cost and completed orders.",
      "Delivery order IDs, net sales, provider fees, tax and tips, supported food and packaging costs, and allocated bank payouts.",
    ],
    workflows: [
      { title: "Food-cost period review", records: "Bring matching inventory values and movements together with theoretical recipe cost and recorded waste.", decision: "Compare actual food depletion with supported expected use. Investigate the residual difference rather than assuming it proves waste or theft." },
      { title: "Service and labour", records: "Compare expected sales and planned paid minutes with actual sales, time and reviewed wage and employer costs.", decision: "Review sales per paid hour and labour as a share of net sales once sales, time and cost coverage is complete." },
      { title: "Delivery reconciliation", records: "Separate net food sales, withheld fees, adjustments, tax and tips, supported costs and the bank payout allocated to an order.", decision: "Inspect expected settlement, an unresolved payout difference and order contribution as distinct figures." },
      { title: "Preparation and receipts", records: "Use reviewed recipes and demand for prep plans and production batches. Compare supplier orders, receipts, invoices and credits.", decision: "Review prep capacity and ingredient availability, then resolve supplier differences with their source evidence." },
    ],
    example: {
      title: "Contribution and settlement answer different questions.",
      rows: [{ label: "Net food sales", value: "C$50" }, { label: "Provider fees", value: "C$12" }, { label: "Supported food cost", value: "C$14" }, { label: "Packaging and additional labour", value: "C$5" }],
      resultLabel: "Order contribution before fixed costs",
      result: "C$19",
      explanation: "C$50 less C$12, C$14 and C$5 leaves C$19 before fixed costs. With C$4 in remitted tax and tips, no other adjustments and a C$40 recorded payout, the expected C$42 settlement also leaves C$2 to reconcile.",
      boundary: "Fictional amounts, not a customer result. Contribution excludes rent, fixed overhead and tax. Tax and tips do not become food revenue, and a payout difference does not identify its cause.",
    },
    boundaries: [
      { title: "Contribution and profit", detail: "Recipe and order contribution measures leave out costs beyond their defined inputs. Operating profit needs its own complete financial records." },
      { title: "Food-cost variance", detail: "Actual depletion includes recorded waste. A residual difference can reflect counts, recipes, timing or missing records; it does not prove a particular cause." },
      { title: "Settlement evidence", detail: "Delivery reconciliation uses entered provider and bank evidence. Allocate each payout once and resolve differences explicitly. The workflow does not contact a provider or move funds." },
      { title: "Approval and safe handling", detail: "Prep and production records require reviewed quantities and authorised actions. Vanteloq does not certify food safety, determine safe shelf life or replace your documented handling process." },
    ],
    guides: [
      { href: "/resources/cafe-recipe-cost-margin-food-waste", title: "Food contribution and recorded waste", description: "Use recipe costs and stock depletion together without confusing contribution with operating profit." },
      { href: "/resources/small-business-cash-flow-management-guide", title: "Sales, settlements and cash", description: "Review when recorded sales become collected cash and which payments still need funding." },
    ],
    tool: { href: "/tools/cash-order-planner", title: "Cash order planner", description: "Model a supplier order alongside expected receipts, payment dates and your chosen reserve." },
  },
];

export function getSolutionSector(slug: string): SolutionSector | undefined {
  return SOLUTION_SECTORS.find((sector) => sector.slug === slug);
}

export const RETAIL_SOLUTION = {
  label: "Retail",
  href: "/solutions/retail",
  question: "Which products earn their shelf space?",
  description: "Review sales, returns, matched product costs and stock evidence before the next purchasing decision.",
  records: "Sales and returns, product costs, quantities and location records.",
};
