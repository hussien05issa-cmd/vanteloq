"use client";

import { useEffect, useRef, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { apiFetch } from "./supabase-browser";
import {
  PLAID_CONSENT_NOTICE_VERSION,
  PLAID_DATA_CATEGORIES,
  PLAID_PROCESSING_PURPOSES,
  PRIVACY_POLICY_VERSION,
} from "../domain/privacy-controls";

export const PLAID_LINK_TOKEN_STORAGE_KEY = "vanteloq:plaid-link-token";
export const PLAID_LINK_MODE_STORAGE_KEY = "vanteloq:plaid-link-mode";
export const PLAID_LINK_EXPIRATION_STORAGE_KEY = "vanteloq:plaid-link-expiration";
export const PLAID_REDIRECT_STORAGE_KEY = "vanteloq:plaid-redirect-uri";
export const PLAID_CONSENT_STORAGE_KEY = "vanteloq:plaid-consent-record";

type LinkMode = "connect" | "update";

function apiMessage(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error?: { message?: string } }).error;
    if (error?.message) return error.message;
  }
  return fallback;
}

function clearPlaidLinkState() {
  sessionStorage.removeItem(PLAID_LINK_TOKEN_STORAGE_KEY);
  sessionStorage.removeItem(PLAID_LINK_MODE_STORAGE_KEY);
  sessionStorage.removeItem(PLAID_LINK_EXPIRATION_STORAGE_KEY);
  sessionStorage.removeItem(PLAID_REDIRECT_STORAGE_KEY);
  sessionStorage.removeItem(PLAID_CONSENT_STORAGE_KEY);
  const url = new URL(window.location.href);
  url.searchParams.delete("oauth_state_id");
  if (url.searchParams.get("integration") === "plaid") url.searchParams.delete("integration");
  if (url.searchParams.get("connection") === "resume") url.searchParams.delete("connection");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function readPlaidResumeState(): { token: string; mode: LinkMode; redirect: string; consentRecordId: string } | { expired: true } | null {
  if (typeof window === "undefined") return null;
  const redirect = sessionStorage.getItem(PLAID_REDIRECT_STORAGE_KEY)
    || (new URL(window.location.href).searchParams.has("oauth_state_id") ? window.location.href : "");
  if (!redirect) return null;
  const token = sessionStorage.getItem(PLAID_LINK_TOKEN_STORAGE_KEY);
  const mode = sessionStorage.getItem(PLAID_LINK_MODE_STORAGE_KEY);
  const consentRecordId = sessionStorage.getItem(PLAID_CONSENT_STORAGE_KEY);
  const expiration = Date.parse(sessionStorage.getItem(PLAID_LINK_EXPIRATION_STORAGE_KEY) ?? "");
  if (!token || !consentRecordId || (mode !== "connect" && mode !== "update") || !Number.isFinite(expiration) || expiration <= Date.now()) {
    return { expired: true };
  }
  return { token, mode, redirect, consentRecordId };
}

export default function PlaidLinkButton({ connected, repairRequired, configured, canManage, deletionAvailable, onChanged, showNotice }: {
  connected: boolean;
  repairRequired: boolean;
  configured: boolean;
  canManage: boolean;
  deletionAvailable: boolean;
  onChanged: () => Promise<void>;
  showNotice: (message: string) => void;
}) {
  const [resumeState] = useState(readPlaidResumeState);
  const validResume = resumeState && "token" in resumeState ? resumeState : null;
  const [linkToken, setLinkToken] = useState<string | null>(validResume?.token ?? null);
  const [linkMode, setLinkMode] = useState<LinkMode>(validResume?.mode ?? "connect");
  const [consentRecordId, setConsentRecordId] = useState<string | null>(validResume?.consentRecordId ?? null);
  const [receivedRedirectUri, setReceivedRedirectUri] = useState<string | null>(validResume?.redirect ?? null);
  const openWhenReady = useRef(Boolean(validResume));
  const resumeErrorReported = useRef(false);
  const [busy, setBusy] = useState<"prepare" | "exchange" | "sync" | "disconnect" | "delete-data" | "">("");
  const [consentDialog, setConsentDialog] = useState<LinkMode | null>(null);
  const [consentChecked, setConsentChecked] = useState(false);

  const finish = () => {
    clearPlaidLinkState();
    openWhenReady.current = false;
    setReceivedRedirectUri(null);
    setConsentRecordId(null);
    setLinkToken(null);
  };

  const { open, ready } = usePlaidLink({
    token: linkToken,
    receivedRedirectUri: receivedRedirectUri ?? undefined,
    onSuccess: (publicToken) => {
      setBusy(linkMode === "update" ? "sync" : "exchange");
      const request = linkMode === "update"
        ? apiFetch("/api/v1/integrations/plaid/sync", { method: "POST" })
        : apiFetch("/api/v1/integrations/plaid/exchange", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ publicToken, consentRecordId }),
          });
      void request.then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(apiMessage(body, linkMode === "update" ? "The bank connection could not be repaired." : "The bank connection could not be completed."));
        if (linkMode === "update") {
          showNotice("Bank access repaired and the reviewed feed synchronized");
        } else if (body.syncWarning) {
          showNotice(body.syncWarning);
        } else {
          showNotice(`${body.accountsImported ?? 0} financial accounts connected for review`);
        }
        await onChanged();
      }).catch((caught) => showNotice(caught instanceof Error ? caught.message : "The bank connection could not be completed."))
        .finally(() => { setBusy(""); finish(); });
    },
    onExit: (error) => {
      if (error) showNotice("The bank connection was not completed. You can safely try again.");
      finish();
    },
  });

  useEffect(() => {
    if (!resumeState || !("expired" in resumeState) || resumeErrorReported.current) return;
    resumeErrorReported.current = true;
    clearPlaidLinkState();
    showNotice("The secure bank session expired. Start the connection again.");
  }, [resumeState, showNotice]);

  useEffect(() => {
    if (!ready || !openWhenReady.current || !linkToken) return;
    openWhenReady.current = false;
    open();
  }, [linkToken, open, ready]);

  const prepare = async (mode: LinkMode) => {
    setBusy("prepare");
    try {
      const response = await apiFetch("/api/v1/integrations/plaid/link-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          consentAcknowledged: true,
          noticeVersion: PLAID_CONSENT_NOTICE_VERSION,
          privacyPolicyVersion: PRIVACY_POLICY_VERSION,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(apiMessage(body, "A secure Plaid Link session could not be created."));
      sessionStorage.setItem(PLAID_LINK_TOKEN_STORAGE_KEY, body.linkToken);
      sessionStorage.setItem(PLAID_LINK_MODE_STORAGE_KEY, mode);
      sessionStorage.setItem(PLAID_LINK_EXPIRATION_STORAGE_KEY, body.expiration);
      sessionStorage.setItem(PLAID_CONSENT_STORAGE_KEY, body.consentRecordId);
      setLinkMode(mode);
      setConsentRecordId(body.consentRecordId);
      setReceivedRedirectUri(null);
      openWhenReady.current = true;
      setLinkToken(body.linkToken);
    } catch (caught) {
      showNotice(caught instanceof Error ? caught.message : "A secure Plaid Link session could not be created.");
    } finally {
      setBusy("");
    }
  };

  const action = async (type: "sync" | "disconnect") => {
    if (type === "disconnect" && !window.confirm("Disconnect Plaid? Bank access will be revoked and encrypted tokens deleted. Reviewed accounting history will remain.")) return;
    setBusy(type);
    try {
      const response = await apiFetch(`/api/v1/integrations/plaid/${type}`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(apiMessage(body, `Plaid ${type} could not be completed.`));
      showNotice(type === "sync" ? `${body.sync?.added ?? 0} new bank transactions imported for review` : "Plaid access revoked and encrypted tokens deleted");
      await onChanged();
    } catch (caught) {
      showNotice(caught instanceof Error ? caught.message : `Plaid ${type} could not be completed.`);
    } finally {
      setBusy("");
    }
  };

  const authorizeAfterConsent = () => {
    if (!consentDialog || !consentChecked) return;
    const mode = consentDialog;
    setConsentDialog(null);
    setConsentChecked(false);
    void prepare(mode);
  };

  const deleteRetainedData = async () => {
    const confirmation = window.prompt("This permanently deletes unreviewed Plaid imports and removes bank identifiers from accounting records that must remain. Type DELETE PLAID DATA to continue.");
    if (confirmation === null) return;
    setBusy("delete-data");
    try {
      const response = await apiFetch("/api/v1/integrations/plaid/delete-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(apiMessage(body, "The Plaid data-deletion request could not be completed."));
      showNotice(`${body.importedTransactionsDeleted ?? 0} unreviewed imports deleted; retained accounting records de-identified`);
      await onChanged();
    } catch (caught) {
      showNotice(caught instanceof Error ? caught.message : "The Plaid data-deletion request could not be completed.");
    } finally {
      setBusy("");
    }
  };

  const consentModal = consentDialog ? (
    <div className="plaid-consent-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setConsentDialog(null); }}>
      <section className="plaid-consent-dialog" role="dialog" aria-modal="true" aria-labelledby="plaid-consent-title" aria-describedby="plaid-consent-summary">
        <header>
          <div><span>FINANCIAL DATA AUTHORIZATION</span><h3 id="plaid-consent-title">Choose what Vanteloq may use.</h3></div>
          <button type="button" aria-label="Close financial data notice" onClick={() => setConsentDialog(null)}>×</button>
        </header>
        <p id="plaid-consent-summary">Plaid will ask you to choose a financial institution and eligible business accounts. Vanteloq receives read-only records only after you authorize them in Plaid Link. Vanteloq cannot move money or make payments.</p>
        <div className="plaid-consent-grid">
          <div><h4>Data requested</h4><ul>{PLAID_DATA_CATEGORIES.map((item) => <li key={item}>{item}</li>)}</ul></div>
          <div><h4>Why it is used</h4><ul>{PLAID_PROCESSING_PURPOSES.map((item) => <li key={item}>{item}</li>)}</ul></div>
        </div>
        <p className="plaid-consent-retention">Encrypted provider credentials are deleted when you disconnect. You can then request deletion of unreviewed imported data. Approved, reconciled, or posted accounting fields may be retained where required, with bank identifiers and descriptions removed.</p>
        <label className="plaid-consent-check">
          <input type="checkbox" checked={consentChecked} onChange={(event) => setConsentChecked(event.target.checked)} />
          <span>I authorize Vanteloq to collect, process, and store the selected read-only financial data for the purposes above. I understand that I can withdraw access.</span>
        </label>
        <p className="plaid-consent-links"><a href="/privacy#financial-connections" target="_blank" rel="noreferrer">Privacy Policy</a><a href="/privacy#retention" target="_blank" rel="noreferrer">Retention and deletion</a></p>
        <footer><button type="button" onClick={() => setConsentDialog(null)}>Cancel</button><button type="button" className="primary" disabled={!consentChecked} title={!consentChecked ? "Accept the financial data authorization to continue." : "Continue to Plaid Link."} onClick={authorizeAfterConsent}>Continue to Plaid</button></footer>
      </section>
    </div>
  ) : null;

  if (!connected) return (
    <>
      <div className="plaid-connect-actions">
        <button onClick={() => setConsentDialog(repairRequired ? "update" : "connect")} disabled={!configured || !canManage || Boolean(busy)} title={!canManage ? "Your role cannot manage financial connections." : !configured ? "Add the hosted Plaid settings before connecting." : repairRequired ? "Review the notice, then re-authenticate this institution through Plaid Link." : "Review the notice, then open Plaid Link to authorize read-only Transactions and Balance access."}>
          {busy === "prepare" ? "Preparing secure Link…" : repairRequired ? "Repair bank connection" : "Connect bank with Plaid"}
        </button>
        {deletionAvailable && <button className="danger-text" onClick={() => void deleteRetainedData()} disabled={!canManage || Boolean(busy)} title="Delete unreviewed Plaid imports and de-identify accounting records that must remain.">{busy === "delete-data" ? "Deleting…" : "Delete retained Plaid data"}</button>}
        <small>{repairRequired ? "Your saved bank records remain intact. Review the authorization notice before restoring access." : "Review the exact data categories, purposes, retention, and withdrawal choices before Plaid Link opens."}</small>
      </div>
      {consentModal}
    </>
  );
  return <div className="provider-actions plaid-provider-actions">
    <button onClick={() => void action("sync")} disabled={!canManage || Boolean(busy)}>{busy === "sync" ? "Syncing…" : "Sync bank feed"}</button>
    <button className="danger-text" onClick={() => void action("disconnect")} disabled={!canManage || Boolean(busy)}>{busy === "disconnect" ? "Disconnecting…" : "Disconnect"}</button>
  </div>;
}
