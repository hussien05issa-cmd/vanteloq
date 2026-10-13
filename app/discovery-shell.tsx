"use client";

import type { ReactNode } from "react";
import PublicPageNav from "./public-page-nav";
import PublicFooter from "./public-footer";
import { useWorkspaceAppearance } from "./workspace-appearance";
import "./discovery-shell.css";

type DiscoveryShellProps = {
  children: ReactNode;
  className?: string;
  fixedTheme?: "dark" | "light";
  primaryNavAction?: {
    href: string;
    label: string;
    shortLabel?: string;
  };
};

/** Public guides share the product appearance unless a focused landing page sets a fixed theme. */
export default function DiscoveryShell({ children, className = "", fixedTheme, primaryNavAction }: DiscoveryShellProps) {
  const appearance = useWorkspaceAppearance();
  const theme = fixedTheme ?? appearance.theme;
  return <div className={`public-site discovery-shell ${className}`} data-public-theme={theme} data-public-appearance={fixedTheme ?? appearance.appearance}>
    <a className="discovery-skip" href="#discovery-main">Skip to content</a>
    <PublicPageNav appearanceControl={!fixedTheme} primaryAction={primaryNavAction}/>
    {children}
    <PublicFooter/>
  </div>;
}
