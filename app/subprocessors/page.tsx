import type { Metadata } from "next";
import { LegalContactLink, LegalShell, PolicySection } from "../legal-shell";

export const metadata: Metadata = {
  title: "Subprocessors and Connected Services | Vanteloq",
  description: "Current Vanteloq infrastructure providers, subprocessors, optional connected services, purposes, and processing locations.",
  alternates: { canonical: "/subprocessors" },
};

export default function SubprocessorsPage() {
  return <LegalShell updated="September 10, 2026" eyebrow="SERVICE PROVIDER NOTICE" title="Know where Vanteloq sends information." summary="This list separates core infrastructure from services a workspace chooses to connect.">
    <PolicySection id="core" title="Core subprocessors">
      <div className="legal-table"><table><thead><tr><th>Provider</th><th>Purpose and information</th><th>Location note</th></tr></thead><tbody>
        <tr><td>Cloudflare, Inc.</td><td>Hosting, network delivery and protection, managed application database, and encrypted file storage. Processes service traffic, workspace records, uploaded files, and security information.</td><td>Canada and Cloudflare&apos;s global network, subject to its service configuration and terms.</td></tr>
        <tr><td>Supabase, Inc.</td><td>Authentication, account verification, multifactor authentication, password recovery, and protected team invitations. Processes account identifiers, email, authentication records, and security metadata.</td><td>The configured project region and Supabase subprocessors.</td></tr>
        <tr><td>Stripe, Inc. and affiliates</td><td>Subscription checkout, payment method collection, recurring billing, billing portal, tax related checkout fields, and payment status. Vanteloq receives references and status, not full card numbers.</td><td>Canada, the United States, and other locations described by Stripe.</td></tr>
        <tr><td>Resend, Inc.</td><td>Transactional email delivery, such as an invoice email initiated by an authorized user. Processes recipient, sender, subject, message content, and delivery metadata.</td><td>The United States and provider locations described by Resend.</td></tr>
        <tr><td>Canada Post AddressComplete</td><td>Customer directed business address search and validation. Processes the address search text, country, returned suggestion identifier, and requested address result.</td><td>Canada and locations identified in the AddressComplete service terms.</td></tr>
        <tr><td>Google LLC, Google Analytics</td><td>Optional public website measurement after the visitor explicitly allows analytics. Processes page paths without URL query text, device and browser context, approximate region, timestamps, and configured interaction events. Advertising signals and ad personalization remain disabled.</td><td>The United States and other locations described in Google&apos;s service materials.</td></tr>
      </tbody></table></div>
    </PolicySection>
    <PolicySection id="optional" title="Optional customer directed services">
      <p>These services receive information only after an authorized user enables the relevant feature and completes the displayed provider and Vanteloq controls. Their own terms and privacy materials also apply.</p>
      <ul>
        <li><strong>Plaid:</strong> read only business financial account connection, balances, and transactions selected by a workspace owner.</li>
        <li><strong>Google:</strong> selected marketing resources and Business Profile information after the specific authorization and resource selection shown in Vanteloq. Google does not provide Vanteloq AI responses.</li>
        <li><strong>OpenAI:</strong> optional Vanteloq AI analysis using the question, permission-filtered business and financial KPIs and bounded conversation context, only when configured and selected with affirmative acceptance. Processing may occur in the United States and other provider locations. Requests disable stored response objects; provider safety retention can still apply.</li>
        <li><strong>Meta:</strong> selected marketing account and measurement records.</li>
        <li><strong>Intuit QuickBooks Online:</strong> a customer selected company identifier, company name, authorization status, and accounting records only when the staged accounting import is later enabled and expressly authorized.</li>
        <li><strong>Shopify, Square, Clover, Lightspeed, Stripe Connect, and Moneris:</strong> customer directed commerce, payment reference, product, inventory, location, or reporting records available under the permissions shown during connection.</li>
      </ul>
      <p>Placeholder integrations shown as unavailable do not receive Customer Data.</p>
    </PolicySection>
    <PolicySection id="changes" title="Changes and questions">
      <p>This notice is updated before a new core subprocessor begins materially different processing. Customers may use <LegalContactLink/> for current provider information or to raise a reasonable data protection objection.</p>
    </PolicySection>
  </LegalShell>;
}
