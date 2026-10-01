import { getRuntimeEnv } from "../../db";
import { ApiError } from "../api";

export const SLACK_PROVIDER = "slack";
export const SLACK_API_VERSION = "oauth-v2";
export const SLACK_SCOPES = ["incoming-webhook"] as const;

const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SLACK_ID_PATTERN = /^[A-Za-z0-9]{2,64}$/;
const NAME_PATTERN = /^[^\u0000-\u001f\u007f]{1,200}$/;
const NO_REFRESH_TOKEN = "slack:no-refresh-token:v1";

type SlackRuntimeEnv = ReturnType<typeof getRuntimeEnv> & {
  SLACK_CLIENT_ID?: string;
  SLACK_CLIENT_SECRET?: string;
  SLACK_REDIRECT_URI?: string;
};

type SlackConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  encryptionKey: string;
};

type SlackOAuthResponse = {
  ok?: unknown;
  error?: unknown;
  app_id?: unknown;
  access_token?: unknown;
  bot_user_id?: unknown;
  scope?: unknown;
  token_type?: unknown;
  team?: { id?: unknown; name?: unknown } | null;
  enterprise?: { id?: unknown; name?: unknown } | null;
  incoming_webhook?: {
    channel?: unknown;
    channel_id?: unknown;
    configuration_url?: unknown;
    url?: unknown;
  } | null;
};

export type SlackGrant = {
  appId: string;
  accessToken: string;
  botUserId: string | null;
  teamId: string;
  teamName: string;
  enterpriseId: string | null;
  channelId: string;
  channelName: string;
  webhookUrl: string;
  scopes: readonly ["incoming-webhook"];
};

export type SlackCredentialEnvelope = {
  version: 1;
  accessToken: string;
  teamId: string;
  channelId: string;
  webhookUrl: string;
};

function runtimeEnv(): SlackRuntimeEnv {
  return getRuntimeEnv() as SlackRuntimeEnv;
}

export function slackReadiness() {
  const env = runtimeEnv();
  const missingConfiguration = [
    ["SLACK_CLIENT_ID", env.SLACK_CLIENT_ID],
    ["SLACK_CLIENT_SECRET", env.SLACK_CLIENT_SECRET],
    ["SLACK_REDIRECT_URI", env.SLACK_REDIRECT_URI],
    ["INTEGRATION_ENCRYPTION_KEY", env.INTEGRATION_ENCRYPTION_KEY],
  ].filter((entry) => !entry[1]?.trim()).map((entry) => entry[0]);
  return {
    adapterBuilt: true,
    credentialsConfigured: missingConfiguration.length === 0,
    missingConfiguration,
    apiVersion: SLACK_API_VERSION,
    scopes: [...SLACK_SCOPES],
    mode: "single_channel_notifications" as const,
    liveDataEligible: false,
    dataPromotionEnabled: false,
  };
}

function config(): SlackConfig {
  const env = runtimeEnv();
  const readiness = slackReadiness();
  if (!readiness.credentialsConfigured) {
    throw new ApiError(503, "SLACK_CONFIGURATION_REQUIRED", "Slack developer credentials must be configured before authorization can begin.");
  }
  let redirect: URL;
  try {
    redirect = new URL(env.SLACK_REDIRECT_URI!.trim());
  } catch {
    throw new ApiError(503, "SLACK_REDIRECT_INVALID", "The configured Slack callback URL is invalid.");
  }
  if (redirect.protocol !== "https:" || redirect.username || redirect.password || redirect.hash || redirect.search) {
    throw new ApiError(503, "SLACK_REDIRECT_INVALID", "The configured Slack callback URL must be a clean HTTPS URL.");
  }
  return {
    clientId: env.SLACK_CLIENT_ID!.trim(),
    clientSecret: env.SLACK_CLIENT_SECRET!,
    redirectUri: redirect.toString(),
    encryptionKey: env.INTEGRATION_ENCRYPTION_KEY!.trim(),
  };
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0));
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (character) => character.charCodeAt(0));
}

