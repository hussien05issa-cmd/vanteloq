import { and, eq } from "drizzle-orm";
import { getD1, getDb, getRuntimeEnv, type VanteloqRuntimeEnv } from "../../db/index.ts";
import {
  bankAccounts,
  financialAccounts,
  financialTransactions,
  integrationConnections,
  integrationSecrets,
} from "../../db/schema.ts";
import { ApiError } from "../api.ts";

export const PLAID_PROVIDER = "plaid";

export function plaidRequiresUserRepair(code: string) {
  return code === "ITEM_LOGIN_REQUIRED" || code === "PENDING_EXPIRATION" || code === "PENDING_DISCONNECT" || code === "USER_PERMISSION_REVOKED";
}

type PlaidEnv = Pick<VanteloqRuntimeEnv, "PLAID_CLIENT_ID" | "PLAID_SECRET" | "PLAID_ENV" | "PLAID_WEBHOOK_URL" | "PLAID_REDIRECT_URI" | "INTEGRATION_ENCRYPTION_KEY">;

type PlaidTransactionInput = {
  transaction_id: string;
  account_id: string;
  amount: number;
  iso_currency_code?: string | null;
  unofficial_currency_code?: string | null;
  date: string;
  authorized_date?: string | null;
  name: string;
  merchant_name?: string | null;
  pending: boolean;
  pending_transaction_id?: string | null;
};

type PlaidAccount = {
  account_id: string;
  name: string;
  official_name?: string | null;
  mask?: string | null;
  type: string;
  subtype?: string | null;
  balances: { available?: number | null; current?: number | null; iso_currency_code?: string | null };
};

const requiredConfiguration = [
  "PLAID_CLIENT_ID",
  "PLAID_SECRET",
  "PLAID_ENV",
  "PLAID_WEBHOOK_URL",
  "PLAID_REDIRECT_URI",
  "INTEGRATION_ENCRYPTION_KEY",
] as const;

export function plaidReadiness(env: PlaidEnv = getRuntimeEnv()) {
  const missingConfiguration = requiredConfiguration.filter((key) => !env[key]?.trim());
  const configuredMode = env.PLAID_ENV?.trim();
  const modeValid = configuredMode === "sandbox" || configuredMode === "development" || configuredMode === "production";
  if (configuredMode && !modeValid && !missingConfiguration.includes("PLAID_ENV")) missingConfiguration.push("PLAID_ENV");
  const mode = modeValid ? configuredMode : "unconfigured";
  return {
    adapterBuilt: true,
    credentialsConfigured: missingConfiguration.length === 0,
    missingConfiguration,
    mode,
    scopes: ["transactions", "balances"],
    dataPromotionEnabled: false,
    liveDataEligible: missingConfiguration.length === 0 && mode === "production",
  };
}

function configuration() {
  const env = getRuntimeEnv();
  const readiness = plaidReadiness(env);
  if (!readiness.credentialsConfigured) {
    throw new ApiError(503, "PLAID_NOT_CONFIGURED", `Plaid is unavailable until these hosted settings are configured: ${readiness.missingConfiguration.join(", ")}.`);
  }
  const hosts = {
    sandbox: "https://sandbox.plaid.com",
    development: "https://development.plaid.com",
    production: "https://production.plaid.com",
  } as const;
  return {
    clientId: env.PLAID_CLIENT_ID!,
    secret: env.PLAID_SECRET!,
    webhookUrl: cleanPlaidHttpsUrl(env.PLAID_WEBHOOK_URL!, "PLAID_WEBHOOK_URL_INVALID"),
    redirectUri: cleanPlaidHttpsUrl(env.PLAID_REDIRECT_URI!, "PLAID_REDIRECT_URI_INVALID"),
    encryptionKey: env.INTEGRATION_ENCRYPTION_KEY!,
    mode: readiness.mode as keyof typeof hosts,
    host: hosts[readiness.mode as keyof typeof hosts],
  };
}

