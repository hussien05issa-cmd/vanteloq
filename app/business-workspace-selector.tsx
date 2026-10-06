"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "./supabase-browser";
import { businessSwitchUrl } from "../domain/owner-navigation";
import { humanizeIdentifier } from "../domain/display-labels";

export type BusinessWorkspaceChoice = { id: string; name: string; industry: string; role: string; setupComplete: boolean };
export type BusinessWorkspaceListing = { workspaces: BusinessWorkspaceChoice[]; currentWorkspaceId: string | null };

export function BusinessWorkspaceChoices({ listing, selectedWorkspaceId, busy = false, onSwitch }: { listing: BusinessWorkspaceListing; selectedWorkspaceId: string | null; busy?: boolean; onSwitch: (id: string) => void }) {
  const selected = selectedWorkspaceId ?? listing.currentWorkspaceId;
  return <div className="business-workspace-choices">
    <label><span>Business workspace</span><select aria-describedby="business-switch-help" value={selected ?? ""} disabled={busy || listing.workspaces.length < 2 && Boolean(selected)} onChange={event => { if (event.target.value && event.target.value !== selected) onSwitch(event.target.value); }}>
      {!selected && <option value="">Choose a business</option>}
      {listing.workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name} · {workspace.industry || "Business"}{!workspace.setupComplete ? " · Setup pending" : ""}</option>)}
    </select></label>
    <small id="business-switch-help">{busy ? "Opening the selected business…" : listing.workspaces.length > 1 ? "Save open changes before switching. Each business has its own records, plan and permissions." : "Your account has access to this business."}</small>
  </div>;
}

export function OwnerWorkspaceContext({ businessName, industry, locationName, limitedScope = false }: { businessName: string; industry: string; locationName: string | null; limitedScope?: boolean }) {
  return <p className="owner-workspace-context" aria-label="Current business and reporting scope"><strong>{businessName}</strong><span>{industry || "Business"}</span><span>{locationName ?? (limitedScope ? "All accessible locations" : "All locations")}</span></p>;
}

export default function BusinessWorkspaceSelector({ selectedWorkspaceId }: { selectedWorkspaceId: string | null }) {
  const [listing, setListing] = useState<BusinessWorkspaceListing | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    apiFetch("/api/v1/workspaces", { headers: { Accept: "application/json" }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? "Your business workspaces could not be loaded."); if (!controller.signal.aborted) { setListing(body); setError(""); } })
      .catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Your business workspaces could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);
  if (loading) return <p className="business-workspace-status" role="status">Loading business access…</p>;
  if (error) return <div className="business-workspace-status" role="alert"><p>{error}</p><button type="button" onClick={() => { setLoading(true); setReload(value => value + 1); }}>Retry business list</button></div>;
  if (!listing?.workspaces.length) return <p className="business-workspace-status" role="status">No active business access is available.</p>;
  const selected = listing.workspaces.find(workspace => workspace.id === (selectedWorkspaceId ?? listing.currentWorkspaceId));
  return <section className="business-workspace-selector" aria-label="Business access">
    <BusinessWorkspaceChoices listing={listing} selectedWorkspaceId={selectedWorkspaceId} busy={switching} onSwitch={id => { setSwitching(true); window.location.assign(businessSwitchUrl(window.location.href, id)); }}/>
    {selected && <small className="business-role">{humanizeIdentifier(selected.role)} access</small>}
  </section>;
}
