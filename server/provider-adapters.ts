export type ProviderHealth =
  | "healthy"
  | "degraded"
  | "reauthorization_required"
  | "disconnected";
export type SyncCursor = {
  value: string | null;
  synchronizedThrough: string | null;
};

export type AuthorizationStart = {
  hostedAuthorizationUrl: string;
  state: string;
  expiresAt: string;
};

export type VerifiedConnection = {
  externalConnectionId: string;
  verified: true;
  consentExpiresAt: string | null;
  scopes: string[];
};

export interface SecureProviderAdapter<NormalizedRecord> {
  readonly providerId: string;
  readonly regions: readonly string[];
  beginAuthorization(input: {
    organizationId: string;
    redirectUri: string;
  }): Promise<AuthorizationStart>;
  completeAuthorization(input: {
    organizationId: string;
    code: string;
    state: string;
  }): Promise<VerifiedConnection>;
  refreshConnection(input: {
    organizationId: string;
    connectionId: string;
  }): Promise<ProviderHealth>;
  backfill(input: {
    organizationId: string;
    connectionId: string;
    from: string;
    to: string;
  }): Promise<NormalizedRecord[]>;
  synchronize(input: {
    organizationId: string;
    connectionId: string;
    cursor: SyncCursor;
  }): Promise<{ records: NormalizedRecord[]; cursor: SyncCursor }>;
  verifyWebhook(input: {
    headers: Headers;
    rawBody: ArrayBuffer;
  }): Promise<{ eventId: string; eventType: string; connectionId: string }>;
  disconnect(input: {
    organizationId: string;
    connectionId: string;
  }): Promise<void>;
}

export type NormalizedPosRecord = {
  externalId: string;
  occurredAt: string;
  locationExternalId: string | null;
  currency: string;
  grossAmountMinor: number;
  netAmountMinor: number;
  taxAmountMinor: number;
  discountAmountMinor: number;
  refundAmountMinor: number;
  sourceUpdatedAt: string;
};

export type NormalizedBankRecord = {
  externalId: string;
  accountExternalId: string;
  postedAt: string;
  pending: boolean;
  description: string;
  amountMinor: number;
  currency: string;
  sourceUpdatedAt: string;
};

export interface PosAdapter extends SecureProviderAdapter<NormalizedPosRecord> {
  capabilities(): Promise<{
    transactions: boolean;
    lineItems: boolean;
    inventory: boolean;
    customers: boolean;
    employees: boolean;
    payouts: boolean;
  }>;
}

export interface BankingAdapter
  extends SecureProviderAdapter<NormalizedBankRecord> {
  coverage(input: {
    country: string;
    institutionId?: string;
    accountType?: string;
  }): Promise<{
    supported: boolean;
    productionAvailable: boolean;
    consentModel: string;
    reason?: string;
  }>;
  accounts(input: {
    organizationId: string;
    connectionId: string;
  }): Promise<
    Array<{
      externalId: string;
      name: string;
      type: string;
      currency: string;
      currentBalanceMinor: number | null;
      availableBalanceMinor: number | null;
      availableCreditMinor: number | null;
    }>
  >;
}

export interface DocumentExtractionAdapter {
  readonly providerId: string;
  extract(input: {
    organizationId: string;
    objectKey: string;
    contentType: string;
  }): Promise<{
    providerRunId: string;
    fields: Record<
      string,
      { value: string | number | null; confidenceBasisPoints: number }
    >;
    lines: Array<
      Record<
        string,
        { value: string | number | null; confidenceBasisPoints: number }
      >
    >;
  }>;
}

export interface MalwareScanAdapter {
  readonly providerId: string;
  scan(input: {
    organizationId: string;
    objectKey: string;
    sha256Hex: string;
  }): Promise<{
    verdict: "clean" | "malicious" | "unknown";
    providerRunId: string;
  }>;
}

export interface AddressValidationAdapter {
  readonly providerId: string;
  readonly regions: readonly string[];
  suggest(input: {
    country: string;
    query: string;
    sessionToken: string;
  }): Promise<Array<{ providerRef: string; label: string }>>;
  validate(input: {
    country: string;
    providerRef?: string;
    entered: Record<string, string>;
  }): Promise<{
    status: "entered" | "suggested" | "validated" | "undeliverable" | "unknown";
    standardized: Record<string, string>;
    latitude: number | null;
    longitude: number | null;
  }>;
}
