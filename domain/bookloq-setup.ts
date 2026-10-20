import { isCalendarDate } from "./calendar-date.ts";

export type BookLoQSetupInput = { initialize: boolean; label: string; startDate: string; endDate: string };
export function bookloqSetupInput(body: Record<string, unknown>): BookLoQSetupInput {
  if (Object.keys(body).some(key => !["initialize", "label", "startDate", "endDate"].includes(key))) throw new Error("The setup request contains an unsupported field.");
  if (typeof body.initialize !== "boolean") throw new Error("Choose whether to initialize the chart of accounts.");
  if (!isCalendarDate(body.startDate) || !isCalendarDate(body.endDate) || body.startDate > body.endDate) throw new Error("Enter a valid accounting period, with its start before its end.");
  const days = (Date.parse(`${body.endDate}T00:00:00Z`) - Date.parse(`${body.startDate}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > 366) throw new Error("An accounting period can cover at most 366 days.");
  const label = typeof body.label === "string" ? body.label.trim().normalize("NFC") : "";
  if (!label || label.length > 100 || /[\u0000-\u001f\u007f]/.test(label)) throw new Error("Enter a period name of up to 100 characters.");
  return { initialize: body.initialize, label, startDate: body.startDate, endDate: body.endDate };
}

// A starting chart, not a claim about registrations, tax eligibility or balances.
export const BOOKLOQ_STARTING_ACCOUNTS = [
  ["1000", "Operating cash", "asset", "bank", "debit", "operating_cash", "Cash recorded in the operating account."],
  ["1050", "Merchant clearing", "asset", "clearing", "debit", "merchant_clearing", "Card settlements awaiting deposit."],
  ["1100", "Accounts receivable", "asset", "receivable", "debit", "accounts_receivable", "Amounts owed by customers."],
  ["1150", "GST/HST recoverable", "asset", "tax_receivable", "debit", "gst_recoverable", "Reviewed recoverable tax, subject to eligibility and documentation."],
  ["1200", "Inventory", "asset", "inventory", "debit", "inventory_asset", "Recorded cost of stock held for sale."],
  ["1500", "Equipment", "asset", "fixed_asset", "debit", "fixed_assets", "Recorded equipment acquisition cost."],
  ["2000", "Accounts payable", "liability", "payable", "credit", "accounts_payable", "Amounts owed to suppliers."],
  ["2100", "GST/HST collected", "liability", "tax_payable", "credit", "gst_collected", "Recorded tax collected, before filing adjustments."],
  ["2200", "Payroll liabilities", "liability", "payroll", "credit", "payroll_payable", "Recorded payroll amounts still payable."],
  ["2300", "Loans payable", "liability", "loan", "credit", "loan_payable", "Recorded loan principal."],
  ["3000", "Contributed capital", "equity", "owner_equity", "credit", "owner_equity", "Reviewed capital contributions."],
  ["3100", "Owner distributions", "equity", "owner_draw", "debit", "owner_withdrawals", "Distributions reviewed for the business's legal structure."],
  ["4000", "Sales revenue", "revenue", "sales", "credit", "sales_revenue", "Revenue recognized from sales and services."],
  ["5000", "Cost of goods sold", "expense", "cost_of_sales", "debit", "cost_of_goods_sold", "Recognized cost of items sold."],
  ["6100", "Wages and benefits", "expense", "payroll_expense", "debit", "wage_expense", "Employee wages and employer costs."],
  ["6200", "Rent and occupancy", "expense", "occupancy", "debit", "rent_expense", "Operating premises costs."],
  ["6300", "Payment processing fees", "expense", "merchant_fees", "debit", "merchant_fees", "Processor charges, separate from gross receipts."],
  ["6400", "Marketing", "expense", "advertising", "debit", "marketing_expense", "Campaign and promotion costs."],
  ["6500", "Operating supplies", "expense", "supplies", "debit", "supplies_expense", "Consumable supplies used by the business."],
  ["6600", "Depreciation", "expense", "depreciation", "debit", "depreciation_expense", "Reviewed allocation of fixed asset cost."],
  ["6700", "Interest expense", "expense", "interest", "debit", "interest_expense", "Financing cost, separate from loan principal."],
] as const;

export const BOOKLOQ_CLOSE_CONTROLS = [
  ["bank_review", "Review bank statements and unresolved differences"],
  ["receivables", "Review outstanding invoices and payment evidence"],
  ["payables", "Review supplier bills and unpaid commitments"],
  ["stock", "Review inventory costs and adjustments"],
  ["tax", "Review tax accounts and supporting records"],
  ["statements", "Review the trial balance and financial statements"],
] as const;
