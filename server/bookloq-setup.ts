import { BOOKLOQ_CLOSE_CONTROLS, BOOKLOQ_STARTING_ACCOUNTS, type BookLoQSetupInput } from "../domain/bookloq-setup.ts";
import { ApiError } from "./api.ts";

type SetupContext = { organizationId: string; userId: string; currency: string; country: string; province: string; fiscalYearStartMonth: number; requestId: string; sourceHash: string };
export async function configureBookLoQ(database: D1Database, context: SetupContext, input: BookLoQSetupInput) {
  const { organizationId: org, userId: actor } = context;
  if (!Number.isInteger(context.fiscalYearStartMonth) || context.fiscalYearStartMonth < 1 || context.fiscalYearStartMonth > 12) throw new ApiError(409, "BOOKLOQ_FISCAL_MONTH_REQUIRED", "Review the fiscal year start in workspace settings before configuring the books.");
  const periodId = `blq:${org}:period:${input.startDate}:${input.endDate}`;
  const existing = await database.prepare("SELECT id,label,start_date startDate,end_date endDate FROM accounting_periods WHERE organization_id=? AND id=?").bind(org, periodId).first();
  if (existing) {
    if (existing.label !== input.label) throw new ApiError(409, "BOOKLOQ_PERIOD_EXISTS", "This accounting period already exists with another name. Select it in Month-End.");
    return { period: existing, replayed: true, postedToLedger: false };
  }
  const settings = await database.prepare("SELECT data_mode dataMode,status,base_currency currency FROM bookloq_settings WHERE organization_id=?").bind(org).first<{dataMode:string;status:string;currency:string}>();
  if (settings?.dataMode === "demonstration" || settings?.status === "suspended") throw new ApiError(409, "BOOKLOQ_SETUP_UNAVAILABLE", "Live setup is unavailable for this accounting profile.");
  if (settings && settings.currency !== context.currency) throw new ApiError(409, "BOOKLOQ_CURRENCY_REVIEW", "The accounting and workspace currencies differ. Review the existing configuration first.");
  const timestamp = Math.floor(Date.now() / 1000);
  // The guard uses the existing audit outcome CHECK. D1 executes the complete
  // batch atomically: a failed precondition, insert or audit rolls everything back.
  const guard = input.initialize
    ? "NOT EXISTS(SELECT 1 FROM bookloq_settings WHERE organization_id=? AND status='active') AND NOT EXISTS(SELECT 1 FROM journal_entries WHERE organization_id=?) AND NOT EXISTS(SELECT 1 FROM accounting_periods WHERE organization_id=?)"
    : "EXISTS(SELECT 1 FROM financial_accounts WHERE organization_id=?) AND EXISTS(SELECT 1 FROM bookloq_settings WHERE organization_id=? AND status='active' AND data_mode='live')";
  const bindings = input.initialize ? [org, org, org] : [org, org];
  const statements = [database.prepare(`INSERT INTO audit_events(id,organization_id,actor_user_id,action,resource_type,resource_id,outcome,request_id,source_hash,details_json,created_at)
    VALUES(?,?,?,?,?,?,CASE WHEN ${guard}
      AND NOT EXISTS(SELECT 1 FROM accounting_periods WHERE organization_id=? AND start_date<=? AND end_date>=?)
      AND NOT EXISTS(SELECT 1 FROM bookloq_settings WHERE organization_id=? AND (data_mode<>'live' OR status='suspended' OR base_currency<>?))
      THEN 'success' ELSE 'setup_conflict' END,?,?,?,?)`)
    .bind(crypto.randomUUID(),org,actor,input.initialize?"bookloq.initialized":"accounting_period.created","accounting_period",periodId,...bindings,org,input.endDate,input.startDate,org,context.currency,context.requestId,context.sourceHash,JSON.stringify({startDate:input.startDate,endDate:input.endDate,initialize:input.initialize,postedToLedger:false}),timestamp)];
  if (input.initialize) {
    for (const [code,name,type,subtype,normal,key,description] of BOOKLOQ_STARTING_ACCOUNTS) {
      statements.push(database.prepare(`INSERT INTO financial_accounts(id,organization_id,code,name,account_type,account_subtype,normal_balance,system_key,description,plain_language,tax_treatment,restricted,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'review_required',1,1,?,?)`)
        .bind(`blq:${org}:account:${key}`,org,code,context.country === "CA" ? name : name.replace("GST/HST", "Sales tax"),type,subtype,normal,key,description,description,timestamp,timestamp));
    }
    statements.push(database.prepare(`INSERT INTO bookloq_settings(organization_id,base_currency,country_code,province_code,accounting_basis,fiscal_year_start_month,cash_safety_threshold_cents,status,data_mode,updated_by_user_id,created_at,updated_at)
      VALUES(?,?,?,?,'accrual',?,0,'active','live',?,?,?)
      ON CONFLICT(organization_id) DO UPDATE SET status='active',updated_by_user_id=excluded.updated_by_user_id,updated_at=excluded.updated_at`)
      .bind(org,context.currency,context.country,context.province,context.fiscalYearStartMonth,actor,timestamp,timestamp));
  }
  statements.push(database.prepare("INSERT INTO accounting_periods(id,organization_id,label,start_date,end_date,status,created_at,updated_at) VALUES(?,?,?,?,?,'open',?,?)").bind(periodId,org,input.label,input.startDate,input.endDate,timestamp,timestamp));
  for (const [key,title] of BOOKLOQ_CLOSE_CONTROLS) statements.push(database.prepare("INSERT INTO month_end_items(id,organization_id,period_id,item_key,title,status,due_date,blocker,updated_at) VALUES(?,?,?,?,?,'not_started',?,'',?)").bind(`${periodId}:${key}`,org,periodId,key,title,input.endDate,timestamp));
  try { await database.batch(statements); }
  catch (error) {
    const concurrent = await database.prepare("SELECT id,label FROM accounting_periods WHERE organization_id=? AND id=?").bind(org,periodId).first();
    if (concurrent?.label === input.label) return { period: { ...concurrent, startDate: input.startDate, endDate: input.endDate }, replayed: true, postedToLedger: false };
    if (/constraint|setup_conflict/i.test(String(error))) throw new ApiError(409,"BOOKLOQ_SETUP_CONFLICT","The chart already exists, the period overlaps another period, or the profile changed. Refresh and review the current accounting setup.");
    throw error;
  }
  return { period: { id: periodId, label: input.label, startDate: input.startDate, endDate: input.endDate }, replayed: false, postedToLedger: false };
}
