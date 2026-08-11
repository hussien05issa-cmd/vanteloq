"use client";

import { useState } from "react";
import {
  COUNTRIES,
  formatPostalCode,
  REGIONS,
  validPostalCode,
} from "./address-data";
import ProductBrandLogo from "./product-brand-logo";
import { apiFetch } from "./supabase-browser";

type Hour = { day: string; open: string; close: string; closed: boolean };
type SourceMode = "connect_later" | "csv" | "live";

type Setup = {
  ownerName: string;
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
  taxNumber: string;
  sourceMode: SourceMode;
  selectedPos: string;
  emailNotifications: boolean;
};

const initialHours: Hour[] = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
].map((day) => ({
  day,
  open: day === "Sunday" ? "" : "09:00",
  close: day === "Sunday" ? "" : "18:00",
  closed: day === "Sunday",
}));

const initialSetup = (accountName: string): Setup => ({
  ownerName: accountName.includes("@") ? "" : accountName,
  businessName: "",
  legalName: "",
  businessEmail: "",
  phone: "",
  website: "",
  industry: "Retail",
  country: "CA",
  province: "",
  city: "",
  address: "",
  postalCode: "",
  timezone: "America/Edmonton",
  currency: "CAD",
  fiscalYearStart: "January",
  taxNumber: "",
  sourceMode: "connect_later",
  selectedPos: "",
  emailNotifications: true,
});

function countryDefaults(country: string) {
  const known: Record<string, { currency: string; timezone: string }> = {
    CA: { currency: "CAD", timezone: "America/Edmonton" },
    US: { currency: "USD", timezone: "America/New_York" },
    GB: { currency: "GBP", timezone: "Europe/London" },
    AU: { currency: "AUD", timezone: "Australia/Sydney" },
    NZ: { currency: "NZD", timezone: "Pacific/Auckland" },
    JP: { currency: "JPY", timezone: "Asia/Tokyo" },
    IN: { currency: "INR", timezone: "Asia/Kolkata" },
    MX: { currency: "MXN", timezone: "America/Mexico_City" },
    BR: { currency: "BRL", timezone: "America/Sao_Paulo" },
  };
  return known[country] || { currency: "USD", timezone: "UTC" };
}

