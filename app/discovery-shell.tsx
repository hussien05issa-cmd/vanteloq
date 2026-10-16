"use client";

import type { ReactNode } from "react";
import PublicPageNav from "./public-page-nav";
import PublicFooter from "./public-footer";
import { usePublicAppearance } from "./public-appearance";
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

/** Public guides follow the device; explicit brand-page themes remain fixed. */
export default function DiscoveryShell({ children, className = "", fixedTheme, primaryNavAction }: DiscoveryShellProps) {
  const appearance = usePublicAppearance();
  return <div className={`public-site discovery-shell ${className}`} data-public-theme={fixedTheme ?? appearance.theme} data-public-appearance={fixedTheme ?? appearance.appearance}>
    <a className="discovery-skip" href="#discovery-main">Skip to content</a>
    <PublicPageNav primaryAction={primaryNavAction}/>
    {children}
    <PublicFooter/>
  </div>;
}
