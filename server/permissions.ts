import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { accessRoles, teamMembers } from "../db/schema";
import { ApiError } from "./api";
import type { AccessContext, Role } from "./authorization";

export const permissionGroups = [
  {
    group: "Dashboard & intelligence",
    permissions: [
      ["dashboard.view", "View executive dashboard", "standard"],
      ["metrics.revenue", "View revenue metrics", "financial"],
      ["metrics.profit", "View profit and margin", "sensitive"],
      ["metrics.cash", "View cash metrics", "restricted"],
      ["insights.view", "View recommendations", "standard"],
      ["insights.create_task", "Create tasks from insights", "standard"],
    ],
  },
  {
    group: "Sales",
    permissions: [
      ["sales.view", "View sales totals", "standard"],
      ["sales.transactions", "View individual transactions", "sensitive"],
      ["sales.refunds", "View refunds and discounts", "standard"],
      ["sales.refund_issue", "Issue refunds", "sensitive"],
      ["sales.export", "Export sales records", "sensitive"],
    ],
  },
  {
    group: "Finance & BookLoQ",
    permissions: [
      ["finance.statements", "View financial statements", "restricted"],
      [
        "finance.bank_balances",
        "View bank balances and available cash",
        "restricted",
      ],
      ["finance.bank_transactions", "View bank transactions", "restricted"],
      ["finance.costs", "View product and supplier costs", "sensitive"],
      ["finance.ap_ar", "View accounts payable and receivable", "restricted"],
      ["finance.journal_post", "Post journal entries", "restricted"],
      ["finance.reconcile", "Reconcile accounts", "restricted"],
      ["finance.periods", "Lock or unlock periods", "restricted"],
      ["finance.export", "Export financial information", "restricted"],
      ["finance.connections", "Manage banking connections", "restricted"],
    ],
  },
  {
    group: "Payroll & compensation",
    permissions: [
      ["payroll.totals", "View payroll totals", "restricted"],
      ["payroll.individual", "View individual compensation", "restricted"],
      ["payroll.edit", "Edit compensation", "restricted"],
      ["payroll.export", "Export payroll", "restricted"],
    ],
  },
  {
    group: "Inventory & purchasing",
    permissions: [
      ["inventory.view", "View quantities", "standard"],
      ["inventory.value", "View inventory value and costs", "sensitive"],
      ["inventory.adjust", "Adjust or transfer inventory", "sensitive"],
      ["purchasing.view", "View purchase orders", "standard"],
      ["purchasing.create", "Create purchase orders", "sensitive"],
      ["purchasing.approve", "Approve purchase orders", "restricted"],
      ["purchasing.send", "Send purchase orders", "restricted"],
      ["purchasing.receive", "Receive inventory", "standard"],
      ["purchasing.match", "Match invoices", "sensitive"],
    ],
  },
  {
    group: "Documents",
    permissions: [
      ["documents.upload", "Upload invoices and receipts", "standard"],
      ["documents.view", "View financial documents", "sensitive"],
      ["documents.review", "Review extracted information", "sensitive"],
      ["documents.download", "Download documents", "sensitive"],
      ["documents.retention", "Manage document retention", "restricted"],
    ],
  },
  {
    group: "Customers & marketing",
    permissions: [
      ["customers.totals", "View customer totals", "standard"],
      [
        "customers.identity",
        "View customer identity and contact details",
        "sensitive",
      ],
      ["customers.export", "Export customer data", "restricted"],
      ["marketing.view", "View marketing performance", "standard"],
      ["marketing.spend", "View marketing spending", "sensitive"],
      ["marketing.manage", "Manage campaigns and integrations", "restricted"],
    ],
  },
  {
    group: "Team & operations",
    permissions: [
      ["team.directory", "View employee directory", "standard"],
      ["team.contacts", "View employee contact information", "sensitive"],
      ["team.create", "Create and invite employees", "restricted"],
      ["team.edit", "Edit, suspend or archive employees", "restricted"],
      ["team.roles", "Assign roles and permissions", "restricted"],
      ["team.pin_reset", "Reset workplace PINs", "restricted"],
      ["operations.tasks", "View and complete tasks", "standard"],
      ["operations.manage", "Assign tasks and manage checklists", "standard"],
      ["locations.manage", "Manage locations", "restricted"],
    ],
  },
  {
    group: "Reports, integrations & administration",
    permissions: [
      ["reports.operational", "View operational reports", "standard"],
      ["reports.financial", "View financial reports", "restricted"],
      ["reports.export", "Export or schedule reports", "sensitive"],
      [
        "integrations.view",
        "View integrations and synchronization",
        "standard",
      ],
      [
        "integrations.manage",
        "Connect, disconnect and manage credentials",
        "restricted",
      ],
      ["data.import", "Upload and map data", "sensitive"],
      ["audit.view", "View audit history", "restricted"],
      [
        "organization.settings",
        "Manage organization settings and branding",
        "restricted",
      ],
      ["organization.billing", "Manage billing and subscription", "restricted"],
      ["organization.ownership", "Manage ownership", "restricted"],
    ],
  },
] as const;

