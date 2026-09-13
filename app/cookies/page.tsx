import type { Metadata } from "next";
import { LegalContactLink, LegalShell, PolicySection } from "../legal-shell";

export const metadata: Metadata = {
  title: "Cookie Notice | Vanteloq",
  description: "Learn how Vanteloq uses essential browser storage and optional Google Analytics that runs only with consent.",
  alternates: { canonical: "/cookies" },
};

export default function CookiesPage() {
  return (
    <LegalShell eyebrow="PRIVACY AND STORAGE" title="Cookie Notice" summary="This notice explains the browser storage Vanteloq needs to operate, the optional analytics you can choose to allow, and how to change that choice.">
      <PolicySection id="overview" title="1. Overview">
        <p>Cookies are small files stored by a browser. Similar technologies include local storage and session storage. Vanteloq and its service providers may use these technologies when you visit the site or sign in.</p>
        <p>Vanteloq does not currently use advertising cookies or third-party behavioural advertising trackers. Optional Google Analytics is blocked until a visitor makes an explicit choice to allow it.</p>
      </PolicySection>

      <PolicySection id="essential" title="2. Essential storage">
        <p>Essential cookies and browser storage support:</p>
        <ul>
          <li>account authentication and secure session continuity;</li>
          <li>password recovery and identity verification;</li>
          <li>fraud, bot, abuse, and request protection;</li>
          <li>authorization callbacks for supported integrations;</li>
          <li>security settings and short-lived workflow state; and</li>
          <li>preferences needed to operate the interface on your device, including the saved cookie choice.</li>
        </ul>
        <p>Blocking essential storage may prevent sign-in, account recovery, provider connections, or other protected features from working.</p>
      </PolicySection>

      <PolicySection id="providers" title="3. Service providers">
        <p>Authentication and security providers may set or read essential cookies or browser storage on Vanteloq’s behalf. Current flows may involve Supabase for authentication and Cloudflare for hosting, network security, and bot protection. A connected provider may also use short-lived state during its own authorization process.</p>
      </PolicySection>

      <PolicySection id="analytics" title="4. Analytics and marketing">
        <p>If you select Allow analytics, Vanteloq loads Google Analytics to measure visits, page paths, device and browser context, approximate region, and interaction events made available by the configured web stream. We use this information to understand site performance and improve navigation and content.</p>
        <p>The Vanteloq implementation excludes URL query strings from page view events, keeps Google advertising signals and ad personalization disabled, and does not intentionally send account details, form entries, email addresses, telephone numbers, or workspace records to Google Analytics. Google may set analytics cookies such as <code>_ga</code> after consent. Google processes the analytics information under its own terms and privacy materials.</p>
        <p>Product records and security events inside an authenticated workspace remain service data under the Privacy Policy. They are not added to visitor analytics or used to create advertising profiles.</p>
      </PolicySection>

      <PolicySection id="controls" title="5. Your controls">
        <p>You can use browser settings to inspect, delete, or block cookies and site data. Deleting authentication storage will usually sign you out. Browser privacy controls may also limit integration callbacks or account recovery.</p>
        <p>The first time the analytics choice is available, you can select Essential only or Allow analytics. The choice is not preselected. Use the Cookie settings button at any time to change it. Choosing Essential only or withdrawing analytics permission does not limit Vanteloq features. It stops new analytics events and removes Google Analytics cookies that this site can access.</p>
        <p>For questions about browser storage, use <LegalContactLink/>.</p>
      </PolicySection>

      <PolicySection id="changes" title="6. Changes to this notice">
        <p>We will update this notice if Vanteloq adds a new category of cookies, browser storage, analytics, or advertising technology. Where law requires consent, the choice will be presented before optional technology is used.</p>
      </PolicySection>
    </LegalShell>
  );
}
