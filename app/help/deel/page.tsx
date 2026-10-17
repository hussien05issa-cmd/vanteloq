import type { Metadata } from "next";
import Link from "next/link";
import PublicPageNav from "../../public-page-nav";

export const metadata: Metadata = {
  title: "Connect Deel for payroll report review | Vanteloq help",
  description: "Deel preview setup, read permissions, payroll report staging, supported location mapping and safe disconnection in Vanteloq.",
  alternates: { canonical: "/help/deel" },
};

export default function DeelHelpPage() {
  return <div className="public-site demo-page"><PublicPageNav/><main className="product-help">
    <p className="demo-eyebrow">DEEL CONNECTION GUIDE</p>
    <h1>Connect Deel for payroll report review.</h1>
    <p>Review available payroll reports as category totals by currency, with their source and limitations visible.</p>
    <p className="help-boundary">Deel is currently an authorized preview. Public customer access requires Deel approval and further release verification. If the card says Coming Soon, contact support.</p>
    <nav aria-label="Deel setup topics"><a href="#connect">Connect your organization</a><a href="#reports">Stage and review reports</a><a href="#remove">Resolve problems and stop access</a></nav>
    <div className="product-help-topics">
      <section id="connect"><h2>Connect the right organization.</h2><ol>
        <li>Sign in to the correct Vanteloq workspace. An authorized owner or administrator needs integration-management and payroll-total permissions.</li>
        <li>Open Integrations &amp; data and select Deel. Read the data-use notice, both privacy policies and the requested read scopes before accepting the aggregate-storage acknowledgement.</li>
        <li>Continue to Deel, choose the organization you are authorized to manage and review Deel&apos;s permission screen. Return to Vanteloq and check the connected account and status.</li>
        <li>Check location coverage before importing. With one active Vanteloq location, discovered global-payroll legal entities are assigned to it automatically. Multi-location mapping is not yet available through a dedicated Deel control. Contact support before proceeding with multiple locations.</li>
      </ol><p className="help-boundary">The requested scopes read organizations, accounting, legal entities and payslips. Deel&apos;s gross-to-net response can include worker identifiers, individual report items and payment metadata. Vanteloq discards those details when creating its stored category aggregates; the provider permission is broader than the retained reports.</p></section>
      <section id="reports"><h2>Stage reports before using the totals.</h2><ol>
        <li>Use the connected Deel card&apos;s manual staging action. Its default range covers the preceding 120 days; a request supports at most 366 days.</li>
        <li>Review the selected legal entity, payroll cycles, currencies, category totals, source timestamps and synchronization status. Compare the totals with the source reports.</li>
        <li>Keep each currency separate. A gross-to-net report being available does not prove that payroll is finalized, approved or paid.</li>
      </ol><p className="help-boundary">Current imports remain staged. They do not supply verified wages or paid hours, update approved operating reports, run payroll, pay employees, remit deductions or automatically post BookLoQ journals. Individual payslip files are not imported.</p></section>
      <section id="remove"><h2>Resolve problems and stop access.</h2><ol>
        <li>If Deel rate-limits a request, wait before trying again. If authorization cannot be confirmed or has expired, start a fresh connection.</li>
        <li>A failed multi-cycle synchronization can leave aggregates from earlier cycles already staged. Review them and the error before retrying.</li>
        <li>Disconnect in Vanteloq to remove local credentials, authorization states, mappings and staged Deel aggregates. Also remove Vanteloq from your Deel account to end the provider-side app grant.</li>
      </ol><p className="help-boundary">Limited connection and audit history can remain under the retention policy. Local disconnection does not itself prove that Deel revoked the provider grant.</p></section>
    </div>
    <p>For help, <Link href="/contact">contact Vanteloq</Link> or email <a href="mailto:support@vanteloq.com">support@vanteloq.com</a>. Include the relevant status or error code. Do not send passwords, tokens or worker payroll records.</p>
    <p><Link href="/privacy">Vanteloq Privacy Policy</Link> · <Link href="/terms">Terms</Link> · <Link href="/privacy#retention">Retention policy</Link> · <a href="https://www.deel.com/privacy/">Deel Privacy Policy</a></p>
    <p><Link href="/help">Back to the help centre</Link></p>
  </main></div>;
}
