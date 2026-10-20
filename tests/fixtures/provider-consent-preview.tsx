import { useState } from "react";
import { createRoot } from "react-dom/client";
import ProviderPrivacyNotice from "../../app/provider-privacy-notice";
import { providerPrivacy, type PrivacyProvider } from "../../domain/provider-privacy";

function Fixture() {
  const [provider, setProvider] = useState<PrivacyProvider>("google");
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState("");
  const scopes = provider === "google" ? ["openid", "email", "https://www.googleapis.com/auth/analytics.readonly", "https://www.googleapis.com/auth/webmasters.readonly", "https://www.googleapis.com/auth/business.manage", ...(new URLSearchParams(location.search).has("noAds") ? [] : ["https://www.googleapis.com/auth/adwords"])] : undefined;
  return <main><h1>Connector notice verification</h1><p>Local interface fixture. No account connection, customer data or provider request.</p><label>Provider <select value={provider} onChange={event => setProvider(event.target.value as PrivacyProvider)}>{Object.keys(providerPrivacy).map(key => <option key={key}>{key}</option>)}</select></label><button type="button" onClick={() => { setResult(""); setOpen(true); }}>Review connection</button><p role="status">{result}</p>{open && <ProviderPrivacyNotice provider={provider} scopes={scopes} preview onComplete={accepted => { setResult(accepted ? "Acknowledgement accepted. No provider access requested." : "Cancelled. No provider access requested."); setOpen(false); }}/>}</main>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
