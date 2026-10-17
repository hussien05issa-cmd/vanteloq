import { and, eq } from "drizzle-orm";
import { getD1, getDb, getRuntimeEnv } from "../db";
import { internalAccess, memberships, users, workspaces } from "../db/schema";
import { ApiError } from "./api";
import { requireAccess, type AccessContext } from "./authorization";
import { requirePermission } from "./permissions";
import { requireOrganizationWideLocationAccess } from "./location-access";
import { getTenantEntitlements, requireAddon, requireFeatureEntitlement, requireTenantServiceAccess, resolveComplimentaryEntitlements, resolveInternalEntitlements, resolveSubscriptionEntitlements, subscriptionSnapshot } from "./entitlements/engine";
import { complimentaryGrantForOwner } from "./complimentary-access";
import { internalAccessEnabled } from "./internal-access";
import { defaultFollowupNote, defaultFollowupPreferences, dueBriefingSlots, FOLLOWUP_AUTHORIZATION, followupClock, followupRetryDelay, isFollowupQuiet, reminderEligibility, validateFollowupNote, validateFollowupPreferences, type FollowupNote, type FollowupPreferences, type ReminderInvoice } from "../domain/workflow-followup";

type Preference = { id: string; organization_id: string; user_id: string; payload_json: string; authorized_subject: string; approved_email: string; authorization_version: string; version: number; enabled: number };
type Followup = { id: string; invoice_id: string; payload_json: string; version: number; approved_recipient: string; approved_total_cents: number; approved_currency: string; updated_at: number };
type Invoice = ReminderInvoice & { id: string; reference: string; contact: string; updatedAt: number };
type Delivery = { id: string; organization_id: string; user_id: string; kind: "opening" | "closing" | "reminder"; invoice_id: string | null; business_date: string; preference_version: number; followup_version: number | null; attempts: number; created_at: number; payload_json: string; status: string };
const emailPattern = /^[^\s@]{1,64}@[^\s@]{1,190}$/;
const invoiceColumns = `i.id,i.invoice_number reference,i.due_date dueDate,i.status,i.total_cents totalCents,i.paid_cents paidCents,i.currency,i.demo_record demo,i.updated_at updatedAt,COALESCE(NULLIF(json_extract(i.customer_snapshot_json,'$.email'),''),c.email,'') recipient,COALESCE(c.name,'Customer') contact`;
const invoiceJoins = "customer_invoices i LEFT JOIN bookloq_contacts c ON c.id=i.customer_id AND c.organization_id=i.organization_id";
const failInput = (error: unknown) => new ApiError(400, "FOLLOWUP_INPUT", error instanceof Error ? error.message : "Review the follow-up details.");
function mutation(value: unknown) { if (typeof value !== "string" || !/^[a-f0-9-]{36}$/.test(value)) throw new ApiError(400, "FOLLOWUP_MUTATION", "Retry with a valid save identifier."); return value; }
function expectedVersion(value: unknown) { if (!Number.isSafeInteger(value) || Number(value) < 0) throw new ApiError(400, "FOLLOWUP_VERSION", "Reload the current record before saving."); return Number(value); }
export async function followupAccess(request: Request, mode: string) {
  const collections = mode === "collections";
  const context = await requireAccess(request, ["owner", "admin", "manager", "employee", "read_only"], collections ? "bookloq.dashboard" : "business.brief.basic");
  if (collections) { await requireAddon(context, "bookloq"); await requirePermission(context, "finance.ap_ar"); await requirePermission(context, "finance.statements"); await requirePermission(context, "customers.identity"); }
  else { await requirePermission(context, "insights.view"); if (context.role !== "owner") throw new ApiError(403, "FOLLOWUP_OWNER", "Delivery preferences and owner briefings are private to the workspace owner."); }
  await requireOrganizationWideLocationAccess(context);
  if (collections) { const settings = await getD1().prepare("SELECT status FROM bookloq_settings WHERE organization_id=?").bind(context.organizationId).first<{ status: string }>(); if (settings?.status === "suspended") throw new ApiError(409, "BOOKLOQ_SUSPENDED", "Restore BookLoQ access before using collection follow-up."); }
  return context;
}
async function invoice(context: Pick<AccessContext, "organizationId">, id: string) {
  return getD1().prepare(`SELECT ${invoiceColumns} FROM ${invoiceJoins} WHERE i.organization_id=? AND i.id=?`).bind(context.organizationId, id).first<Invoice>();
}
export async function readWorkflowFollowup(context: AccessContext, mode: string) {
  const db = getD1();
  const pref = await db.prepare("SELECT * FROM workflow_delivery_preferences WHERE organization_id=? AND user_id=?").bind(context.organizationId, context.userId).first<Preference>();
  const deliveries = await db.prepare(`SELECT id,kind,business_date businessDate,status,attempts,error_code errorCode,acknowledged_at acknowledgedAt,accepted_at acceptedAt,created_at createdAt,payload_json payloadJson FROM workflow_deliveries WHERE organization_id=? ${mode === "collections" ? "AND kind='reminder'" : "AND user_id=? AND kind<>'reminder'"} ORDER BY created_at DESC,id DESC LIMIT 50`).bind(...(mode === "collections" ? [context.organizationId] : [context.organizationId, context.userId])).all<Record<string, unknown>>();
  let records: (Invoice & { followup: FollowupNote; version: number })[] = [];
  let truncated = false;
  if (mode === "collections") {
    const result = await db.prepare(`SELECT ${invoiceColumns},f.payload_json followupJson,f.version FROM ${invoiceJoins} LEFT JOIN collection_followups f ON f.invoice_id=i.id AND f.organization_id=i.organization_id WHERE i.organization_id=? AND i.demo_record=COALESCE((SELECT CASE WHEN data_mode='demonstration' THEN 1 ELSE 0 END FROM bookloq_settings WHERE organization_id=?),0) AND (i.status NOT IN ('draft','paid','void','written_off') OR f.id IS NOT NULL) ORDER BY i.due_date,i.id LIMIT 201`).bind(context.organizationId, context.organizationId).all<Invoice & { followupJson: string | null; version: number | null }>();
    truncated = (result.results?.length ?? 0) > 200;
    records = (result.results ?? []).slice(0, 200).map(r => ({ ...r, followup: r.followupJson ? validateFollowupNote(JSON.parse(r.followupJson)) : { ...defaultFollowupNote }, version: r.version ?? 0 }));
  }
  const events = mode === "collections" ? await db.prepare("SELECT e.followup_id followupId,f.invoice_id invoiceId,e.version,e.payload_json payloadJson,e.created_at createdAt FROM collection_followup_events e JOIN collection_followups f ON f.id=e.followup_id AND f.organization_id=e.organization_id WHERE e.organization_id=? ORDER BY e.created_at DESC LIMIT 100").bind(context.organizationId).all() : { results: [] };
  return { records, truncated, events: events.results, deliveries: (deliveries.results ?? []).map(r => { const payload = JSON.parse(String(r.payloadJson)); const { payloadJson: _ignored, ...safe } = r; void _ignored; return { ...safe, summary: payload.summary ?? null, invoiceReference: payload.invoiceReference ?? null }; }), preferences: pref ? validateFollowupPreferences(JSON.parse(pref.payload_json)) : { ...defaultFollowupPreferences }, preferenceVersion: pref?.version ?? 0, schedulingActive: Boolean(pref?.enabled), canEdit: ["owner", "admin", "manager"].includes(context.role), canAuthorize: context.role === "owner", timezone: context.organization.timezone, ownerEmail: context.role === "owner" ? context.identity.email : null, mailReady: Boolean(getRuntimeEnv().RESEND_API_KEY && getRuntimeEnv().INVOICE_EMAIL_FROM), schedulerConfigured: (getRuntimeEnv().POS_SYNC_SECRET?.length ?? 0) >= 32 };
}
export async function saveCollectionFollowup(context: AccessContext, body: Record<string, unknown>) {
  if (!["owner", "admin", "manager"].includes(context.role)) throw new ApiError(403, "FOLLOWUP_WRITE", "Your role cannot change collection follow-up.");
  if (body.reviewed !== true) throw new ApiError(400, "FOLLOWUP_REVIEW", "Review the contact details and follow-up before saving.");
  const invoiceId = typeof body.invoiceId === "string" ? body.invoiceId : "", current = await invoice(context, invoiceId);
  if (!current) throw new ApiError(404, "INVOICE_NOT_FOUND", "This invoice was not found in the current workspace.");
  const version = expectedVersion(body.expectedVersion), key = mutation(body.mutationKey);
  let note: FollowupNote; try { note = validateFollowupNote(body.record); } catch (e) { throw failInput(e); }
  const today = followupClock(new Date(), context.organization.timezone).date;
  if (note.lastContactDate && note.lastContactDate > today) throw new ApiError(400, "FOLLOWUP_CONTACT_DATE", "The last contact date cannot be in the future.");
  const db = getD1(), now = Date.now(), id = `${context.organizationId}:${invoiceId}`;
  const prior = await db.prepare("SELECT * FROM collection_followups WHERE organization_id=? AND invoice_id=?").bind(context.organizationId, invoiceId).first<Followup & { mutation_key: string }>();
  if (prior?.mutation_key === key) { if (JSON.stringify(note) !== prior.payload_json || version !== prior.version - 1) throw new ApiError(409, "FOLLOWUP_REQUEST", "This save identifier was already used for different details."); return { saved: true, replayed: true }; }
  const approvedNote = prior ? validateFollowupNote(JSON.parse(prior.payload_json)) : null;
  if (note.promisedCents !== null && note.promisedCents > current.totalCents - current.paidCents && (note.promisedCents !== approvedNote?.promisedCents || note.promisedDate !== approvedNote?.promisedDate)) throw new ApiError(400, "FOLLOWUP_PROMISE", "A new payment promise cannot exceed the current outstanding balance. An unchanged historical promise can be retained.");
  if (note.remindersEnabled && (!emailPattern.test(current.recipient) || current.demo || (context.role !== "owner" && (!approvedNote?.remindersEnabled || note.reminderIntervalDays !== approvedNote.reminderIntervalDays)))) throw new ApiError(403, "FOLLOWUP_REMINDER_APPROVAL", "Only the owner can approve reminders or change their frequency. Team members can update notes and pause existing reminders.");
  // Editing operational notes must not silently reapprove a changed recipient or invoice value.
  const approvedRecipient = note.remindersEnabled ? context.role === "owner" ? current.recipient : prior!.approved_recipient : "";
  const approvedTotal = context.role === "owner" ? current.totalCents : prior?.approved_total_cents ?? current.totalCents;
  const approvedCurrency = context.role === "owner" ? current.currency : prior?.approved_currency ?? current.currency;
  const write = version === 0 ? db.prepare("INSERT OR IGNORE INTO collection_followups(id,organization_id,invoice_id,payload_json,approved_recipient,approved_total_cents,approved_currency,version,mutation_key,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,1,?,?,?)").bind(id, context.organizationId, invoiceId, JSON.stringify(note), approvedRecipient, approvedTotal, approvedCurrency, key, context.userId, now)
    : db.prepare("UPDATE collection_followups SET payload_json=?,approved_recipient=?,approved_total_cents=?,approved_currency=?,version=version+1,mutation_key=?,updated_by=?,updated_at=? WHERE organization_id=? AND invoice_id=? AND version=?").bind(JSON.stringify(note), approvedRecipient, approvedTotal, approvedCurrency, key, context.userId, now, context.organizationId, invoiceId, version);
  const result = await db.batch([write, db.prepare("INSERT OR IGNORE INTO collection_followup_events(id,organization_id,followup_id,version,payload_json,actor_user_id,created_at) SELECT ?,organization_id,id,version,payload_json,updated_by,updated_at FROM collection_followups WHERE organization_id=? AND invoice_id=? AND mutation_key=?").bind(key, context.organizationId, invoiceId, key)]);
  if (!result[0].meta.changes) throw new ApiError(409, "FOLLOWUP_CONFLICT", "Another person updated this follow-up. Reload before saving.");
  return { saved: true, version: version + 1 };
}
export async function saveFollowupPreferences(context: AccessContext, body: Record<string, unknown>) {
  if (context.role !== "owner" || context.authProvider !== "supabase" || !context.authSubject || !context.identity.emailVerified) throw new ApiError(403, "FOLLOWUP_OWNER", "A verified workspace owner must authorize recurring delivery.");
  if (body.reviewed !== true) throw new ApiError(400, "FOLLOWUP_REVIEW", "Review and approve these delivery preferences.");
  let prefs: FollowupPreferences; try { prefs = validateFollowupPreferences(body.preferences); } catch (e) { throw failInput(e); }
  const grants = await getTenantEntitlements(context);
  if (prefs.opening || prefs.closing) requireFeatureEntitlement(grants, "business.brief.basic");
  if (prefs.invoiceReminders) await requireAddon(context, "bookloq");
  const enabled = prefs.opening || prefs.closing || prefs.invoiceReminders;
  if (enabled && (getRuntimeEnv().POS_SYNC_SECRET?.length ?? 0) < 32) throw new ApiError(503, "FOLLOWUP_SCHEDULER", "Background delivery is not configured. Save preferences with delivery off until it is available.");
  if ((prefs.emailBriefings && (prefs.opening || prefs.closing) || prefs.invoiceReminders) && !(getRuntimeEnv().RESEND_API_KEY && getRuntimeEnv().INVOICE_EMAIL_FROM)) throw new ApiError(503, "FOLLOWUP_MAIL", "Email delivery is not configured. In-app briefings can be enabled separately.");
  const version = expectedVersion(body.expectedVersion), key = mutation(body.mutationKey), db = getD1(), now = Date.now();
  const prior = await db.prepare("SELECT * FROM workflow_delivery_preferences WHERE organization_id=? AND user_id=?").bind(context.organizationId, context.userId).first<Preference & { mutation_key: string }>();
  if (prior?.mutation_key === key) { if (JSON.stringify(prefs) !== prior.payload_json || version !== prior.version - 1) throw new ApiError(409, "FOLLOWUP_REQUEST", "This save identifier was already used for different preferences."); return { saved: true, replayed: true }; }
  const result = version === 0 ? await db.prepare("INSERT OR IGNORE INTO workflow_delivery_preferences(id,organization_id,user_id,payload_json,enabled,authorized_subject,approved_email,authorization_version,version,mutation_key,last_checked_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,?,0,?)").bind(crypto.randomUUID(), context.organizationId, context.userId, JSON.stringify(prefs), Number(enabled), context.authSubject, context.identity.email, FOLLOWUP_AUTHORIZATION, key, now).run()
    : await db.prepare("UPDATE workflow_delivery_preferences SET payload_json=?,enabled=?,authorized_subject=?,approved_email=?,authorization_version=?,version=version+1,mutation_key=?,updated_at=? WHERE organization_id=? AND user_id=? AND version=?").bind(JSON.stringify(prefs), Number(enabled), context.authSubject, context.identity.email, FOLLOWUP_AUTHORIZATION, key, now, context.organizationId, context.userId, version).run();
  if (!result.meta.changes) throw new ApiError(409, "FOLLOWUP_CONFLICT", "Delivery preferences changed. Reload before saving.");
  return { saved: true, version: version + 1 };
}
export async function acknowledgeFollowup(context: AccessContext, id: unknown) {
  if (typeof id !== "string") throw new ApiError(400, "FOLLOWUP_ID", "Choose a saved briefing.");
  const result = await getD1().prepare("UPDATE workflow_deliveries SET acknowledged_at=COALESCE(acknowledged_at,?) WHERE id=? AND organization_id=? AND user_id=? AND kind<>'reminder' AND status IN ('accepted','ready')").bind(Date.now(), id, context.organizationId, context.userId).run();
  if (!result.meta.changes) throw new ApiError(404, "FOLLOWUP_NOT_FOUND", "This briefing is not available to your account.");
  return { acknowledged: true };
}
async function ownerGrant(pref: Preference) {
  const [actor] = await getDb().select({ user: users, membership: memberships, organization: workspaces }).from(users)
    .innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.organizationId, pref.organization_id))).innerJoin(workspaces, eq(workspaces.id, memberships.organizationId)).where(eq(users.id, pref.user_id)).limit(1);
  if (!actor || actor.user.status !== "active" || actor.membership.status !== "active" || actor.membership.role !== "owner" || actor.user.authProvider !== "supabase" || actor.user.authSubject !== pref.authorized_subject || actor.user.email !== pref.approved_email || !pref.authorized_subject || pref.authorization_version !== FOLLOWUP_AUTHORIZATION || !actor.organization.setupComplete) throw new ApiError(403, "FOLLOWUP_AUTHORIZATION_WITHDRAWN", "The owner's authorization must be renewed.");
  const deleting = await getD1().prepare("SELECT id FROM account_deletion_jobs WHERE stage IN ('confirmed','local_deleted') AND (user_id=? OR (scope='workspace' AND organization_id=?)) LIMIT 1").bind(pref.user_id, pref.organization_id).first();
  if (deleting) throw new ApiError(403, "FOLLOWUP_AUTHORIZATION_WITHDRAWN", "The account is being deleted.");
  // A stored, owner-issued service grant is used. No user session or MFA claim is fabricated.
  const [internal] = internalAccessEnabled() ? await getDb().select().from(internalAccess).where(and(eq(internalAccess.userId, pref.user_id), eq(internalAccess.organizationId, pref.organization_id), eq(internalAccess.active, true), eq(internalAccess.accessLevel, "founder"))).limit(1) : [];
  const complimentary = await complimentaryGrantForOwner({ userId: actor.user.id, organizationId: pref.organization_id, authSubject: actor.user.authSubject, email: actor.user.email });
  const grants = internal ? resolveInternalEntitlements({ accessLevel: internal.accessLevel, mfaRequired: internal.mfaRequired }) : complimentary ? resolveComplimentaryEntitlements(complimentary) : resolveSubscriptionEntitlements(await subscriptionSnapshot(pref.organization_id));
  requireTenantServiceAccess(grants);
  return { user: actor.user, organization: actor.organization, grants };
}
async function enqueue(pref: Preference, kind: Delivery["kind"], date: string, invoiceId: string | null, followupVersion: number | null, now: number) {
  const scopeKey = invoiceId ? `${invoiceId}:${date}` : `${pref.user_id}:${kind}:${date}`;
  await getD1().prepare("INSERT OR IGNORE INTO workflow_deliveries(id,organization_id,user_id,kind,scope_key,business_date,invoice_id,preference_version,followup_version,status,payload_json,attempts,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'pending','{}',0,?,?,?)").bind(crypto.randomUUID(), pref.organization_id, pref.user_id, kind, scopeKey, date, invoiceId, pref.version, followupVersion, now, now, now).run();
}
async function prepareDue(pref: Preference, now: number) {
  const db = getD1();
  await db.prepare("UPDATE workflow_delivery_preferences SET last_checked_at=? WHERE id=?").bind(now, pref.id).run();
  const actor = await ownerGrant(pref), prefs = validateFollowupPreferences(JSON.parse(pref.payload_json));
  const local = followupClock(new Date(now), actor.organization.timezone);
  if (grantsBriefing(actor.grants.features)) for (const slot of dueBriefingSlots(new Date(now), actor.organization.timezone, actor.organization.hoursJson, prefs)) await enqueue(pref, slot.kind, slot.businessDate, null, null, now);
  if (!prefs.invoiceReminders || !actor.grants.addons.includes("bookloq") || isFollowupQuiet(local.minute, prefs)) return;
  const rows = await db.prepare("SELECT * FROM collection_followups WHERE organization_id=? AND json_extract(payload_json,'$.remindersEnabled')=1 AND json_extract(payload_json,'$.paused')=0 ORDER BY last_checked_at,id LIMIT 10").bind(pref.organization_id).all<Followup>();
  for (const row of rows.results ?? []) {
    await db.prepare("UPDATE collection_followups SET last_checked_at=? WHERE id=? AND organization_id=?").bind(now, row.id, pref.organization_id).run();
    const current = await invoice({ organizationId: pref.organization_id }, row.invoice_id);
    if (!current) continue;
    const last = await lastAcceptedReminderDate(pref.organization_id, row.invoice_id, actor.organization.timezone);
    if (reminderEligibility(current, validateFollowupNote(JSON.parse(row.payload_json)), local.date, last, { recipient: row.approved_recipient, totalCents: row.approved_total_cents, currency: row.approved_currency }) === "eligible") await enqueue(pref, "reminder", local.date, row.invoice_id, row.version, now);
  }
}
async function lastAcceptedReminderDate(organizationId: string, invoiceId: string, timezone: string) {
  const result = await getD1().prepare("SELECT MAX(accepted_at) acceptedAt FROM workflow_deliveries WHERE organization_id=? AND invoice_id=? AND kind='reminder' AND status='accepted'").bind(organizationId, invoiceId).first<{ acceptedAt: number | null }>();
  return result?.acceptedAt ? followupClock(new Date(result.acceptedAt), timezone).date : null;
}
const grantsBriefing = (features: readonly string[]) => features.includes("business.brief.basic");
type MailPayload = { recipient: string; subject: string; text: string; summary?: { title: string; items: string[]; preparedAt: number }; invoiceReference?: string; invoiceFingerprint?: string };
function invoiceFingerprint(i: Invoice) { return JSON.stringify([i.id, i.totalCents, i.paidCents, i.recipient, i.currency, i.status]); }
async function briefingSummary(pref: Preference, title: string, today: string, canFinance: boolean, now: number) {
  const db = getD1(), items: string[] = [];
  if (canFinance) {
    for (const [table, label] of [["customer_invoices", "customer invoices"], ["supplier_bills", "supplier bills"]] as const) {
      const rows = await db.prepare(`SELECT currency,COUNT(*) count,SUM(total_cents-paid_cents) cents FROM ${table} WHERE organization_id=? AND demo_record=0 AND due_date<? AND total_cents>paid_cents AND status NOT IN ('draft','void','paid','reconciled','written_off','disputed') GROUP BY currency`).bind(pref.organization_id, today).all<{ currency: string; count: number; cents: number }>();
      for (const row of rows.results ?? []) if (Number.isSafeInteger(row.cents)) items.push(`${row.count} overdue ${label}: ${row.currency} ${(row.cents / 100).toFixed(2)} after recorded payments. Review current records before contacting or paying anyone.`);
    }
  }
  const tasks = await db.prepare("SELECT COUNT(*) count FROM workspace_tasks WHERE organization_id=? AND status NOT IN ('done','completed','cancelled') AND due_date<=?").bind(pref.organization_id, today).first<{ count: number }>();
  if (tasks?.count) items.push(`${tasks.count} recorded tasks are due. Assign or review their next actions.`);
  if (!items.length) items.push("No overdue items were found in the supported records. Missing imports and unrecorded commitments are not an all-clear.");
  items.push("Based on saved invoice, bill and task records at preparation time. This is not a bank-balance or sales-completeness check.");
  return { title, items, preparedAt: now };
}
export async function sendFollowupEmail(id: string, payload: MailPayload, fetcher: typeof fetch = fetch) {
  const env = getRuntimeEnv();
  if (!env.RESEND_API_KEY || !env.INVOICE_EMAIL_FROM || !emailPattern.test(payload.recipient)) throw new ApiError(503, "FOLLOWUP_MAIL_UNAVAILABLE", "Email delivery is unavailable.");
  const response = await fetcher("https://api.resend.com/emails", { method: "POST", redirect: "error", signal: AbortSignal.timeout(8_000), headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `workflow-${id}` }, body: JSON.stringify({ from: env.INVOICE_EMAIL_FROM, to: [payload.recipient], subject: payload.subject, text: payload.text, ...(env.INVOICE_EMAIL_REPLY_TO ? { reply_to: env.INVOICE_EMAIL_REPLY_TO } : {}) }) });
  if (!response.ok) { await response.body?.cancel(); throw new ApiError(502, response.status === 429 ? "FOLLOWUP_RATE_LIMITED" : "FOLLOWUP_MAIL_REJECTED", "The email provider did not accept the message."); }
  const result = await response.json() as { id?: unknown };
  if (typeof result.id !== "string" || !result.id) throw new ApiError(502, "FOLLOWUP_MAIL_UNCONFIRMED", "Email acceptance could not be confirmed.");
  return result.id;
}
export async function processFollowupDelivery(delivery: Delivery, now: number, send: typeof sendFollowupEmail = sendFollowupEmail) {
  const db = getD1(), lease = crypto.randomUUID();
  const claimed = await db.prepare("UPDATE workflow_deliveries SET status='sending',lease_owner=?,lease_expires_at=?,attempts=attempts+1,updated_at=? WHERE id=? AND status IN ('pending','sending') AND next_attempt_at<=? AND (lease_owner IS NULL OR lease_expires_at<=?) AND attempts<4 AND (invoice_id IS NULL OR NOT EXISTS (SELECT 1 FROM workflow_deliveries other WHERE other.organization_id=workflow_deliveries.organization_id AND other.invoice_id=workflow_deliveries.invoice_id AND other.id<>workflow_deliveries.id AND other.status='sending' AND other.lease_expires_at>?))").bind(lease, now + 120_000, now, delivery.id, now, now, now).run();
  if (!claimed.meta.changes) return "coalesced";
  let status = "pending", errorCode: string | null = null, providerId: string | null = null;
  try {
    if (now - delivery.created_at > 12 * 60 * 60_000) throw new ApiError(409, "FOLLOWUP_EXPIRED", "Delivery expired; no old reminder will be sent.");
    const pref = await db.prepare("SELECT * FROM workflow_delivery_preferences WHERE organization_id=? AND user_id=? AND enabled=1").bind(delivery.organization_id, delivery.user_id).first<Preference>();
    if (!pref || pref.version !== delivery.preference_version) throw new ApiError(409, "FOLLOWUP_PREFERENCES_CHANGED", "Delivery authorization changed.");
    const actor = await ownerGrant(pref), prefs = validateFollowupPreferences(JSON.parse(pref.payload_json)), local = followupClock(new Date(now), actor.organization.timezone);
    if (isFollowupQuiet(local.minute, prefs)) throw new ApiError(429, "FOLLOWUP_QUIET_HOURS", "Delivery is paused during quiet hours.");
    let payload = JSON.parse(delivery.payload_json) as MailPayload;
    if (delivery.kind === "reminder") {
      const settings = await db.prepare("SELECT status,data_mode FROM bookloq_settings WHERE organization_id=?").bind(delivery.organization_id).first<{ status: string; data_mode: string }>();
      if (settings?.status === "suspended" || settings?.data_mode === "demonstration") throw new ApiError(409, "FOLLOWUP_BOOKLOQ_STATE", "BookLoQ is suspended or in demonstration mode.");
      if (!prefs.invoiceReminders || !actor.grants.addons.includes("bookloq")) throw new ApiError(403, "FOLLOWUP_REMINDERS_DISABLED", "Reminder access changed.");
      const row = await db.prepare("SELECT * FROM collection_followups WHERE organization_id=? AND invoice_id=?").bind(delivery.organization_id, delivery.invoice_id).first<Followup>();
      const current = await invoice({ organizationId: delivery.organization_id }, delivery.invoice_id!);
      const last = await lastAcceptedReminderDate(delivery.organization_id, delivery.invoice_id!, actor.organization.timezone);
      if (!row || !current || row.version !== delivery.followup_version || reminderEligibility(current, validateFollowupNote(JSON.parse(row.payload_json)), local.date, last, { recipient: row.approved_recipient, totalCents: row.approved_total_cents, currency: row.approved_currency }) !== "eligible") throw new ApiError(409, "FOLLOWUP_INVOICE_CHANGED", "Payment, recipient, dispute or follow-up details changed.");
      const fingerprint = invoiceFingerprint(current);
      if (payload.invoiceFingerprint && payload.invoiceFingerprint !== fingerprint) throw new ApiError(409, "FOLLOWUP_INVOICE_CHANGED", "The invoice changed after an earlier send attempt.");
      if (!payload.recipient) payload = { recipient: current.recipient, invoiceReference: current.reference, invoiceFingerprint: fingerprint, subject: `Invoice ${current.reference}: payment reminder`, text: `Hello,\n\nThis is a reminder from ${actor.organization.businessName} about invoice ${current.reference}, due ${current.dueDate}. The current recorded outstanding balance is ${current.currency} ${((current.totalCents - current.paidCents) / 100).toFixed(2)}.\n\nIf you have already paid or need to discuss this invoice, please contact ${actor.organization.businessEmail}. Payment records can take time to be updated.\n\nSent through BookLoQ by Vanteloq.` };
    } else {
      if (!prefs[delivery.kind] || !grantsBriefing(actor.grants.features)) throw new ApiError(403, "FOLLOWUP_BRIEFING_DISABLED", "Briefing access changed.");
      if (!payload.recipient) payload = { recipient: actor.user.email, subject: `${delivery.kind === "opening" ? "Opening" : "Closing"} briefing ready in Vanteloq`, text: "Your requested business briefing is ready. Sign in at https://vanteloq.com/ and open Daily follow-through to review it. No customer or financial records are included in this email.", summary: await briefingSummary(pref, `${delivery.kind === "opening" ? "Opening" : "Closing"} briefing`, local.date, actor.grants.addons.includes("bookloq"), now) };
      if (payload.recipient !== actor.user.email) throw new ApiError(409, "FOLLOWUP_RECIPIENT_CHANGED", "The owner's address changed.");
    }
    await db.prepare("UPDATE workflow_deliveries SET payload_json=? WHERE id=? AND lease_owner=?").bind(JSON.stringify(payload), delivery.id, lease).run();
    // Re-read revocation and current balance immediately before the external send.
    const unchanged = await db.prepare("SELECT version FROM workflow_delivery_preferences WHERE id=? AND enabled=1 AND version=?").bind(pref.id, pref.version).first();
    if (!unchanged) throw new ApiError(409, "FOLLOWUP_PREFERENCES_CHANGED", "Delivery was disabled.");
    if (delivery.kind === "reminder") {
      const latest = await invoice({ organizationId: delivery.organization_id }, delivery.invoice_id!);
      const sameFollowup = await db.prepare("SELECT version FROM collection_followups WHERE organization_id=? AND invoice_id=? AND version=?").bind(delivery.organization_id, delivery.invoice_id, delivery.followup_version).first();
      if (!latest || !sameFollowup || invoiceFingerprint(latest) !== payload.invoiceFingerprint) throw new ApiError(409, "FOLLOWUP_INVOICE_CHANGED", "The invoice changed before delivery.");
    }
    await ownerGrant(pref);
    if (delivery.kind !== "reminder" && !prefs.emailBriefings) status = "ready";
    else { providerId = await send(delivery.id, payload); status = "accepted"; }
  } catch (error) {
    errorCode = error instanceof ApiError ? error.code : "FOLLOWUP_TEMPORARY_ERROR";
    status = errorCode === "FOLLOWUP_QUIET_HOURS" ? "pending" : error instanceof ApiError && [400, 402, 403, 404, 409].includes(error.status) ? "suppressed" : delivery.attempts + 1 >= 4 ? "failed" : "pending";
  }
  await db.prepare("UPDATE workflow_deliveries SET status=?,error_code=?,provider_id=?,attempts=attempts-?,accepted_at=CASE WHEN ?='accepted' THEN ? ELSE accepted_at END,next_attempt_at=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND lease_owner=?").bind(status, errorCode, providerId, Number(errorCode === "FOLLOWUP_QUIET_HOURS"), status, now, now + (errorCode === "FOLLOWUP_QUIET_HOURS" ? 60 * 60_000 : followupRetryDelay(delivery.attempts + 1)), now, delivery.id, lease).run();
  return status;
}
/** Called only after the existing signed scheduler has verified signature and nonce. */
export async function runWorkflowFollowupTick(now = Date.now(), send: typeof sendFollowupEmail = sendFollowupEmail) {
  const db = getD1();
  await db.prepare("UPDATE workflow_deliveries SET status='failed',error_code='FOLLOWUP_RETRY_LIMIT',lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE status='sending' AND lease_expires_at<=? AND attempts>=4").bind(now, now).run();
  const preferences = await db.prepare("SELECT * FROM workflow_delivery_preferences WHERE enabled=1 AND last_checked_at<? ORDER BY last_checked_at,id LIMIT 3").bind(now - 60_000).all<Preference>();
  for (const pref of preferences.results ?? []) {
    try { await prepareDue(pref, now); } catch (error) { if (error instanceof ApiError && [402, 403].includes(error.status)) await db.prepare("UPDATE workflow_delivery_preferences SET enabled=0 WHERE id=? AND version=?").bind(pref.id, pref.version).run(); }
  }
  const due = await db.prepare("SELECT * FROM workflow_deliveries WHERE status IN ('pending','sending') AND next_attempt_at<=? AND (lease_owner IS NULL OR lease_expires_at<=?) AND attempts<4 ORDER BY next_attempt_at,id LIMIT 2").bind(now, now).all<Delivery>();
  const results = await Promise.allSettled((due.results ?? []).map(row => processFollowupDelivery(row, now, send)));
  return { checked: preferences.results?.length ?? 0, processed: results.length, accepted: results.filter(r => r.status === "fulfilled" && r.value === "accepted").length };
}
