"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  COUNTRIES,
  formatPostalCode,
  REGIONS,
  validPostalCode,
} from "./address-data";
import { FieldLabel, FormInput, FormLegend, RequiredMark } from "./form-primitives";
import ProductBrandLogo from "./product-brand-logo";
import MarketingPreferences from "./marketing-consent";
import { apiFetch } from "./supabase-browser";
import {
  ACCOUNT_ACCEPTANCE_NOTICE_VERSION,
  PRIVACY_POLICY_VERSION,
  TERMS_OF_SERVICE_VERSION,
} from "../shared/legal-versions";
import { readPlanSelection, type PlanSelection } from "../shared/plan-selection";

type Hour = { day: string; open: string; close: string; closed: boolean };
type SourceMode = "connect_later" | "csv" | "live";
type AddressSuggestion = {
  id: string;
  text: string;
  description: string;
  next: "Find" | "Retrieve";
};
type VerifiedAddress = {
  address: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  validationStatus: "validated";
};

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
  addressVerificationToken: string;
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
  addressVerificationToken: "",
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
  const [planSelection, setPlanSelection] = useState<PlanSelection | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const previousStep = useRef(1);
  useEffect(() => { if (step !== previousStep.current) { panelRef.current?.querySelector<HTMLElement>(".setup-step h2")?.focus(); previousStep.current = step; } }, [step]);
  const [form, setForm] = useState<Setup>(() => initialSetup(accountName));
  const [hours, setHours] = useState<Hour[]>(initialHours);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [addressProvider, setAddressProvider] = useState<"checking" | "ready" | "manual">("checking");
  const [addressSearch, setAddressSearch] = useState("");
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([]);
  const [addressBusy, setAddressBusy] = useState(false);
  const [addressMessage, setAddressMessage] = useState("");
  const standaloneBookloq = planSelection?.plan === "bookloq";
  const set = <K extends keyof Setup>(key: K, value: Setup[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    queueMicrotask(() => setPlanSelection(readPlanSelection()));
  }, []);

  useEffect(() => {
    let active = true;
    void apiFetch("/api/v1/address", { headers: { Accept: "application/json" } })
      .then(async (response) => {
        const data = await response.json() as { configured?: unknown };
        if (active) setAddressProvider(response.ok && data.configured === true ? "ready" : "manual");
      })
      .catch(() => {
        if (active) setAddressProvider("manual");
      });
    return () => { active = false; };
  }, []);

  const setAddressField = (key: "country" | "province" | "city" | "address" | "postalCode", value: string) => {
    setForm((current) => ({ ...current, [key]: value, addressVerificationToken: "" }));
    setAddressSuggestions([]);
    setAddressMessage("");
  };

  const findAddress = async (lastId?: string) => {
    if (addressSearch.trim().length < 3 && !lastId) {
      setAddressMessage("Enter at least three characters of the business address.");
      return;
    }
    setAddressBusy(true);
    setAddressMessage("");
    try {
      const response = await apiFetch("/api/v1/address", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ action: "find", search: addressSearch, country: form.country, ...(lastId ? { lastId } : {}) }),
      });
      const data = await response.json() as { suggestions?: unknown; error?: unknown };
      if (!response.ok) throw new Error(messageFrom(data, "Address search is temporarily unavailable."));
      const suggestions = Array.isArray(data.suggestions) ? data.suggestions as AddressSuggestion[] : [];
      setAddressSuggestions(suggestions);
      if (!suggestions.length) setAddressMessage("No matching premises were found. Add more of the street address and try again.");
    } catch (caught) {
      setAddressMessage(caught instanceof Error ? caught.message : "Address search is temporarily unavailable.");
    } finally {
      setAddressBusy(false);
    }
  };

  const selectAddress = async (suggestion: AddressSuggestion) => {
    if (suggestion.next === "Find") {
      await findAddress(suggestion.id);
      return;
    }
    setAddressBusy(true);
    setAddressMessage("");
    try {
      const response = await apiFetch("/api/v1/address", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ action: "retrieve", id: suggestion.id }),
      });
      const data = await response.json() as { address?: VerifiedAddress; verificationToken?: unknown; error?: unknown };
      if (!response.ok || !data.address || typeof data.verificationToken !== "string") {
        throw new Error(messageFrom(data, "The selected address could not be verified."));
      }
      const address = data.address;
      const verificationToken = data.verificationToken;
      const defaults = countryDefaults(address.country);
      setForm((current) => ({
        ...current,
        country: address.country,
        province: address.province,
        city: address.city,
        address: address.address,
        postalCode: address.postalCode,
        addressVerificationToken: verificationToken,
        ...defaults,
      }));
      setAddressSearch(`${address.address}, ${address.city}, ${address.province} ${address.postalCode}`);
      setAddressSuggestions([]);
      setAddressMessage("Verified against Canada Post AddressComplete.");
    } catch (caught) {
      setAddressMessage(caught instanceof Error ? caught.message : "The selected address could not be verified.");
    } finally {
      setAddressBusy(false);
    }
  };

  const next = () => {
    setError("");
    const invalid = Array.from(panelRef.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select") || []).filter(input => !input.disabled && !input.checkValidity());
    if (invalid.length) {
      const details = invalid[0].closest("details");
      if (details) details.open = true;
      invalid[0].focus();
      return setError("Review the highlighted fields before continuing.");
    }
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
    if (step === 3 && addressProvider === "ready" && !form.addressVerificationToken)
      return setError("Select a complete business address verified by Canada Post AddressComplete.");
    if (step === 5 && form.sourceMode === "live" && !form.selectedPos)
      return setError("Select the POS system you plan to connect.");
    setStep((current) => Math.min(6, current + 1));
  };

  const submit = async () => {
    if (!legalAccepted) {
      setError("Review and accept the Terms of Service and Privacy Policy before creating the workspace.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await apiFetch("/api/v1/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          hours,
          legalAccepted: true,
          termsVersion: TERMS_OF_SERVICE_VERSION,
          privacyPolicyVersion: PRIVACY_POLICY_VERSION,
          legalNoticeVersion: ACCOUNT_ACCEPTANCE_NOTICE_VERSION,
        }),
      });
      const data: unknown = await response.json();
      if (!response.ok)
        return setError(messageFrom(data, "Unable to create the workspace."));
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
    <main className="onboarding setup-shell">
      <aside>
        <div className="public-brand">
          <ProductBrandLogo product={standaloneBookloq ? "bookloq" : "vanteloq"} />
          <span>
            {standaloneBookloq ? "BookLoQ" : "Vanteloq"}<small>SECURE WORKSPACE SETUP</small>
          </span>
        </div>
        <div className="setup-message">
          <p>WELCOME TO {standaloneBookloq ? "BOOKLOQ" : "VANTELOQ"}</p>
          <h1>{standaloneBookloq ? "Set up your financial review workspace." : "Build a workspace around your real business."}</h1>
          <span>
            {standaloneBookloq
              ? "Add your business details, then choose how you will bring in statements, documents and commerce evidence."
              : "Add your business details, set your preferences and choose how to connect your records."}
          </span>
        </div>
        <ol>
          {[
            "Verified owner",
            "Business profile",
            "Location & hours",
            "Security preferences",
            standaloneBookloq ? "Add financial records" : "Connect your data",
            "Review & continue",
          ].map((label, index) => (
            <li
              className={
                step === index + 1 ? "active" : step > index + 1 ? "done" : ""
              }
              key={label}
            >
              <b>{step > index + 1 ? "Done" : index + 1}</b>
              <span>
                {label}
                <small>
                  {
                    [
                      "Trusted account identity",
                      "Identity & reporting",
                      "Operating context",
                      "Account preferences",
                      standaloneBookloq ? "Statements, files or POS" : "POS or CSV",
                      "Confirm your details",
                    ][index]
                  }
                </small>
              </span>
            </li>
          ))}
        </ol>
        <small className="setup-security">
          Verified sign-in · Private business records
        </small>
      </aside>
      <section ref={panelRef} className="setup-panel">
        <FormLegend/>
        <div className="setup-progress" role="progressbar" aria-label="Workspace setup" aria-valuemin={0} aria-valuemax={6} aria-valuenow={step} aria-valuetext={`Step ${step} of 6`}>
          <span>STEP {step} OF 6</span>
          <i>
            <b style={{ width: `${Math.round((step / 6) * 100)}%` }} />
          </i>
          <em>{Math.round((step / 6) * 100)}%</em>
        </div>
        {step === 1 && (
          <Step
            eyebrow="VERIFIED IDENTITY"
            title="Workspace Owner"
            copy="Confirm the name people will see in your workspace."
          >
            <div className="verified-identity">
              <span>ID</span>
              <div>
                <b>Email verified by secure sign-in</b>
                <small>
                  {accountEmail || "Authenticated account"} · This account
                  receives the owner role.
                </small>
              </div>
            </div>
            <Field
              label="Owner Display Name"
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
                <b>Account and Workspace Notifications <span className="field-optional">(Optional)</span></b>
                <small>
                  Choose whether to receive workspace updates. Email delivery
                  depends on your notification setup.
                </small>
              </span>
            </label>
            <MarketingPreferences placement="onboarding" />
            <p className="auth-note">
              Your business records and preferences belong to this workspace.
              You can review account access in Settings.
            </p>
            <button className="text-action" onClick={signOut}>
              Use a different account
            </button>
          </Step>
        )}
        {step === 2 && (
          <Step
            eyebrow="BUSINESS PROFILE"
            title="Business Details"
            copy="Keep the customer-facing name separate from the registered legal entity."
          >
            <div className="form-grid">
              <Field
                label="Business Name"
                value={form.businessName}
                onChange={(value) => set("businessName", value)}
                placeholder="Maple & Main Market"
              />
              <Field
                label="Legal Business Name"
                value={form.legalName}
                onChange={(value) => set("legalName", value)}
                placeholder="Maple & Main Retail Ltd."
              />
              <Field
                label="Business Email" autoComplete="email"
                type="email"
                value={form.businessEmail}
                onChange={(value) => set("businessEmail", value)}
                placeholder="operations@example.com"
              />
              <Field
                label="Phone" required={false} type="tel" autoComplete="tel"
                value={form.phone}
                onChange={(value) => set("phone", value)}
                placeholder="780-555-0142"
              />
              <Field
                label="Website" required={false} type="url" autoComplete="url"
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
            title="Location and Reporting"
            copy="Add your business address and reporting preferences. Use address search when available, then review the details."
          >
            {addressProvider === "checking" && (
              <p className="address-provider-state" role="status">Checking secure address verification…</p>
            )}
            {addressProvider === "ready" && (
              <div className="address-finder">
                <label>
                  <span>Find the business address</span>
                  <div>
                    <input
                      value={addressSearch}
                      onChange={(event) => {
                        setAddressSearch(event.target.value);
                        setForm((current) => ({ ...current, addressVerificationToken: "" }));
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void findAddress();
                        }
                      }}
                      placeholder="Start typing the street address"
                      autoComplete="off"
                    />
                    <button type="button" disabled={addressBusy} onClick={() => void findAddress()}>
                      {addressBusy ? "Checking…" : "Find address"}
                    </button>
                  </div>
                </label>
                {addressSuggestions.length > 0 && (
                  <div className="address-suggestions" role="listbox" aria-label="Canada Post address suggestions">
                    {addressSuggestions.map((suggestion) => (
                      <button type="button" role="option" aria-selected="false" onClick={() => void selectAddress(suggestion)} key={`${suggestion.id}:${suggestion.text}`}>
                        <b>{suggestion.text}</b>
                        <span>{suggestion.description || (suggestion.next === "Find" ? "Show matching premises" : "Select this premise")}</span>
                      </button>
                    ))}
                  </div>
                )}
                {addressMessage && <p className={form.addressVerificationToken ? "address-verified" : "address-provider-message"} aria-live="polite">{addressMessage}</p>}
              </div>
            )}
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
                    city: "",
                    address: "",
                    postalCode: "",
                    addressVerificationToken: "",
                    ...defaults,
                  }));
                  setAddressSearch("");
                  setAddressSuggestions([]);
                  setAddressMessage("");
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
                      ? "Province / Territory"
                      : "State or Territory"
                  }
                  value={form.province}
                  onChange={(value) => setAddressField("province", value)}
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
                  label="Administrative Area / Region"
                  value={form.province}
                  onChange={(value) => setAddressField("province", value)}
                  placeholder="Province, state, region or prefecture"
                  autoComplete="address-level1"
                />
              )}
              <Field
                label="Street Address"
                value={form.address}
                onChange={(value) => setAddressField("address", value)}
                placeholder="Street and building"
                full
                autoComplete="street-address"
              />
              <Field
                label="City / Locality"
                value={form.city}
                onChange={(value) => setAddressField("city", value)}
                autoComplete="address-level2"
              />
              <Field
                label={
                  form.country === "CA"
                    ? "Postal Code"
                    : form.country === "US"
                      ? "ZIP or ZIP+4"
                      : "Postal Code"
                }
                hint={form.country === "CA" ? "Example: T5J 0N3. We add the space for you." : form.country === "US" ? "Example: 98101 or 98101-1234." : "Use the postal format for your country."}
                validate={value => validPostalCode(form.country, value) ? "" : "Enter a valid postal code for the selected country."}
                value={form.postalCode}
                onChange={(value) => setAddressField("postalCode", value.toUpperCase())}
                onBlur={() => {
                  const formatted = formatPostalCode(form.country, form.postalCode);
                  if (formatted !== form.postalCode) setAddressField("postalCode", formatted);
                }}
                placeholder={
                  form.country === "CA"
                    ? "T5J 0N3"
                    : form.country === "US"
                      ? "98101"
                      : "Postal Code"
                }
                autoComplete="postal-code"
              />
              <Field
                label="Reporting Timezone" hint="For example, America/Edmonton. Reports follow this timezone."
                value={form.timezone}
                onChange={(value) => set("timezone", value)}
                placeholder="Europe/London"
              />
              <Field
                label="Currency" hint="Three-letter currency code, such as CAD or USD." validate={value => /^[A-Z]{3}$/.test(value) ? "" : "Enter a three-letter currency code, such as CAD."}
                value={form.currency}
                onChange={(value) =>
                  set("currency", value.toUpperCase().slice(0, 3))
                }
                placeholder="CAD"
              />
              <Select
                label="Fiscal Year Starts"
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
                    ? "GST/HST Number"
                    : "Tax Identifier"
                }
                required={false}
                value={form.taxNumber}
                onChange={(value) => set("taxNumber", value)}
                placeholder="Optional"
              />
            </div>
            {addressProvider === "manual" && <p className="address-note">Enter your address manually and check it for accuracy before continuing.</p>}
            {addressProvider === "ready" && <p className="address-note">Selecting a result verifies the premise and fills the fields above. Editing any verified address field clears the verification and requires another selection.</p>}
            <details className="hours-editor">
              <summary><b>Business Hours</b><span>Review the default schedule.</span></summary>
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
                    type="time" required={!row.closed} aria-label={row.day + " Opening Time"}
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
                    type="time" required={!row.closed} aria-label={row.day + " Closing Time"}
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
            </details>
          </Step>
        )}
        {step === 4 && (
          <Step
            eyebrow="SECURITY & NOTIFICATIONS"
            title="Security and Notifications"
            copy="Your sign-in protects your account. Workspace roles control who can view records and take action."
          >
            <div className="verified-identity">
              <span>ID</span>
              <div>
                <b>Secure Sign-In</b>
                <small>
                  Your account uses verified sign-in and an authenticator code.
                  Manage your security preferences in Settings.
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
                <b>Account and Workspace Notifications <span className="field-optional">(Optional)</span></b>
                <small>
                  Save your preference for optional workspace updates. Essential
                  account and security messages are sent separately.
                </small>
              </span>
            </label>
            <p className="auth-note">
              You control which records your team can view and which actions
              they can take. Manage team permissions in Settings.
            </p>
          </Step>
        )}
        {step === 5 && (
          <Step
            eyebrow="DATA SOURCES"
            title={standaloneBookloq ? "Add Financial Records" : "Connect Your Data"}
            copy={standaloneBookloq
              ? "Start with statements or structured files, add optional commerce evidence, or connect sources after setup. Every import is reviewed before it affects reports."
              : "Choose how to bring in your records. You can also connect a source after setup."}
          >
            <div className="source-choice">
              {(
                (standaloneBookloq ? [
                  [
                    "csv",
                    "↑",
                    "Start with Statements or CSV",
                    "Upload bank statements, invoices, receipts or structured CSV files after setup, then review extracted records before use.",
                  ],
                  [
                    "connect_later",
                    "○",
                    "Connect Financial Sources Later",
                    "Open BookLoQ first, then authorize an available bank or accounting connection when you are ready.",
                  ],
                  [
                    "live",
                    "⇄",
                    "Add POS Evidence (Optional)",
                    "Connect a supported POS after setup when commerce records should support sales, fees and settlement review.",
                  ],
                ] : [
                  [
                    "live",
                    "⇄",
                    "Choose Your POS",
                    "Choose your provider. Connect an available integration from your workspace after setup.",
                  ],
                  [
                    "csv",
                    "↑",
                    "Start with CSV",
                    "Upload a CSV, match its columns and review the results before importing.",
                  ],
                  [
                    "connect_later",
                    "○",
                    "Continue empty",
                    "Start with an empty workspace and add your records when you are ready.",
                  ],
                ]) as readonly (readonly [SourceMode, string, string, string])[]
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
                  <em>{form.sourceMode === id ? "●" : "○"}</em>
                </button>
              ))}
            </div>
            {form.sourceMode === "live" && (
              <div className="pos-picker">
                <b>Preferred POS provider</b>
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
        {step === 6 && (
          <Step
            eyebrow="REVIEW"
            title={`Review Your ${standaloneBookloq ? "BookLoQ " : ""}Workspace`}
            copy={`${standaloneBookloq ? "BookLoQ" : "Vanteloq"} will create the owner account and an empty workspace for this organization.`}
          >
            <div className="review-grid">
              <article>
                <small>OWNER</small>
                <b>{form.ownerName}</b>
                <span>
                  Verified account
                  <br />
                  Workspace owner
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
                  Add your logo in Settings after activation.
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
                  Review imports before they update reports
                </span>
              </article>
            </div>
            <div className="launch-note">
              <i>OK</i>
              <span>
                <b>Ready to Continue</b>
                <small>
                  Create your workspace, then activate your chosen {standaloneBookloq ? "BookLoQ" : "Vanteloq"} plan.
                  Your reports will use the records you connect or import.
                </small>
              </span>
            </div>
            <label className="onboarding-legal-consent">
              <input required
                type="checkbox"
                checked={legalAccepted}
                onChange={(event) => setLegalAccepted(event.target.checked)}
              />
              <span>
                I agree to the <Link href="/terms" target="_blank">Terms of Service</Link> and acknowledge the <Link href="/privacy" target="_blank">Privacy Policy</Link>. This acceptance is recorded with the current document versions when the workspace is created. <RequiredMark/>
              </span>
            </label>
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
          {step < 6 ? (
            <button className="continue" onClick={next}>
              Continue →
            </button>
          ) : (
            <button
              className="continue"
              disabled={saving || !legalAccepted}
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
      <h2 tabIndex={-1}>{title}</h2>
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
  required = true,
  hint,
  validate,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  type?: string;
  full?: boolean;
  autoComplete?: string;
  required?: boolean;
  hint?: string;
  validate?: (value: string) => string;
}) {
  return (
    <label className={full ? "field full" : "field"}>
      <FieldLabel required={required}>{label}</FieldLabel>
      <FormInput
        aria-label={required ? label : label + " (Optional)"}
        hint={hint}
        validate={validate}
        required={required}
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
      <FieldLabel>{label}</FieldLabel>
      <select required value={value} onChange={(event) => onChange(event.target.value)}>
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