export type PermissionKey =
  (typeof permissionGroups)[number]["permissions"][number][0];
export const allPermissions = permissionGroups.flatMap((group) =>
  group.permissions.map((item) => item[0]),
) as PermissionKey[];

const operations = allPermissions.filter(
  (permission) =>
    !permission.startsWith("finance.") &&
    !permission.startsWith("payroll.") &&
    permission !== "metrics.cash" &&
    !permission.includes("billing") &&
    !permission.includes("ownership"),
);
const employee = [
  "dashboard.view",
  "metrics.revenue",
  "insights.view",
  "insights.create_task",
  "sales.view",
  "inventory.view",
  "operations.tasks",
  "purchasing.receive",
  "documents.upload",
] as PermissionKey[];
const finance = allPermissions.filter(
  (permission) =>
    permission.startsWith("dashboard.") ||
    permission.startsWith("metrics.") ||
    permission.startsWith("finance.") ||
    permission.startsWith("documents.") ||
    permission.startsWith("reports.") ||
    permission === "audit.view",
);

export const roleTemplates: Record<string, readonly PermissionKey[]> = {
  account_owner: allPermissions,
  organization_administrator: allPermissions.filter(
    (permission) => permission !== "organization.ownership",
  ),
  finance_administrator: finance,
  accountant_bookkeeper: finance.filter(
    (permission) => permission !== "finance.connections",
  ),
  general_manager: operations,
  location_manager: operations.filter(
    (permission) =>
      !permission.startsWith("integrations.") && permission !== "team.roles",
  ),
  inventory_purchasing_manager: allPermissions.filter(
    (permission) =>
      permission.startsWith("inventory.") ||
      permission.startsWith("purchasing.") ||
      permission.startsWith("documents.") ||
      permission === "metrics.cash" ||
      permission === "operations.tasks",
  ),
  marketing_manager: allPermissions.filter(
    (permission) =>
      permission.startsWith("marketing.") ||
      permission.startsWith("customers.") ||
      permission === "sales.view" ||
      permission === "reports.operational",
  ),
  team_lead: employee.concat(["team.directory", "operations.manage"]),
  employee,
  external_advisor: finance.filter(
    (permission) =>
      !permission.endsWith("post") &&
      !permission.endsWith("periods") &&
      !permission.endsWith("connections"),
  ),
  read_only_reviewer: allPermissions.filter(
    (permission) =>
      permission.includes(".view") ||
      permission.startsWith("metrics.") ||
      (permission.startsWith("reports.") && permission !== "reports.export"),
  ),
};

function parsePermissions(value: string): PermissionKey[] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is PermissionKey =>
        typeof item === "string" &&
        allPermissions.includes(item as PermissionKey),
    );
  } catch {
    return [];
  }
}

export async function effectivePermissions(
  context: AccessContext,
): Promise<PermissionKey[]> {
  if (context.role === "owner") return [...allPermissions];
  const [profile] = await getDb()
    .select({ permissionsJson: accessRoles.permissionsJson })
    .from(teamMembers)
    .leftJoin(accessRoles, eq(teamMembers.roleId, accessRoles.id))
    .where(
      and(
        eq(teamMembers.organizationId, context.organizationId),
        eq(teamMembers.userId, context.userId),
        eq(teamMembers.status, "active"),
      ),
    )
    .limit(1);
  if (profile?.permissionsJson)
    return parsePermissions(profile.permissionsJson);
  const fallback: Record<Role, readonly PermissionKey[]> = {
    owner: allPermissions,
    admin: roleTemplates.organization_administrator,
    manager: roleTemplates.general_manager,
    employee: roleTemplates.employee,
    read_only: roleTemplates.read_only_reviewer,
    integration: ["data.import", "integrations.view"],
  };
  return [...fallback[context.role]];
}

export async function requirePermission(
  context: AccessContext,
  permission: PermissionKey,
): Promise<void> {
  if (!(await effectivePermissions(context)).includes(permission)) {
    throw new ApiError(
      403,
      "INSUFFICIENT_PERMISSION",
      "You do not have permission to perform this action.",
    );
  }
}

export function permissionCatalogDto() {
  return permissionGroups.map((group) => ({
    group: group.group,
    permissions: group.permissions.map(([key, label, sensitivity]) => ({
      key,
      label,
      sensitivity,
    })),
  }));
}
