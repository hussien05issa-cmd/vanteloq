import test from "node:test";
import assert from "node:assert/strict";
import { readSlackConversationAuthorization } from "../app/slack-messages-reader.ts";
import { connectionPermissionSummary } from "../domain/provider-connection-notice.ts";

const accepted = { mode: "single_channel_conversations", slackConversationReadAccepted: true };
test("Slack setup validates its exact provider destination", async () => {
  let sent: RequestInit | undefined;
  const url = await readSlackConversationAuthorization(async (_url, init) => { sent = init; return Response.json({ authorizationUrl: "https://slack.com/oauth/v2/authorize?scope=channels%3Ahistory" }); }, accepted, new AbortController().signal);
  assert.match(url, /^https:\/\/slack.com\/oauth\/v2\/authorize\?/);
  assert.deepEqual(JSON.parse(String(sent?.body)), accepted);
  for (const authorizationUrl of ["https://slack.com.evil.test/oauth/v2/authorize", "https://slack.com/redirect", "javascript:alert(1)", "https://owner@slack.com/oauth/v2/authorize"]) {
    await assert.rejects(readSlackConversationAuthorization(async () => Response.json({ authorizationUrl }), accepted, new AbortController().signal), /could not start/);
  }
});
test("Leaving Slack setup rejects a late successful response before navigation", async () => {
  const controller = new AbortController();
  let resolve!: (response: Response) => void;
  const pending = readSlackConversationAuthorization(() => new Promise<Response>(done => { resolve = done; }), accepted, controller.signal);
  controller.abort(); resolve(Response.json({ authorizationUrl: "https://slack.com/oauth/v2/authorize?state=fictional" }));
  await assert.rejects(pending, { name: "AbortError" });
});
test("Slack conversation consent states broader grant, selected channel, owner and no storage", () => {
  const notification = connectionPermissionSummary("slack");
  assert.match(notification[0].description, /does not grant access to conversations/);
  const read = connectionPermissionSummary("slack", ["incoming-webhook", "channels:read", "channels:history"]);
  assert.match(read[0].description, /where the app is a member/);
  assert.match(read[0].description, /one public channel/);
  assert.match(read[1].description, /workspace owner/);
  assert.match(read[1].description, /not copied.*saved.*AI/);
});
