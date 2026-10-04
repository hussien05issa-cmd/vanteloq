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
import { apiFetch } from "./supabase-browser";
import {
  ACCOUNT_ACCEPTANCE_NOTICE_VERSION,
  PRIVACY_POLICY_VERSION,
  TERMS_OF_SERVICE_VERSION,
} from "../shared/legal-versions";
import { useBillingEntitlements } from "./billing-entitlements-context";
import { industryKpiRecommendation } from "../domain/industry-kpis";

import BuildYourOverview from "./build-your-overview";
import { recommendedOverview } from "../domain/dashboard-personalization";
import { IndustryConfigurationFields } from "./industry-configuration";
import { defaultIndustryConfiguration, resolveIndustryTemplate } from "../domain/industry-templates";
import type { validateOnboardingDraft } from "../domain/onboarding-draft";

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
  const planAccess = useBillingEntitlements();
  const panelRef = useRef<HTMLElement>(null);
  const previousStep = useRef(1);
  useEffect(() => { if (step !== previousStep.current) { panelRef.current?.querySelector<HTMLElement>(".setup-step h2")?.focus(); previousStep.current = step; } }, [step]);
  const [form, setForm] = useState<Setup>(() => initialSetup(accountName));
  const [industryConfiguration,setIndustryConfiguration] = useState(()=>defaultIndustryConfiguration("Retail"));
  const [overview,setOverview] = useState(()=>recommendedOverview("Retail"));
  const [overviewTouched,setOverviewTouched] = useState(false);
  const overviewLayout=overviewTouched?overview:recommendedOverview(form.industry);
  const kpiGuide = industryKpiRecommendation(form.industry);
  const [hours, setHours] = useState<Hour[]>(initialHours);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [savedDraft,setSavedDraft]=useState<ReturnType<typeof validateOnboardingDraft>|null>(null);
  const [draftRevision,setDraftRevision]=useState(0),[draftNotice,setDraftNotice]=useState(""),[draftBusy,setDraftBusy]=useState(false),[draftLoading,setDraftLoading]=useState(true);
  useEffect(()=>{const controller=new AbortController();apiFetch("/api/v1/onboarding/draft",{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])}).then(async response=>{if(!response.ok)throw new Error("Saved progress could not be checked. Saving will still protect any newer draft.");const body=await response.json();if(!controller.signal.aborted){setSavedDraft(body.draft);setDraftRevision(body.revision);}}).catch(e=>{if(!controller.signal.aborted)setDraftNotice(e instanceof Error?e.message:"Saved progress could not be checked.");}).finally(()=>{if(!controller.signal.aborted)setDraftLoading(false);});return()=>controller.abort();},[]);
  async function saveDraft(){if(draftBusy||draftLoading||saving)return;setDraftBusy(true);setError("");try{const response=await apiFetch("/api/v1/onboarding/draft",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({expectedRevision:draftRevision,draft:{form,step,hours,industryConfiguration,overview:overviewLayout}}),signal:AbortSignal.timeout(15000)});const body=await response.json();if(!response.ok)throw new Error(messageFrom(body,"Unable to save your progress."));setDraftRevision(body.revision);setDraftNotice("Progress saved to your account for 48 hours. Tax identifiers and legal acceptance are not saved in the draft.");}catch(e){setError(e instanceof Error?e.message:"Unable to save progress.");}finally{setDraftBusy(false);}}
  async function discardDraft(){setDraftBusy(true);try{const response=await apiFetch("/api/v1/onboarding/draft",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({expectedRevision:draftRevision}),signal:AbortSignal.timeout(15000)});if(!response.ok){const body=await response.json();throw new Error(messageFrom(body,"Unable to discard the saved draft."));}setSavedDraft(null);setDraftRevision(0);}catch(e){setError(e instanceof Error?e.message:"Unable to discard the saved draft.");}finally{setDraftBusy(false);}}
  const standaloneBookloq = planAccess.plan === "bookloq";
  const freePlan = planAccess.accessType === "free";
  const set = <K extends keyof Setup>(key: K, value: Setup[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const setAddressField = (key: "country" | "province" | "city" | "address" | "postalCode", value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
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
    if (step === 5 && form.sourceMode === "live" && !form.selectedPos)
      return setError("Select the POS system you plan to connect.");
    setStep((current) => Math.min(7, current + 1));
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
          industryConfiguration: {...industryConfiguration,goals:overviewLayout.priorities??[]},
          hours,
          dashboardPreferences: overviewLayout,
          legalAccepted: true,
          termsVersion: TERMS_OF_SERVICE_VERSION,
          privacyPolicyVersion: PRIVACY_POLICY_VERSION,
          legalNoticeVersion: ACCOUNT_ACCEPTANCE_NOTICE_VERSION,
        }),
      });
      const data: unknown = await response.json();
      if (!response.ok)
        return setError(messageFrom(data, "Unable to create the workspace."));
      const saved = (data as { organization?: { businessName?: string; ownerName?: string } }).organization;
      complete(saved?.businessName ?? form.businessName, saved?.ownerName ?? form.ownerName);
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
            "Build your overview",
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
        <div className="setup-progress" role="progressbar" aria-label="Workspace setup" aria-valuemin={0} aria-valuemax={7} aria-valuenow={step} aria-valuetext={`Step ${step} of 7`}>
          <span>STEP {step} OF 7</span>
          <i>
            <b style={{ width: `${Math.round((step / 7) * 100)}%` }} />
          </i>
          <em>{Math.round((step / 7) * 100)}%</em>
        </div>
        {savedDraft&&<section className="industry-resume" aria-label="Saved business setup"><strong>Your saved setup is ready.</strong><p>Resume where you left off, or start again. Acceptance of legal terms must be reviewed again.</p><button type="button" disabled={draftBusy||saving} onClick={()=>{setForm({...initialSetup(accountName),...savedDraft.form} as Setup);setHours(savedDraft.hours);setIndustryConfiguration(savedDraft.industryConfiguration);setOverview(savedDraft.overview);setOverviewTouched(true);setStep(savedDraft.step);setLegalAccepted(false);setSavedDraft(null);}}>Resume saved setup</button><button type="button" disabled={draftBusy||saving} onClick={()=>void discardDraft()}>Discard saved draft</button></section>}
        {draftNotice&&<p role="status" className="industry-draft-note">{draftNotice}</p>}
        <button type="button" className="overview-skip" disabled={draftBusy||draftLoading||saving||Boolean(savedDraft)} onClick={()=>void saveDraft()}>{draftLoading?"Checking saved progress…":draftBusy?"Saving progress…":"Save progress"}</button>
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
            <IndustryConfigurationFields value={industryConfiguration} disabled={saving} onChange={next=>{setIndustryConfiguration(next);set("industry",resolveIndustryTemplate(next.templateId).label);}}/>
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
            </div>
            <section className="onboarding-kpi-guide" aria-live="polite" aria-label={`${kpiGuide.industry} KPI recommendations`}>
              <header><div><p>RECOMMENDED STARTING VIEW</p><h3>{kpiGuide.industry} KPIs</h3></div><span>These are a starting point, not an industry benchmark.</span></header>
              <p>{kpiGuide.summary}</p>
              <div>{kpiGuide.recommended.slice(0, 4).map(item => <article key={item.key}><strong>{item.key.replaceAll("_", " ")}</strong><span>{item.reason}</span></article>)}</div>
              <small>You can apply this view, choose different metrics and set your own targets from Dashboard → Customize. Vanteloq never invents a target from your industry selection.</small>
            </section>
          </Step>
        )}
        {step === 3 && (
          <Step
            eyebrow="LOCATION & REPORTING"
            title="Location and Reporting"
            copy="Choose your country and province or state, then enter your business address and reporting preferences."
          >
            <div className="form-grid">
              <Select
                label="Country"
                autoComplete="country"
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
                      ? "Province / Territory"
                      : "State or Territory"
                  }
                  autoComplete="address-level1"
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
            <p className="address-note">Check your address for accuracy before continuing.</p>
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
                  disabled={freePlan && id === "live"}
                  key={id}
                >
                  <i>{icon}</i>
                  <span>
                    <b>{title}</b>
                    <small>{freePlan && id === "live" ? "Live POS connections are available after a paid upgrade. Start with daily-summary CSV or manual entry." : copy}</small>
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
        {step === 6 && <Step eyebrow="YOUR PRIORITIES" title="Build Your Overview" copy="A dashboard built around your business, with the numbers you want to follow."><BuildYourOverview industry={form.industry} value={overviewLayout} onChange={next=>{setOverview(next);setOverviewTouched(true);}}/><button type="button" className="overview-skip" onClick={()=>{setOverview(recommendedOverview(form.industry));setOverviewTouched(true);setStep(7);}}>Skip for Now</button></Step>}
        {step === 7 && (
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
                  Finish setting up your {standaloneBookloq ? "BookLoQ" : "Vanteloq"} workspace.
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
          {step < 7 ? (
            <button className="continue" onClick={next}>
              Continue →
            </button>
          ) : (
            <button
              className="continue"
              disabled={saving || !legalAccepted}
              onClick={() => void submit()}
            >
              {saving ? "Saving your business details…" : "Finish setup →"}
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
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly (string | { value: string; label: string })[];
  autoComplete?: string;
}) {
  return (
    <label className="field">
      <FieldLabel>{label}</FieldLabel>
      <select required aria-label={label} autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)}>
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
