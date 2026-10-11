import type { IndustryId } from "./industry-templates";

export type WorkflowStep = { title: string; shortTitle: string; description: string; icon: string; recordLabel: string; recordTitle: string; metric: string; value: string; context: string; rows: [string, string][]; outcome: string };
export type IndustryShowcase = { title: string; description: string; workspace: string; boundary: string; steps: [WorkflowStep, WorkflowStep, WorkflowStep] };

// Authored fictional examples, never mixed with workspace records or AI output.
const retail: IndustryShowcase = {
  title: "Find what earns its shelf space.", description: "Follow sales into the products, costs and stock worth reviewing. Give the next step an owner.", workspace: "Sales & inventory", boundary: "Matched costs support margin. Stock cover assumes the recorded sales pace continues.",
  steps: [
    { title: "Follow the sale", shortTitle: "Sales", description: "Open net sales into the records behind them.", icon: "Sales", recordLabel: "Product sales", recordTitle: "Everyday essentials", metric: "Net sales", value: "CAD $12,000", context: "Selected 30-day period · One sample location", rows: [["Completed sales, before tax", "$12,400"], ["Refunds, before tax", "−$400"], ["Net sales", "$12,000"]], outcome: "See the effect of returns before comparing performance." },
    { title: "Connect margin and stock", shortTitle: "Review", description: "Compare matched costs with recorded stock cover.", icon: "Inventory", recordLabel: "Product review", recordTitle: "Everyday essentials", metric: "Gross margin", value: "35.0%", context: "CAD $4,200 gross profit / $12,000 net sales", rows: [["Matched cost of goods sold", "$7,800"], ["Units on hand", "90"], ["Sales pace / stock cover", "10 daily / 9 days"]], outcome: "Review incoming orders and supplier lead time before reordering." },
    { title: "Make the review actionable", shortTitle: "Action", description: "Assign an action and track its outcome.", icon: "Action Centre", recordLabel: "Review task", recordTitle: "Check next delivery", metric: "Assigned to", value: "Store manager", context: "Fictional task · Purchasing review", rows: [["Evidence", "9 days of recorded stock cover"], ["Next step", "Confirm incoming stock"], ["Status", "To do"]], outcome: "Keep the task connected to the finding that prompted it." },
  ],
};
const dealership: IndustryShowcase = {
  title: "Keep every vehicle moving forward.", description: "Connect the vehicle record, preparation and delivery. Know what is waiting and who needs to act.", workspace: "Vehicle operations", boundary: "Operational delivery records do not post a journal or calculate payroll. Sales credit is attribution.",
  steps: [
    { title: "Record the vehicle", shortTitle: "Stock", description: "Keep identity, ownership and acquisition together.", icon: "Inventory", recordLabel: "Vehicle stock", recordTitle: "Sample Sedan · 2024", metric: "Stock number", value: "DEMO-024", context: "Fictional vehicle · Sample identifier", rows: [["VIN / legacy identifier", "DEMO-VEHICLE-024"], ["Ownership", "Owned"], ["Physical status", "On lot"]], outcome: "Separate each acquisition from the vehicle’s permanent identity." },
    { title: "Clear preparation", shortTitle: "Prepare", description: "Find blocked, unassigned and due tasks.", icon: "Operations", recordLabel: "Preparation task", recordTitle: "Inspection review", metric: "Needs attention", value: "Waiting for report", context: "DEMO-024 · Sample preparation record", rows: [["Task status", "Blocked"], ["Assigned to", "Preparation manager"], ["Next step", "Review inspection report"]], outcome: "Make the blocker visible before marking preparation ready." },
    { title: "Record the delivery", shortTitle: "Deliver", description: "Retain the sale and reviewed salesperson credit.", icon: "Sales", recordLabel: "Delivered sale", recordTitle: "DEMO-024", metric: "Net sale, before tax", value: "CAD $24,900", context: "Fictional delivery · Operational sale record", rows: [["Delivery status", "Delivered"], ["Salesperson credit", "Alex · 100%"], ["Commission", "Not calculated here"]], outcome: "Preserve the delivery trail without treating a reservation as a sale." },
  ],
};
const cafe: IndustryShowcase = {
  title: "Know the cost behind every serving.", description: "Trace ingredient cost through usable yield and recipe changes. Keep earlier values when you save a new version.", workspace: "Recipe costing", boundary: "Recipe costs use reviewed inputs. Saving a recipe does not automatically consume stock or post an expense.",
  steps: [
    { title: "Build the recipe", shortTitle: "Inputs", description: "Include purchase units, quantities and usable yield.", icon: "Inventory", recordLabel: "Recipe inputs", recordTitle: "Seasonal soup · 10 portions", metric: "Cost per portion", value: "CAD $0.60", context: "$6.00 batch cost / 10 portions", rows: [["Vegetables, 2 kg pack", "$8.00"], ["Recipe uses / usable yield", "1 kg / 80%"], ["Stock used", "500 ml · $1.00"]], outcome: "Account for usable yield instead of treating all purchased weight as usable." },
    { title: "Review an ingredient change", shortTitle: "Compare", description: "Check quantities and costs before saving.", icon: "Scenario Planner", recordLabel: "Cost comparison", recordTitle: "Vegetable pack price updated", metric: "Revised cost per portion", value: "CAD $0.66", context: "$6.625 unrounded batch cost / 10 portions, rounded for display", rows: [["Previous / new pack price", "$8.00 / $9.00"], ["New batch cost", "$6.63"], ["Recipe yield", "10 portions"]], outcome: "Review the calculation before deciding whether to change the recipe or price." },
    { title: "Save the reviewed version", shortTitle: "History", description: "Keep the source, date and earlier recipe values.", icon: "Decision Journal", recordLabel: "Recipe history", recordTitle: "Seasonal soup", metric: "Reviewed version", value: "Version 2", context: "Fictional saved recipe · CAD", rows: [["Previous pack price", "$8.00"], ["Current pack price", "$9.00"], ["Source", "Supplier invoice and yield sheet"]], outcome: "Revisit what changed without overwriting the earlier recorded values." },
  ],
};
const restaurant: IndustryShowcase = {
  title: "See where food costs need a closer look.", description: "Put food usage, recorded waste and labour in one review. Separate what is known from what still needs investigation.", workspace: "Food-cost review", boundary: "Waste is already included in actual depletion. A remaining variance is not proof of theft or waste.",
  steps: [
    { title: "Record the period", shortTitle: "Inputs", description: "Bring opening stock, purchases and closing stock together.", icon: "Inventory", recordLabel: "Food-cost period", recordTitle: "September review", metric: "Actual food depletion", value: "CAD $3,200", context: "Opening + net purchases + net transfers − closing", rows: [["Opening inventory", "$1,000"], ["Purchases, net of credits", "$3,900"], ["Net transfers / closing", "−$100 / $1,600"]], outcome: "Use matching locations, dates and cost inputs for a meaningful comparison." },
    { title: "Understand the difference", shortTitle: "Variance", description: "Compare actual usage, theoretical cost and recorded waste.", icon: "Reports", recordLabel: "Cost variance", recordTitle: "September review", metric: "Remaining difference", value: "CAD $350", context: "$3,200 actual − $2,750 theoretical − $100 recorded waste", rows: [["Actual less theoretical", "$450"], ["Recorded waste", "$100"], ["Still to investigate", "$350"]], outcome: "Check counts, recipes and recorded usage before assigning a cause." },
    { title: "Review food and labour", shortTitle: "Decision", description: "See contribution and labour alongside the period.", icon: "Action Centre", recordLabel: "Operating review", recordTitle: "September review", metric: "Food cost ratio", value: "32.0%", context: "$3,200 food depletion / $10,000 net food sales", rows: [["Food contribution before labour", "$6,800"], ["Labour / total net sales", "$4,000 / $12,000"], ["Labour ratio", "33.3%"]], outcome: "Review food and labour together. Contribution is not net profit." },
  ],
};
const services: IndustryShowcase = {
  title: "Keep outstanding balances in view.", description: "Review invoices, payment allocations and the cash still due. Add BookLoQ for financial workflows.", workspace: "BookLoQ · Receivables", boundary: "BookLoQ requires its own access. An unpaid invoice is a receivable, not cash already collected.",
  steps: [
    { title: "Inspect the invoice", shortTitle: "Invoice", description: "See the customer, amount and due date together.", icon: "Sales", recordLabel: "Customer invoice", recordTitle: "Sample project · INV-024", metric: "Invoice total", value: "CAD $2,100", context: "Fictional invoice · Tax included in the total", rows: [["Services", "$2,000"], ["Recorded tax", "$100"], ["Total due", "$2,100"]], outcome: "Review the invoice record before following up with the customer." },
    { title: "Check the allocation", shortTitle: "Payment", description: "Separate paid amounts from what remains outstanding.", icon: "Transactions", recordLabel: "Payment allocation", recordTitle: "INV-024", metric: "Outstanding balance", value: "CAD $1,600", context: "$2,100 invoice total − $500 allocated payment", rows: [["Invoice total", "$2,100"], ["Allocated payment", "$500"], ["Still due", "$1,600"]], outcome: "Avoid treating the full invoice total as collected cash." },
    { title: "Review what is due", shortTitle: "Review", description: "Use receivables and source records to plan follow-up.", icon: "Action Centre", recordLabel: "Receivables review", recordTitle: "INV-024", metric: "Amount to follow up", value: "CAD $1,600", context: "Fictional outstanding invoice", rows: [["Customer", "Sample customer"], ["Payment state", "Partially paid"], ["Next step", "Review invoice and follow up"]], outcome: "Ground collection decisions in the remaining balance." },
  ],
};

export function industryShowcase(id: IndustryId): IndustryShowcase {
  if (id === "dealership") return dealership;
  if (id === "cafe") return cafe;
  if (id === "restaurant") return restaurant;
  if (id === "services" || id === "hospitality" || id === "other") return services;
  if (id === "health" || id === "grocery") return { ...retail, description: "Review product margin, stock cover and recorded lot expiry. Keep perishables and replenishment in the same picture." };
  if (id === "clothing") return { ...retail, description: "Review variants, returns and product margin. See the recorded stock behind your next purchasing review." };
  if (id === "furniture") return { ...retail, description: "Connect product margin, stock and purchasing review. Add BookLoQ to review invoices and outstanding balances." };
  if (id === "ecommerce") return { ...retail, title: "Follow orders into the detail that matters.", description: "Review product sales, returns and matched costs. Understand the recorded stock before planning the next purchase." };
  return retail;
}
