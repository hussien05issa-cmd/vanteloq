export const SLACK_CONVERSATION_READ_NOTICE_VERSION = "slack-conversation-read-2026-10-10";
export type SlackMode = "single_channel_notifications" | "single_channel_conversations";
export type SlackConversationMessage = { ts: string; authorId: string | null; text: string; replyCount: number };
export type SlackConversationStatus = {
  mode: SlackMode;
  connected: boolean;
  readsMessages: boolean;
  requiresReconnect: boolean;
  connectionId: string | null;
  channelName: string | null;
  channelUrl: string | null;
  nextReadAt: string | null;
};
export type SlackConversationPage = SlackConversationStatus & {
  messages: SlackConversationMessage[];
  fetchedAt: string;
  hasMore: boolean;
  isLimited: boolean;
};
