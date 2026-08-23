import { asc, desc, eq, like } from "drizzle-orm";
import { getDb } from "../../../../db";
import {
  auditEvents,
  managementActivities,
  managementConsoleAccess,
  managementContacts,
  managementTasks,
  memberships,
  tenantAddons,
  tenantSubscriptions,
  users,
  workspaces,
} from "../../../../db/schema";
import { recordAudit } from "../../../../server/audit";
import {
  clientSource,
  enforceRateLimit,
  handleApi,
  jsonResponse,
  readJsonObject,
  requireSameOrigin,
  ApiError,
} from "../../../../server/api";
import { ADDONS, PLANS, type BillingInterval, type PlanKey } from "../../../../server/entitlements/catalog";
import { FOUNDER_BOOTSTRAP_EMAIL } from "../../../../server/internal-access";
import {
  MANAGEMENT_COMPANIES,
  requireManagementConsoleAccess,
  requireManagementOwner,
  requireManagementScope,
  requireManagementWrite,
  type ManagementCompany,
  type ManagementConsoleContext,
} from "../../../../server/management-console-access";

const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,190}$/;
const roles = ["admin", "viewer"] as const;
const contactStages = ["lead", "prospect", "client", "partner", "inactive"] as const;
const activityKinds = ["call", "meeting", "follow_up", "deadline"] as const;
const activityStatuses = ["scheduled", "completed", "cancelled", "no_show"] as const;
const taskPriorities = ["high", "medium", "low"] as const;
const taskStatuses = ["open", "in_progress", "done"] as const;

function requiredText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum) {
    throw new ApiError(400, "CONSOLE_INPUT_INVALID", `${field} is required and must be ${maximum} characters or fewer.`);
  }
  return value.trim();
}

function optionalText(value: unknown, maximum: number): string {
  if (value == null) return "";
  if (typeof value !== "string" || value.trim().length > maximum) {
    throw new ApiError(400, "CONSOLE_INPUT_INVALID", `A text value exceeds the ${maximum} character limit.`);
  }
  return value.trim();
}

function optionalEmail(value: unknown): string {
  const email = optionalText(value, 255).toLowerCase();
  if (email && !EMAIL_PATTERN.test(email)) {
    throw new ApiError(400, "CONSOLE_INPUT_INVALID", "Enter a valid email address.");
  }
  return email;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ApiError(400, "CONSOLE_INPUT_INVALID", `Select a valid ${field}.`);
  }
  return value as T;
}

function companyValue(value: unknown): ManagementCompany {
  return enumValue(value, MANAGEMENT_COMPANIES, "company");
}

function optionalDate(value: unknown, field: string): Date | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 40) throw new ApiError(400, "CONSOLE_INPUT_INVALID", `${field} is invalid.`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ApiError(400, "CONSOLE_INPUT_INVALID", `${field} is invalid.`);
  return date;
}

function requiredDate(value: unknown, field: string): Date {
  const date = optionalDate(value, field);
  if (!date) throw new ApiError(400, "CONSOLE_INPUT_INVALID", `${field} is required.`);
  return date;
}

function parseScopes(value: unknown): ManagementCompany[] {
  if (!Array.isArray(value)) throw new ApiError(400, "CONSOLE_INPUT_INVALID", "Choose at least one company scope.");
  const scopes = [...new Set(value.filter((item): item is ManagementCompany =>
    typeof item === "string" && MANAGEMENT_COMPANIES.includes(item as ManagementCompany),
  ))];
  if (!scopes.length) throw new ApiError(400, "CONSOLE_INPUT_INVALID", "Choose at least one company scope.");
  return scopes;
}

function parseStoredScopes(value: string): ManagementCompany[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((item): item is ManagementCompany =>
      typeof item === "string" && MANAGEMENT_COMPANIES.includes(item as ManagementCompany),
    ))];
  } catch {
    return [];
  }
}

