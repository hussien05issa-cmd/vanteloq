import type { Metadata } from "next";
import Link from "next/link";
import { AccountDeletionSettings } from "../../governance-workspaces";
import ProductBrandLogo from "../../product-brand-logo";
import "./deletion.css";

export const metadata: Metadata = { title: "Delete my account | Vanteloq", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function AccountDeletionPage() {
  return <main className="account-deletion-page" style={{maxWidth:800,margin:"48px auto",padding:"24px"}}>
    <div style={{width:56}}><Link href="/" aria-label="Vanteloq home"><ProductBrandLogo product="vanteloq" priority /></Link></div>
    <h1>Vanteloq account deletion</h1>
    <p>Sign in and verify your authenticator to review the protected deletion controls. No paid subscription is required.</p>
    <p><Link href="/?auth=signin">Sign in</Link> · <Link href="/account/deletion-status">Resume a confirmed deletion</Link> · <Link href="/privacy">Privacy Policy</Link></p>
    <AccountDeletionSettings />
  </main>;
}
