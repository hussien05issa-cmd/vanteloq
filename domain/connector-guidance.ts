import { customerIntegrationAvailability } from "./integration-availability";

type ConnectionEvidence = {
  status: string;
  dataPromotionStatus: string;
  lastSuccessfulSyncAt: string | null;
  lastErrorCode?: string | null;
  reportingEnvironment?: "production" | "sandbox" | "unverified" | null;
  syncActive?: boolean;
  automaticSync?: null | {
    configured: boolean;
    healthy: boolean;
    enabled: boolean;
    status: string;
    lastErrorCode: string | null;
    intervalMinutes: number;
  };
};

export type Connector = ConnectionEvidence & {
  id?: string;
  name: string;
  category: string;
  availability: string;
  providerReadiness: null | { credentialsConfigured: boolean; mode: string; liveDataEligible?: boolean; ledgerImportEnabled?: boolean };
  connections?: readonly ConnectionEvidence[];
};

export type ConnectorHealthState = "coming_soon" | "not_connected" | "authorizing" | "setup_required" | "unknown"
  | "reauthorize" | "warning" | "test_only" | "verification_only" | "eligibility_required"
  | "initial_import" | "syncing" | "review_required" | "stale" | "synced" | "channel_authorized";

export type ConnectorHealth = {
  state: ConnectorHealthState;
  label: string;
  tone: "neutral" | "info" | "success" | "warning";
  detail: string;
  action: "connect" | "continue_authorization" | "reconnect" | "review_connection" | "import" | "review_data" | "view_data" | "view_channel" | null;
  actionLabel: string | null;
  lastSuccessfulSyncAt: string | null;
  freshness: "not_applicable" | "unknown" | "current" | "stale";
};

type HealthOptions = { now?: number; staleAfterMs?: number };
const REAUTHORIZE_ERROR = /(?:^|_)(?:REAUTHORIZATION_REQUIRED|REAUTH_REQUIRED|RECONNECT_REQUIRED|TOKEN_REVOKED|TOKEN_INVALID|TOKEN_EXPIRED|AUTHORIZATION_EXPIRED|ACCESS_REVOKED|NOT_CONNECTED)(?:_|$)/;
const HEALTH_PRIORITY: Record<ConnectorHealthState, number> = {
  reauthorize: 100, warning: 95, setup_required: 90, unknown: 85, test_only: 80,
  verification_only: 75, eligibility_required: 70, initial_import: 65, review_required: 60,
  stale: 55, syncing: 50, authorizing: 45, not_connected: 40, coming_soon: 35,
  channel_authorized: 10, synced: 10,
};

