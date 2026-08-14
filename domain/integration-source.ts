export const LEGACY_SOURCE_NAMESPACE = "legacy";

const MULTI_ACCOUNT_PROVIDER_IDS = new Set(["lightspeed", "lightspeed-r", "square", "clover", "stripe", "google", "meta"]);

export function supportsMultipleProviderAccounts(providerId: string) {
  return MULTI_ACCOUNT_PROVIDER_IDS.has(providerId);
}

export function integrationActionKey(providerId: string, connectionId?: string | null) {
  return `${providerId}:${connectionId ?? "new"}`;
}

export function scopeExternalRef(namespace: string, externalRef: string | null) {
  if (!externalRef) return null;
  return namespace === LEGACY_SOURCE_NAMESPACE ? externalRef : `${namespace}:${externalRef}`;
}

export function unscopedExternalRef(namespace: string, storedRef: string | null) {
  if (!storedRef || namespace === LEGACY_SOURCE_NAMESPACE) return storedRef;
  const prefix = `${namespace}:`;
  return storedRef.startsWith(prefix) ? storedRef.slice(prefix.length) : storedRef;
}

type ConnectionState = {
  status: string;
  dataPromotionStatus: string;
  lastSuccessfulSyncAt: string | null;
  lastErrorCode: string | null;
};

type MetricSourceConnection = {
  provider: string;
  sourceNamespace: string;
  status: string;
  dataPromotionStatus: string;
};

const METRIC_PROVIDER_IDS = new Set([
  "lightspeed",
  "lightspeed-r",
  "shopify",
  "shopify-pos",
  "square",
  "clover",
  "moneris",
]);

export function isTrustedMetricLocationRef(
  locationRef: string,
  connections: MetricSourceConnection[],
) {
  const provider = [...METRIC_PROVIDER_IDS].find((candidate) =>
    locationRef.startsWith(`${candidate}:`),
  );
  if (!provider) return true;
  const providerConnections = connections.filter(
    (connection) => connection.provider === provider,
  );
  const namespaced = providerConnections.filter(
    (connection) =>
      connection.sourceNamespace !== LEGACY_SOURCE_NAMESPACE &&
      locationRef.startsWith(`${provider}:${connection.sourceNamespace}:`),
  );
  if (namespaced.length) {
    return namespaced.some(
      (connection) =>
        connection.status === "connected" &&
        connection.dataPromotionStatus === "approved",
    );
  }
  const legacy = providerConnections.filter(
    (connection) => connection.sourceNamespace === LEGACY_SOURCE_NAMESPACE,
  );
  return legacy.some(
    (connection) =>
      connection.status === "connected" &&
      connection.dataPromotionStatus === "approved",
  );
}

export function aggregateConnectionStatus(connections: ConnectionState[]) {
  const connected = connections.filter((connection) => connection.status === "connected");
  const latestSync = connections
    .map((connection) => connection.lastSuccessfulSyncAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
  return {
    status: connected.length ? "connected" : connections.some((connection) => connection.status === "pending") ? "pending" : connections.some((connection) => connection.status === "error") ? "error" : "not_connected",
    dataPromotionStatus: connected.some((connection) => connection.dataPromotionStatus === "approved") ? "approved" : connected.length ? "staging" : "blocked",
    lastSuccessfulSyncAt: latestSync,
    lastErrorCode: connections.find((connection) => connection.lastErrorCode)?.lastErrorCode ?? null,
    connectedCount: connected.length,
  };
}
