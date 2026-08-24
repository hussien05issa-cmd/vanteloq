import type { Metadata } from "next";
import { LEGAL_EMAIL, LegalShell, PolicySection } from "../legal-shell";

export const metadata: Metadata = {
  title: "Cookie Notice | Vanteloq",
  description: "Learn how Vanteloq uses essential cookies and browser storage for sign-in, security, and preferences.",
  alternates: { canonical: "/cookies" },
};

export default function CookiesPage() {
  return (
    <LegalShell eyebrow="COOKIE NOTICE" title="Only the browser storage the service needs." summary="This notice explains the cookies and similar browser storage used for account access, security, and essential service behaviour.">
      <PolicySection id="overview" title="1. Overview">
        <p>Cookies are small files stored by a browser. Similar technologies include local storage and session storage. Vanteloq and its service providers may use these technologies when you visit the site or sign in.</p>
        <p>Vanteloq does not currently use advertising cookies or third-party behavioural advertising trackers. If that changes, this notice and any required consent choices will be updated before those tools are activated.</p>
      </PolicySection>

      <PolicySection id="essential" title="2. Essential storage">
        <p>Essential cookies and browser storage support:</p>
        <ul>
          <li>account authentication and secure session continuity;</li>
          <li>password recovery and identity verification;</li>
          <li>fraud, bot, abuse, and request protection;</li>
          <li>authorization callbacks for supported integrations;</li>
          <li>security settings and short-lived workflow state; and</li>
          <li>preferences needed to operate the interface on your device.</li>
        </ul>
        <p>Blocking essential storage may prevent sign-in, account recovery, provider connections, or other protected features from working.</p>
      </PolicySection>

      <PolicySection id="providers" title="3. Service providers">
        <p>Authentication and security providers may set or read essential cookies or browser storage on Vanteloq’s behalf. Current flows may involve Supabase for authentication and Cloudflare for hosting, network security, and bot protection. A connected provider may also use short-lived state during its own authorization process.</p>
      </PolicySection>

      <PolicySection id="analytics" title="4. Analytics and marketing">
        <p>Vanteloq does not currently activate a separate visitor analytics or advertising cookie system on the public site. Product records and security events inside an authenticated workspace are handled as service data under the Privacy Policy, not as advertising profiles.</p>
      </PolicySection>

      <PolicySection id="controls" title="5. Your controls">
        <p>You can use browser settings to inspect, delete, or block cookies and site data. Deleting authentication storage will usually sign you out. Browser privacy controls may also limit integration callbacks or account recovery.</p>
        <p>Because Vanteloq currently uses only essential storage, there is no optional cookie category to enable or disable in the service. Optional analytics, advertising, or profiling tools will remain blocked unless and until the notice and any legally required consent control are deployed first.</p>
        <p>For questions about browser storage, contact <a href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</a>.</p>
      </PolicySection>

      <PolicySection id="changes" title="6. Changes to this notice">
        <p>We will update this notice if Vanteloq adds a new category of cookies, browser storage, analytics, or advertising technology. Where law requires consent, the choice will be presented before optional technology is used.</p>
      </PolicySection>
    </LegalShell>
  );
}