function cleanPlaidHttpsUrl(value: string, code: string) {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new ApiError(503, code, "The configured Plaid URL is invalid.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
    throw new ApiError(503, code, "The configured Plaid URL must be a clean HTTPS URL.");
  }
  return parsed.toString();
}

async function plaidRequest<T>(path: string, payload: Record<string, unknown>, fetcher: typeof fetch = fetch): Promise<T> {
  const config = configuration();
  const response = await fetcher(`${config.host}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Plaid-Version": "2020-09-14" },
    body: JSON.stringify({ client_id: config.clientId, secret: config.secret, ...payload }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json() as T & { error_code?: string; error_message?: string };
  if (!response.ok || body.error_code) {
    throw new ApiError(response.status >= 500 ? 502 : 409, body.error_code || "PLAID_REQUEST_FAILED", body.error_message || "Plaid could not complete the request.");
  }
  return body;
}

function decodeBase64(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0));
}

function encodeBase64(value: Uint8Array) {
  return btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

async function encryptionKey() {
  const raw = decodeBase64(configuration().encryptionKey);
  if (raw.byteLength !== 32) throw new ApiError(503, "INTEGRATION_ENCRYPTION_KEY_INVALID", "The integration encryption key must decode to 32 bytes.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encrypt(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode("vanteloq:plaid:v1") },
    await encryptionKey(),
    new TextEncoder().encode(value),
  );
  return `v1.${encodeBase64(iv)}.${encodeBase64(new Uint8Array(ciphertext))}`;
}

async function decrypt(value: string) {
  const [version, encodedIv, encodedCiphertext] = value.split(".");
  if (version !== "v1" || !encodedIv || !encodedCiphertext) throw new ApiError(500, "PLAID_SECRET_INVALID", "Stored Plaid credentials could not be read.");
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: decodeBase64(encodedIv), additionalData: new TextEncoder().encode("vanteloq:plaid:v1") },
      await encryptionKey(),
      decodeBase64(encodedCiphertext),
    );
    return new TextDecoder().decode(plaintext);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, "PLAID_SECRET_DECRYPTION_FAILED", "Stored Plaid credentials could not be decrypted.");
  }
}

export function normalizePlaidTransaction(input: PlaidTransactionInput) {
  if (!input.transaction_id || !input.account_id || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isFinite(input.amount)) {
    throw new ApiError(502, "PLAID_TRANSACTION_INVALID", "Plaid returned an invalid transaction record.");
  }
  return {
    externalSourceId: input.transaction_id,
    externalAccountRef: input.account_id,
    transactionDate: input.authorized_date || input.date,
    postingDate: input.date,
    description: (input.merchant_name || input.name || "Bank transaction").slice(0, 500),
    originalDescription: (input.name || "Bank transaction").slice(0, 500),
    amountCents: Math.round(input.amount * -100),
    currency: (input.iso_currency_code || input.unofficial_currency_code || "CAD").slice(0, 3).toUpperCase(),
    sourceState: input.pending ? "pending" as const : "posted" as const,
    pendingExternalSourceId: input.pending_transaction_id || null,
    categorizationStatus: "missing" as const,
    confidenceBasisPoints: 0,
  };
}

async function plaidClientUserId(userId: string, organizationId: string) {
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`vanteloq:plaid:${organizationId}:${userId}`),
  ));
  return encodeBase64(digest);
}

export async function createPlaidLinkToken(
  userId: string,
  organizationId: string,
  mode: "connect" | "update" = "connect",
  fetcher: typeof fetch = fetch,
) {
  const config = configuration();
  const shared = {
    user: { client_user_id: await plaidClientUserId(userId, organizationId) },
    client_name: "Vanteloq BookLoQ",
    country_codes: ["CA"],
    language: "en",
    webhook: config.webhookUrl,
    redirect_uri: config.redirectUri,
  };
  if (mode === "update") {
    const current = await credentials(organizationId, ["connected", "error"]);
    return plaidRequest<{ link_token: string; expiration: string }>("/link/token/create", {
      ...shared,
      access_token: current.accessToken,
    }, fetcher);
  }
  return plaidRequest<{ link_token: string; expiration: string }>("/link/token/create", {
    ...shared,
    products: ["transactions"],
  }, fetcher);
}

function accountType(account: PlaidAccount): "chequing" | "savings" | "credit_card" | "line_of_credit" | "merchant" | "loan" | null {
  if (account.type === "depository") return account.subtype === "savings" ? "savings" : "chequing";
  if (account.type === "credit") return "credit_card";
  if (account.type === "loan") return account.subtype === "line of credit" ? "line_of_credit" : "loan";
  return null;
}

async function syncAccounts(
  organizationId: string,
  itemId: string,
  accessToken: string,
  institutionName: string,
  fetcher: typeof fetch = fetch,
) {
  const payload = await plaidRequest<{ accounts: PlaidAccount[] }>("/accounts/balance/get", { access_token: accessToken }, fetcher);
  const database = getDb();
  const now = new Date();
  let imported = 0;
  for (const account of payload.accounts ?? []) {
    const mappedType = accountType(account);
    if (!mappedType) continue;
    const systemKey = `plaid:${account.account_id}`;
    const [existingLedger] = await database.select({ id: financialAccounts.id }).from(financialAccounts).where(and(
      eq(financialAccounts.organizationId, organizationId),
      eq(financialAccounts.systemKey, systemKey),
    )).limit(1);
    const ledgerId = existingLedger?.id ?? crypto.randomUUID();
    const liability = account.type === "credit" || account.type === "loan";
    await database.insert(financialAccounts).values({
      id: ledgerId,
      organizationId,
      code: `PL-${account.account_id.slice(-8)}`,
      name: (account.official_name || account.name || "Connected account").slice(0, 160),
      accountType: liability ? "liability" : "asset",
      accountSubtype: mappedType,
      normalBalance: liability ? "credit" : "debit",
      systemKey,
      description: "Imported from an owner-authorized Plaid bank feed.",
      plainLanguage: "Connected bank or credit account",
      taxTreatment: "review_required",
      restricted: true,
      active: true,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({ target: [financialAccounts.organizationId, financialAccounts.systemKey], set: {
      name: (account.official_name || account.name || "Connected account").slice(0, 160),
      active: true,
      updatedAt: now,
    }});
    const toCents = (value: number | null | undefined) => typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) : null;
    await database.insert(bankAccounts).values({
      id: crypto.randomUUID(),
      organizationId,
      financialAccountId: ledgerId,
      name: (account.name || "Connected account").slice(0, 160),
      accountType: mappedType,
      institutionName,
      maskedNumber: account.mask ? `•••• ${account.mask.slice(-4)}` : "Protected",
      currency: (account.balances.iso_currency_code || "CAD").slice(0, 3).toUpperCase(),
      provider: PLAID_PROVIDER,
      externalAccountRef: account.account_id,
      externalItemRef: itemId,
      liveBalanceCents: toCents(account.balances.current),
      availableBalanceCents: toCents(account.balances.available),
      bookBalanceCents: 0,
      connectionStatus: "healthy",
      lastSyncAt: now,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({ target: [bankAccounts.organizationId, bankAccounts.provider, bankAccounts.externalAccountRef], set: {
      financialAccountId: ledgerId,
      name: (account.name || "Connected account").slice(0, 160),
      institutionName,
      maskedNumber: account.mask ? `•••• ${account.mask.slice(-4)}` : "Protected",
      currency: (account.balances.iso_currency_code || "CAD").slice(0, 3).toUpperCase(),
      liveBalanceCents: toCents(account.balances.current),
      availableBalanceCents: toCents(account.balances.available),
      connectionStatus: "healthy",
      lastSyncAt: now,
      updatedAt: now,
    }});
    imported += 1;
  }
  return imported;
}

export async function exchangePlaidPublicToken(organizationId: string, publicToken: string, fetcher: typeof fetch = fetch) {
  const exchange = await plaidRequest<{ access_token: string; item_id: string }>("/item/public_token/exchange", { public_token: publicToken }, fetcher);
  const item = await plaidRequest<{ item?: { institution_id?: string | null } }>("/item/get", { access_token: exchange.access_token }, fetcher);
  const institutionId = item.item?.institution_id?.trim() ?? "";
  let institutionName = "Connected financial institution";
  if (institutionId) {
    const institution = await plaidRequest<{ institution?: { name?: string | null } }>("/institutions/get_by_id", {
      institution_id: institutionId,
      country_codes: ["CA"],
    }, fetcher);
    const providerName = institution.institution?.name?.trim();
    if (providerName) institutionName = providerName.slice(0, 160);
  }
  const now = new Date();
  const database = getDb();
  await database.insert(integrationConnections).values({
    id: crypto.randomUUID(),
    organizationId,
    provider: PLAID_PROVIDER,
    status: "connected",
    externalAccountRef: exchange.item_id,
    externalAccountName: institutionName,
    scopesJson: JSON.stringify(["transactions", "balance"]),
    dataPromotionStatus: "staging",
    privacyDataDeletedAt: null,
    connectedAt: now,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({ target: [integrationConnections.organizationId, integrationConnections.provider], set: {
    status: "connected",
    externalAccountRef: exchange.item_id,
    externalAccountName: institutionName,
    scopesJson: JSON.stringify(["transactions", "balance"]),
    dataPromotionStatus: "staging",
    connectedAt: now,
    lastErrorCode: null,
    lastSyncCursor: null,
    privacyDataDeletedAt: null,
    updatedAt: now,
  }});
  await database.insert(integrationSecrets).values({
    id: crypto.randomUUID(),
    organizationId,
    provider: PLAID_PROVIDER,
    accessTokenCiphertext: await encrypt(exchange.access_token),
    refreshTokenCiphertext: await encrypt(exchange.item_id),
    tokenExpiresAt: new Date("2099-12-31T00:00:00Z"),
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({ target: [integrationSecrets.organizationId, integrationSecrets.provider], set: {
    accessTokenCiphertext: await encrypt(exchange.access_token),
    refreshTokenCiphertext: await encrypt(exchange.item_id),
    tokenExpiresAt: new Date("2099-12-31T00:00:00Z"),
    updatedAt: now,
  }});
  return { itemId: exchange.item_id, institutionName };
}

async function credentials(
  organizationId: string,
  allowedStatuses: Array<"connected" | "error"> = ["connected"],
) {
  const [row] = await getDb().select({
    accessToken: integrationSecrets.accessTokenCiphertext,
    itemId: integrationSecrets.refreshTokenCiphertext,
    cursor: integrationConnections.lastSyncCursor,
    institutionName: integrationConnections.externalAccountName,
    status: integrationConnections.status,
  }).from(integrationSecrets).innerJoin(integrationConnections, and(
    eq(integrationConnections.organizationId, integrationSecrets.organizationId),
    eq(integrationConnections.provider, integrationSecrets.provider),
  )).where(and(
    eq(integrationSecrets.organizationId, organizationId),
    eq(integrationSecrets.provider, PLAID_PROVIDER),
  )).limit(1);
  if (!row || !allowedStatuses.includes(row.status as "connected" | "error")) {
    throw new ApiError(409, "PLAID_NOT_CONNECTED", "Connect a financial institution before synchronizing BookLoQ.");
  }
  return {
    accessToken: await decrypt(row.accessToken),
    itemId: await decrypt(row.itemId),
    cursor: row.cursor,
    institutionName: row.institutionName?.trim() || "Connected financial institution",
  };
}

export async function syncPlaidTransactions(organizationId: string, fetcher: typeof fetch = fetch) {
  const current = await credentials(organizationId, ["connected", "error"]);
  // Accounts must exist before the first transaction page is normalized; otherwise
  // an initial cursor can advance past transactions whose ledger account was absent.
  const accountsImported = await syncAccounts(
    organizationId,
    current.itemId,
    current.accessToken,
    current.institutionName,
    fetcher,
  );
  let cursor = current.cursor || undefined;
  let hasMore = true;
  let pages = 0;
  let restarted = false;
  const added: PlaidTransactionInput[] = [];
  const modified: PlaidTransactionInput[] = [];
  const removed: Array<{ transaction_id: string }> = [];
  while (hasMore && pages < 30) {
    try {
      const page = await plaidRequest<{
        added: PlaidTransactionInput[];
        modified: PlaidTransactionInput[];
        removed: Array<{ transaction_id: string }>;
        next_cursor: string;
        has_more: boolean;
      }>("/transactions/sync", { access_token: current.accessToken, ...(cursor ? { cursor } : {}), count: 500 }, fetcher);
      added.push(...(page.added ?? []));
      modified.push(...(page.modified ?? []));
      removed.push(...(page.removed ?? []));
      cursor = page.next_cursor;
      hasMore = page.has_more;
      pages += 1;
    } catch (error) {
      if (error instanceof ApiError && error.code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" && !restarted) {
        cursor = current.cursor || undefined;
        added.length = 0;
        modified.length = 0;
        removed.length = 0;
        pages = 0;
        restarted = true;
        continue;
      }
      throw error;
    }
  }
  if (hasMore) throw new ApiError(502, "PLAID_SYNC_PAGE_LIMIT", "Plaid returned more transaction pages than the bounded sync can safely process.");

  const database = getDb();
  const now = new Date();
  const accountRows = await database.select({ externalAccountRef: bankAccounts.externalAccountRef, accountId: bankAccounts.financialAccountId })
    .from(bankAccounts).where(and(eq(bankAccounts.organizationId, organizationId), eq(bankAccounts.provider, PLAID_PROVIDER)));
  const accountMap = new Map(accountRows.map((account) => [account.externalAccountRef, account.accountId]));
  for (const [state, records] of [["posted", added], ["modified", modified]] as const) {
    for (const input of records) {
      const record = normalizePlaidTransaction(input);
      const accountId = accountMap.get(record.externalAccountRef);
      if (!accountId) continue;
      await database.insert(financialTransactions).values({
        id: crypto.randomUUID(),
        organizationId,
        transactionDate: record.transactionDate,
        postingDate: record.postingDate,
        description: record.description,
        originalDescription: record.originalDescription,
        amountCents: record.amountCents,
        currency: record.currency,
        exchangeRatePpm: 1_000_000,
        taxAmountCents: 0,
        accountId,
        sourceSystem: PLAID_PROVIDER,
        externalSourceId: record.externalSourceId,
        sourceState: record.sourceState === "pending" ? "pending" : state,
        pendingExternalSourceId: record.pendingExternalSourceId,
        reconciliationStatus: "unreconciled",
        categorizationStatus: record.categorizationStatus,
        confidenceBasisPoints: record.confidenceBasisPoints,
        approvalStatus: "pending",
        demoRecord: configuration().mode === "sandbox",
        createdAt: now,
        updatedAt: now,
      }).onConflictDoUpdate({ target: [financialTransactions.organizationId, financialTransactions.sourceSystem, financialTransactions.externalSourceId], set: {
        transactionDate: record.transactionDate,
        postingDate: record.postingDate,
        description: record.description,
        originalDescription: record.originalDescription,
        amountCents: record.amountCents,
        currency: record.currency,
        accountId,
        sourceState: record.sourceState === "pending" ? "pending" : state,
        pendingExternalSourceId: record.pendingExternalSourceId,
        categorizationStatus: "missing",
        confidenceBasisPoints: 0,
        updatedAt: now,
      }});
      if (record.pendingExternalSourceId) {
        await database.update(financialTransactions).set({ sourceState: "removed", updatedAt: now }).where(and(
          eq(financialTransactions.organizationId, organizationId),
          eq(financialTransactions.sourceSystem, PLAID_PROVIDER),
          eq(financialTransactions.externalSourceId, record.pendingExternalSourceId),
        ));
      }
    }
  }
  for (const record of removed) {
    await database.update(financialTransactions).set({ sourceState: "removed", updatedAt: now }).where(and(
      eq(financialTransactions.organizationId, organizationId),
      eq(financialTransactions.sourceSystem, PLAID_PROVIDER),
      eq(financialTransactions.externalSourceId, record.transaction_id),
    ));
  }
  await database.update(integrationConnections).set({
    status: "connected",
    lastSyncCursor: cursor ?? null,
    lastSuccessfulSyncAt: now,
    lastErrorCode: null,
    // Successful account and balance retrieval is enough to use fresh balances
    // for cash readiness. Imported transactions remain independently gated by
    // approval, categorization and reconciliation state and are never posted
    // to the ledger by this promotion.
    dataPromotionStatus: accountsImported > 0 ? "approved" : "staging",
    updatedAt: now,
  }).where(and(eq(integrationConnections.organizationId, organizationId), eq(integrationConnections.provider, PLAID_PROVIDER)));
  return {
    added: added.length,
    modified: modified.length,
    removed: removed.length,
    pages,
    accountsImported,
    dataPromotionStatus: accountsImported > 0 ? "approved" as const : "staging" as const,
  };
}

export async function disconnectPlaid(organizationId: string, fetcher: typeof fetch = fetch) {
  const current = await credentials(organizationId, ["connected", "error"]);
  await plaidRequest("/item/remove", { access_token: current.accessToken }, fetcher);
  const now = new Date();
  await getDb().delete(integrationSecrets).where(and(eq(integrationSecrets.organizationId, organizationId), eq(integrationSecrets.provider, PLAID_PROVIDER)));
  await getDb().update(integrationConnections).set({ status: "revoked", dataPromotionStatus: "blocked", lastSyncCursor: null, updatedAt: now })
    .where(and(eq(integrationConnections.organizationId, organizationId), eq(integrationConnections.provider, PLAID_PROVIDER)));
  await getDb().update(bankAccounts).set({ connectionStatus: "error", updatedAt: now })
    .where(and(eq(bankAccounts.organizationId, organizationId), eq(bankAccounts.provider, PLAID_PROVIDER)));
}

export async function deletePlaidConsumerData(organizationId: string) {
  const database = getD1();
  const connection = await database.prepare(
    "SELECT status FROM integration_connections WHERE organization_id = ? AND provider = 'plaid' LIMIT 1",
  ).bind(organizationId).first<{ status: string }>();
  if (connection?.status === "connected" || connection?.status === "error") {
    throw new ApiError(409, "PLAID_DISCONNECT_REQUIRED", "Disconnect Plaid before deleting retained financial data.");
  }

  // The batch is atomic in D1. Unreviewed imports are deleted. Transactions
  // already approved, reconciled, or posted into a journal retain only the
  // minimum accounting fields; bank/provider identifiers and descriptions are
  // removed. This preserves ledger integrity without retaining reusable bank
  // connection data.
  const results = await database.batch([
    database.prepare(`
      DELETE FROM financial_transactions
      WHERE organization_id = ? AND source_system = 'plaid'
        AND journal_entry_id IS NULL
        AND reconciliation_status = 'unreconciled'
        AND approval_status != 'approved'
    `).bind(organizationId),
    database.prepare(`
      UPDATE financial_transactions
      SET description = 'Retained accounting transaction',
          original_description = '',
          source_system = 'retained_accounting',
          external_source_id = 'retained:' || id,
          pending_external_source_id = NULL,
          updated_at = unixepoch()
      WHERE organization_id = ? AND source_system = 'plaid'
    `).bind(organizationId),
    database.prepare(`
      UPDATE financial_accounts
      SET name = 'Disconnected financial account',
          system_key = 'retained:' || id,
          description = '',
          plain_language = 'Retained only where required for an approved, reconciled, or posted accounting record.',
          active = 0,
          archived_at = unixepoch(),
          updated_at = unixepoch()
      WHERE organization_id = ? AND id IN (
        SELECT financial_account_id FROM bank_accounts
        WHERE organization_id = ? AND provider = 'plaid'
      )
    `).bind(organizationId, organizationId),
    database.prepare("DELETE FROM bank_accounts WHERE organization_id = ? AND provider = 'plaid'").bind(organizationId),
    database.prepare("DELETE FROM integration_secrets WHERE organization_id = ? AND provider = 'plaid'").bind(organizationId),
    database.prepare(`
      UPDATE integration_connections
      SET status = 'revoked', external_account_ref = NULL, external_account_name = NULL,
          scopes_json = '[]', data_promotion_status = 'blocked', connected_at = NULL,
          last_successful_sync_at = NULL, last_sync_cursor = NULL, last_error_code = NULL,
          privacy_data_deleted_at = unixepoch(), updated_at = unixepoch()
      WHERE organization_id = ? AND provider = 'plaid'
    `).bind(organizationId),
  ]);
  return {
    importedTransactionsDeleted: Number(results[0]?.meta.changes ?? 0),
    retainedTransactionsDeidentified: Number(results[1]?.meta.changes ?? 0),
    financialAccountsDeidentified: Number(results[2]?.meta.changes ?? 0),
    bankAccountsDeleted: Number(results[3]?.meta.changes ?? 0),
    encryptedCredentialsDeleted: Number(results[4]?.meta.changes ?? 0),
  };
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyPlaidWebhook(rawBody: string, compactJwt: string, fetcher: typeof fetch = fetch) {
  const [encodedHeader, encodedPayload, encodedSignature] = compactJwt.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) throw new ApiError(401, "PLAID_WEBHOOK_SIGNATURE_INVALID", "Plaid webhook verification failed.");
  let header: { alg?: unknown; kid?: unknown };
  let payload: { iat?: unknown; request_body_sha256?: unknown };
  try {
    header = JSON.parse(new TextDecoder().decode(decodeBase64(encodedHeader)));
    payload = JSON.parse(new TextDecoder().decode(decodeBase64(encodedPayload)));
  } catch {
    throw new ApiError(401, "PLAID_WEBHOOK_SIGNATURE_INVALID", "Plaid webhook verification failed.");
  }
  if (header.alg !== "ES256" || typeof header.kid !== "string" || typeof payload.iat !== "number" || typeof payload.request_body_sha256 !== "string") {
    throw new ApiError(401, "PLAID_WEBHOOK_SIGNATURE_INVALID", "Plaid webhook verification failed.");
  }
  const ageSeconds = Math.floor(Date.now() / 1_000) - payload.iat;
  if (ageSeconds < -30 || ageSeconds > 300) throw new ApiError(401, "PLAID_WEBHOOK_SIGNATURE_EXPIRED", "Plaid webhook verification expired.");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawBody)));
  if (hex(digest) !== payload.request_body_sha256.toLowerCase()) throw new ApiError(401, "PLAID_WEBHOOK_BODY_INVALID", "Plaid webhook verification failed.");
  const response = await plaidRequest<{ key: JsonWebKey & { alg?: string; expired_at?: number | null } }>("/webhook_verification_key/get", { key_id: header.kid }, fetcher);
  if (!response.key || response.key.alg !== "ES256" || (response.key.expired_at && response.key.expired_at * 1_000 < Date.now())) {
    throw new ApiError(401, "PLAID_WEBHOOK_KEY_INVALID", "Plaid webhook verification failed.");
  }
  const key = await crypto.subtle.importKey("jwk", response.key, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const verified = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    decodeBase64(encodedSignature),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  );
  if (!verified) throw new ApiError(401, "PLAID_WEBHOOK_SIGNATURE_INVALID", "Plaid webhook verification failed.");
  return { keyId: header.kid, issuedAt: payload.iat };
}