/** Presentation only. A successful authorization is not evidence of a completed or approved import. */
export function connectorHealth(provider: Connector, options: HealthOptions = {}): ConnectorHealth {
  const now = options.now ?? Date.now();
  const rawSync = provider.lastSuccessfulSyncAt;
  const syncTime = rawSync ? Date.parse(rawSync) : NaN;
  const lastSync = Number.isFinite(syncTime) && syncTime <= now ? rawSync : null;
  const isSlack = provider.id === "slack";
  const result = (state: ConnectorHealthState, label: string, tone: ConnectorHealth["tone"], detail: string,
    action: ConnectorHealth["action"] = null, actionLabel: string | null = null,
    freshness: ConnectorHealth["freshness"] = "unknown"): ConnectorHealth => ({
      state, label, tone, detail, action, actionLabel,
      lastSuccessfulSyncAt: isSlack ? null : lastSync, freshness: isSlack ? "not_applicable" : freshness,
    });

  // The aggregate's newest timestamp and approved flag must not hide a failed or unreviewed account.
  const accounts = provider.connections?.filter(account => account.status === "connected" || account.status === "error" || Boolean(account.lastErrorCode));
  if (accounts?.length) {
    const states = accounts.map(account => connectorHealth({ ...provider, ...account, connections: undefined }, options));
    const worst = states.reduce((current, candidate) => HEALTH_PRIORITY[candidate.state] > HEALTH_PRIORITY[current.state] ? candidate : current);
    if (accounts.length === 1) return worst;
    if (states.some(state => state.state !== worst.state)) return {
      ...worst, lastSuccessfulSyncAt: null, freshness: isSlack ? "not_applicable" : "unknown",
      detail: `${worst.detail} Review each account below; other accounts may have a different status.`,
    };
    // A provider-level date is the oldest successful account sync, never the newest sibling.
    const dates = states.map(state => state.lastSuccessfulSyncAt);
    const oldest = dates.every((date): date is string => date !== null)
      ? [...dates].sort((left, right) => Date.parse(left) - Date.parse(right))[0] : null;
    return { ...worst, lastSuccessfulSyncAt: oldest, freshness: states.every(state => state.freshness === worst.freshness) ? worst.freshness : "unknown" };
  }

  const error = provider.lastErrorCode || provider.automaticSync?.lastErrorCode;
  if (error && REAUTHORIZE_ERROR.test(error.toUpperCase())) return result("reauthorize", "Reconnect required", "warning", "Access has expired or been revoked. Reconnect this account before requesting new data.", "reconnect", "Reconnect account");
  if (provider.status === "error" || error) return result("warning", "Needs attention", "warning", "The latest connection or import needs review. Previously approved records remain separate from incomplete results.", "review_connection", "Review connection");
  if (provider.status !== "connected") {
    if (customerIntegrationAvailability(provider).comingSoon) return result("coming_soon", "Coming Soon", "neutral", "This connection is not available to all customers yet.");
    if (provider.status === "pending") return result("authorizing", "Authorization incomplete", "info", "Finish the provider's account and permission steps to authorize this connection.", "continue_authorization", "Continue connection");
    return result("not_connected", "Not connected", "neutral", "Connect the account that belongs to this business.", "connect", "Connect account");
  }
  const ready = provider.providerReadiness;
  if (!ready) return result("unknown", "Check connection", "neutral", "The latest provider status is unavailable. Refresh before starting an import.", "review_connection", "Check connection");
  if (!ready.credentialsConfigured) return result("setup_required", "Temporarily unavailable", "warning", "The provider connection is unavailable. Your saved records are unchanged.", "review_connection", "Review connection");
  if (isSlack) return result("channel_authorized", "Channel authorized", "success", "One Slack channel is authorized. Vanteloq cannot read conversations or files. Automatic alerts are not enabled.", "view_channel", "View channel settings");
  if (ready.ledgerImportEnabled === false) return result("verification_only", "Company verified only", "neutral", "The company is authorized. Ledger imports are not enabled, so this connection does not populate BookLoQ or business reports.", "review_connection", "Review connection");
  if (provider.reportingEnvironment === "sandbox" || /(?:^|_)(?:sandbox|development|test)(?:_|$)/i.test(ready.mode)) return result("test_only", "Test data only", "info", "This account uses test data. It is excluded from live business results.", "review_connection", "Review test account");
  if (provider.reportingEnvironment === "unverified") return result("eligibility_required", "Account review required", "warning", "This account has not been verified for production reporting. Review its environment and source records first.", "review_connection", "Review account");
  const automatic = provider.automaticSync;
  if (provider.syncActive || (automatic?.enabled && ["running", "backfilling", "waiting"].includes(automatic.status))) {
    const firstImport = !lastSync || automatic?.status === "backfilling";
    return result(firstImport ? "initial_import" : "syncing", firstImport ? "Importing records" : "Syncing", "info", firstImport
      ? "The import is in progress. Incomplete or unreviewed records are not treated as complete business results."
      : "An update is in progress. The last completed import remains visible until new records pass their checks.");
  }
  if (provider.category === "Marketing" && provider.dataPromotionStatus !== "approved") return result("review_required", "Resource review required", "info", "Select this business's properties or accounts, then review the imported sample. Unreviewed data stays excluded.", "review_data", "Select and review resources");
  if (ready.liveDataEligible === false) return result("eligibility_required", "Reporting not enabled", "info", "Authorization is complete. Provider requirements and account checks must be completed before records can enter reports.", "review_connection", "Review requirements");
  if (!lastSync) return result("initial_import", "Import and review", "info", "Authorization is complete. Select the correct account or location, then run the first supported import.", "import", "Import records");
  if (provider.dataPromotionStatus !== "approved") return result("review_required", "Review imported records", "info", "The import has completed. Review mappings, totals and warnings before approving eligible records for reports.", "review_data", "Review source data");
  if (automatic?.enabled && (!automatic.configured || !automatic.healthy || ["retrying", "attention", "paused"].includes(automatic.status))) return result("warning", "Updates need attention", "warning", "Automatic updates are delayed or paused. Review the connection and last completed import.", "review_connection", "Review updates");
  // Do not invent a freshness promise for manual imports. Scheduled accounts use a two-interval grace period.
  const cadence = automatic?.enabled && automatic.intervalMinutes > 0 ? automatic.intervalMinutes * 120_000 : null;
  const threshold = options.staleAfterMs ?? cadence;
  const measured = threshold !== null && Number.isFinite(threshold) && threshold > 0;
  if (measured && now - syncTime > threshold) return result("stale", "Update overdue", "warning", "The last completed import is older than the expected refresh window. Refresh the source before relying on current-period results.", "import", "Refresh records", "stale");
  return result("synced", "Synced", "success", measured
    ? "The last completed import is within the expected refresh window. Review account coverage before relying on individual metrics."
    : "Approved records are available from the last completed import. Check its date and coverage before relying on current-period results.", "view_data", "View source data", measured ? "current" : "unknown");
}