function dateDto(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function monthlyPlanAmount(plan: PlanKey | null, interval: BillingInterval | null): number {
  if (!plan || !interval) return 0;
  const price = PLANS[plan].prices[interval];
  return interval === "year" ? Math.round(price.amountCents / 12) : price.amountCents;
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function visibleCompany(context: ManagementConsoleContext, company: ManagementCompany) {
  return context.scopes.includes(company);
}

async function dashboardPayload(context: ManagementConsoleContext) {
  const db = getDb();
  const [peopleRows, addonRows, contactRows, activityRows, taskRows, accessRows, auditRows] = await Promise.all([
    db.select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      userStatus: users.status,
      userCreatedAt: users.createdAt,
      userUpdatedAt: users.updatedAt,
      organizationId: workspaces.id,
      businessName: workspaces.businessName,
      businessEmail: workspaces.businessEmail,
      organizationCreatedAt: workspaces.createdAt,
      membershipRole: memberships.role,
      membershipStatus: memberships.status,
      plan: tenantSubscriptions.basePlan,
      billingInterval: tenantSubscriptions.billingInterval,
      subscriptionStatus: tenantSubscriptions.status,
      trialEndsAt: tenantSubscriptions.trialEndsAt,
      currentPeriodEndsAt: tenantSubscriptions.currentPeriodEndsAt,
      cancelAtPeriodEnd: tenantSubscriptions.cancelAtPeriodEnd,
      lastSyncedAt: tenantSubscriptions.lastSyncedAt,
    }).from(users)
      .leftJoin(memberships, eq(memberships.userId, users.id))
      .leftJoin(workspaces, eq(workspaces.id, memberships.organizationId))
      .leftJoin(tenantSubscriptions, eq(tenantSubscriptions.organizationId, workspaces.id))
      .orderBy(desc(users.createdAt))
      .limit(500),
    db.select().from(tenantAddons),
    db.select().from(managementContacts).orderBy(desc(managementContacts.updatedAt)).limit(500),
    db.select().from(managementActivities).orderBy(asc(managementActivities.startsAt)).limit(500),
    db.select().from(managementTasks).orderBy(asc(managementTasks.dueAt), desc(managementTasks.createdAt)).limit(500),
    context.role === "owner"
      ? db.select().from(managementConsoleAccess).orderBy(desc(managementConsoleAccess.createdAt)).limit(100)
      : Promise.resolve([]),
    context.role === "owner"
      ? db.select({
        id: auditEvents.id,
        action: auditEvents.action,
        resourceType: auditEvents.resourceType,
        resourceId: auditEvents.resourceId,
        outcome: auditEvents.outcome,
        createdAt: auditEvents.createdAt,
      }).from(auditEvents).where(like(auditEvents.action, "management_console.%")).orderBy(desc(auditEvents.createdAt)).limit(30)
      : Promise.resolve([]),
  ]);

  const activeAddonByOrganization = new Map<string, number>();
  for (const addon of addonRows) {
    if (!["active", "trialing", "scheduled_for_removal"].includes(addon.status)) continue;
    const price = ADDONS[addon.addonKey].prices.month.amountCents;
    activeAddonByOrganization.set(addon.organizationId, (activeAddonByOrganization.get(addon.organizationId) ?? 0) + price);
  }

  const subscriptionRows = peopleRows.filter((row) => row.organizationId && row.membershipRole === "owner");
  const activeSubscriptions = subscriptionRows.filter((row) => row.subscriptionStatus === "active");
  const trialSubscriptions = subscriptionRows.filter((row) => row.subscriptionStatus === "trialing");
  const attentionSubscriptions = subscriptionRows.filter((row) => row.subscriptionStatus === "past_due" || row.subscriptionStatus === "unpaid");
  const estimatedMrrCents = activeSubscriptions.reduce((sum, row) => sum
    + monthlyPlanAmount(row.plan, row.billingInterval)
    + (row.organizationId ? activeAddonByOrganization.get(row.organizationId) ?? 0 : 0), 0);
  const trialPipelineMrrCents = trialSubscriptions.reduce((sum, row) => sum + monthlyPlanAmount(row.plan, row.billingInterval), 0);
  const planMix = (["starter", "growth", "pro"] as const).map((plan) => ({
    plan,
    count: activeSubscriptions.filter((row) => row.plan === plan).length,
  }));
  const subscriberOrganizations = new Set(subscriptionRows.map((row) => row.organizationId).filter(Boolean));
  const allOrganizations = new Set(peopleRows.map((row) => row.organizationId).filter(Boolean));
  const now = new Date();
  const sixMonths = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (5 - index), 1));
    return {
      key: monthKey(date),
      label: new Intl.DateTimeFormat("en-CA", { month: "short", timeZone: "UTC" }).format(date),
      signups: 0,
    };
  });
  for (const row of peopleRows) {
    const bucket = sixMonths.find((item) => item.key === monthKey(row.userCreatedAt));
    if (bucket) bucket.signups += 1;
  }

  const contacts = contactRows
    .filter((row) => visibleCompany(context, row.company))
    .map((row) => ({
      id: row.id,
      company: row.company,
      name: row.name,
      email: row.email,
      phone: row.phone,
      organization: row.organization,
      stage: row.stage,
      source: row.source,
      owner: row.owner,
      notes: row.notes,
      lastContactAt: dateDto(row.lastContactAt),
      nextFollowUpAt: dateDto(row.nextFollowUpAt),
      createdAt: dateDto(row.createdAt),
      updatedAt: dateDto(row.updatedAt),
    }));
  const activities = activityRows
    .filter((row) => visibleCompany(context, row.company))
    .map((row) => ({
      id: row.id,
      company: row.company,
      kind: row.kind,
      title: row.title,
      contactId: row.contactId,
      contactName: row.contactName,
      contactEmail: row.contactEmail,
      startsAt: dateDto(row.startsAt),
      endsAt: dateDto(row.endsAt),
      location: row.location,
      status: row.status,
      notes: row.notes,
      outcome: row.outcome,
    }));
  const tasks = taskRows
    .filter((row) => visibleCompany(context, row.company))
    .map((row) => ({
      id: row.id,
      company: row.company,
      title: row.title,
      detail: row.detail,
      priority: row.priority,
      status: row.status,
      dueAt: dateDto(row.dueAt),
      assignee: row.assignee,
      contactId: row.contactId,
      createdAt: dateDto(row.createdAt),
    }));

  return {
    viewer: {
      name: context.identity.displayName,
      email: context.identity.email,
      role: context.role,
      scopes: context.scopes,
      mfa: "verified",
    },
    generatedAt: new Date().toISOString(),
    vanteloq: visibleCompany(context, "vanteloq") ? {
      metrics: {
        accounts: peopleRows.length,
        organizations: allOrganizations.size,
        activeSubscribers: activeSubscriptions.length,
        trials: trialSubscriptions.length,
        billingAttention: attentionSubscriptions.length,
        estimatedMrrCents,
        trialPipelineMrrCents,
        conversionRate: allOrganizations.size ? (subscriberOrganizations.size / allOrganizations.size) * 100 : 0,
        newAccounts30d: peopleRows.filter((row) => row.userCreatedAt.getTime() >= Date.now() - 30 * 86_400_000).length,
      },
      planMix,
      signupTrend: sixMonths,
      people: peopleRows.map((row) => ({
        id: row.id,
        displayName: row.displayName,
        email: row.email,
        status: row.userStatus,
        businessName: row.businessName,
        businessEmail: row.businessEmail,
        role: row.membershipRole,
        plan: row.plan,
        subscriptionStatus: row.subscriptionStatus,
        joinedAt: dateDto(row.userCreatedAt),
      })),
      subscriptions: subscriptionRows.map((row) => ({
        organizationId: row.organizationId,
        businessName: row.businessName,
        ownerName: row.displayName,
        ownerEmail: row.email,
        plan: row.plan,
        billingInterval: row.billingInterval,
        status: row.subscriptionStatus,
        trialEndsAt: dateDto(row.trialEndsAt),
        currentPeriodEndsAt: dateDto(row.currentPeriodEndsAt),
        cancelAtPeriodEnd: row.cancelAtPeriodEnd ?? false,
        addonMrrCents: row.organizationId ? activeAddonByOrganization.get(row.organizationId) ?? 0 : 0,
        estimatedMrrCents: monthlyPlanAmount(row.plan, row.billingInterval) + (row.organizationId ? activeAddonByOrganization.get(row.organizationId) ?? 0 : 0),
        lastSyncedAt: dateDto(row.lastSyncedAt),
      })),
      analytics: {
        status: "not_connected",
        message: "Connect a consent appropriate analytics source to add anonymous visitor and conversion data. Account and subscriber totals above are live application records.",
      },
    } : null,
    operations: {
      contacts,
      activities,
      tasks,
      summary: MANAGEMENT_COMPANIES.filter((company) => visibleCompany(context, company)).map((company) => ({
        company,
        contacts: contacts.filter((row) => row.company === company && row.stage !== "inactive").length,
        activeClients: contacts.filter((row) => row.company === company && row.stage === "client").length,
        upcoming: activities.filter((row) => row.company === company && row.status === "scheduled" && new Date(row.startsAt ?? 0).getTime() >= Date.now()).length,
        openTasks: tasks.filter((row) => row.company === company && row.status !== "done").length,
        overdueTasks: tasks.filter((row) => row.company === company && row.status !== "done" && row.dueAt && new Date(row.dueAt).getTime() < Date.now()).length,
      })),
    },
    access: context.role === "owner" ? [
      {
        id: "founder",
        email: FOUNDER_BOOTSTRAP_EMAIL,
        role: "owner",
        scopes: MANAGEMENT_COMPANIES,
        active: true,
        mfaRequired: true,
        lastAccessedAt: null,
        protected: true,
      },
      ...accessRows.map((row) => ({
        id: row.id,
        email: row.email,
        role: row.role,
        scopes: parseStoredScopes(row.scopesJson),
        active: row.active,
        mfaRequired: row.mfaRequired,
        lastAccessedAt: dateDto(row.lastAccessedAt),
        protected: false,
      })),
    ] : null,
    audit: auditRows.map((row) => ({ ...row, createdAt: dateDto(row.createdAt) })),
  };
}

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireManagementConsoleAccess(request);
    await enforceRateLimit("management-console:read", `${context.userId}:${clientSource(request)}`, 120, 60);
    return jsonResponse(await dashboardPayload(context));
  });
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireManagementConsoleAccess(request);
    requireManagementWrite(context);
    await enforceRateLimit("management-console:write", context.userId, 60, 60);
    const body = await readJsonObject(request, 32_768);
    const action = requiredText(body.action, "Action", 80);
    const now = new Date();
    const db = getDb();

    if (action === "contact.create") {
      const company = companyValue(body.company);
      requireManagementScope(context, company);
      const [contact] = await db.insert(managementContacts).values({
        id: crypto.randomUUID(),
        company,
        name: requiredText(body.name, "Name", 160),
        email: optionalEmail(body.email),
        phone: optionalText(body.phone, 50),
        organization: optionalText(body.organization, 160),
        stage: enumValue(body.stage ?? "lead", contactStages, "contact stage"),
        source: optionalText(body.source ?? "manual", 100),
        owner: optionalText(body.owner ?? context.identity.displayName, 160),
        notes: optionalText(body.notes, 2_000),
        lastContactAt: optionalDate(body.lastContactAt, "Last contact date"),
        nextFollowUpAt: optionalDate(body.nextFollowUpAt, "Next follow-up date"),
        createdByUserId: context.userId,
        createdAt: now,
        updatedAt: now,
      }).returning();
      await recordAudit({ request, requestId, actorUserId: context.userId, action: "management_console.contact_created", resourceType: "management_contact", resourceId: contact.id, details: { company, stage: contact.stage } });
      return jsonResponse({ created: true, id: contact.id }, { status: 201 });
    }

    if (action === "activity.create") {
      const company = companyValue(body.company);
      requireManagementScope(context, company);
      const startsAt = requiredDate(body.startsAt, "Start time");
      const endsAt = optionalDate(body.endsAt, "End time");
      if (endsAt && endsAt <= startsAt) throw new ApiError(400, "CONSOLE_INPUT_INVALID", "The end time must be after the start time.");
      const contactId = optionalText(body.contactId, 100) || null;
      if (contactId) {
        const [contact] = await db.select({ company: managementContacts.company }).from(managementContacts).where(eq(managementContacts.id, contactId)).limit(1);
        if (!contact || contact.company !== company) {
          throw new ApiError(400, "CONSOLE_CONTACT_INVALID", "Choose a contact from the selected company.");
        }
      }
      const [activity] = await db.insert(managementActivities).values({
        id: crypto.randomUUID(),
        company,
        kind: enumValue(body.kind, activityKinds, "activity type"),
        title: requiredText(body.title, "Title", 200),
        contactId,
        contactName: optionalText(body.contactName, 160),
        contactEmail: optionalEmail(body.contactEmail),
        startsAt,
        endsAt,
        location: optionalText(body.location, 300),
        status: "scheduled",
        notes: optionalText(body.notes, 2_000),
        outcome: "",
        createdByUserId: context.userId,
        createdAt: now,
        updatedAt: now,
      }).returning();
      await recordAudit({ request, requestId, actorUserId: context.userId, action: "management_console.activity_created", resourceType: "management_activity", resourceId: activity.id, details: { company, kind: activity.kind } });
      return jsonResponse({ created: true, id: activity.id }, { status: 201 });
    }

    if (action === "task.create") {
      const company = companyValue(body.company);
      requireManagementScope(context, company);
      const contactId = optionalText(body.contactId, 100) || null;
      if (contactId) {
        const [contact] = await db.select({ company: managementContacts.company }).from(managementContacts).where(eq(managementContacts.id, contactId)).limit(1);
        if (!contact || contact.company !== company) {
          throw new ApiError(400, "CONSOLE_CONTACT_INVALID", "Choose a contact from the selected company.");
        }
      }
      const [task] = await db.insert(managementTasks).values({
        id: crypto.randomUUID(),
        company,
        title: requiredText(body.title, "Title", 200),
        detail: optionalText(body.detail, 2_000),
        priority: enumValue(body.priority ?? "medium", taskPriorities, "priority"),
        status: "open",
        dueAt: optionalDate(body.dueAt, "Due date"),
        assignee: optionalText(body.assignee ?? context.identity.displayName, 160),
        contactId,
        createdByUserId: context.userId,
        createdAt: now,
        updatedAt: now,
      }).returning();
      await recordAudit({ request, requestId, actorUserId: context.userId, action: "management_console.task_created", resourceType: "management_task", resourceId: task.id, details: { company, priority: task.priority } });
      return jsonResponse({ created: true, id: task.id }, { status: 201 });
    }

    if (action === "access.grant") {
      requireManagementOwner(context);
      const email = requiredText(body.email, "Email", 255).toLowerCase();
      if (!EMAIL_PATTERN.test(email) || email === FOUNDER_BOOTSTRAP_EMAIL) throw new ApiError(400, "CONSOLE_INPUT_INVALID", "Enter a different valid email address.");
      const role = enumValue(body.role, roles, "access role");
      const scopes = parseScopes(body.scopes);
      const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      const id = crypto.randomUUID();
      await db.insert(managementConsoleAccess).values({
        id,
        email,
        userId: existingUser?.id ?? null,
        role,
        scopesJson: JSON.stringify(scopes),
        active: true,
        mfaRequired: true,
        grantedByUserId: context.userId,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: managementConsoleAccess.email,
        set: { userId: existingUser?.id ?? null, role, scopesJson: JSON.stringify(scopes), active: true, mfaRequired: true, grantedByUserId: context.userId, updatedAt: now },
      });
      await recordAudit({ request, requestId, actorUserId: context.userId, action: "management_console.access_granted", resourceType: "management_console_access", resourceId: id, details: { email, role, scopes: scopes.join(",") } });
      return jsonResponse({ granted: true });
    }

    throw new ApiError(400, "CONSOLE_ACTION_INVALID", "The requested console action is not supported.");
  });
}

