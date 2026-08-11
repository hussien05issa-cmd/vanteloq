"use client";

import { useEffect, useRef, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { apiFetch } from "./supabase-browser";

function apiMessage(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error?: { message?: string } }).error;
    if (error?.message) return error.message;
  }
  return fallback;
}

export default function PlaidLinkButton({ connected, configured, canManage, onChanged, showNotice }: {
  connected: boolean;
  configured: boolean;
  canManage: boolean;
  onChanged: () => Promise<void>;
  showNotice: (message: string) => void;
}) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const openWhenReady = useRef(false);
  const [busy, setBusy] = useState<"prepare" | "exchange" | "sync" | "disconnect" | "">("");
  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: (publicToken) => {
      setBusy("exchange");
      void apiFetch("/api/v1/integrations/plaid/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicToken, consentAcknowledged: true }),
      }).then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(apiMessage(body, "The bank connection could not be completed."));
        showNotice(`${body.accountsImported ?? 0} financial accounts connected for review`);
        await onChanged();
      }).catch((caught) => showNotice(caught instanceof Error ? caught.message : "The bank connection could not be completed."))
        .finally(() => { setBusy(""); setLinkToken(null); });
    },
    onExit: () => { setLinkToken(null); openWhenReady.current = false; },
  });

  useEffect(() => {
    if (!ready || !openWhenReady.current || !linkToken) return;
    openWhenReady.current = false;
    open();
  }, [linkToken, open, ready]);

  const prepare = async () => {
    setBusy("prepare");
    try {
      const response = await apiFetch("/api/v1/integrations/plaid/link-token", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(apiMessage(body, "A secure Plaid Link session could not be created."));
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
      <button onClick={() => void prepare()} disabled={!configured || !canManage || Boolean(busy)} title={!canManage ? "Your role cannot manage financial connections." : !configured ? "Add the hosted Plaid settings before connecting." : "Open Plaid Link to authorize read-only Transactions and Balance access."}>
        {busy === "prepare" ? "Preparing secure Link…" : "Connect bank with Plaid"}
      </button>
      <small>By continuing, the account owner asks Vanteloq and Plaid to access selected business account names, masked identifiers, balances and transactions for bookkeeping, reconciliation and preliminary cash analysis. Access can be revoked at any time.</small>
    </div>
  );
  return <div className="provider-actions plaid-provider-actions">
    <button onClick={() => void action("sync")} disabled={!canManage || Boolean(busy)}>{busy === "sync" ? "Syncing…" : "Sync bank feed"}</button>
    <button className="danger-text" onClick={() => void action("disconnect")} disabled={!canManage || Boolean(busy)}>{busy === "disconnect" ? "Disconnecting…" : "Disconnect"}</button>
  </div>;
}
