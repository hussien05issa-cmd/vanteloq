"use client";

import type { ReactNode } from "react";
import { usePublicAppearance } from "./public-appearance";
import "./public-surface.css";

/** Public destination pages share the device setting, never workspace overrides. */
export default function PublicSurface({ className = "", children }: { className?: string; children: ReactNode }) {
  const { appearance, theme } = usePublicAppearance();
  return <div className={`public-site public-surface ${className}`} data-public-theme={theme} data-public-appearance={appearance}>{children}</div>;
}
