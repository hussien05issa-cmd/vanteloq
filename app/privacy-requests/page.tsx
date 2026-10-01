import Link from "next/link";
import ShopifyPrivacyRequests from "../shopify-privacy-requests";
export const metadata = { title: "Privacy requests | Vanteloq", robots: { index: false, follow: false } };
export default function PrivacyRequestsPage() {
  return <main className="content"><p><Link href="/">Return to Vanteloq and sign in</Link></p><h1>Manage privacy requests</h1>
    <p>This page uses your signed-in workspace. Privacy response access remains available after a subscription ends. Customer exports are private and must be delivered through a verified secure channel.</p>
    <ShopifyPrivacyRequests />
  </main>;
}
