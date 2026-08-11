import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell, PolicySection } from "../legal-shell";

export const metadata: Metadata = {
  title: "Legal Centre | Vanteloq",
  description: "Read Vanteloq's Privacy Policy, Terms of Service, and Cookie Notice.",
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
          <Link href="/#security"><small>PRODUCT CONTROLS</small><strong>Security overview</strong><span>Verified application controls, including access boundaries, permissions, and protected connections.</span></Link>
        </div>
      </PolicySection>
      <PolicySection id="operator" title="Who operates Vanteloq">
        <p>Vanteloq is operated by LexEdge Consulting in Alberta, Canada. References to “Vanteloq,” “we,” “us,” or “our” in these documents refer to LexEdge Consulting operating the Vanteloq service.</p>
        <p>Questions about these documents can be sent to <a href="mailto:hussienissa@lexedgeconsulting.com">hussienissa@lexedgeconsulting.com</a>.</p>
      </PolicySection>
      <PolicySection id="review" title="Professional review recommended">
        <div className="legal-note"><strong>Important:</strong> These documents are written to reflect the current Vanteloq product and Canadian privacy principles. They should still be reviewed by a qualified Alberta lawyer before paid subscriptions or broad public onboarding begin.</div>
      </PolicySection>
    </LegalShell>
  );
}
