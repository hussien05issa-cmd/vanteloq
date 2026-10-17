"use client";
import type { BookloqPayrollSource } from "../domain/bookloq-payroll-source";
import "./bookloq-advertising-spend.css";

function timestamp(value: number | null) {
  return value ? `${new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(value * 1000)} UTC` : "Not recorded";
}
export default function BookloqPayrollSourcePanel({ source, openIntegrations }: { source?: BookloqPayrollSource; openIntegrations: () => void }) {
  if (!source || source.status === "restricted") return null;
  return <section className="bookloq-card bookloq-payroll-source">
    <header><div><h3>Deel source reports</h3><p>Review the connection and imported period before recording payroll in the books.</p></div><button type="button" onClick={openIntegrations}>Review payroll connection</button></header>
    {source.connections.length ? <div className="bookloq-ad-spend-accounts">{source.connections.map(connection => <article key={connection.id}>
      <header><strong>{connection.accountName || "Deel account"}</strong><span className="bookloq-ad-spend-state review">Review required</span></header>
      <p>{connection.reportCount} staged aggregate records</p>
      <small>{connection.latestReportPeriod ? `Latest period: ${connection.latestReportPeriod.start} to ${connection.latestReportPeriod.end}` : "No report period recorded"}</small>
      <small>Last successful sync: {timestamp(connection.lastSuccessfulSyncAt)}</small>
      <small>Report environment: unverified</small>
      {connection.reviewReasons.length > 0 && <ul className="bookloq-ad-spend-reasons">{connection.reviewReasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
    </article>)}</div> : <p role="status">{source.status === "not_connected" ? "No connected Deel source is recorded for this scope." : "The payroll source status could not be verified. Review the connection before relying on its reports."}</p>}
    <details className="bookloq-ad-accounting"><summary>Source and accounting status</summary><p>{source.boundary}</p></details>
  </section>;
}