export function filterConnectors<T extends { name: string; category: string }>(providers: readonly T[], query: string, category: string): T[] {
  const search = query.trim().toLocaleLowerCase();
  return providers.filter(provider => (category === "All categories" || provider.category === category)
    && (!search || `${provider.name} ${provider.category}`.toLocaleLowerCase().includes(search)));
}

/** Guidance only. Authorization and promotion remain enforced by the server. */
export function connectorNextStep(provider: Connector, entitled: boolean, canManage: boolean) {
  const health = connectorHealth(provider);
  if (health.state === "reauthorize") return { stage: "Reconnect account", detail: health.detail };
  if (provider.status === "error") return { stage: "Repair connection", detail: "Your connection needs attention. Review its error and restore access before using new results." };
  if (provider.status !== "connected" && customerIntegrationAvailability(provider).comingSoon) {
    return { stage: "Coming Soon", detail: "Use an available connection or add your records with a supported file import." };
  }
  if (!entitled) return { stage: "Plan access", detail: "Review the required plan or add-on before authorizing this provider." };
  if (!canManage) return { stage: "Owner action", detail: "Ask an owner or authorized integration manager to complete setup. You can review status here." };
  if (!provider.providerReadiness) return { stage: "Check status", detail: "Live readiness has not been confirmed. Refresh the connection status before continuing." };
  if (!provider.providerReadiness.credentialsConfigured) return { stage: "Provider setup", detail: "This connection is temporarily unavailable. Your saved records are unchanged. Contact support if it does not recover." };

  if (provider.status !== "connected") return { stage: "Authorize account", detail: "Use the connection control below, review consent and select the correct business account." };
  if (health.state === "warning") return { stage: "Review connection", detail: health.detail };
  if (provider.id === "slack") return { stage: "Channel authorized", detail: health.detail };
  if (provider.providerReadiness.ledgerImportEnabled === false) return { stage: "Company verification only", detail: "The company is authorized, but ledger imports are not available yet. This connection does not populate BookLoQ or business reports." };
  if (health.state === "test_only") return { stage: "Test data only", detail: health.detail };
  if (health.state === "eligibility_required") return { stage: "Review data eligibility", detail: health.detail };
  if ((health.state === "initial_import" && health.action === null) || health.state === "syncing") return { stage: "Import in progress", detail: health.detail };
  if (provider.category === "Marketing" && provider.dataPromotionStatus !== "approved") {
    return { stage: "Select and review resources", detail: "Choose this business's exact properties or accounts, then review a sample before enabling reports. Unreviewed data stays excluded." };
  }
  if (provider.providerReadiness.liveDataEligible === false) return { stage: "Review data eligibility", detail: "Live reporting has not been verified. Review the provider's requirements and account checks before using its results." };
  if (health.state === "initial_import") return { stage: "Import and review", detail: health.detail };
  if (health.state === "review_required" || provider.dataPromotionStatus !== "approved") return { stage: "Review source data", detail: "An import exists. Review mappings, totals and outstanding checks for each account before approving eligible records." };
  if (health.state === "stale") return { stage: "Refresh records", detail: health.detail };
  return { stage: "Monitor freshness", detail: "Approved records are available. Check the latest sync, coverage and any account-level warnings before relying on results." };
}
