"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { COUNTRIES, formatPostalCode, validPostalCode } from "./address-data";
import { FieldLabel, FormInput, FormLegend } from "./form-primitives";
import { useModalFocus } from "./use-modal-focus";
import { changeOnboardingCountry, validReportingTimezone } from "../domain/onboarding-reporting";

export default function LocationSetupDialog({ close, create, country = "CA", timezone = "America/Edmonton", currency = "CAD", locale = "en-CA" }: { close: () => void; create: (body: Record<string, unknown>) => Promise<void>; country?: string; timezone?: string; currency?: string; locale?: string }) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [reporting, setReporting] = useState({ country, province: "", timezone, currency });
  const [postalCode, setPostalCode] = useState("");
  const submitted = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const titleId = useId();
  useModalFocus(formRef, true, () => { if (!submitted.current) close(); });
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitted.current) return;
    const form = new FormData(event.currentTarget);
    submitted.current = true;
    setSaving(true);
    setError("");
    try {
      await create(Object.fromEntries(form));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create this location. Your entries are still here. Try again.");
    } finally { submitted.current = false; setSaving(false); }
  }
  return <div className="modal-backdrop"><form ref={formRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={saving} tabIndex={-1} className="employee-wizard location-owner-modal" onSubmit={submit}>
    <header><div><p>NEW LOCATION</p><h2 id={titleId}>Add a business location</h2></div><button type="button" disabled={saving} aria-label="Close location setup" onClick={close}>×</button></header>
    <FormLegend/>
    <fieldset disabled={saving}><div className="wizard-grid">
      <label><FieldLabel>Location Name</FieldLabel><FormInput name="name" required maxLength={160} placeholder="Downtown café"/></label>
      <label><FieldLabel>Country</FieldLabel><select name="countryCode" required value={reporting.country} onChange={event => { setReporting(current => changeOnboardingCountry(current, event.target.value)); setPostalCode(""); }}>{COUNTRIES.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
      <label><FieldLabel>Street Address</FieldLabel><FormInput name="addressLine1" autoComplete="address-line1" required maxLength={240}/></label>
      <label><FieldLabel required={false}>Address Line 2</FieldLabel><FormInput name="addressLine2" autoComplete="address-line2" maxLength={240}/></label>
      <label><FieldLabel required={false}>Address Line 3</FieldLabel><FormInput name="addressLine3" autoComplete="address-line3" maxLength={240}/></label>
      <label><FieldLabel>City / Locality</FieldLabel><FormInput name="locality" autoComplete="address-level2" required maxLength={160}/></label>
      <label><FieldLabel required={false}>District / County</FieldLabel><FormInput name="district" maxLength={160}/></label>
      <label><FieldLabel>Province / State / Region</FieldLabel><FormInput name="administrativeArea" autoComplete="address-level1" required maxLength={160} value={reporting.province} onChange={event => setReporting(current => ({ ...current, province: event.target.value }))}/></label>
      <label><FieldLabel required={false}>Postal / ZIP Code</FieldLabel><FormInput name="postalCode" autoComplete="postal-code" maxLength={20} value={postalCode} onChange={event => setPostalCode(event.target.value)} onBlur={() => setPostalCode(formatPostalCode(reporting.country, postalCode))} validate={value => !value || validPostalCode(reporting.country, value) ? "" : "Enter a valid postal or ZIP code for the selected country."}/></label>
      <label><FieldLabel>Reporting Timezone</FieldLabel><FormInput name="timezone" required value={reporting.timezone} onChange={event => setReporting(current => ({ ...current, timezone: event.target.value }))} validate={value => validReportingTimezone(value) ? "" : "Enter a valid timezone, such as America/Edmonton."} hint="Reports use this location's timezone."/></label>
      <label><FieldLabel>Currency</FieldLabel><FormInput name="currency" required maxLength={3} pattern="[A-Z]{3}" value={reporting.currency} onChange={event => setReporting(current => ({ ...current, currency: event.target.value.toUpperCase() }))} hint="Three-letter currency code, such as CAD."/></label>
      <label><FieldLabel>Language and Region</FieldLabel><FormInput name="locale" required defaultValue={locale} maxLength={35} hint="For example, en-CA. This controls regional display conventions."/></label>
      <label><FieldLabel required={false}>Tax Jurisdiction</FieldLabel><FormInput name="taxJurisdiction" maxLength={160}/></label>
    </div></fieldset>
    {error && <p className="form-error" role="alert">{error}</p>}
    {saving && <p role="status">Saving this location. Keep this window open until confirmation.</p>}
    <footer><button type="button" disabled={saving} onClick={close}>Cancel</button><button type="submit" className="primary" disabled={saving}>{saving ? "Creating location…" : "Create location"}</button></footer>
  </form></div>;
}