async function encryptionKey(): Promise<CryptoKey> {
  const encoded = runtimeEnv().INTEGRATION_ENCRYPTION_KEY?.trim();
  if (!encoded) throw new ApiError(503, "INTEGRATION_ENCRYPTION_KEY_REQUIRED", "Encrypted integration credential storage is not configured.");
  let raw: Uint8Array;
  try {
    raw = fromBase64(encoded);
  } catch {
    throw new ApiError(503, "INTEGRATION_ENCRYPTION_KEY_INVALID", "The integration encryption key is invalid.");
  }
  if (raw.byteLength !== 32) {
    throw new ApiError(503, "INTEGRATION_ENCRYPTION_KEY_INVALID", "The integration encryption key must decode to 32 bytes.");
  }
  return crypto.subtle.importKey("raw", asArrayBuffer(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export function newSlackOAuthState(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function slackStateHash(state: string): Promise<string> {
  if (!STATE_PATTERN.test(state)) throw new Error("Invalid Slack OAuth state");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(state));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function buildSlackAuthorizationUrl(state: string): string {
  if (!STATE_PATTERN.test(state)) throw new Error("Invalid Slack OAuth state");
  const current = config();
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", current.clientId);
  url.searchParams.set("scope", SLACK_SCOPES.join(","));
  url.searchParams.set("redirect_uri", current.redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

function cleanId(value: unknown, code: string): string {
  if (typeof value !== "string" || !SLACK_ID_PATTERN.test(value)) {
    throw new ApiError(502, code, "Slack returned an incomplete authorization response.");
  }
  return value;
}

function cleanName(value: unknown, fallback: string): string {
  return typeof value === "string" && NAME_PATTERN.test(value.trim()) ? value.trim() : fallback;
}

export function validateSlackWebhookUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(502, "SLACK_WEBHOOK_INVALID", "Slack returned an invalid incoming webhook URL.");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.protocol !== "https:" || url.hostname !== "hooks.slack.com" || url.port || url.username || url.password || url.search || url.hash
    || parts.length !== 4 || parts[0] !== "services" || parts.slice(1).some((part) => !/^[A-Za-z0-9_-]{6,200}$/.test(part))) {
    throw new ApiError(502, "SLACK_WEBHOOK_INVALID", "Slack returned an invalid incoming webhook URL.");
  }
  return url.toString();
}

function parseScopes(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return [...new Set(value.split(/[\s,]+/).map((scope) => scope.trim()).filter(Boolean))].sort();
}

export async function exchangeSlackAuthorizationCode(code: string, fetcher: typeof fetch = fetch): Promise<SlackGrant> {
  if (!code || code.length > 2_048) throw new ApiError(400, "SLACK_CODE_INVALID", "Slack returned an invalid authorization code.");
  const current = config();
  const response = await fetcher("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: current.clientId,
      client_secret: current.clientSecret,
      code,
      redirect_uri: current.redirectUri,
    }),
    // Workers supports manual, not error. Non-success responses are rejected below.
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 429) {
    throw new ApiError(503, "SLACK_RATE_LIMITED", "Slack is rate-limiting authorization. Wait for the provider window to reset, then retry.");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new ApiError(502, "SLACK_TOKEN_EXCHANGE_FAILED", "Slack did not accept the authorization request. Start again.");
  }
  const body = await response.json() as SlackOAuthResponse;
  if (body.ok !== true) throw new ApiError(502, "SLACK_TOKEN_EXCHANGE_FAILED", "Slack did not accept the authorization request. Start again.");
  const scopes = parseScopes(body.scope);
  if (scopes.length !== 1 || scopes[0] !== SLACK_SCOPES[0]) {
    throw new ApiError(409, "SLACK_SCOPES_INVALID", "Slack did not return the single-channel permission requested by Vanteloq. Review the Slack app scopes before reconnecting.");
  }
  if (body.token_type !== "bot" || typeof body.access_token !== "string" || !body.access_token.startsWith("xoxb-")
    || !body.incoming_webhook || !body.team) {
    throw new ApiError(502, "SLACK_TOKEN_RESPONSE_INVALID", "Slack returned an incomplete authorization response.");
  }
  const teamId = cleanId(body.team.id, "SLACK_TEAM_INVALID");
  const channelId = cleanId(body.incoming_webhook.channel_id, "SLACK_CHANNEL_INVALID");
  const appId = cleanId(body.app_id, "SLACK_APP_INVALID");
  return {
    appId,
    accessToken: body.access_token,
    botUserId: typeof body.bot_user_id === "string" && SLACK_ID_PATTERN.test(body.bot_user_id) ? body.bot_user_id : null,
    teamId,
    teamName: cleanName(body.team.name, teamId),
    enterpriseId: body.enterprise && typeof body.enterprise.id === "string" && SLACK_ID_PATTERN.test(body.enterprise.id) ? body.enterprise.id : null,
    channelId,
    channelName: cleanName(body.incoming_webhook.channel, channelId).replace(/^#/, ""),
    webhookUrl: validateSlackWebhookUrl(typeof body.incoming_webhook.url === "string" ? body.incoming_webhook.url : ""),
    scopes: SLACK_SCOPES,
  };
}

export function slackCredentialEnvelope(grant: SlackGrant): SlackCredentialEnvelope {
  return {
    version: 1,
    accessToken: grant.accessToken,
    teamId: grant.teamId,
    channelId: grant.channelId,
    webhookUrl: validateSlackWebhookUrl(grant.webhookUrl),
  };
}

export async function encryptSlackCredentials(credentials: SlackCredentialEnvelope): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey();
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode("vanteloq:slack:v1") },
    key,
    new TextEncoder().encode(JSON.stringify(credentials)),
  );
  return `v1.${base64Url(iv)}.${base64Url(new Uint8Array(ciphertext))}`;
}

