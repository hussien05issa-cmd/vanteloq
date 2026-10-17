"use client";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { WorkspaceAppearanceBoundary } from "./workspace-appearance";
import { providerPrivacy, privacyProvider } from "../domain/provider-privacy";
import { connectionDataUse, connectionPermissionSummary } from "../domain/provider-connection-notice";
import { useModalFocus } from "./use-modal-focus";
import "./provider-privacy-notice.css";

export function ProviderPolicyLinks({ provider }: { provider: string }) {
  const key = privacyProvider(provider);
  if (!key) return null;
  const policy = providerPrivacy[key];
  return <span className="provider-policy-links">I authorise the connection and data use described above and in <a href="/privacy#financial-connections" target="_blank" rel="noopener noreferrer">Vanteloq’s Privacy Policy</a>, and acknowledge <a href={policy.url} target="_blank" rel="noopener noreferrer">{policy.name}’s Privacy Policy</a>. Both links open in a new tab.</span>;
}

export function ProviderPermissionSummary({ provider, scopes }: { provider: string; scopes?: readonly string[] }) {
  const key = privacyProvider(provider);
  if (!key) return null;
  return <dl className="provider-permission-summary">{connectionPermissionSummary(key, scopes).map(row => <div key={row.title}><dt>{row.title}</dt><dd>{row.description}</dd></div>)}</dl>;
}

export default function ProviderPrivacyNotice({ provider, scopes, preview = false, onComplete }: { provider: string; scopes?: readonly string[]; preview?: boolean; onComplete: (accepted: boolean) => void }) {
  const [accepted, setAccepted] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useModalFocus(ref, true, () => onComplete(false));
  const key = privacyProvider(provider);
  if (!key) return null;
  const policy = providerPrivacy[key];
  const marketing = key === "google" || key === "meta";
  const slackRead = key === "slack" && scopes?.includes("channels:history");
  return createPortal(
    <WorkspaceAppearanceBoundary><div className="provider-privacy-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onComplete(false); }}>
      <section className="provider-privacy-dialog" ref={ref} role="dialog" aria-modal="true" aria-labelledby="provider-privacy-heading" aria-describedby="provider-privacy-summary" tabIndex={-1}>
        <header><div><small>YOUR CONNECTION, YOUR CHOICE{preview ? " · PREVIEW" : ""}</small><h2 id="provider-privacy-heading">Connect {policy.name}</h2></div><button type="button" aria-label="Close privacy notice" onClick={() => onComplete(false)}>×</button></header>
        <div className="provider-privacy-content">
          <p id="provider-privacy-summary">Review what this connection permits. Choose an account you are authorised to manage, then review {policy.name}’s own permission screen before granting access.</p>
          <ProviderPermissionSummary provider={key} scopes={scopes}/>
          <section className="provider-data-use"><h3>How your workspace uses it</h3><p>{slackRead ? "The workspace owner may manually load a recent page from the selected public channel. Slack grants broader public-channel scope where the app is a member, but Vanteloq restricts its reader to the installation’s selected channel. Make sure you have authority and have provided any required notices to channel members." : connectionDataUse(key)}</p>
            {slackRead && <p>Message text, Slack author identifiers and timestamps are held only in the open panel. They are not stored in team messages or sent to AI. No private channels, direct messages, shared channels, files or thread contents are read. Invite the app to the selected channel in Slack before loading messages.</p>}
            {marketing && <p>Selected identifiers, connection status and derived daily measurements are stored in your workspace. Detailed report responses are fetched on demand.{key === "google" && " Google Business Profile reports and reviews are excluded from stored marketing summaries and AI evidence."}</p>}
            <p>Connection credentials are encrypted. Only authorised workspace members can use the connected data within their access permissions. AI analysis requires its own data-use agreement.</p>
          </section>
          <p className="provider-privacy-footnote">Disconnect in Integrations to stop future access. {key === "slack" ? "Active Slack access is removed immediately. Encrypted material used only to finish provider removal may remain until cleanup succeeds or you confirm manual removal in Slack. It cannot send messages." : "Local connection credentials are removed."} Imported documents, reviewed accounting records and audit evidence may remain under the <a href="/privacy#retention" target="_blank" rel="noopener noreferrer">retention policy</a>. This acknowledgement does not enable optional background sync or send messages.</p>
          {scopes && scopes.length > 0 && <details className="provider-requested-permissions"><summary>Requested permissions</summary><ul>{scopes.map(scope => <li key={scope}>{scope}</li>)}</ul></details>}
          <label className="provider-privacy-check"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)}/><ProviderPolicyLinks provider={key}/></label>
        </div>
        <footer><button type="button" onClick={() => onComplete(false)}>Cancel</button><button type="button" className="primary" disabled={!accepted} onClick={() => { if (accepted) onComplete(true); }}>Agree & Continue</button></footer>
      </section>
    </div></WorkspaceAppearanceBoundary>, document.body,
  );
}
