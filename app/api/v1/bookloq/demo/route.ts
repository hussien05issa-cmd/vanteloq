import { getD1, getRuntimeEnv } from "../../../../../db";
import { recordAudit } from "../../../../../server/audit";
import { requireAccess } from "../../../../../server/authorization";
import { enforceRateLimit, handleApi, jsonResponse, requireSameOrigin } from "../../../../../server/api";
import { requireBookLoQPermission } from "../../../../../server/bookloq";
import { requirePermission } from "../../../../../server/permissions";

const writers = ["owner", "admin", "manager", "employee", "read_only"] as const;

function dateAt(offset: number): string {
  const current = new Date();
  const date = new Date(current);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offset);
  if (offset < 0 && (date.getUTCFullYear() !== current.getUTCFullYear() || date.getUTCMonth() !== current.getUTCMonth())) {
    date.setUTCFullYear(current.getUTCFullYear(), current.getUTCMonth(), 1);
  }
  return date.toISOString().slice(0, 10);
}

function canadianProvinceCode(value: string): string {
  const normalized = value.trim().toLowerCase();
  const codes: Record<string, string> = {
    alberta: "AB", british_columbia: "BC", manitoba: "MB", new_brunswick: "NB",
    newfoundland_and_labrador: "NL", northwest_territories: "NT", nova_scotia: "NS",
    nunavut: "NU", ontario: "ON", prince_edward_island: "PE", quebec: "QC",
    saskatchewan: "SK", yukon: "YT",
  };
  const key = normalized.replaceAll(" ", "_");
  if (/^[a-z]{2}$/.test(normalized)) return normalized.toUpperCase();
  return codes[key] ?? "AB";
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    if (getRuntimeEnv().BOOKLOQ_DEMO_ENABLED !== "true") return jsonResponse({ error: { code: "NOT_FOUND", message: "Demonstration data is disabled." } }, { status: 404 });
    const context = await requireAccess(request, writers);
    await requirePermission(context, "finance.journal_post");
    requireBookLoQPermission(context.role, "post_journals");
    await enforceRateLimit("bookloq:demo", context.userId, 3, 3_600);
    const database = getD1();
    const organizationId = context.organizationId;
    const existing = await database.prepare(`SELECT COUNT(*) count FROM journal_entries WHERE organization_id = ?`).bind(organizationId).first<{ count: number }>();
    const settings = await database.prepare(`SELECT data_mode dataMode FROM bookloq_settings WHERE organization_id = ?`).bind(organizationId).first<{ dataMode: string }>();
    if ((existing?.count ?? 0) > 0) {
      if (settings?.dataMode === "demonstration") return jsonResponse({ seeded: true, replayed: true });
      return jsonResponse({ error: { code: "BOOKLOQ_HAS_DATA", message: "Demonstration records cannot be mixed into an active ledger." } }, { status: 409 });
    }

    const now = new Date();
    const timestamp = Math.floor(now.getTime() / 1_000);
    const prefix = `blq:${organizationId}`;
    const account = (key: string) => `${prefix}:account:${key}`;
    const contact = (key: string) => `${prefix}:contact:${key}`;
    const journal = (number: number) => `${prefix}:journal:${number}`;
    const periodStart = `${dateAt(0).slice(0, 7)}-01`;
    const endDate = new Date(`${periodStart}T00:00:00Z`);
    endDate.setUTCMonth(endDate.getUTCMonth() + 1);
    endDate.setUTCDate(0);
    const periodEnd = endDate.toISOString().slice(0, 10);
    const periodId = `${prefix}:period:${periodStart}`;
    const statements: D1PreparedStatement[] = [];

    statements.push(database.prepare(`INSERT INTO bookloq_settings
      (organization_id, base_currency, country_code, province_code, accounting_basis, fiscal_year_start_month,
       cash_safety_threshold_cents, status, data_mode, updated_by_user_id, created_at, updated_at)
      VALUES (?, 'CAD', 'CA', ?, 'accrual', 1, 1000000, 'active', 'demonstration', ?, ?, ?)
      ON CONFLICT(organization_id) DO UPDATE SET status = 'active', data_mode = 'demonstration', updated_by_user_id = excluded.updated_by_user_id, updated_at = excluded.updated_at`)
      .bind(organizationId, canadianProvinceCode(context.organization.province || "AB"), context.userId, timestamp, timestamp));
    statements.push(database.prepare(`INSERT OR IGNORE INTO bookloq_role_assignments
      (id, organization_id, user_id, role, permissions_json, created_by_user_id, created_at, updated_at)
      VALUES (?, ?, ?, 'owner', ?, ?, ?, ?)`)
      .bind(`${prefix}:role:${context.userId}`, organizationId, context.userId, JSON.stringify(["all"]), context.userId, timestamp, timestamp));
    statements.push(database.prepare(`INSERT OR IGNORE INTO accounting_periods
      (id, organization_id, label, start_date, end_date, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`)
      .bind(periodId, organizationId, new Intl.DateTimeFormat("en-CA", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${periodStart}T00:00:00Z`)), periodStart, periodEnd, timestamp, timestamp));

    const accounts = [
      ["cash", "1000", "Operating cash", "asset", "bank", "debit", "operating_cash", "Cash available in the operating account."],
      ["merchant", "1050", "Merchant clearing", "asset", "clearing", "debit", "merchant_clearing", "Card sales waiting to be deposited."],
      ["ar", "1100", "Accounts receivable", "asset", "receivable", "debit", "accounts_receivable", "Customer invoices that have not been collected."],
      ["gst_itc", "1150", "GST recoverable", "asset", "tax_receivable", "debit", "gst_recoverable", "GST paid that may qualify as an input tax credit."],
      ["inventory", "1200", "Inventory", "asset", "inventory", "debit", "inventory_asset", "Product cost currently held for sale."],
      ["equipment", "1500", "Equipment", "asset", "fixed_asset", "debit", "fixed_assets", "Long-lived equipment owned by the business."],
      ["ap", "2000", "Accounts payable", "liability", "payable", "credit", "accounts_payable", "Approved supplier bills that remain unpaid."],
      ["gst", "2100", "GST collected", "liability", "tax_payable", "credit", "gst_collected", "GST collected from customers before offsets and filing."],
      ["payroll", "2200", "Payroll liabilities", "liability", "payroll", "credit", "payroll_payable", "Payroll deductions and employer amounts still payable."],
      ["loan", "2300", "Term loan", "liability", "loan", "credit", "loan_payable", "Outstanding principal on the business loan."],
      ["equity", "3000", "Owner capital", "equity", "owner_equity", "credit", "owner_equity", "Funds the owner contributed to the business."],
      ["draws", "3100", "Owner withdrawals", "equity", "owner_draw", "debit", "owner_withdrawals", "Funds withdrawn by the owner; not an operating expense."],
      ["sales", "4000", "Retail sales", "revenue", "sales", "credit", "sales_revenue", "Revenue earned from product and service sales."],
      ["cogs", "5000", "Cost of goods sold", "expense", "cost_of_sales", "debit", "cost_of_goods_sold", "The product cost attached to items sold."],
      ["wages", "6100", "Wages and benefits", "expense", "payroll_expense", "debit", "wage_expense", "Employee wages and employer costs."],
      ["rent", "6200", "Rent and occupancy", "expense", "occupancy", "debit", "rent_expense", "Store rent and occupancy cost."],
      ["fees", "6300", "Payment processing fees", "expense", "merchant_fees", "debit", "merchant_fees", "Fees retained by card and payment processors."],
      ["marketing", "6400", "Marketing", "expense", "advertising", "debit", "marketing_expense", "Campaign, flyer, and promotion costs."],
      ["office", "6500", "Office and store supplies", "expense", "supplies", "debit", "supplies_expense", "Consumable supplies used to run the business."],
      ["depreciation", "6600", "Depreciation", "expense", "depreciation", "debit", "depreciation_expense", "Periodic allocation of fixed-asset cost."],
      ["interest", "6700", "Interest expense", "expense", "interest", "debit", "interest_expense", "Financing cost, separate from principal repayment."],
    ] as const;
    for (const [key, code, name, type, subtype, normal, systemKey, plainLanguage] of accounts) {
      statements.push(database.prepare(`INSERT OR IGNORE INTO financial_accounts
        (id, organization_id, code, name, account_type, account_subtype, normal_balance, system_key,
         description, plain_language, tax_treatment, restricted, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, 'none', ?, 1, ?, ?)`)
        .bind(account(key), organizationId, code, name, type, subtype, normal, systemKey, plainLanguage, ["cash", "ar", "ap", "gst", "gst_itc", "loan", "equity"].includes(key) ? 1 : 0, timestamp, timestamp));
    }

    const contacts = [
      ["supplier_peak", "supplier", "Peak Performance Distribution", "accounts@peak-demo.invalid", 30, "Primary inventory supplier — demonstration record."],
      ["supplier_local", "supplier", "Edmonton Print & Promo", "billing@print-demo.invalid", 15, "Local campaign supplier — demonstration record."],
      ["customer_corp", "customer", "Northside Fitness Studio", "finance@northside-demo.invalid", 15, "Wholesale customer — demonstration record."],
    ] as const;
    for (const [key, type, name, email, terms, notes] of contacts) {
      statements.push(database.prepare(`INSERT OR IGNORE INTO bookloq_contacts
        (id, organization_id, contact_type, name, email, phone, billing_address, payment_terms_days,
         credit_limit_cents, tax_registration_number, notes, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, '', 'Edmonton, Alberta', ?, 500000, '', ?, 1, ?, ?)`)
        .bind(contact(key), organizationId, type, name, email, terms, notes, timestamp, timestamp));
    }

    const journals = [
      { number: 1, date: dateAt(-18), memo: "Owner contribution", source: "owner_contribution", lines: [["cash", 1_500_000, 0], ["equity", 0, 1_500_000]] },
      { number: 2, date: dateAt(-12), memo: "Inventory received from Peak Performance Distribution", source: "supplier_bill", lines: [["inventory", 800_000, 0], ["gst_itc", 40_000, 0], ["ap", 0, 840_000]] },
      { number: 3, date: dateAt(-5), memo: "POS sales batch LS-2408", source: "pos_batch", lines: [["merchant", 1_323_000, 0], ["sales", 0, 1_260_000], ["gst", 0, 63_000]] },
      { number: 4, date: dateAt(-3), memo: "Processor payout bridge for LS-2408", source: "processor_payout", lines: [["cash", 1_296_540, 0], ["fees", 26_460, 0], ["merchant", 0, 1_323_000]] },
      { number: 5, date: dateAt(-5), memo: "Cost of goods sold for POS batch LS-2408", source: "inventory_subledger", lines: [["cogs", 660_000, 0], ["inventory", 0, 660_000]] },
      { number: 6, date: dateAt(-2), memo: "Monthly store rent", source: "supplier_bill", lines: [["rent", 500_000, 0], ["gst_itc", 25_000, 0], ["cash", 0, 525_000]] },
      { number: 7, date: dateAt(-2), memo: "Payroll withdrawal", source: "payroll_import", lines: [["wages", 320_000, 0], ["cash", 0, 320_000]] },
      { number: 8, date: dateAt(-1), memo: "Wholesale customer invoice INV-1042", source: "customer_invoice", lines: [["ar", 210_000, 0], ["sales", 0, 200_000], ["gst", 0, 10_000]] },
      { number: 9, date: dateAt(-1), memo: "August flyer campaign bill", source: "supplier_bill", lines: [["marketing", 125_000, 0], ["gst_itc", 6_250, 0], ["ap", 0, 131_250]] },
      { number: 10, date: dateAt(-20), memo: "Business term-loan advance", source: "loan", lines: [["cash", 500_000, 0], ["loan", 0, 500_000]] },
      { number: 11, date: dateAt(0), memo: "Loan payment split between principal and interest", source: "loan", lines: [["loan", 45_000, 0], ["interest", 7_500, 0], ["cash", 0, 52_500]] },
    ] as const;
    for (const entry of journals) {
      const entryId = journal(entry.number);
      const total = entry.lines.reduce((sum, line) => sum + line[1], 0);
      statements.push(database.prepare(`INSERT OR IGNORE INTO journal_entries
        (id, organization_id, entry_number, entry_date, posting_date, period_id, status, source_type,
         source_ref, memo, currency, exchange_rate_ppm, total_debit_cents, total_credit_cents,
         idempotency_key, prepared_by_user_id, approved_by_user_id, posted_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, 'CAD', 1000000, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(entryId, organizationId, `DEMO-${String(entry.number).padStart(4, "0")}`, entry.date, entry.date, periodId, entry.source, `demo-${entry.number}`, entry.memo, total, total, `demo-${organizationId}-${entry.number}`, context.userId, context.userId, timestamp, timestamp, timestamp));
      entry.lines.forEach((line, index) => {
        statements.push(database.prepare(`INSERT OR IGNORE INTO journal_lines
          (id, organization_id, journal_entry_id, line_number, account_id, description, debit_cents,
           credit_cents, tax_amount_cents, location_ref, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'Main store', ?)`)
          .bind(`${entryId}:line:${index + 1}`, organizationId, entryId, index + 1, account(line[0]), entry.memo, line[1], line[2], timestamp));
      });
    }

    const transactions = [
      ["owner", dateAt(-18), "Owner contribution", 1_500_000, "bank", "cash", "confirmed", "reconciled", 10000],
      ["inventory", dateAt(-12), "Peak Performance inventory invoice", -840_000, "supplier_bill", "inventory", "confirmed", "matched", 10000],
      ["sales", dateAt(-5), "Lightspeed POS sales batch LS-2408", 1_323_000, "lightspeed_demo", "merchant", "confirmed", "matched", 10000],
      ["payout", dateAt(-3), "Moneris settlement LS-2408", 1_296_540, "moneris_demo", "cash", "confirmed", "unreconciled", 10000],
      ["fees", dateAt(-3), "Moneris processing fees", -26_460, "moneris_demo", "fees", "confirmed", "matched", 10000],
      ["rent", dateAt(-2), "Store rent", -525_000, "bank", "rent", "confirmed", "reconciled", 10000],
      ["payroll", dateAt(-2), "Payroll withdrawal", -320_000, "payroll_demo", "wages", "confirmed", "reconciled", 10000],
      ["invoice", dateAt(-1), "Wholesale invoice INV-1042", 210_000, "invoice", "ar", "confirmed", "unreconciled", 10000],
      ["marketing", dateAt(-1), "August flyer campaign", -131_250, "supplier_bill", "marketing", "suggested", "unreconciled", 8400],
      ["loan", dateAt(0), "Term-loan payment", -52_500, "bank", "loan", "accountant_review", "unreconciled", 9200],
    ] as const;
    for (const [key, date, description, amount, source, accountKey, category, reconciliation, confidence] of transactions) {
      statements.push(database.prepare(`INSERT OR IGNORE INTO financial_transactions
        (id, organization_id, transaction_date, posting_date, description, original_description,
         amount_cents, currency, exchange_rate_ppm, tax_amount_cents, account_id, source_system,
         external_source_id, location_ref, reconciliation_status, categorization_status,
         confidence_basis_points, approval_status, demo_record, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'CAD', 1000000, 0, ?, ?, ?, 'Main store', ?, ?, ?, 'not_required', 1, ?, ?)`)
        .bind(`${prefix}:transaction:${key}`, organizationId, date, date, description, `DEMO · ${description}`, amount, account(accountKey), source, `demo-${key}`, reconciliation, category, confidence, timestamp, timestamp));
    }

    statements.push(database.prepare(`INSERT OR IGNORE INTO bank_accounts
      (id, organization_id, financial_account_id, name, account_type, institution_name, masked_number,
       live_balance_cents, available_balance_cents, book_balance_cents, connection_status,
       last_sync_at, last_reconciled_at, demo_record, created_at, updated_at)
      VALUES (?, ?, ?, 'Operating account', 'chequing', 'Demonstration bank', '•••• 4821',
       2397800, 2397800, 2399040, 'healthy', ?, ?, 1, ?, ?)`)
      .bind(`${prefix}:bank:operating`, organizationId, account("cash"), timestamp, timestamp, timestamp, timestamp));
    statements.push(database.prepare(`INSERT OR IGNORE INTO reconciliations
      (id, organization_id, account_id, reconciliation_type, start_date, end_date, opening_balance_cents,
       closing_balance_cents, book_balance_cents, difference_cents, status, prepared_by_user_id, created_at, updated_at)
      VALUES (?, ?, ?, 'bank', ?, ?, 1500000, 2397800, 2399040, -1240, 'draft', ?, ?, ?)`)
      .bind(`${prefix}:reconciliation:bank`, organizationId, account("cash"), periodStart, dateAt(0), context.userId, timestamp, timestamp));

    statements.push(database.prepare(`INSERT OR IGNORE INTO supplier_bills
      (id, organization_id, supplier_id, bill_number, invoice_date, due_date, status, subtotal_cents,
       tax_cents, total_cents, paid_cents, currency, purchase_order_ref, location_ref, approval_status,
       journal_entry_id, demo_record, created_at, updated_at)
      VALUES (?, ?, ?, 'PPD-8841', ?, ?, 'approved', 800000, 40000, 840000, 0, 'CAD', 'PO-2081', 'Main store', 'approved', ?, 1, ?, ?)`)
      .bind(`${prefix}:bill:inventory`, organizationId, contact("supplier_peak"), dateAt(-12), dateAt(7), journal(2), timestamp, timestamp));
    statements.push(database.prepare(`INSERT OR IGNORE INTO supplier_bills
      (id, organization_id, supplier_id, bill_number, invoice_date, due_date, status, subtotal_cents,
       tax_cents, total_cents, paid_cents, currency, purchase_order_ref, location_ref, approval_status,
       journal_entry_id, demo_record, created_at, updated_at)
      VALUES (?, ?, ?, 'EPP-2208', ?, ?, 'awaiting_approval', 125000, 6250, 131250, 0, 'CAD', 'PO-2094', 'Main store', 'pending', ?, 1, ?, ?)`)
      .bind(`${prefix}:bill:marketing`, organizationId, contact("supplier_local"), dateAt(-1), dateAt(14), journal(9), timestamp, timestamp));
    statements.push(database.prepare(`INSERT OR IGNORE INTO customer_invoices
      (id, organization_id, customer_id, invoice_number, invoice_date, due_date, status, subtotal_cents,
       tax_cents, total_cents, paid_cents, currency, location_ref, journal_entry_id, demo_record, created_at, updated_at)
      VALUES (?, ?, ?, 'INV-1042', ?, ?, 'sent', 200000, 10000, 210000, 0, 'CAD', 'Main store', ?, 1, ?, ?)`)
      .bind(`${prefix}:invoice:1042`, organizationId, contact("customer_corp"), dateAt(-1), dateAt(12), journal(8), timestamp, timestamp));

    const alerts = [
      ["bank_difference", "attention", "Bank statement differs from the books", "The demonstration bank balance is $12.40 below the BookLoQ cash balance.", 1240, "high", "Review the unmatched settlement and confirm the bank posting date.", ["reconciliation:bank", "transaction:payout"]],
      ["receipt_missing", "attention", "Receipt evidence is missing", "The flyer campaign bill has invoice data but no stored source document.", 131250, "high", "Request and attach the supplier invoice before approval.", ["bill:marketing"]],
      ["loan_split", "informational", "Loan payment was split correctly", "The $525.00 payment was separated into $450.00 principal and $75.00 interest.", 52500, "high", "Review the split against the lender statement during month-end.", ["journal:11"]],
      ["margin", "opportunity", "Gross margin is holding above 50%", "Demonstration gross profit is $8,000.00 on $14,600.00 of revenue.", 800000, "high", "Protect margin by validating the next supplier price list before reordering.", ["account:4000", "account:5000"]],
    ] as const;
    for (const [key, severity, title, explanation, impact, confidence, actionText, support] of alerts) {
      statements.push(database.prepare(`INSERT OR IGNORE INTO bookloq_alerts
        (id, organization_id, severity, alert_type, title, explanation, dollar_impact_cents,
         confidence, supporting_records_json, recommended_action, assigned_user_id, due_date,
         status, resolution_history_json, demo_record, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', '[]', 1, ?, ?)`)
        .bind(`${prefix}:alert:${key}`, organizationId, severity, key, title, explanation, impact, confidence, JSON.stringify(support), actionText, context.userId, dateAt(5), timestamp, timestamp));
    }

    const budgets = [["sales", 1_800_000, 0, 1_800_000], ["wages", 450_000, 320_000, 450_000], ["rent", 500_000, 500_000, 500_000], ["marketing", 150_000, 131_250, 150_000]] as const;
    for (const [key, budget, committed, forecast] of budgets) {
      statements.push(database.prepare(`INSERT OR IGNORE INTO bookloq_budgets
        (id, organization_id, account_id, period_start, period_end, location_ref, department_ref,
         budget_cents, committed_cents, forecast_cents, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'Main store', 'all', ?, ?, ?, ?, ?)`)
        .bind(`${prefix}:budget:${key}`, organizationId, account(key), periodStart, periodEnd, budget, committed, forecast, timestamp, timestamp));
    }

    const closeItems = [
      ["bank", "Bank reconciliation", "in_progress"], ["credit_card", "Credit-card reconciliation", "not_started"],
      ["pos", "POS and processor reconciliation", "in_progress"], ["ar", "Accounts-receivable review", "complete"],
      ["ap", "Accounts-payable review", "complete"], ["supplier", "Supplier-statement review", "not_started"],
      ["inventory", "Inventory reconciliation", "blocked"], ["payroll", "Payroll review", "complete"],
      ["tax", "Sales-tax review", "in_progress"], ["loan", "Loan review", "not_started"],
      ["accruals", "Accruals and prepaids", "not_started"], ["depreciation", "Depreciation", "not_started"],
      ["statements", "Financial-statement review", "not_started"], ["approval", "Final approval and period lock", "not_started"],
    ] as const;
    for (const [key, title, status] of closeItems) {
      statements.push(database.prepare(`INSERT OR IGNORE INTO month_end_items
        (id, organization_id, period_id, item_key, title, status, assigned_user_id, due_date, blocker, completed_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(`${prefix}:close:${key}`, organizationId, periodId, key, title, status, context.userId, periodEnd, status === "blocked" ? "Physical inventory count has not been imported." : "", status === "complete" ? timestamp : null, timestamp));
    }

    await database.batch(statements);
    await recordAudit({
      request,
      requestId,
      organizationId,
      actorUserId: context.userId,
      action: "bookloq.demonstration_seeded",
      resourceType: "bookloq_workspace",
      resourceId: organizationId,
      details: { accounts: accounts.length, journals: journals.length, mode: "demonstration" },
    });
    return jsonResponse({ seeded: true, replayed: false }, { status: 201 });
  });
}
