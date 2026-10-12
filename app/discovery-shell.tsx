"use client";

import type { ReactNode } from "react";
import PublicPageNav from "./public-page-nav";
import PublicFooter from "./public-footer";
import { useWorkspaceAppearance } from "./workspace-appearance";
import "./discovery-shell.css";

/** Public guides share the same appearance preference as the product. */
export default function DiscoveryShell({ children, className = "" }: { children: ReactNode; className?: string }) {
  const appearance = useWorkspaceAppearance();
  return <div className={`public-site discovery-shell ${className}`} data-public-theme={appearance.theme} data-public-appearance={appearance.appearance}>
    <a className="discovery-skip" href="#discovery-main">Skip to content</a>
    <PublicPageNav appearanceControl/>
    {children}
    <PublicFooter/>
  </div>;
}
