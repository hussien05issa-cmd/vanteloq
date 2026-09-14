"use client";
import Link from "next/link";
import { useState } from "react";
import IntegrationBrandLogo from "./integration-brand-logo";
import { integrationCatalog, integrationPublicStatus, integrationCategoryGuide } from "./integration-catalog";

export default function CompatibilityCheck() {
  const [selection, setSelection] = useState("lightspeed-r");
  const provider = integrationCatalog.find(item => item.id === selection);
  const status = provider ? integrationPublicStatus(provider) : { label: "Available", tone: "setup" };
  const unavailable = provider && (status.tone !== "setup" || provider.id === "meta");
  return <div className="compatibility-check">
    <div className="compatibility-picker"><label htmlFor="compatibility-provider">Which system do you use?</label><select id="compatibility-provider" value={selection} onChange={event => setSelection(event.target.value)} data-public-event="compatibility_checked">{integrationCatalog.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}<option value="csv">CSV import</option></select><p>No login or account access needed to check.</p></div>
    <div className="compatibility-result" aria-live="polite" aria-atomic="true">
      <div className="compatibility-result-title"><IntegrationBrandLogo name={provider?.name ?? "Daily CSV"} compact/><div><h3>{provider?.name ?? "CSV import"}</h3><span className={`home-connection-status ${status.tone}`}>{status.label}</span></div></div>
      <p>{provider?.activationRequirement ?? "Import a supported CSV, map your locations and review validation results before the records reach your reports."}</p>
      <dl><div><dt>What the data can support</dt><dd>{provider ? integrationCategoryGuide[provider.category].enables : "Daily sales and supported operating or financial records, according to the selected import template."}</dd></div><div><dt>Before using the results</dt><dd>{unavailable ? "This connection is not ready for general production use. Check a supported import alternative before choosing a plan." : "Authorize your own account, map locations, complete the import and reconcile a representative period. Reports depend on the records your provider supplies."}</dd></div></dl>
      <Link href={unavailable ? "/contact" : "/pricing"}>{unavailable ? "Ask about your requirements" : "Compare plans"} →</Link>
    </div>
  </div>;
}
