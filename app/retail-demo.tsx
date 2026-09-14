"use client";
import { useMemo } from "react";
import { retailDemo } from "../domain/retail-demo";
import RetailIntelligencePanel, { type retailSections } from "./retail-intelligence-panel";

export default function RetailDemo({ location, initialSection = "Why it changed", missingCost = false, onMissingCost }: { location: string; initialSection?: typeof retailSections[number]; missingCost?: boolean; onMissingCost?: (value: boolean) => void }) {
  const report = useMemo(() => retailDemo(location, missingCost), [location, missingCost]);
  return <div className="retail-demo"><div className="retail-demo-scenario"><span>Try an evidence gap</span><button type="button" aria-pressed={missingCost} onClick={() => onMissingCost?.(!missingCost)}>{missingCost ? "Restore complete costs" : "Remove a product cost"}</button><span>All records in this example are fictional.</span></div><RetailIntelligencePanel key={initialSection} initialSection={initialSection} report={report} currency="CAD" access={{ inventory: true, customers: true, labour: true, profit: true, costs: true, expiry: true, edit: false }} demo/></div>;
}
