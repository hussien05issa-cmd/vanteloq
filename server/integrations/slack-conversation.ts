import { ApiError } from "../api";
import type { SlackConversationMessage } from "../../domain/slack-conversations";
import type { SlackCredentialEnvelope } from "./slack";

const RESPONSE_LIMIT = 262_144;
const MESSAGE_LIMIT = 15;
const TS_PATTERN = /^\d{1,12}\.\d{6}$/;
const ID_PATTERN = /^[A-Za-z0-9]{2,64}$/;

export class SlackConversationCooldownError extends ApiError {
  constructor(readonly nextReadAt: number) {
    super(429, "SLACK_CONVERSATION_COOLDOWN", "Wait for the Slack refresh window before trying again.");
  }
}
export class SlackConversationRateLimitError extends ApiError {
  nextReadAt?: number;
  constructor(readonly retryAfterSeconds: number) {
    super(429, "SLACK_RATE_LIMITED", "Slack is limiting conversation requests. Wait before refreshing again.");
  }
}

export function slackChannelUrl(teamId: string, channelId: string): string {
  if (!ID_PATTERN.test(teamId) || !ID_PATTERN.test(channelId)) throw new ApiError(409, "SLACK_CHANNEL_INVALID", "Reconnect Slack before viewing this channel.");
  const url = new URL("https://slack.com/app_redirect");
  url.searchParams.set("channel", channelId);
  url.searchParams.set("team", teamId);
  return url.toString();
}

function retryAfter(response: Response): number {
  const value = response.headers.get("Retry-After") ?? "";
  const seconds = /^\d{1,6}$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - Date.now()) / 1000);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(86_400, Math.max(60, seconds)) : 60;
}

async function slackRead(method: "conversations.info" | "conversations.history", credentials: SlackCredentialEnvelope,
  parameters: Record<string, string>, fetcher: typeof fetch, checkCurrent?: () => Promise<void>): Promise<Record<string, unknown>> {
  await checkCurrent?.();
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  let response: Response;
  try { response = await fetcher(url, { headers: { Authorization: `Bearer ${credentials.accessToken}`, Accept: "application/json" },
    redirect: "manual", signal: AbortSignal.timeout(8_000) }); }
  catch { throw new ApiError(503, "SLACK_CONVERSATION_UNAVAILABLE", "Slack conversations are temporarily unavailable. Try again later."); }
  if (response.status === 429) {
    await response.body?.cancel().catch(() => undefined);
    throw new SlackConversationRateLimitError(retryAfter(response));
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new ApiError(502, "SLACK_CONVERSATION_REQUEST_FAILED", "Slack conversations could not be read. Try again later.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ApiError(502, "SLACK_CONVERSATION_RESPONSE_INVALID", "Slack returned an incomplete conversation response.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > RESPONSE_LIMIT) throw new Error("Response too large");
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid response");
    const result = body as Record<string, unknown>;
    if (result.ok !== true) {
      const code = typeof result.error === "string" ? result.error : "";
      if (["invalid_auth", "token_revoked", "token_expired", "account_inactive", "missing_scope", "not_authed"].includes(code)) {
        throw new ApiError(409, "SLACK_CONVERSATION_RECONNECT_REQUIRED", "Disconnect Slack and reconnect with conversation permissions to read this channel.");
      }
      if (["not_in_channel", "channel_not_found", "access_denied"].includes(code)) {
        throw new ApiError(409, "SLACK_PUBLIC_CHANNEL_REQUIRED", "Invite the Vanteloq app to the selected public channel, then try again.");
      }
      if (code === "ratelimited") throw new SlackConversationRateLimitError(60);
      throw new ApiError(502, "SLACK_CONVERSATION_REQUEST_FAILED", "Slack conversations could not be read. Try again later.");
    }
    return result;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, "SLACK_CONVERSATION_RESPONSE_INVALID", "Slack returned an invalid or oversized conversation response.");
  } finally { reader.releaseLock(); }
}

export async function validateSlackPublicChannel(credentials: SlackCredentialEnvelope, fetcher: typeof fetch = fetch, checkCurrent?: () => Promise<void>): Promise<string> {
  const body = await slackRead("conversations.info", credentials, { channel: credentials.channelId }, fetcher, checkCurrent);
  const channel = body.channel as Record<string, unknown> | undefined;
  if (!channel || typeof channel !== "object" || Array.isArray(channel)
    || channel.id !== credentials.channelId || (channel.context_team_id ?? channel.team_id) !== credentials.teamId
    || channel.is_channel !== true || channel.is_private !== false || channel.is_member !== true
    || channel.is_im === true || channel.is_mpim === true || channel.is_archived !== false
    || channel.is_shared !== false || channel.is_ext_shared === true || channel.is_org_shared === true
    || channel.is_pending_ext_shared === true || (Array.isArray(channel.shared_team_ids)
      && channel.shared_team_ids.some(id => id !== credentials.teamId))) {
    throw new ApiError(409, "SLACK_PUBLIC_CHANNEL_REQUIRED", "Choose a public channel in the connected Slack workspace, without shared access, and invite the Vanteloq app to it.");
  }
  return typeof channel.name === "string" && /^[^\u0000-\u001f\u007f]{1,200}$/.test(channel.name) ? channel.name : credentials.channelId;
}

export async function readSlackRecentConversation(credentials: SlackCredentialEnvelope, fetcher: typeof fetch = fetch, checkCurrent?: () => Promise<void>) {
  if (!credentials.conversationRead?.enabled) throw new ApiError(409, "SLACK_CONVERSATION_CONSENT_REQUIRED", "Disconnect Slack and reconnect after approving conversation access.");
  const channelName = await validateSlackPublicChannel(credentials, fetcher, checkCurrent);
  const body = await slackRead("conversations.history", credentials, { channel: credentials.channelId, limit: String(MESSAGE_LIMIT) }, fetcher, checkCurrent);
  if (!Array.isArray(body.messages)) throw new ApiError(502, "SLACK_CONVERSATION_RESPONSE_INVALID", "Slack returned an incomplete conversation response.");
  const messages: SlackConversationMessage[] = [];
  for (const value of body.messages.slice(0, MESSAGE_LIMIT)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const item = value as Record<string, unknown>;
    if (item.type !== "message" || item.hidden === true || typeof item.ts !== "string" || !TS_PATTERN.test(item.ts)
      || (item.thread_ts !== undefined && item.thread_ts !== item.ts)
      || (item.subtype !== undefined && !["bot_message", "me_message"].includes(String(item.subtype)))
      || typeof item.text !== "string" || !item.text.trim()) continue;
    const text = item.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
    messages.push({ ts: item.ts, authorId: typeof item.user === "string" && ID_PATTERN.test(item.user) ? item.user
      : typeof item.bot_id === "string" && ID_PATTERN.test(item.bot_id) ? item.bot_id : null,
      text: text.length > 8_000 ? `${text.slice(0, 7_975)}\n[Message shortened]` : text,
      replyCount: Number.isSafeInteger(item.reply_count) && Number(item.reply_count) >= 0 ? Math.min(Number(item.reply_count), 1_000_000) : 0 });
  }
  // Slack returns newest first. Keep the provider timestamp as the identity.
  messages.reverse();
  return { channelName, channelUrl: slackChannelUrl(credentials.teamId, credentials.channelId), messages,
    fetchedAt: new Date().toISOString(), hasMore: body.has_more === true || typeof (body.response_metadata as { next_cursor?: unknown } | undefined)?.next_cursor === "string"
      && Boolean((body.response_metadata as { next_cursor?: string }).next_cursor), isLimited: body.is_limited === true };
}
