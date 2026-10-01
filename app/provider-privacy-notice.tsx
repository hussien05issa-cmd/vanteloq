"use client";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { providerPrivacy, privacyProvider } from "../domain/provider-privacy";
import { useModalFocus } from "./use-modal-focus";
import "./provider-privacy-notice.css";

export function ProviderPolicyLinks({ provider }: { provider: string }) {
  const key = privacyProvider(provider);
  if (!key) return null;
  const policy = providerPrivacy[key];
  return <span className="provider-policy-links">By authorising this connection, I agree to the data use described in <a href="/privacy#financial-connections" target="_blank" rel="noopener noreferrer">Vanteloq’s Privacy Policy</a> and acknowledge <a href={policy.url} target="_blank" rel="noopener noreferrer">{policy.name}’s Privacy Policy</a>. Both links open in a new tab.</span>;
}
export default function ProviderPrivacyNotice({ provider, onComplete }: { provider: string; onComplete: (accepted: boolean) => void }) {
  const [accepted, setAccepted] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useModalFocus(ref, true, () => onComplete(false));
  const key = privacyProvider(provider);
  if (!key) return null;
  return createPortal(<div className="provider-privacy-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onComplete(false); }}><section className="provider-privacy-dialog" ref={ref} role="dialog" aria-modal="true" aria-labelledby="provider-privacy-heading" tabIndex={-1}><header><div><small>YOUR CONNECTION, YOUR CHOICE</small><h2 id="provider-privacy-heading">Connect {providerPrivacy[key].name}</h2></div><button aria-label="Close privacy notice" onClick={() => onComplete(false)}>×</button></header><p>Review the privacy policies before continuing. You will choose the account and review the permissions on the provider’s next screen. Only connect an account you are authorised to manage.</p><label><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)}/><ProviderPolicyLinks provider={provider}/></label><p className="provider-privacy-footnote">You can disconnect in Integrations. Disconnection stops future access; reviewed accounting records may remain under the retention policy. This consent does not enable optional background sync or send messages.</p><footer><button onClick={() => onComplete(false)}>Cancel</button><button className="primary" disabled={!accepted} onClick={() => onComplete(true)}>Agree & Continue</button></footer></section></div>, document.body);
}