export async function encryptedSlackNoRefreshToken(): Promise<string> {
  const credentials: SlackCredentialEnvelope = {
    version: 1,
    accessToken: NO_REFRESH_TOKEN,
    teamId: "none",
    channelId: "none",
    webhookUrl: "https://hooks.slack.com/services/unused0/unused0/unused0",
  };
  return encryptSlackCredentials(credentials);
}

export async function decryptSlackCredentials(value: string): Promise<SlackCredentialEnvelope> {
  const [version, encodedIv, encodedCiphertext] = value.split(".");
  if (version !== "v1" || !encodedIv || !encodedCiphertext) {
    throw new ApiError(500, "SLACK_SECRET_INVALID", "Stored Slack credentials could not be read.");
  }
  try {
    const key = await encryptionKey();
    const iv = fromBase64Url(encodedIv);
    const ciphertext = fromBase64Url(encodedCiphertext);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: asArrayBuffer(iv), additionalData: new TextEncoder().encode("vanteloq:slack:v1") },
      key,
      asArrayBuffer(ciphertext),
    );
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as Partial<SlackCredentialEnvelope>;
    if (parsed.version !== 1 || typeof parsed.accessToken !== "string" || !parsed.accessToken.startsWith("xoxb-")
      || typeof parsed.teamId !== "string" || !SLACK_ID_PATTERN.test(parsed.teamId)
      || typeof parsed.channelId !== "string" || !SLACK_ID_PATTERN.test(parsed.channelId)
      || typeof parsed.webhookUrl !== "string") {
      throw new Error("Invalid Slack credential envelope");
    }
    return { ...parsed, webhookUrl: validateSlackWebhookUrl(parsed.webhookUrl) } as SlackCredentialEnvelope;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, "SLACK_SECRET_DECRYPTION_FAILED", "Stored Slack credentials could not be decrypted.");
  }
}

export async function sendSlackTestNotification(credentials: SlackCredentialEnvelope, fetcher: typeof fetch = fetch): Promise<void> {
  return sendSlackNotification(credentials, {
    text: "Vanteloq connection test. This approved channel is ready for Vanteloq notifications.",
    blocks: [{ type: "section", text: { type: "mrkdwn", text: "*Vanteloq connection test*\nThis approved channel is ready for Vanteloq notifications. No business data was included." } }],
  }, fetcher);
}

/** Share a fixed sign-in link, never records, free-form text or a caller-supplied URL. */
export async function sendSlackWorkspaceLink(credentials: SlackCredentialEnvelope, fetcher: typeof fetch = fetch): Promise<void> {
  const workspaceUrl = new URL("/", config().redirectUri).toString();
  return sendSlackNotification(credentials, {
    text: "Open Vanteloq to review your business. Sign-in and workspace access are required.",
    blocks: [
      { type: "section", text: { type: "plain_text", text: "Open Vanteloq to review your business. Sign-in and workspace access are required. No business records are included in this message." } },
      { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Open Vanteloq" }, url: workspaceUrl }] },
    ],
    unfurl_links: false,
    unfurl_media: false,
  }, fetcher);
}

async function sendSlackNotification(credentials: SlackCredentialEnvelope, payload: Record<string, unknown>, fetcher: typeof fetch): Promise<void> {
  const webhookUrl = validateSlackWebhookUrl(credentials.webhookUrl);
  const response = await fetcher(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
    redirect: "manual",
    signal: AbortSignal.timeout(8_000),
  });
  if (response.status === 429) {
    throw new ApiError(503, "SLACK_RATE_LIMITED", "Slack is rate-limiting this channel. Wait before sending another notification.");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new ApiError(502, "SLACK_NOTIFICATION_FAILED", "Slack did not accept the notification.");
  }
  const acknowledgement = await response.text();
  if (acknowledgement.trim() !== "ok") {
    throw new ApiError(502, "SLACK_NOTIFICATION_FAILED", "Slack did not accept the notification.");
  }
}

export async function revokeSlackInstallation(credentials: SlackCredentialEnvelope, fetcher: typeof fetch = fetch): Promise<boolean> {
  const current = config();
  const response = await fetcher("https://slack.com/api/apps.uninstall", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: current.clientId, client_secret: current.clientSecret, token: credentials.accessToken }),
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 429) throw new ApiError(503, "SLACK_RATE_LIMITED", "Slack is rate-limiting this request. Wait before disconnecting again.");
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return false;
  }
  const body = await response.json() as { ok?: unknown; error?: unknown };
  return body.ok === true || body.error === "token_revoked" || body.error === "account_inactive";
}
