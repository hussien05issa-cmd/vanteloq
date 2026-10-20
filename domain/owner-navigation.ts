import { NAVIGATION_VIEW_IDS } from "./navigation-preferences";
import { settingsSectionFromHash, settingsSectionHash } from "./settings-navigation";
import { businessContextId } from "./business-context";

type WorkspaceView = typeof NAVIGATION_VIEW_IDS[number] | "Profit" | "Cash" | "Bookkeeping";
const views: readonly WorkspaceView[] = [...NAVIGATION_VIEW_IDS, "Profit", "Cash", "Bookkeeping"];
const slug = (view: string) => view.toLowerCase().replaceAll(" ", "-");

export function workspaceViewFromHash(hash: string): WorkspaceView | null {
  if (settingsSectionFromHash(hash)) return "Settings";
  if (!hash.startsWith("#workspace/")) return null;
  return views.find(view => slug(view) === hash.slice("#workspace/".length)) ?? null;
}

export function workspaceViewHash(view: WorkspaceView): string {
  return view === "Settings" ? settingsSectionHash("profile") : `#workspace/${slug(view)}`;
}

/** Switching reloads all tenant-scoped state and removes provider callbacks,
 * return paths and section state from the business being left. */
export function businessSwitchUrl(pageUrl: string, workspaceId: string): string {
  const id = businessContextId(workspaceId);
  if (!id) throw new Error("Choose a business workspace.");
  const url = new URL(pageUrl);
  url.search = "";
  url.searchParams.set("workspace", id);
  url.hash = "";
  return url.toString();
}
