"use client";

import Image from "next/image";
import { FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import { apiFetch } from "./supabase-browser";
import { humanizeIdentifier } from "../domain/display-labels";

type Permission = {
  key: string;
  label: string;
  sensitivity: "standard" | "financial" | "sensitive" | "restricted";
};
type PermissionGroup = { group: string; permissions: Permission[] };
type Role = {
  id: string;
  name: string;
  description: string;
  color: string;
  systemKey: string | null;
  permissions: string[];
  locationScopeJson: string;
};
type Member = {
  id: string;
  userId: string | null;
  roleId: string | null;
  firstName: string;
  lastName: string;
  preferredName: string;
  email: string;
  mobile: string;
  employeeCode: string;
  jobTitle: string;
  department: string;
  employmentType: string;
  status: string;
  remoteLogin: boolean;
  requireMfa: boolean;
  pinEnabled: boolean;
  primaryLocationId: string | null;
  permittedLocations: string[];
  lastLoginAt: string | null;
};
type Location = {
  id: string;
  name: string;
  status: string;
  countryCode: string;
  addressLine1: string;
  locality: string;
  administrativeArea: string;
  postalCode: string;
  timezone: string;
  currency: string;
  validationStatus: string;
};
type Governance = {
  account: {
    displayName: string;
    email: string;
    emailVerified: boolean;
    authenticationProvider: string;
  };
  organization: {
    businessName: string;
    legalName: string;
    businessEmail: string;
    phone: string;
    website: string;
    industry: string;
    country: string;
    province: string;
    city: string;
    address: string;
    postalCode: string;
    timezone: string;
    currency: string;
    fiscalYearStart: string;
    displayName: string;
    organizationType: string;
    businessStructure: string;
    locale: string;
    language: string;
    brandColor: string;
    logoAvailable: boolean;
    logoVersion: number;
  };
  preferences: { emailNotifications: boolean; rememberedProfile: boolean; hiddenNavigationJson?: string; preferredLocationId?: string | null };
  locations: Location[];
  roles: Role[];
  members: Member[];
  permissionCatalog: PermissionGroup[];
  security: {
    password: string;
    mfa: string;
    passkeys: string;
    sessions: string;
    invitationDelivery: string;
  };
  billingCoverage: {
    payer: "organization_owner";
    employeeCheckoutRequired: false;
    remoteSeatsEnforced: true;
  };
};

type Props = {
  showNotice: (message: string) => void;
  organizationName: string;
  accountName: string;
  onBrandChange?: (name: string, logoVersion: number | null) => void;
  navigationSettings?: ReactNode;
};

function message(data: unknown, fallback: string) {
  if (data && typeof data === "object" && "error" in data) {
    const error = (data as { error?: { message?: string } }).error;
    if (error?.message) return error.message;
  }
  return fallback;
}

async function governanceAction(body: Record<string, unknown>) {
  const response = await apiFetch("/api/v1/governance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(message(data, "The change could not be saved."));
  return data.governance as Governance;
}

function useGovernance() {
  const [data, setData] = useState<Governance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiFetch("/api/v1/governance", {
        headers: { Accept: "application/json" },
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(message(body, "Unable to load team and settings."));
      setData(body.governance as Governance);
      setError("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to load team and settings.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  return { data, setData, loading, error, load };
}

function Loading({ error, retry }: { error: string; retry: () => void }) {
  return (
    <div className="content governance-loading">
      {error ? (
        <>
          <b>Team and settings could not be loaded.</b>
          <span>{error}</span>
          <button onClick={retry}>Try again</button>
        </>
      ) : (
        <>
          <i />
          <b>Loading organization controls…</b>
        </>
      )}
    </div>
  );
}

export function TeamWorkspace({ showNotice, permissions }: Props & { permissions: string[] }) {
  const { data, setData, loading, error, load } = useGovernance();
  const [tab, setTab] = useState<"people" | "roles" | "access">("people");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [creating, setCreating] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  if (loading || !data)
    return <Loading error={error} retry={() => void load()} />;
  const canCreate = permissions.includes("team.create");
  const canEdit = permissions.includes("team.edit");
  const canViewContacts = permissions.includes("team.contacts");
  const canManageRoles = permissions.includes("team.roles");
  const visible = data.members.filter((member) => {
    const match =
      `${member.firstName} ${member.lastName} ${member.email} ${member.jobTitle} ${member.department}`
        .toLowerCase()
        .includes(query.toLowerCase());
    return match && (status === "all" || member.status === status);
  });
  const roleById = new Map(data.roles.map((role) => [role.id, role]));

  const updateMember = async (member: Member, nextStatus: string) => {
    try {
      setData(
        await governanceAction({
          action: "update_employee",
          memberId: member.id,
          status: nextStatus,
        }),
      );
      showNotice(
        `Employee profile ${nextStatus === "active" ? "restored" : nextStatus}`,
      );
    } catch (caught) {
      showNotice(
        caught instanceof Error ? caught.message : "Unable to update employee.",
      );
    }
  };

  return (
    <div className="content governance-page team-governance">
      <section className="page-intro governance-intro">
        <div>
          <p>TEAM & ACCESS</p>
          <h2>Give each person exactly what their work requires.</h2>
          <span>
            Employee profiles, workplace PINs, role scopes and financial privacy
            are kept separate from Vanteloq’s product identity.
          </span>
        </div>
        {canCreate && <button className="primary" onClick={() => setCreating(true)}>
          + Create employee
        </button>}
      </section>
      <section className="owner-plan-coverage" role="note">
        <span>Covered by the owner plan</span>
        <div>
          <b>Employee access is billed to the organization owner.</b>
          <small>Employees never complete a separate checkout. Remote logins use the available seats in the owner&apos;s current subscription.</small>
        </div>
      </section>
      <div className="governance-tabs">
        <button
          className={tab === "people" ? "active" : ""}
          onClick={() => setTab("people")}
        >
          Employees <b>{data.members.length}</b>
        </button>
        {canManageRoles && <button
          className={tab === "roles" ? "active" : ""}
          onClick={() => setTab("roles")}
        >
          Roles & permissions
        </button>}
        <button
          className={tab === "access" ? "active" : ""}
          onClick={() => setTab("access")}
        >
          Access safeguards
        </button>
      </div>
      {tab === "people" && (
        <>
          <div className="directory-tools">
            <label>
              <span>⌕</span>
              <input
                aria-label="Search employees"
                placeholder="Search name, role, department or email"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <select
              aria-label="Filter employee status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="draft">Draft</option>
              <option value="suspended">Suspended</option>
              <option value="archived">Archived</option>
            </select>
            <button
              disabled
              title="CSV employee import is gated until invitation and duplicate-resolution services are connected"
            >
              CSV import · gated
            </button>
          </div>
          <section className="employee-table card">
            <div className="employee-table-head">
              <span>Person</span>
              <span>Role & scope</span>
              <span>Security</span>
              <span>Status</span>
              <span>Actions</span>
            </div>
            {visible.map((member) => (
              <div className="employee-row" key={member.id}>
                <div className="employee-person">
                  <i>
                    {(member.preferredName || member.firstName).slice(0, 1)}
                    {member.lastName.slice(0, 1)}
                  </i>
                  <span>
                    <b>
                      {member.preferredName || member.firstName}{" "}
                      {member.lastName}
                    </b>
                    <small>
                      {member.jobTitle || "Job title not set"} ·{" "}
                      {member.department || "No department"}
                    </small>
                    {canViewContacts && member.email && <em>{member.email}</em>}
                  </span>
                </div>
                <div>
                  <b>{roleById.get(member.roleId || "")?.name || "No role"}</b>
                  <small>
                    {member.permittedLocations.length || "All assigned"}{" "}
                    location scope
                  </small>
                </div>
                <div className="security-flags">
                  <span className={member.requireMfa ? "on" : ""}>
                    MFA {member.requireMfa ? "required" : "standard"}
                  </span>
                  <span className={member.pinEnabled ? "on" : ""}>
                    PIN {member.pinEnabled ? "enabled" : "off"}
                  </span>
                </div>
                <div>
                  <span className={`member-status ${member.status}`}>
                    {humanizeIdentifier(member.status)}
                  </span>
                  {member.status === "draft" && (
                    <small>Email delivery not connected</small>
                  )}
                </div>
                <div className="row-actions">
                  {canEdit && member.status === "active" && !member.userId && (
                    <button
                      onClick={() => void updateMember(member, "suspended")}
                    >
                      Suspend
                    </button>
                  )}
                  {canEdit && member.status === "suspended" && (
                    <button onClick={() => void updateMember(member, "active")}>
                      Restore
                    </button>
                  )}
                  {canEdit && !member.userId && member.status !== "archived" && (
                    <button
                      onClick={() => void updateMember(member, "archived")}
                    >
                      Archive
                    </button>
                  )}
                  {member.userId && <span>Protected owner</span>}
                </div>
              </div>
            ))}
            {!visible.length && (
              <div className="governance-empty">
                <b>No employee matches this view.</b>
                <span>Adjust the search or create a new employee profile.</span>
              </div>
            )}
          </section>
        </>
      )}
      {canManageRoles && tab === "roles" && (
        <section className="roles-layout">
          <aside className="card role-list">
            <div>
              <b>Role templates</b>
              <button
                onClick={() =>
                  setEditingRole({
                    id: "",
                    name: "Custom role",
                    description: "",
                    color: "#53657a",
                    systemKey: null,
                    permissions: [],
                    locationScopeJson: "[]",
                  })
                }
              >
                + Custom
              </button>
            </div>
            {data.roles.map((role) => (
              <button
                className={editingRole?.id === role.id ? "selected" : ""}
                key={role.id}
                onClick={() => setEditingRole(role)}
              >
                <i style={{ background: role.color }} />
                <span>
                  <b>{role.name}</b>
                  <small>
                    {role.permissions.length} permissions ·{" "}
                    {
                      data.members.filter((member) => member.roleId === role.id)
                        .length
                    }{" "}
                    people
                  </small>
                </span>
                {role.systemKey === "account_owner" && <em>Protected</em>}
              </button>
            ))}
          </aside>
          <PermissionEditor
            key={(editingRole || data.roles[0])?.id ?? "empty-role"}
            role={editingRole || data.roles[0]}
            catalog={data.permissionCatalog}
            affected={
              data.members.filter(
                (member) =>
                  member.roleId === (editingRole || data.roles[0])?.id,
              ).length
            }
            save={async (role) => {
              try {
                const next = await governanceAction({
                  action: "save_role",
                  roleId: role.id,
                  name: role.name,
                  description: role.description,
                  color: role.color,
                  permissions: role.permissions,
                  locationScope: [],
                });
                setData(next);
                setEditingRole(null);
                showNotice("Role permissions saved and audited");
              } catch (caught) {
                showNotice(
                  caught instanceof Error
                    ? caught.message
                    : "Unable to save role.",
                );
              }
            }}
          />
        </section>
      )}
      {tab === "access" && <AccessSafeguards security={data.security} />}
      {canCreate && creating && (
        <EmployeeWizard
          data={data}
          canAssignRoles={canManageRoles}
          close={() => setCreating(false)}
          created={(next) => {
            setData(next);
            setCreating(false);
            showNotice("Employee profile created as Draft");
          }}
        />
      )}
    </div>
  );
}

function PermissionEditor({
  role,
  catalog,
  affected,
  save,
}: {
  role?: Role;
  catalog: PermissionGroup[];
  affected: number;
  save: (role: Role) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Role | undefined>(role);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  if (!draft)
    return (
      <article className="card permission-editor governance-empty">
        <b>Select a role.</b>
      </article>
    );
  const protectedOwner = draft.systemKey === "account_owner";
  const toggle = (key: string) =>
    setDraft((current) =>
      current
        ? {
            ...current,
            permissions: current.permissions.includes(key)
              ? current.permissions.filter((item) => item !== key)
              : [...current.permissions, key],
          }
        : current,
    );
  const filtered = catalog
    .map((group) => ({
      ...group,
      permissions: group.permissions.filter((permission) =>
        `${group.group} ${permission.label}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    }))
    .filter((group) => group.permissions.length);
  return (
    <article className="card permission-editor">
      <header>
        <div>
          <p>ROLE ACCESS</p>
          <input
            value={draft.name}
            disabled={protectedOwner}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
          />
          <textarea
            value={draft.description}
            disabled={protectedOwner}
            onChange={(event) =>
              setDraft({ ...draft, description: event.target.value })
            }
          />
        </div>
        <label>
          Identifier
          <input
            type="color"
            value={draft.color}
            disabled={protectedOwner}
            onChange={(event) =>
              setDraft({ ...draft, color: event.target.value })
            }
          />
        </label>
      </header>
      <div className="permission-summary">
        <span>
          <b>{draft.permissions.length}</b> allowed
        </span>
        <span>
          <b>
            {catalog.flatMap((group) => group.permissions).length -
              draft.permissions.length}
          </b>{" "}
          denied
        </span>
        <span>
          <b>{affected}</b> affected people
        </span>
      </div>
      {protectedOwner ? (
        <div className="owner-protection">
          The Account Owner role is protected. Ownership must be transferred
          through a separately verified process.
        </div>
      ) : (
        <>
          <label className="permission-search">
            ⌕
            <input
              placeholder="Search permissions"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="permission-groups">
            {filtered.map((group) => (
              <details open key={group.group}>
                <summary>
                  {group.group}
                  <span>
                    {
                      group.permissions.filter((permission) =>
                        draft.permissions.includes(permission.key),
                      ).length
                    }
                    /{group.permissions.length}
                  </span>
                </summary>
                {group.permissions.map((permission) => (
                  <label key={permission.key}>
                    <input
                      type="checkbox"
                      checked={draft.permissions.includes(permission.key)}
                      onChange={() => toggle(permission.key)}
                    />
                    <span>
                      <b>{permission.label}</b>
                      <small>{permission.key}</small>
                    </span>
                    <em className={permission.sensitivity}>
                      {permission.sensitivity}
                    </em>
                  </label>
                ))}
              </details>
            ))}
          </div>
          <div className="permission-save">
            <span>
              Least privilege is the default. New sensitive permissions stay
              denied until reviewed.
            </span>
            <button
              className="primary"
              disabled={saving || !draft.name.trim()}
              onClick={async () => {
                setSaving(true);
                await save(draft);
                setSaving(false);
              }}
            >
              {saving ? "Saving…" : "Review & save role"}
            </button>
          </div>
        </>
      )}
    </article>
  );
}

function EmployeeWizard({
  data,
  canAssignRoles,
  close,
  created,
}: {
  data: Governance;
  canAssignRoles: boolean;
  close: () => void;
  created: (data: Governance) => void;
}) {
  const availableRoles = data.roles.filter((role) =>
    role.systemKey !== "account_owner" && (canAssignRoles || role.systemKey === "employee"),
  );
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    preferredName: "",
    email: "",
    mobile: "",
    employeeCode: "",
    jobTitle: "",
    department: "",
    employmentType: "employee",
    startDate: "",
    roleId:
      availableRoles.find((role) => role.systemKey === "employee")?.id ||
      availableRoles[0]?.id ||
      "",
    primaryLocationId: data.locations[0]?.id || "",
    remoteLogin: false,
    requireMfa: true,
    temporaryPin: "",
    notes: "",
  });
  const set = (key: keyof typeof form, value: string | boolean) =>
    setForm((current) => ({ ...current, [key]: value }));
  const next = () => {
    if (
      step === 1 &&
      (!form.firstName || !form.lastName || !form.email || !form.employeeCode)
    )
      return setError(
        "Complete the employee’s name, email and employee identifier.",
      );
    if (step === 2 && !form.roleId) return setError("Select a role.");
    setError("");
    setStep((current) => Math.min(4, current + 1));
  };
  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      created(
        await governanceAction({
          action: "create_employee",
          ...form,
          permittedLocations: form.primaryLocationId
            ? [form.primaryLocationId]
            : [],
        }),
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to create employee.",
      );
      setSaving(false);
    }
  };
  const role = availableRoles.find((item) => item.id === form.roleId);
  return (
    <div className="modal-backdrop">
      <section className="employee-wizard">
        <header>
          <div>
            <p>EMPLOYEE SETUP · STEP {step} OF 4</p>
            <h2>
              {
                [
                  "Identity & employment",
                  "Role & location",
                  "Secure access",
                  "Review & create",
                ][step - 1]
              }
            </h2>
          </div>
          <button onClick={close}>×</button>
        </header>
        <div className="wizard-progress">
          <i style={{ width: `${step * 25}%` }} />
        </div>
        {step === 1 && (
          <div className="wizard-grid">
            <label>
              First name
              <input
                value={form.firstName}
                onChange={(event) => set("firstName", event.target.value)}
              />
            </label>
            <label>
              Last name
              <input
                value={form.lastName}
                onChange={(event) => set("lastName", event.target.value)}
              />
            </label>
            <label>
              Preferred name
              <input
                value={form.preferredName}
                onChange={(event) => set("preferredName", event.target.value)}
              />
            </label>
            <label>
              Employee email
              <input
                type="email"
                value={form.email}
                onChange={(event) => set("email", event.target.value)}
              />
            </label>
            <label>
              Mobile number
              <input
                value={form.mobile}
                onChange={(event) => set("mobile", event.target.value)}
              />
            </label>
            <label>
              Employee identifier
              <input
                value={form.employeeCode}
                onChange={(event) => set("employeeCode", event.target.value)}
              />
            </label>
            <label>
              Job title
              <input
                value={form.jobTitle}
                onChange={(event) => set("jobTitle", event.target.value)}
              />
            </label>
            <label>
              Department
              <input
                value={form.department}
                onChange={(event) => set("department", event.target.value)}
              />
            </label>
            <label>
              Employment type
              <select
                value={form.employmentType}
                onChange={(event) => set("employmentType", event.target.value)}
              >
                <option value="employee">Employee</option>
                <option value="contractor">Contractor</option>
                <option value="seasonal">Seasonal</option>
                <option value="advisor">External advisor</option>
              </select>
            </label>
            <label>
              Start date
              <input
                type="date"
                value={form.startDate}
                onChange={(event) => set("startDate", event.target.value)}
              />
            </label>
          </div>
        )}
        {step === 2 && (
          <div className="wizard-grid">
            <label className="full">
              Role
              <select
                value={form.roleId}
                onChange={(event) => set("roleId", event.target.value)}
              >
                {availableRoles.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="full">
              Primary location
              <select
                value={form.primaryLocationId}
                onChange={(event) =>
                  set("primaryLocationId", event.target.value)
                }
              >
                {data.locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="effective-access full">
              <b>Effective access summary</b>
              <span>
                {role?.permissions.length || 0} allowed permissions ·{" "}
                {role?.permissions.filter(
                  (permission) =>
                    permission.includes("finance") ||
                    permission.includes("payroll") ||
                    permission.includes("bank"),
                ).length || 0}{" "}
                financially sensitive permissions
              </span>
              <p>
                {role?.permissions.includes("finance.bank_balances")
                  ? "This role can view banking information."
                  : "Bank balances, bank transactions, payroll and owner financial records remain hidden."}
              </p>
            </div>
          </div>
        )}
        {step === 3 && (
          <div className="wizard-grid">
            <label className="toggle full">
              <input
                type="checkbox"
                checked={form.remoteLogin}
                onChange={(event) => set("remoteLogin", event.target.checked)}
              />
              <span>
                <b>Allow remote Vanteloq login</b>
                <small>
                  Profile creation works now; invitation delivery remains gated
                  until an email provider is connected.
                </small>
              </span>
            </label>
            <label className="toggle full">
              <input
                type="checkbox"
                checked={form.requireMfa}
                onChange={(event) => set("requireMfa", event.target.checked)}
              />
              <span>
                <b>Require MFA when remote access is activated</b>
                <small>
                  Authentication is enforced by the connected identity provider.
                </small>
              </span>
            </label>
            <label className="full">
              Temporary workplace PIN (optional)
              <input
                inputMode="numeric"
                maxLength={8}
                value={form.temporaryPin}
                onChange={(event) =>
                  set("temporaryPin", event.target.value.replace(/\D/g, ""))
                }
              />
              <small>
                6 to 8 digits. Stored as a salted PBKDF2 hash, expires in 24 hours,
                and must be changed on first use. PIN never grants banking,
                payroll, export or permission-management access.
              </small>
            </label>
          </div>
        )}
        {step === 4 && (
          <div className="employee-review">
            <article>
              <small>PERSON</small>
              <b>
                {form.preferredName || form.firstName} {form.lastName}
              </b>
              <span>
                {form.email}
                <br />
                {form.jobTitle || "No title"} ·{" "}
                {form.department || "No department"}
              </span>
            </article>
            <article>
              <small>ACCESS</small>
              <b>{role?.name}</b>
              <span>
                {
                  data.locations.find(
                    (location) => location.id === form.primaryLocationId,
                  )?.name
                }
                <br />
                {form.remoteLogin
                  ? "Remote login requested"
                  : "Workplace profile only"}
              </span>
            </article>
            <article>
              <small>SECURITY</small>
              <b>{form.temporaryPin ? "Temporary PIN set" : "No PIN"}</b>
              <span>
                {form.requireMfa ? "MFA required" : "Standard provider policy"}
                <br />
                Profile begins as Draft
              </span>
            </article>
            <p>
              A profile is created immediately. No invitation is falsely marked
              sent while email delivery is not configured.
            </p>
            <p className="employee-billing-note">
              Covered by the owner plan. Employees never complete a separate checkout.
            </p>
          </div>
        )}
        {error && <p className="form-error">{error}</p>}
        <footer>
          <button
            onClick={() =>
              step === 1 ? close() : setStep((current) => current - 1)
            }
          >
            {step === 1 ? "Cancel" : "← Back"}
          </button>
          {step < 4 ? (
            <button className="primary" onClick={next}>
              Continue →
            </button>
          ) : (
            <button
              className="primary"
              disabled={saving}
              onClick={() => void submit()}
            >
              {saving ? "Creating…" : "Confirm & create employee"}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}

function AccessSafeguards({ security }: { security: Governance["security"] }) {
  const items = [
    [
      "Remote authentication",
      "Passwords, passkeys and MFA are managed by the verified identity provider. Vanteloq does not duplicate them.",
      "Protected",
    ],
    [
      "Workplace PINs",
      "Temporary PINs are one-way hashed, expire in 24 hours and are limited to trusted workplace switching. Sensitive actions require full authentication.",
      "Restricted",
    ],
    [
      "Financial privacy",
      "Banking, cash, costs, payroll, profit and exports use distinct server permissions. Derived figures cannot bypass a denied source permission.",
      "Server enforced",
    ],
    [
      "Owner protection",
      "The final active owner cannot be suspended, archived or silently downgraded. Ownership transfer requires a separate verified workflow.",
      "Protected",
    ],
  ];
  return (
    <div className="safeguards-grid">
      {items.map(([title, copy, state]) => (
        <article className="card" key={title}>
          <span>{state}</span>
          <h3>{title}</h3>
          <p>{copy}</p>
        </article>
      ))}
      <article className="card provider-boundary">
        <h3>Current provider boundary</h3>
        <p>{security.invitationDelivery}</p>
        <p>{security.sessions}</p>
      </article>
    </div>
  );
}

export function SettingsWorkspace({ showNotice, onBrandChange, navigationSettings }: Props) {
  const { data, setData, loading, error, load } = useGovernance();
  const [section, setSection] = useState("profile");
  const [saving, setSaving] = useState(false);
  if (loading || !data)
    return <Loading error={error} retry={() => void load()} />;
  const sections = [
    ["profile", "My profile"],
    ["account", "Account & login"],
    ["security", "Security"],
    ["notifications", "Notifications"],
    ["organization", "Organization"],
    ["branding", "Branding"],
    ["navigation", "Sidebar & workspaces"],
    ["locations", "Locations"],
    ["integrations", "Integrations"],
    ["privacy", "Data & privacy"],
    ["billing", "Billing & subscription"],
  ];
  return (
    <div className="content governance-page settings-governance">
      <section className="page-intro">
        <div>
          <p>SETTINGS</p>
          <h2>Control the account, organization and security boundary.</h2>
          <span>
            Signup information stays editable here, while accounting history and
            audit events remain immutable.
          </span>
        </div>
      </section>
      <div className="settings-layout">
        <aside className="settings-nav">
          <label>
            ⌕
            <input aria-label="Search settings" placeholder="Search settings" />
          </label>
          {sections.map(([id, label]) => (
            <button
              className={section === id ? "active" : ""}
              key={id}
              onClick={() => setSection(id)}
            >
              {label}
              <span>›</span>
            </button>
          ))}
        </aside>
        <section className="settings-content card">
          {section === "profile" && (
            <ProfileSettings
              data={data}
              saving={saving}
              save={async (body) => {
                setSaving(true);
                try {
                  const next = await governanceAction({
                    action: "update_profile",
                    ...body,
                  });
                  setData(next);
                  showNotice("Profile and preferences updated");
                } catch (caught) {
                  showNotice(
                    caught instanceof Error
                      ? caught.message
                      : "Unable to save profile.",
                  );
                } finally {
                  setSaving(false);
                }
              }}
            />
          )}
          {section === "organization" && (
            <OrganizationSettings
              data={data}
              saving={saving}
              save={async (body) => {
                setSaving(true);
                try {
                  const next = await governanceAction({
                    action: "update_organization",
                    ...body,
                  });
                  setData(next);
                  onBrandChange?.(
                    next.organization.displayName,
                    next.organization.logoVersion,
                  );
                  showNotice("Organization settings updated and audited");
                } catch (caught) {
                  showNotice(
                    caught instanceof Error
                      ? caught.message
                      : "Unable to save organization.",
                  );
                } finally {
                  setSaving(false);
                }
              }}
            />
          )}
          {section === "branding" && (
            <BrandingSettings
              data={data}
              updated={async () => {
                await load();
                onBrandChange?.(data.organization.displayName, Date.now());
                showNotice("Organization logo updated across the workspace");
              }}
            />
          )}
          {section === "navigation" && navigationSettings}
          {section === "locations" && (
            <LocationsSettings
              data={data}
              created={(next) => {
                setData(next);
                showNotice("Location created with entered-address status");
              }}
            />
          )}
          {section === "notifications" && (
            <ProfileSettings
              data={data}
              saving={saving}
              notificationsOnly
              save={async (body) => {
                setSaving(true);
                try {
                  setData(
                    await governanceAction({
                      action: "update_profile",
                      ...body,
                    }),
                  );
                  showNotice("Notification preferences updated");
                } catch (caught) {
                  showNotice(
                    caught instanceof Error
                      ? caught.message
                      : "Unable to save preferences.",
                  );
                } finally {
                  setSaving(false);
                }
              }}
            />
          )}
          {section === "account" && (
            <ProviderSettings
              title="Account & login"
              items={[
                ["Verified email", data.account.email, "Verified"],
                ["Password", data.security.password, "Provider managed"],
                ["Passkeys", data.security.passkeys, "Provider managed"],
                [
                  "Account deletion",
                  "Requires verified ownership, retention review and export confirmation.",
                  "Gated workflow",
                ],
              ]}
            />
          )}
          {section === "security" && (
            <ProviderSettings
              title="Security"
              items={[
                [
                  "Multi-factor authentication",
                  data.security.mfa,
                  "Provider managed",
                ],
                ["Active session", data.security.sessions, "Active"],
                [
                  "Workplace PIN policy",
                  "6 to 8 digits, hashed, rate-limited, temporary on reset and never sufficient for sensitive actions.",
                  "Enforced",
                ],
                [
                  "Recent security events",
                  "Recorded in the organization audit trail.",
                  "Available",
                ],
              ]}
            />
          )}
          {section === "integrations" && (
            <ProviderSettings
              title="Integration controls"
              items={[
                [
                  "POS and commerce",
                  "Provider cards remain disabled until authorization, verified updates, duplicate protection, reconciliation, and recovery checks pass.",
                  "Gated",
                ],
                [
                  "Banking",
                  "Provider-hosted consent only. Vanteloq never requests online-banking passwords.",
                  "Gated",
                ],
                [
                  "Address validation",
                  "Manual global address entry works; deliverability claims require a configured regional provider.",
                  "Gated",
                ],
                ["Invitation email", data.security.invitationDelivery, "Gated"],
              ]}
            />
          )}
          {section === "privacy" && (
            <ProviderSettings
              title="Data & privacy"
              items={[
                [
                  "Organization export",
                  "Financial and personal exports require explicit export permission and expiring delivery links.",
                  "Protected",
                ],
                [
                  "Retention",
                  "Document and integration retention policies are organization-scoped.",
                  "Configured per source",
                ],
                [
                  "Audit history",
                  "Sensitive changes create append-only audit events.",
                  "Active",
                ],
                [
                  "Memory separation",
                  "Personal preferences, organization records and assistant-visible data remain separately permission-scoped.",
                  "Active",
                ],
              ]}
            />
          )}
          {section === "billing" && (
            <BillingSettings />
          )}
        </section>
      </div>
    </div>
  );
}

function ProfileSettings({
  data,
  save,
  saving,
  notificationsOnly = false,
}: {
  data: Governance;
  save: (body: Record<string, unknown>) => Promise<void>;
  saving: boolean;
  notificationsOnly?: boolean;
}) {
  const owner = data.members.find((member) => member.userId) || data.members[0];
  const [displayName, setDisplayName] = useState(data.account.displayName);
  const [jobTitle, setJobTitle] = useState(owner?.jobTitle || "");
  const [emailNotifications, setEmailNotifications] = useState(
    Boolean(data.preferences.emailNotifications),
  );
  const [rememberedProfile, setRememberedProfile] = useState(
    data.preferences.rememberedProfile !== false,
  );
  return (
    <form
      className="settings-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save({
          displayName,
          jobTitle,
          emailNotifications,
          rememberedProfile,
        });
      }}
    >
      <header>
        <p>
          {notificationsOnly ? "NOTIFICATION PREFERENCES" : "PERSONAL PROFILE"}
        </p>
        <h2>
          {notificationsOnly
            ? "Choose what reaches you."
            : "Your Vanteloq identity"}
        </h2>
        <span>
          {notificationsOnly
            ? "Delivery begins only when its verified channel is configured."
            : "Your verified email is supplied by secure sign-in and cannot be overwritten by a profile form."}
        </span>
      </header>
      {!notificationsOnly && (
        <div className="settings-grid">
          <label>
            Display name
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          <label>
            Job title
            <input
              value={jobTitle}
              onChange={(event) => setJobTitle(event.target.value)}
            />
          </label>
          <label className="full">
            Verified email
            <input value={data.account.email} readOnly />
            <small>
              Email changes are handled by the authenticated identity provider.
            </small>
          </label>
        </div>
      )}
      <div className="setting-toggles">
        <label>
          <input
            type="checkbox"
            checked={emailNotifications}
            onChange={(event) => setEmailNotifications(event.target.checked)}
          />
          <span>
            <b>Email notifications</b>
            <small>
              Security, financial exceptions, integration failures and assigned
              work once delivery is configured.
            </small>
          </span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={rememberedProfile}
            onChange={(event) => setRememberedProfile(event.target.checked)}
          />
          <span>
            <b>Remember personal workspace preferences</b>
            <small>
              Keep this account’s preferred views and settings separate from
              organization-wide memory.
            </small>
          </span>
        </label>
      </div>
      <footer>
        <button className="primary" disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </button>
      </footer>
    </form>
  );
}

function OrganizationSettings({
  data,
  save,
  saving,
}: {
  data: Governance;
  save: (body: Record<string, unknown>) => Promise<void>;
  saving: boolean;
}) {
  const [form, setForm] = useState({
    displayName: data.organization.displayName,
    legalName: data.organization.legalName,
    businessEmail: data.organization.businessEmail,
    phone: data.organization.phone,
    organizationType: data.organization.organizationType,
    businessStructure: data.organization.businessStructure,
    brandColor: data.organization.brandColor,
  });
  const set = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  return (
    <form
      className="settings-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save(form);
      }}
    >
      <header>
        <p>ORGANIZATION</p>
        <h2>Business identity and reporting context</h2>
        <span>
          Changing legal, tax, country, currency or fiscal settings never
          rewrites posted history.
        </span>
      </header>
      <div className="settings-grid">
        <label>
          Operating name
          <input
            value={form.displayName}
            onChange={(event) => set("displayName", event.target.value)}
          />
        </label>
        <label>
          Legal business name
          <input
            value={form.legalName}
            onChange={(event) => set("legalName", event.target.value)}
          />
        </label>
        <label>
          Business email
          <input
            type="email"
            value={form.businessEmail}
            onChange={(event) => set("businessEmail", event.target.value)}
          />
        </label>
        <label>
          Business phone
          <input
            value={form.phone}
            onChange={(event) => set("phone", event.target.value)}
          />
        </label>
        <label>
          Organization type
          <input
            value={form.organizationType}
            onChange={(event) => set("organizationType", event.target.value)}
          />
        </label>
        <label>
          Business structure
          <input
            value={form.businessStructure}
            onChange={(event) => set("businessStructure", event.target.value)}
          />
        </label>
        <label>
          Accessible brand colour
          <input
            type="color"
            value={form.brandColor}
            onChange={(event) => set("brandColor", event.target.value)}
          />
        </label>
      </div>
      <div className="integrity-warning">
        <b>Historical integrity</b>
        <span>
          Posted journals, completed audit events, closed periods and archived
          employee attribution remain unchanged.
        </span>
      </div>
      <footer>
        <button className="primary" disabled={saving}>
          {saving ? "Saving…" : "Save organization"}
        </button>
      </footer>
    </form>
  );
}

function BrandingSettings({
  data,
  updated,
}: {
  data: Governance;
  updated: () => Promise<void>;
}) {
  const [preview, setPreview] = useState(
    data.organization.logoAvailable
      ? `/api/v1/organization-logo?v=${data.organization.logoVersion}`
      : "",
  );
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const initials = data.organization.displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const upload = async () => {
    if (!file) return;
    setSaving(true);
    setError("");
    const form = new FormData();
    form.set("logo", file);
    form.set("altText", `${data.organization.displayName} logo`);
    const response = await apiFetch("/api/v1/organization-logo", {
      method: "POST",
      body: form,
    });
    const body = await response.json();
    if (!response.ok) {
      setError(message(body, "Logo upload failed."));
      setSaving(false);
      return;
    }
    setPreview(body.logoUrl);
    setFile(null);
    await updated();
    setSaving(false);
  };
  const remove = async () => {
    const response = await apiFetch("/api/v1/organization-logo", {
      method: "DELETE",
    });
    if (response.ok) {
      setPreview("");
      await updated();
    }
  };
  return (
    <section className="settings-form branding-settings">
      <header>
        <p>ORGANIZATION BRANDING</p>
        <h2>Keep customer identity separate from Vanteloq.</h2>
        <span>
          Your logo replaces the organization initials in the workspace and can
          be reused on reports, purchase orders and accounting documents.
        </span>
      </header>
      <div className="branding-preview">
        <div className="logo-preview">
          {preview ? (
            <Image src={preview} alt={`${data.organization.displayName} logo`} width={96} height={96} unoptimized />
          ) : (
            <b>{initials}</b>
          )}
        </div>
        <div>
          <h3>{data.organization.displayName}</h3>
          <p>Active organization · Primary location</p>
          <span>Vanteloq product branding remains visible separately.</span>
        </div>
      </div>
      <label className="logo-drop">
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => {
            const next = event.target.files?.[0] || null;
            setFile(next);
            if (next) setPreview(URL.createObjectURL(next));
          }}
        />
        <b>Choose PNG, JPEG or WEBP</b>
        <span>
          Maximum 2 MB. Files are MIME-verified and stored inside the
          organization boundary. SVG stays disabled until sanitization is
          connected.
        </span>
      </label>
      {error && <p className="form-error">{error}</p>}
      <footer>
        <button
          disabled={!preview || (!data.organization.logoAvailable && !file)}
          onClick={() => void remove()}
        >
          Remove logo
        </button>
        <button
          className="primary"
          disabled={!file || saving}
          onClick={() => void upload()}
        >
          {saving ? "Uploading…" : "Upload logo"}
        </button>
      </footer>
    </section>
  );
}

function LocationsSettings({
  data,
  created,
}: {
  data: Governance;
  created: (data: Governance) => void;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <section className="settings-form">
      <header>
        <p>LOCATIONS</p>
        <h2>Global, organization-scoped addresses</h2>
        <span>
          Addresses retain entered, suggested or validated status. A
          postal-pattern match alone never becomes a deliverability claim.
        </span>
      </header>
      <div className="location-list">
        {data.locations.map((location) => (
          <article key={location.id}>
            <div>
              <b>{location.name}</b>
              <span>
                {location.addressLine1}, {location.locality},{" "}
                {location.administrativeArea} {location.postalCode}
              </span>
            </div>
            <small>
              {location.countryCode} · {location.timezone} · {location.currency}
            </small>
            <em className={location.validationStatus}>
              {location.validationStatus}
            </em>
          </article>
        ))}
      </div>
      <footer>
        <button className="primary" onClick={() => setAdding(true)}>
          + Add location
        </button>
      </footer>
      {adding && (
        <LocationModal
          close={() => setAdding(false)}
          created={(next) => {
            setAdding(false);
            created(next);
          }}
        />
      )}
    </section>
  );
}

function LocationModal({
  close,
  created,
}: {
  close: () => void;
  created: (data: Governance) => void;
}) {
  const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      created(
        await governanceAction({
          action: "create_location",
          name: form.get("name"),
          countryCode: form.get("countryCode"),
          addressLine1: form.get("addressLine1"),
          addressLine2: form.get("addressLine2"),
          addressLine3: form.get("addressLine3"),
          locality: form.get("locality"),
          district: form.get("district"),
          administrativeArea: form.get("administrativeArea"),
          postalCode: form.get("postalCode"),
          timezone: form.get("timezone"),
          currency: form.get("currency"),
          locale: form.get("locale"),
          taxJurisdiction: form.get("taxJurisdiction"),
        }),
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to create location.",
      );
    }
  };
  return (
    <div className="modal-backdrop">
      <form className="employee-wizard" onSubmit={submit}>
        <header>
          <div>
            <p>NEW LOCATION</p>
            <h2>Add a global business address</h2>
          </div>
          <button type="button" onClick={close}>
            ×
          </button>
        </header>
        <div className="wizard-grid">
          <label>
            Name
            <input name="name" required />
          </label>
          <label>
            ISO country code
            <input name="countryCode" maxLength={2} placeholder="CA" required />
          </label>
          <label className="full">
            Address line 1<input name="addressLine1" required />
          </label>
          <label>
            Address line 2<input name="addressLine2" />
          </label>
          <label>
            Address line 3<input name="addressLine3" />
          </label>
          <label>
            City / locality
            <input name="locality" required />
          </label>
          <label>
            District / county
            <input name="district" />
          </label>
          <label>
            Province / state / region
            <input name="administrativeArea" required />
          </label>
          <label>
            Postal / ZIP code
            <input name="postalCode" />
          </label>
          <label>
            Timezone
            <input name="timezone" defaultValue="America/Edmonton" required />
          </label>
          <label>
            Currency
            <input name="currency" defaultValue="CAD" maxLength={3} required />
          </label>
          <label>
            Locale
            <input name="locale" defaultValue="en-CA" required />
          </label>
          <label>
            Tax jurisdiction
            <input name="taxJurisdiction" />
          </label>
        </div>
        {error && <p className="form-error">{error}</p>}
        <footer>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary">Create location</button>
        </footer>
      </form>
    </div>
  );
}

function ProviderSettings({
  title,
  items,
}: {
  title: string;
  items: string[][];
}) {
  return (
    <section className="settings-form">
      <header>
        <p>SECURE CONTROL</p>
        <h2>{title}</h2>
        <span>
          Every status below reflects the actual connected service boundary.
        </span>
      </header>
      <div className="provider-settings">
        {items.map(([label, detail, status]) => (
          <article key={label}>
            <div>
              <b>{label}</b>
              <p>{detail}</p>
            </div>
            <span>{status}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

type BillingData = {
  configured: boolean;
  accessType: "internal" | "subscription" | "none";
  current: { plan: "starter" | "growth" | "pro" | null; status: string | null; addons: string[]; billingInterval: "month" | "year" | null; currentPeriodEndsAt: string | null; cancelAtPeriodEnd: boolean; hasCustomer: boolean };
  plans: Array<{ key: "starter" | "growth" | "pro"; name: string; description: string; mostPopular: boolean; price: number }>;
  addon: { key: "bookloq"; name: string; price: number };
  purchaseInterval: "month";
};

function BillingSettings() {
  const [data, setData] = useState<BillingData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<"starter" | "growth" | "pro">("growth");
  const [bookloq, setBookloq] = useState(false);
  useEffect(() => {
    let active = true;
    void apiFetch("/api/v1/billing", { headers: { Accept: "application/json" } }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(message(body, "Billing status could not be loaded."));
      if (active) { setData(body); if (body.current?.plan) setPlan(body.current.plan); setBookloq(body.current?.addons?.includes("bookloq") === true); }
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Billing status could not be loaded."); });
    return () => { active = false; };
  }, []);
  const open = async (path: string, body?: Record<string, unknown>) => {
    setBusy(true); setError("");
    try {
      const response = await apiFetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
      const result = await response.json();
      if (!response.ok) throw new Error(message(result, "Stripe could not open billing."));
      if (typeof result.url === "string") window.location.assign(result.url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Stripe could not open billing."); setBusy(false); }
  };
  if (!data && !error) return <section className="settings-form"><header><p>STRIPE BILLING</p><h2>Loading verified subscription status…</h2></header></section>;
  const managed = data?.current.hasCustomer === true;
  return <section className="settings-form billing-settings"><header><p>STRIPE BILLING</p><h2>Billing & subscription</h2><span>Stripe hosts payment collection, invoices, renewals and cancellation. Vanteloq stores only synchronized subscription identifiers and entitlement status. It never stores card details.</span></header>
    {error && <p className="form-error">{error}</p>}
    {data?.accessType === "internal" ? <div className="billing-internal"><b>Founder access active</b><span>This workspace has verified internal full access and does not require a Stripe subscription.</span></div> : <>
      <p className="billing-monthly-note"><b>Monthly billing</b><span>Plans renew month to month. Cancel before renewal to stop the next charge.</span></p>
      <div className="billing-plans">{data?.plans.map((item) => <button key={item.key} className={plan === item.key ? "selected" : ""} onClick={() => setPlan(item.key)} disabled={managed}><span>{item.mostPopular ? "MOST POPULAR" : "PLAN"}</span><b>{item.name}</b><strong>${(item.price / 100).toLocaleString("en-CA")}</strong><small>CAD / month</small><p>{item.description}</p></button>)}</div>
      <label className="billing-addon"><input type="checkbox" checked={bookloq} onChange={(event) => setBookloq(event.target.checked)} disabled={managed}/><span><b>Add BookLoQ</b><small>${((data?.addon.price ?? 0) / 100).toLocaleString("en-CA")} CAD / month</small></span></label>
      <div className="provider-settings"><article><div><b>Current access</b><p>{data?.current.plan ? `${data.current.plan} · ${data.current.status}` : "No synchronized paid subscription."}</p></div><span>{data?.current.cancelAtPeriodEnd ? "Cancels at renewal" : data?.current.status ?? "Not subscribed"}</span></article></div>
      <footer>{managed ? <button className="primary" disabled={busy || !data?.configured} onClick={() => void open("/api/v1/billing/portal")}>{busy ? "Opening…" : "Manage billing in Stripe"}</button> : <button className="primary" disabled={busy || !data?.configured} title={!data?.configured ? "Stripe products, prices and webhook secret must be configured first." : "Open secure Stripe Checkout"} onClick={() => void open("/api/v1/billing/checkout", { plan, interval: "month", includeBookloq: bookloq })}>{busy ? "Opening…" : data?.configured ? "Continue to secure checkout" : "Stripe setup required"}</button>}</footer>
    </>}
  </section>;
}