function messageFrom(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback;
  const error = (data as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (
    error &&
    typeof error === "object" &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return fallback;
}

export default function SecureOnboardingFlow({
  accountName,
  accountEmail,
  complete,
  signOut,
}: {
  accountName: string;
  accountEmail: string;
  complete: (business: string, owner: string) => void;
  signOut: () => void;
}) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<Setup>(() => initialSetup(accountName));
  const [hours, setHours] = useState<Hour[]>(initialHours);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Setup>(key: K, value: Setup[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const next = () => {
    setError("");
    if (step === 1 && !form.ownerName.trim())
      return setError("Enter the account owner's name.");
    if (
      step === 2 &&
      (!form.businessName.trim() ||
        !form.legalName.trim() ||
        !/^\S+@\S+\.\S+$/.test(form.businessEmail))
    )
      return setError(
        "Complete the business name, legal business name, and business email.",
      );
    if (
      step === 3 &&
      (!form.address.trim() ||
        !form.city.trim() ||
        !form.province.trim() ||
        !validPostalCode(form.country, form.postalCode))
    )
      return setError(
        `Complete the primary business address and enter a valid ${form.country === "CA" ? "Canadian postal code" : form.country === "US" ? "U.S. ZIP code" : "postal code"}.`,
      );
    if (step === 6 && form.sourceMode === "live" && !form.selectedPos)
      return setError("Select the POS system you plan to connect.");
    setStep((current) => Math.min(7, current + 1));
  };

  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      const response = await apiFetch("/api/v1/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, hours }),
      });
      const data: unknown = await response.json();
      if (!response.ok)
        return setError(messageFrom(data, "Unable to create the workspace."));
      if (logoFile) {
        try {
          await apiFetch("/api/v1/governance", {
            headers: { Accept: "application/json" },
          });
          const logo = new FormData();
          logo.set("logo", logoFile);
          await apiFetch("/api/v1/organization-logo", {
            method: "POST",
            body: logo,
          });
        } catch {
          // The workspace is valid even if the optional brand upload is interrupted.
          // Settings exposes the same verified upload flow for a retry.
        }
      }
      complete(form.businessName, form.ownerName);
    } catch {
      setError(
        "Unable to create the workspace. Check your connection and try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="onboarding">
      <aside>
        <div className="public-brand">
          <ProductBrandLogo product="vanteloq" />
          <span>
            Vanteloq<small>SECURE WORKSPACE SETUP</small>
          </span>
        </div>
        <div className="setup-message">
          <p>WELCOME TO VANTELOQ</p>
          <h1>Build a workspace around your real business.</h1>
          <span>
            Your account identity is verified by the hosted sign-in service.
            Vanteloq does not collect a pretend password or create sample
            business data.
          </span>
        </div>
        <ol>
          {[
            "Verified owner",
            "Business profile",
            "Location & hours",
            "Brand identity",
            "Security preferences",
            "Data source plan",
            "Review & launch",
          ].map((label, index) => (
            <li
              className={
                step === index + 1 ? "active" : step > index + 1 ? "done" : ""
              }
              key={label}
            >
              <b>{step > index + 1 ? "✓" : index + 1}</b>
              <span>
                {label}
                <small>
                  {
                    [
                      "Trusted account identity",
                      "Identity & reporting",
                      "Operating context",
                      "Optional tenant logo",
                      "Provider boundaries",
                      "POS or CSV",
                      "Create tenant boundary",
                    ][index]
                  }
                </small>
              </span>
            </li>
          ))}
        </ol>
        <small className="setup-security">
          Trusted identity · Server-derived ownership · Tenant-isolated records
        </small>
      </aside>
      <section className="setup-panel">
        <div className="setup-progress">
          <span>STEP {step} OF 7</span>
          <i>
            <b style={{ width: `${Math.round((step / 7) * 100)}%` }} />
          </i>
          <em>{Math.round((step / 7) * 100)}%</em>
        </div>
        {step === 1 && (
          <Step
            eyebrow="VERIFIED IDENTITY"
            title="Confirm the workspace owner."
            copy="Your sign-in identity is supplied by the hosted authentication service and cannot be replaced by a browser-supplied email."
          >
            <div className="verified-identity">
              <span>✓</span>
              <div>
                <b>Email verified by secure sign-in</b>
                <small>
                  {accountEmail || "Authenticated account"} · This account
                  receives the owner role.
                </small>
              </div>
            </div>
            <Field
              label="Owner display name"
              value={form.ownerName}
              onChange={(value) => set("ownerName", value)}
              placeholder="Avery Chen"
            />
            <label className="notification-consent">
              <input
                type="checkbox"
                checked={form.emailNotifications}
                onChange={(event) =>
                  set("emailNotifications", event.target.checked)
                }
              />
              <span>
                <b>Account and workspace notifications</b>
                <small>
                  Remember this account’s preference for security, action and
                  workspace email notifications. Delivery begins when the
                  notification service is configured.
                </small>
              </span>
            </label>
            <p className="auth-note">
              Secure sign-in remembers this account according to its session
              policy. Vanteloq stores workspace data and preferences
              server-side, never in a pretend browser account.
            </p>
            <button className="text-action" onClick={signOut}>
              Use a different account
            </button>
          </Step>
        )}
        {step === 2 && (
          <Step
            eyebrow="BUSINESS PROFILE"
            title="Define the business identity."
            copy="Keep the customer-facing name separate from the registered legal entity."
          >
            <div className="form-grid">
              <Field
                label="Store / business name"
                value={form.businessName}
                onChange={(value) => set("businessName", value)}
                placeholder="Maple & Main Market"
              />
              <Field
                label="Legal business name"
                value={form.legalName}
                onChange={(value) => set("legalName", value)}
                placeholder="Maple & Main Retail Ltd."
              />
              <Field
                label="Business email"
                type="email"
                value={form.businessEmail}
                onChange={(value) => set("businessEmail", value)}
                placeholder="operations@example.com"
              />
              <Field
                label="Phone (optional)"
                value={form.phone}
                onChange={(value) => set("phone", value)}
                placeholder="780-555-0142"
              />
              <Field
                label="Website (optional)"
                value={form.website}
                onChange={(value) => set("website", value)}
                placeholder="https://example.com"
              />
              <Select
                label="Industry"
                value={form.industry}
                onChange={(value) => set("industry", value)}
                options={[
                  "Retail",
                  "Food & beverage",
                  "Health & wellness",
                  "Professional services",
                  "Hospitality",
                  "E-commerce",
                  "Other",
                ]}
              />
            </div>
          </Step>
        )}
        {step === 3 && (
          <Step
            eyebrow="LOCATION & REPORTING"
            title="Set the operating context."
            copy="Country names use ISO 3166-1 reference codes. Canada and the United States include complete subdivision lists and strict postal formatting; other countries preserve confirmed manual address fields until a regional validation provider is connected."
          >
            <div className="form-grid">
              <Select
                label="Country"
                value={form.country}
                onChange={(country) => {
                  const defaults = countryDefaults(country);
                  setForm((current) => ({
                    ...current,
                    country,
                    province: "",
                    postalCode: "",
                    ...defaults,
                  }));
                }}
                options={COUNTRIES.map((item) => ({
                  value: item.code,
                  label: item.name,
                }))}
              />
              {REGIONS[form.country] ? (
                <Select
                  label={
                    form.country === "CA"
                      ? "Province / territory"
                      : "State or territory"
                  }
                  value={form.province}
                  onChange={(value) => set("province", value)}
                  options={[
                    {
                      value: "",
                      label: `Select ${form.country === "CA" ? "province or territory" : "state or territory"}`,
                    },
                    ...REGIONS[form.country].map((item) => ({
                      value: item.code,
                      label: item.name,
                    })),
                  ]}
                />
              ) : (
                <Field
                  label="Administrative area / region"
                  value={form.province}
                  onChange={(value) => set("province", value)}
                  placeholder="Province, state, region or prefecture"
                  autoComplete="address-level1"
                />
              )}
              <Field
                label="Street address"
                value={form.address}
                onChange={(value) => set("address", value)}
                placeholder="Street and building"
                full
                autoComplete="street-address"
              />
              <Field
                label="City / locality"
                value={form.city}
                onChange={(value) => set("city", value)}
                autoComplete="address-level2"
              />
              <Field
                label={
                  form.country === "CA"
                    ? "Postal code"
                    : form.country === "US"
                      ? "ZIP or ZIP+4"
                      : "Postal code"
                }
                value={form.postalCode}
                onChange={(value) => set("postalCode", value.toUpperCase())}
                onBlur={() =>
                  set(
                    "postalCode",
                    formatPostalCode(form.country, form.postalCode),
                  )
                }
                placeholder={
                  form.country === "CA"
                    ? "T5J 0N3"
                    : form.country === "US"
                      ? "98101"
                      : "Postal code"
                }
                autoComplete="postal-code"
              />
              <Field
                label="IANA timezone"
                value={form.timezone}
                onChange={(value) => set("timezone", value)}
                placeholder="Europe/London"
              />
              <Field
                label="ISO currency"
                value={form.currency}
                onChange={(value) =>
                  set("currency", value.toUpperCase().slice(0, 3))
                }
                placeholder="CAD"
              />
              <Select
                label="Fiscal year starts"
                value={form.fiscalYearStart}
                onChange={(value) => set("fiscalYearStart", value)}
                options={[
                  "January",
                  "February",
                  "March",
                  "April",
                  "May",
                  "June",
                  "July",
                  "August",
                  "September",
                  "October",
                  "November",
                  "December",
                ]}
              />
              <Field
                label={
                  form.country === "CA"
                    ? "GST/HST number (optional)"
                    : "Tax identifier (optional)"
                }
                value={form.taxNumber}
                onChange={(value) => set("taxNumber", value)}
                placeholder="Optional"
              />
            </div>
            <p className="address-note">
              Manual entry is always available and never silently replaced.
              Street autocomplete, deliverability and verified coordinates
              remain disabled until a configured regional provider confirms
              them.
            </p>
            <div className="hours-editor">
              <div>
                <b>Business hours</b>
                <span>Used for daypart and close reporting.</span>
              </div>
              {hours.map((row, index) => (
                <div className="hours-row" key={row.day}>
                  <strong>{row.day}</strong>
                  <label>
                    <input
                      type="checkbox"
                      checked={!row.closed}
                      onChange={(event) =>
                        setHours((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  closed: !event.target.checked,
                                  open: event.target.checked ? "09:00" : "",
                                  close: event.target.checked ? "18:00" : "",
                                }
                              : item,
                          ),
                        )
                      }
                    />{" "}
                    Open
                  </label>
                  <input
                    type="time"
                    disabled={row.closed}
                    value={row.open}
                    onChange={(event) =>
                      setHours((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, open: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                  <span>to</span>
                  <input
                    type="time"
                    disabled={row.closed}
                    value={row.close}
                    onChange={(event) =>
                      setHours((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, close: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </div>
              ))}
            </div>
          </Step>
        )}
        {step === 4 && (
          <Step
            eyebrow="BRAND IDENTITY"
            title="Make the workspace recognizable."
            copy="A customer logo replaces the organization initials while Vanteloq and BookLoQ product identities remain separate."
          >
            <label className="drop-zone">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0] || null;
                  if (file && file.size > 2 * 1024 * 1024) {
                    setError(
                      "Choose a PNG, JPEG or WEBP logo no larger than 2 MB.",
                    );
                    return;
                  }
                  setError("");
                  setLogoFile(file);
                }}
              />
              <b>
                {logoFile
                  ? logoFile.name
                  : "Choose an optional organization logo"}
              </b>
              <span>
                PNG, JPEG or WEBP · maximum 2 MB · can always be changed in
                Settings
              </span>
            </label>
            <p className="address-note">
              The server verifies the file signature and stores the logo inside
              this organization’s isolated file namespace. SVG remains disabled
              until a sanitizer is configured.
            </p>
          </Step>
        )}
        {step === 5 && (
          <Step
            eyebrow="SECURITY & NOTIFICATIONS"
            title="Review the secure account boundary."
            copy="Hosted sign-in owns passwords, passkeys, MFA, recovery and active sessions. Vanteloq owns organization authorization, financial privacy and append-only access records."
          >
            <div className="verified-identity">
              <span>✓</span>
              <div>
                <b>Verified hosted authentication</b>
                <small>
                  Password changes, MFA enrollment, passkeys and recovery stay
                  with the identity provider. Vanteloq never stores those
                  secrets.
                </small>
              </div>
            </div>
            <label className="notification-consent">
              <input
                type="checkbox"
                checked={form.emailNotifications}
                onChange={(event) =>
                  set("emailNotifications", event.target.checked)
                }
              />
              <span>
                <b>Account and workspace notifications</b>
                <small>
                  Store this owner’s preference for security, integration, task
                  and workspace notifications. External delivery remains
                  disabled until a notification provider is connected.
                </small>
              </span>
            </label>
            <p className="auth-note">
              Sensitive financial, export, employee-access and integration
              actions require server authorization. Workplace PINs are created
              later per employee and cannot replace remote authentication.
            </p>
          </Step>
        )}
        {step === 6 && (
          <Step
            eyebrow="DATA SOURCES"
            title="Choose the first ingestion path."
            copy="This records a setup preference. It does not claim that a provider is connected."
          >
            <div className="source-choice">
              {(
                [
                  [
                    "live",
                    "⇄",
                    "Prepare a live POS connection",
                    "Select a provider now; authorization remains disabled until production credentials are configured.",
                  ],
                  [
                    "csv",
                    "↑",
                    "Start with CSV",
                    "Import mapping and validation is the next data-ingestion milestone.",
                  ],
                  [
                    "connect_later",
                    "○",
                    "Continue empty",
                    "Use the workspace shell without sample business data.",
                  ],
                ] as const
              ).map(([id, icon, title, copy]) => (
                <button
                  type="button"
                  className={form.sourceMode === id ? "selected" : ""}
                  onClick={() => set("sourceMode", id)}
                  key={id}
                >
                  <i>{icon}</i>
                  <span>
                    <b>{title}</b>
                    <small>{copy}</small>
                  </span>
                  <em>{form.sourceMode === id ? "✓" : "○"}</em>
                </button>
              ))}
            </div>
            {form.sourceMode === "live" && (
              <div className="pos-picker">
                <b>Planned POS provider</b>
                <div>
                  {[
                    "Lightspeed",
                    "Square",
                    "Moneris",
                    "Shopify POS",
                    "Clover",
                    "Other POS",
                  ].map((provider) => (
                    <button
                      type="button"
                      className={
                        form.selectedPos === provider ? "selected" : ""
                      }
                      onClick={() => set("selectedPos", provider)}
                      key={provider}
                    >
                      {provider}
                      <span>Setup required</span>
                    </button>
                  ))}
                </div>
                <small>
                  No API key or provider secret is requested in onboarding.
                </small>
              </div>
            )}
          </Step>
        )}
        {step === 7 && (
          <Step
            eyebrow="REVIEW"
            title="Create the tenant boundary."
            copy="Vanteloq will create an owner membership and an empty organization-scoped workspace."
          >
            <div className="review-grid">
              <article>
                <small>OWNER</small>
                <b>{form.ownerName}</b>
                <span>
                  Verified hosted identity
                  <br />
                  Protected owner permission
                </span>
              </article>
              <article>
                <small>BUSINESS</small>
                <b>{form.businessName}</b>
                <span>
                  {form.legalName}
                  <br />
                  {form.city}, {form.province}, {form.country}
                  <br />
                  {logoFile ? "Custom logo selected" : "Initials fallback"}
                </span>
              </article>
              <article>
                <small>DATA</small>
                <b>
                  {form.sourceMode === "live"
                    ? form.selectedPos
                    : form.sourceMode === "csv"
                      ? "CSV planned"
                      : "Connect later"}
                </b>
                <span>
                  No demo data
                  <br />
                  No browser-stored secret
                </span>
              </article>
            </div>
            <div className="launch-note">
              <i>✓</i>
              <span>
                <b>Ready for a clean launch</b>
                <small>
                  Ownership is derived from the authenticated account and
                  recorded in the audit trail.
                </small>
              </span>
            </div>
          </Step>
        )}
        {error && (
          <p className="setup-error" role="alert">
            {error}
          </p>
        )}
        <div className="setup-actions">
          <button
            onClick={() =>
              step === 1 ? signOut() : setStep((current) => current - 1)
            }
          >
            {step === 1 ? "Sign out" : "← Back"}
          </button>
          {step < 7 ? (
            <button className="continue" onClick={next}>
              Continue →
            </button>
          ) : (
            <button
              className="continue"
              disabled={saving}
              onClick={() => void submit()}
            >
              {saving ? "Creating secure workspace…" : "Create workspace →"}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

function Step({
  eyebrow,
  title,
  copy,
  children,
}: {
  eyebrow: string;
  title: string;
  copy: string;
  children: React.ReactNode;
}) {
  return (
    <div className="setup-step">
      <p>{eyebrow}</p>
      <h2>{title}</h2>
      <span>{copy}</span>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  onBlur,
  placeholder = "",
  type = "text",
  full = false,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  type?: string;
  full?: boolean;
  autoComplete?: string;
}) {
  return (
    <label className={full ? "field full" : "field"}>
      <span>{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly (string | { value: string; label: string })[];
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => {
          const item =
            typeof option === "string"
              ? { value: option, label: option }
              : option;
          return (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          );
        })}
      </select>
    </label>
  );
}
