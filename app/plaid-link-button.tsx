"use client";

import { useEffect, useRef, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { apiFetch } from "./supabase-browser";

export const PLAID_LINK_TOKEN_STORAGE_KEY = "vanteloq:plaid-link-token";
export const PLAID_LINK_MODE_STORAGE_KEY = "vanteloq:plaid-link-mode";
export const PLAID_LINK_EXPIRATION_STORAGE_KEY = "vanteloq:plaid-link-expiration";
export const PLAID_REDIRECT_STORAGE_KEY = "vanteloq:plaid-redirect-uri";

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
  const url = new URL(window.location.href);
  url.searchParams.delete("oauth_state_id");
  if (url.searchParams.get("integration") === "plaid") url.searchParams.delete("integration");
  if (url.searchParams.get("connection") === "resume") url.searchParams.delete("connection");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function readPlaidResumeState(): { token: string; mode: LinkMode; redirect: string } | { expired: true } | null {
  if (typeof window === "undefined") return null;
  const redirect = sessionStorage.getItem(PLAID_REDIRECT_STORAGE_KEY)
    || (new URL(window.location.href).searchParams.has("oauth_state_id") ? window.location.href : "");
  if (!redirect) return null;
  const token = sessionStorage.getItem(PLAID_LINK_TOKEN_STORAGE_KEY);
  const mode = sessionStorage.getItem(PLAID_LINK_MODE_STORAGE_KEY);
  const expiration = Date.parse(sessionStorage.getItem(PLAID_LINK_EXPIRATION_STORAGE_KEY) ?? "");
  if (!token || (mode !== "connect" && mode !== "update") || !Number.isFinite(expiration) || expiration <= Date.now()) {
    return { expired: true };
  }
  return { token, mode, redirect };
}

export default function PlaidLinkButton({ connected, repairRequired, configured, canManage, onChanged, showNotice }: {
  connected: boolean;
  repairRequired: boolean;
  configured: boolean;
  canManage: boolean;
  onChanged: () => Promise<void>;
  showNotice: (message: string) => void;
}) {
  const [resumeState] = useState(readPlaidResumeState);
  const validResume = resumeState && "token" in resumeState ? resumeState : null;
  const [linkToken, setLinkToken] = useState<string | null>(validResume?.token ?? null);
  const [linkMode, setLinkMode] = useState<LinkMode>(validResume?.mode ?? "connect");
  const [receivedRedirectUri, setReceivedRedirectUri] = useState<string | null>(validResume?.redirect ?? null);
  const openWhenReady = useRef(Boolean(validResume));
  const resumeErrorReported = useRef(false);
  const [busy, setBusy] = useState<"prepare" | "exchange" | "sync" | "disconnect" | "">("");

  const finish = () => {
    clearPlaidLinkState();
    openWhenReady.current = false;
    setReceivedRedirectUri(null);
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
            body: JSON.stringify({ publicToken, consentAcknowledged: true }),
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
        body: JSON.stringify({ mode }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(apiMessage(body, "A secure Plaid Link session could not be created."));
      sessionStorage.setItem(PLAID_LINK_TOKEN_STORAGE_KEY, body.linkToken);
      sessionStorage.setItem(PLAID_LINK_MODE_STORAGE_KEY, mode);
      sessionStorage.setItem(PLAID_LINK_EXPIRATION_STORAGE_KEY, body.expiration);
      setLinkMode(mode);
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

  if (!connected) return (
    <div className="plaid-connect-actions">
      <button onClick={() => void prepare(repairRequired ? "update" : "connect")} disabled={!configured || !canManage || Boolean(busy)} title={!canManage ? "Your role cannot manage financial connections." : !configured ? "Add the hosted Plaid settings before connecting." : repairRequired ? "Re-authenticate this institution through Plaid Link." : "Open Plaid Link to authorize read-only Transactions and Balance access."}>
        {busy === "prepare" ? "Preparing secure Link…" : repairRequired ? "Repair bank connection" : "Connect bank with Plaid"}
      </button>
      <small>{repairRequired ? "Your saved bank records remain intact. Plaid will ask only for the access needed to restore this connection." : "By continuing, the account owner asks Vanteloq and Plaid to access selected business account names, masked identifiers, balances and transactions for bookkeeping, reconciliation and preliminary cash analysis. Access can be revoked at any time."}</small>
    </div>
  );
  return <div className="provider-actions plaid-provider-actions">
    <button onClick={() => void action("sync")} disabled={!canManage || Boolean(busy)}>{busy === "sync" ? "Syncing…" : "Sync bank feed"}</button>
    <button className="danger-text" onClick={() => void action("disconnect")} disabled={!canManage || Boolean(busy)}>{busy === "disconnect" ? "Disconnecting…" : "Disconnect"}</button>
  </div>;
}
