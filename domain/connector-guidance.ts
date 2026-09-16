import { customerIntegrationAvailability } from "./integration-availability";

type Connector = {
  id?: string;
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
  if (provider.status === "error") return { stage: "Repair connection", detail: "Your connection needs attention. Review its error and restore access before using new results." };
  if (provider.status !== "connected" && customerIntegrationAvailability(provider).comingSoon) {
    return { stage: "Coming Soon", detail: "Use an available connection or add your records with a supported file import." };
  }
  if (!entitled) return { stage: "Plan access", detail: "Review the required plan or add-on before authorizing this provider." };
  if (!canManage) return { stage: "Owner action", detail: "Ask an owner or authorized integration manager to complete setup. You can review status here." };
  if (!provider.providerReadiness) return { stage: "Check status", detail: "Live readiness has not been confirmed. Refresh the connection status before continuing." };
  if (!provider.providerReadiness.credentialsConfigured) return { stage: "Provider setup", detail: "This connection is temporarily unavailable. Your saved records are unchanged. Contact support if it does not recover." };

  if (provider.status !== "connected") return { stage: "Authorize account", detail: "Use the connection control below, review consent and select the correct business account." };
  if (provider.providerReadiness.ledgerImportEnabled === false) return { stage: "Company verification only", detail: "The company is authorized, but ledger imports are not available yet. This connection does not populate BookLoQ or business reports." };
  if (/sandbox|staging|development/i.test(provider.providerReadiness.mode)) {
    return { stage: "Test data only", detail: "The connection is in a test environment. Its data must not be treated as live business results." };
  }
  if (provider.category === "Marketing" && provider.dataPromotionStatus !== "approved") {
    return { stage: "Select and review resources", detail: "Choose this business's exact properties or accounts, then review a sample before enabling reports. Unreviewed data stays excluded." };
  }
  if (provider.providerReadiness.liveDataEligible === false) return { stage: "Review data eligibility", detail: "Live reporting has not been verified. Review the provider's requirements and account checks before using its results." };
  if (!provider.lastSuccessfulSyncAt) return { stage: "Import and review", detail: "Authorization is complete. Finish any account or location selection, then run the first supported import." };
  if (provider.dataPromotionStatus !== "approved") return { stage: "Review source data", detail: "An import exists. Review mappings, totals and outstanding checks for each account before approving eligible records." };
  return { stage: "Monitor freshness", detail: "Approved records are available. Check the latest sync, coverage and any account-level warnings before relying on results." };
}
