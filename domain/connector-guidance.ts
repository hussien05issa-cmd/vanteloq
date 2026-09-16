type Connector = {
  name: string;
  category: string;
  status: string;
  availability: string;
  dataPromotionStatus: string;
  lastSuccessfulSyncAt: string | null;
  providerReadiness: null | { credentialsConfigured: boolean; mode: string; liveDataEligible?: boolean; ledgerImportEnabled?: boolean };
};

export function filterConnectors<T extends { name: string; category: string }>(providers: readonly T[], query: string, category: string): T[] {
  const search = query.trim().toLocaleLowerCase();
  return providers.filter(provider => (category === "All categories" || provider.category === category)
    && (!search || `${provider.name} ${provider.category}`.toLocaleLowerCase().includes(search)));
}

/** Guidance only. Authorization and promotion remain enforced by the server. */
export function connectorNextStep(provider: Connector, entitled: boolean, canManage: boolean) {
  if (provider.availability === "coming_soon" || provider.availability === "provider_build_required" || provider.availability === "provider_selection_required") {
    return { stage: "Unavailable", detail: "This connection is not ready to activate. Use a supported source or import a validated file." };
  }
  if (!entitled) return { stage: "Plan access", detail: "Review the required plan or add-on before authorizing this provider." };
  if (!canManage) return { stage: "Owner action", detail: "Ask an owner or authorized integration manager to complete setup. You can review status here." };
  if (!provider.providerReadiness) return { stage: "Check status", detail: "Live readiness has not been confirmed. Refresh the connection status before continuing." };
  if (!provider.providerReadiness.credentialsConfigured) return { stage: "Provider setup", detail: "Vanteloq still needs to finish this provider’s secure setup. You do not need to supply a platform secret key." };
  if (provider.status === "error") return { stage: "Repair connection", detail: "Review the connection error and restore authorization or retry the failed sync before using its results." };
  if (provider.status !== "connected") return { stage: "Authorize account", detail: "Use the connection control below, review consent and select the correct business account." };
  if (provider.providerReadiness.ledgerImportEnabled === false) return { stage: "Company verification only", detail: "The company is authorized, but ledger imports are not available yet. This connection does not populate BookLoQ or business reports." };
  if (provider.providerReadiness.liveDataEligible === false || /sandbox|staging|development/i.test(provider.providerReadiness.mode)) {
    return { stage: "Test data only", detail: "The connection is in a test environment. Its data must not be treated as live business results." };
  }
  if (!provider.lastSuccessfulSyncAt) return { stage: "Import and review", detail: "Authorization is complete. Finish any account or location selection, then run the first supported import." };
  if (provider.dataPromotionStatus !== "approved") return { stage: "Review source data", detail: "An import exists. Review mappings, totals and outstanding checks for each account before approving eligible records." };
  return { stage: "Monitor freshness", detail: "Approved records are available. Check the latest sync, coverage and any account-level warnings before relying on results." };
}
