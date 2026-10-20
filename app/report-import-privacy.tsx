"use client";

import { useId } from "react";
import "./report-imports.css";

export function ReportImportPrivacyNotice({ accepted, onChange, disabled = false }: {
  accepted: boolean; onChange: (accepted: boolean) => void; disabled?: boolean;
}) {
  const id = useId();
  return <section className="report-import-privacy" aria-labelledby={`${id}-title`}>
    <strong id={`${id}-title`}>Your report stays in your workspace</strong>
    <p>Authorised members can access it according to their permissions. Vanteloq’s service providers process stored data; restricted support access may be used to operate and troubleshoot the service. Uploads are not public.</p>
    <label htmlFor={`${id}-accept`}><input id={`${id}-accept`} type="checkbox" checked={accepted} disabled={disabled} onChange={event => onChange(event.target.checked)}/><span>I am authorised to provide this information and agree to its processing under Vanteloq’s <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.</span></label>
    <small>CSV imports save matched records; Documents keeps the original file. Use only required fields. External scanning and AI analysis require separate permission. <a href="/subprocessors" target="_blank" rel="noopener noreferrer">Service providers</a> · <a href="/privacy#retention" target="_blank" rel="noopener noreferrer">Retention and deletion</a></small>
  </section>;
}
