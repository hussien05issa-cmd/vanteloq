// Public rollout is separate from credentials and a customer's saved connection.
// Remove a provider only after its public access and reporting path are verified.
export const PREVIEW_INTEGRATION_IDS: readonly string[] = ["clover", "moneris", "quickbooks", "shopify", "shopify-pos", "meta"];

type Provider = {
  id?: string;
  availability: string;
  providerReadiness: null | { credentialsConfigured: boolean; mode: string; liveDataEligible?: boolean; ledgerImportEnabled?: boolean };
};

export type CustomerIntegrationAvailability = {
  comingSoon: boolean;
  canStartConnection: boolean;
  previewAccess: boolean;
};

export function hasConnectionAttention(provider: { status: string; lastErrorCode?: string | null; connections?: readonly { status: string; lastErrorCode?: string | null }[] }) {
  return provider.status === "error" || Boolean(provider.lastErrorCode)
    || Boolean(provider.connections?.some(connection => connection.status === "error" || connection.lastErrorCode));
}

/** Presentation only. Existing authorization, consent and reporting guards remain mandatory. */
export function customerIntegrationAvailability(provider: Provider, authorizedPreview = false): CustomerIntegrationAvailability {
  const ready = provider.providerReadiness;
  const configured = ready?.credentialsConfigured === true;
  const built = !["coming_soon", "provider_build_required", "provider_selection_required", "provider_access_required"].includes(provider.availability);
  const publicReady = built && configured && !PREVIEW_INTEGRATION_IDS.includes(provider.id ?? "")
    && ready?.ledgerImportEnabled !== false
    && (provider.id !== "plaid" || (ready?.mode === "production" && ready.liveDataEligible === true));
  return { comingSoon: !publicReady, canStartConnection: built && configured && (publicReady || authorizedPreview), previewAccess: built && !publicReady && authorizedPreview };
}
