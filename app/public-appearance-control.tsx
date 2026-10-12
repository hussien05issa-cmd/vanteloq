"use client";

import { useId } from "react";
import { useWorkspaceAppearance, type WorkspaceAppearance } from "./workspace-appearance";

/** The same device preference controls the homepage and protected workspace. */
export default function PublicAppearanceControl() {
  const appearance = useWorkspaceAppearance();
  const id = useId();
  return <label className="public-appearance-control" htmlFor={id}>
    <span className="sr-only">Colour theme</span>
    <select id={id} aria-label="Colour theme" value={appearance.appearance} onChange={event => appearance.choose(event.target.value as WorkspaceAppearance)}>
      <option value="dark">Dark</option>
      <option value="light">Light</option>
      <option value="system">System</option>
    </select>
    {(appearance.storageNotice || appearance.systemNotice) && <span className="public-appearance-notice" role="status">{appearance.storageNotice || appearance.systemNotice}</span>}
  </label>;
}
