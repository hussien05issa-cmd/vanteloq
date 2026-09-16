import type { Metadata } from "next";
import { Suspense } from "react";
import UnsubscribeForm from "./unsubscribe-form";
export const metadata: Metadata = { title: "Email Preferences | Vanteloq", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function UnsubscribePage() { return <Suspense fallback={<main className="email-unsubscribe-shell" role="status">Loading email preferences…</main>}><UnsubscribeForm /></Suspense>; }