export async function PATCH(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireManagementConsoleAccess(request);
    requireManagementWrite(context);
    await enforceRateLimit("management-console:update", context.userId, 120, 60);
    const body = await readJsonObject(request, 16_384);
    const resource = enumValue(body.resource, ["contact", "activity", "task", "access"] as const, "resource");
    const id = requiredText(body.id, "Resource ID", 100);
    const db = getDb();
    const now = new Date();

    if (resource === "contact") {
      const [before] = await db.select().from(managementContacts).where(eq(managementContacts.id, id)).limit(1);
      if (!before) throw new ApiError(404, "CONSOLE_CONTACT_NOT_FOUND", "Contact not found.");
      requireManagementScope(context, before.company);
      const stage = enumValue(body.stage, contactStages, "contact stage");
      await db.update(managementContacts).set({ stage, notes: body.notes == null ? before.notes : optionalText(body.notes, 2_000), nextFollowUpAt: body.nextFollowUpAt === undefined ? before.nextFollowUpAt : optionalDate(body.nextFollowUpAt, "Next follow-up date"), updatedAt: now }).where(eq(managementContacts.id, id));
      await recordAudit({ request, requestId, actorUserId: context.userId, action: "management_console.contact_updated", resourceType: "management_contact", resourceId: id, details: { before: before.stage, after: stage } });
      return jsonResponse({ updated: true });
    }

    if (resource === "activity") {
      const [before] = await db.select().from(managementActivities).where(eq(managementActivities.id, id)).limit(1);
      if (!before) throw new ApiError(404, "CONSOLE_ACTIVITY_NOT_FOUND", "Activity not found.");
      requireManagementScope(context, before.company);
      const status = enumValue(body.status, activityStatuses, "activity status");
      await db.update(managementActivities).set({ status, outcome: body.outcome == null ? before.outcome : optionalText(body.outcome, 2_000), notes: body.notes == null ? before.notes : optionalText(body.notes, 2_000), updatedAt: now }).where(eq(managementActivities.id, id));
      await recordAudit({ request, requestId, actorUserId: context.userId, action: "management_console.activity_updated", resourceType: "management_activity", resourceId: id, details: { before: before.status, after: status } });
      return jsonResponse({ updated: true });
    }

    if (resource === "task") {
      const [before] = await db.select().from(managementTasks).where(eq(managementTasks.id, id)).limit(1);
      if (!before) throw new ApiError(404, "CONSOLE_TASK_NOT_FOUND", "Task not found.");
      requireManagementScope(context, before.company);
      const status = enumValue(body.status, taskStatuses, "task status");
      await db.update(managementTasks).set({ status, updatedAt: now }).where(eq(managementTasks.id, id));
      await recordAudit({ request, requestId, actorUserId: context.userId, action: "management_console.task_updated", resourceType: "management_task", resourceId: id, details: { before: before.status, after: status } });
      return jsonResponse({ updated: true });
    }

    requireManagementOwner(context);
    const [before] = await db.select().from(managementConsoleAccess).where(eq(managementConsoleAccess.id, id)).limit(1);
    if (!before) throw new ApiError(404, "CONSOLE_ACCESS_NOT_FOUND", "Access grant not found.");
    const active = typeof body.active === "boolean" ? body.active : before.active;
    const role = body.role == null ? before.role : enumValue(body.role, roles, "access role");
    const scopes = body.scopes == null ? parseStoredScopes(before.scopesJson) : parseScopes(body.scopes);
    if (!scopes.length) {
      throw new ApiError(409, "CONSOLE_ACCESS_INVALID", "Choose at least one company scope before updating this access grant.");
    }
    await db.update(managementConsoleAccess).set({ active, role, scopesJson: JSON.stringify(scopes), updatedAt: now }).where(eq(managementConsoleAccess.id, id));
    await recordAudit({ request, requestId, actorUserId: context.userId, action: active ? "management_console.access_updated" : "management_console.access_revoked", resourceType: "management_console_access", resourceId: id, details: { email: before.email, role, active, scopes: scopes.join(",") } });
    return jsonResponse({ updated: true });
  });
}
