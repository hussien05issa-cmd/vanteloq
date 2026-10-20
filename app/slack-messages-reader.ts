/** Validate the destination and reject even a late response from an aborted setup. */
export async function readSlackConversationAuthorization(fetcher: typeof fetch, body: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const response = await fetcher("/api/v1/integrations/slack/authorize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  const payload = await response.json();
  if (signal.aborted) throw new DOMException("Setup cancelled", "AbortError");
  if (!response.ok) throw Error(payload.error?.message || "Slack setup could not start. Please try again.");
  let destination: URL;
  try { destination = new URL(payload.authorizationUrl); } catch { throw Error("Slack setup could not start. Please try again."); }
  if (destination.origin !== "https://slack.com" || destination.pathname !== "/oauth/v2/authorize" || destination.username || destination.password) throw Error("Slack setup could not start. Please try again.");
  return destination.href;
}
