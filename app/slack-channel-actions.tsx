"use client";

import { useState } from "react";
import "./slack-channel-actions.css";

export function SlackChannelActions({ destination, action, disabled, onTest, onShare }: {
  destination: string;
  action: string;
  disabled: boolean;
  onTest: () => void;
  onShare: () => Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState(false);
  return <>
    <button type="button" disabled={disabled} onClick={() => setConfirming(true)}>Share workspace link</button>
    <button type="button" disabled={disabled} onClick={onTest}>{action === "test" ? "Sending…" : "Test connection"}</button>
    {confirming && <div className="slack-share-confirmation" role="group" aria-label="Confirm Slack message">
      <b>Send a link to {destination}?</b>
      <p>Channel members will receive a link to Vanteloq. They must sign in with their own workspace access. No business records are sent.</p>
      <div><button type="button" disabled={disabled} onClick={() => setConfirming(false)}>Cancel</button><button type="button" className="primary" disabled={disabled} onClick={() => { void onShare().then(sent => { if (sent) setConfirming(false); }); }}>{action === "share" ? "Sending…" : "Send link"}</button></div>
    </div>}
  </>;
}
