"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import IntegrationBrandLogo from "./integration-brand-logo";
import { integrationCatalog, integrationPublicStatus, integrationCategoryGuide } from "./integration-catalog";

const GROUPS = [
  { name: "Point of sale & online stores", categories: ["Point of sale", "Commerce"] },
  { name: "Payments & banking", categories: ["Payments", "Banking"] },
  { name: "Accounting", categories: ["Accounting"] },
  { name: "Marketing", categories: ["Marketing"] },
  { name: "Delivery & labour", categories: ["Delivery", "Labour"] },
];

export default function CompatibilityCheck() {
  const [selection, setSelection] = useState<string | null>(null);
  const details = useRef<HTMLDivElement>(null);
  const provider = integrationCatalog.find(item => item.id === selection);
  const status = provider ? integrationPublicStatus(provider) : { label: "Available", tone: "setup" };
  const unavailable = provider && status.tone !== "setup";
  useEffect(() => {
    if (!selection) return;
    details.current?.focus({ preventScroll: true });
    details.current?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }, [selection]);

  return <div className="home-provider-directory" aria-labelledby="provider-directory-title">
    <header><div><h3 id="provider-directory-title">Which system do you use?</h3><p>Select a provider for setup details. All connections and availability are shown below.</p></div><span>Reports require authorization, a completed import and reviewed source totals.</span></header>
    {GROUPS.map(group => <section className="home-provider-group" key={group.name} aria-label={group.name}>
      <div className="home-provider-group-heading"><h4>{group.name}</h4></div>
      <div className="home-provider-tiles">{integrationCatalog.filter(item => group.categories.includes(item.category)).map(item => {
        const itemStatus = integrationPublicStatus(item);
        return <button type="button" key={item.id} aria-expanded={selection === item.id} aria-controls="provider-setup-details" data-public-event="compatibility_checked" onClick={() => setSelection(item.id)}><IntegrationBrandLogo name={item.name} compact/><span className="provider-tile-label"><strong>{item.name}</strong><span className={`home-connection-status ${itemStatus.tone}`}>{itemStatus.label}</span></span></button>;
      })}</div>
    </section>)}
    <section className="home-provider-group" aria-label="File imports"><div className="home-provider-group-heading"><h4>File imports</h4></div><div className="home-provider-tiles"><button type="button" aria-expanded={selection === "csv"} aria-controls="provider-setup-details" data-public-event="compatibility_checked" onClick={() => setSelection("csv")}><IntegrationBrandLogo name="Daily CSV" compact/><span className="provider-tile-label"><strong>CSV import</strong><span className="home-connection-status setup">Available</span></span></button></div></section>
    <div id="provider-setup-details" ref={details} tabIndex={-1} className="provider-setup-details" aria-live="polite" aria-label="Selected provider setup">
      {selection ? <><header><h4>{provider?.name ?? "CSV import"}</h4><span className={`home-connection-status ${status.tone}`}>{status.label}</span></header><p>{provider?.activationRequirement ?? "Use a supported CSV template, map your locations and review validation results before records reach your reports."}</p><dl><div><dt>What the data can support</dt><dd>{provider ? integrationCategoryGuide[provider.category].enables : "Daily sales and supported operating or financial records, according to the selected import template."}</dd></div><div><dt>Before using the results</dt><dd>{unavailable ? "This connection is not ready for general production use. Check a supported import alternative before choosing a plan." : "Map locations, finish the import and reconcile a representative period. Results depend on the records your source supplies."}</dd></div></dl><Link href={unavailable ? "/contact" : "/pricing"}>{unavailable ? "Ask about your requirements" : "Compare plans"} →</Link></> : <p>Not sure where to start? Select your system above or <Link href="/contact">ask us about your requirements</Link>.</p>}
    </div>
    <p className="provider-mark-notice">Third-party names and permitted marks identify compatible or planned services only. They remain the property of their owners and do not imply endorsement of Vanteloq. Availability is stated beside each provider. QuickBooks is a registered trademark of Intuit Inc.; its name is used here only to describe compatibility.</p>
  </div>;
}
