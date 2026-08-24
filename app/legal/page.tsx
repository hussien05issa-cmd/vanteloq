import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell, PolicySection } from "../legal-shell";

export const metadata: Metadata = {
  title: "Legal Centre | Vanteloq",
  description: "Read Vanteloq's Privacy Policy, Terms of Service, Cookie Notice, connected-data boundaries, and professional review notice.",
  alternates: { canonical: "/legal" },
};

export default function LegalPage() {
  return (
    <LegalShell eyebrow="VANTELOQ LEGAL CENTRE" title="Clear rules for using Vanteloq." summary="Find the policies that explain how the service works, how personal information is handled, and what each party is responsible for.">
      <PolicySection id="documents" title="Legal documents">
        <p>These documents apply to the Vanteloq website, workspaces, resource library, and supported service features. Read the Privacy Policy and Terms of Service before creating or administering a workspace.</p>
        <div className="legal-card-grid">
          <Link href="/privacy"><small>PRIVACY</small><strong>Privacy Policy</strong><span>What we collect, why we use it, who may process it, and how to make a privacy request.</span></Link>
          <Link href="/terms"><small>SERVICE RULES</small><strong>Terms of Service</strong><span>Account responsibilities, acceptable use, connected data, service limits, and legal terms.</span></Link>
          <Link href="/cookies"><small>BROWSER STORAGE</small><strong>Cookie Notice</strong><span>The essential cookies and browser storage used for sign-in, security, and service preferences.</span></Link>
          <Link href="/data-processing"><small>CUSTOMER DATA</small><strong>Data Processing Addendum</strong><span>Processing instructions, safeguards, rights assistance, incident support, and deletion commitments.</span></Link>
          <Link href="/subprocessors"><small>PROVIDERS</small><strong>Subprocessors and Connected Services</strong><span>Core infrastructure and optional services that may receive data when a customer enables them.</span></Link>
          <Link href="/#security"><small>PRODUCT CONTROLS</small><strong>Security overview</strong><span>Verified application controls, including access boundaries, permissions, and protected connections.</span></Link>
        </div>
      </PolicySection>
      <PolicySection id="operator" title="Who operates Vanteloq">
        <p>Vanteloq is operated by LexEdge Consulting in Alberta, Canada. References to “Vanteloq,” “we,” “us,” or “our” in these documents refer to LexEdge Consulting operating the Vanteloq service.</p>
        <p>Questions about these documents can be sent to <a href="mailto:hussienissa@lexedgeconsulting.com">hussienissa@lexedgeconsulting.com</a>.</p>
      </PolicySection>
      <PolicySection id="boundaries" title="Connected data and product boundaries">
        <ul>
          <li>A Plaid connection begins through an authorized provider consent flow and is read-only for the disclosed data products. It does not allow Vanteloq to move money. Disconnecting revokes or deletes stored access credentials and stops scheduled access, while accounting records may remain under a valid retention requirement.</li>
          <li>Uploaded invoices and receipts remain source evidence. Extracted fields can be incomplete or incorrect and require comparison with the original document before posting, payment, filing, or tax use.</li>
          <li>Vanteloq and BookLoQ support record organization, analysis, reconciliation, and review. They do not replace legal, accounting, tax, payroll, or financial advice.</li>
          <li>A transaction or customer record is not automatically consent to send marketing. Customers remain responsible for establishing express or implied consent, or an applicable CASL exception, and for sender information, unsubscribe controls, consent evidence, and suppression records.</li>
          <li>An integration, recommendation, or workflow does not guarantee sales, profit, legal compliance, tax treatment, provider availability, or a particular business result.</li>
        </ul>
      </PolicySection>
      <PolicySection id="review" title="Professional review recommended">
        <div className="legal-note"><strong>Important:</strong> These documents are written to reflect the current Vanteloq product and Canadian privacy principles, but no website notice can guarantee that every legal issue has been resolved. A qualified Alberta lawyer should review the service, provider agreements, customer contracts, privacy practices, cross-border processing, retention schedule, and commercial-message workflows before paid subscriptions or broad public onboarding begin. Accounting and tax controls should also be reviewed by the appropriate qualified professionals.</div>
      </PolicySection>
    </LegalShell>
  );
}
