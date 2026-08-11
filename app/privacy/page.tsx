import type { Metadata } from "next";
import { LEGAL_EMAIL, LegalShell, PolicySection } from "../legal-shell";

export const metadata: Metadata = {
  title: "Privacy Policy | Vanteloq",
  description: "Learn how Vanteloq collects, uses, shares, protects, and retains personal information.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalShell eyebrow="PRIVACY POLICY" title="Your information should have a clear purpose." summary="This policy explains what Vanteloq handles, why it is needed, and the choices available to account holders and other individuals.">
      <PolicySection id="scope" title="1. Scope and accountability">
        <p>This Privacy Policy applies when you visit vanteloq.com, create or use a Vanteloq account, administer a workspace, connect a supported service, submit a form, or contact us.</p>
        <p>LexEdge Consulting, operating as Vanteloq, is responsible for personal information under its control. The privacy contact is the Vanteloq Privacy Officer at <a href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</a>.</p>
        <p>Vanteloq follows Alberta’s <a href="https://www.alberta.ca/personal-information-protection-act">Personal Information Protection Act</a> and Canada’s <a href="https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/">Personal Information Protection and Electronic Documents Act</a> where each law applies.</p>
      </PolicySection>

      <PolicySection id="collection" title="2. Information we collect">
        <h3>Account and workspace information</h3>
        <p>We collect information you provide, such as your name, email address, password credentials handled by the authentication provider, business name, legal name, business contact details, role, location information, operating hours, and workspace settings.</p>
        <h3>Connected business information</h3>
        <p>When an authorized workspace user connects a supported provider or imports records, Vanteloq may receive sales, payment, refund, product, inventory, customer, supplier, location, purchasing, finance, and operational records. The exact fields depend on the source, the permissions granted, and the import selected by the user.</p>
        <h3>Service and security information</h3>
        <p>We may collect device and browser details, IP address, timestamps, authentication events, audit events, integration status, request identifiers, error details, and records of actions taken inside a workspace. This information supports sign-in, fraud prevention, troubleshooting, access control, and service reliability.</p>
        <h3>Communications and billing information</h3>
        <p>We collect messages and support details that you send to us. If paid billing becomes available, the payment processor may provide subscription status, plan, billing contact, transaction identifiers, and limited payment details. Vanteloq does not need to store full card numbers.</p>
      </PolicySection>

      <PolicySection id="use" title="3. How we use information">
        <p>We use information to:</p>
        <ul>
          <li>create, authenticate, secure, and administer accounts and workspaces;</li>
          <li>import, organize, reconcile, display, and analyze records selected by authorized users;</li>
          <li>provide reports, calculations, alerts, audit context, and operational workflows;</li>
          <li>maintain integrations and show their connection or verification status;</li>
          <li>respond to support requests and service communications;</li>
          <li>protect the service, investigate misuse, and meet legal obligations;</li>
          <li>improve reliability and usability using limited service information; and</li>
          <li>send commercial messages only where consent or another lawful basis exists, with an unsubscribe method when required.</li>
        </ul>
        <p>We do not sell personal information. We do not use workspace business data to create advertising profiles.</p>
      </PolicySection>

      <PolicySection id="authority" title="4. Consent and workspace authority">
        <p>We obtain consent where required and identify the purpose before or when information is collected. You may withdraw consent, subject to legal, security, and contractual limits. Withdrawal may prevent features that need the information from continuing to operate.</p>
        <p>A workspace customer decides which authorized users and supported sources are added. The customer is responsible for having the authority to provide business records and personal information to Vanteloq. If Vanteloq processes personal information for a customer, that customer remains responsible for its own notices, permissions, and legal obligations.</p>
      </PolicySection>

      <PolicySection id="sharing" title="5. When information is shared">
        <p>We may disclose information:</p>
        <ul>
          <li>to authorized users in the same workspace according to their roles and permissions;</li>
          <li>to providers that support hosting, authentication, security, email delivery, payments, support, and connected services;</li>
          <li>when an authorized user directs a connection, export, or disclosure;</li>
          <li>to investigate security incidents or enforce the Terms of Service;</li>
          <li>where required by law, court order, or lawful government request; or</li>
          <li>as part of a business transaction, subject to appropriate confidentiality and legal protections.</li>
        </ul>
        <p>Current infrastructure and product flows may involve Cloudflare for hosting and security, Supabase for authentication, Stripe for billing or supported payment data where configured, and the provider chosen by a workspace for an authorized integration.</p>
      </PolicySection>

      <PolicySection id="transfers" title="6. Processing outside Canada">
        <p>Some service providers may process or store information outside Alberta or Canada. Information in another jurisdiction may be subject to that jurisdiction’s laws and lawful access rules. We assess providers and use contractual, technical, and organizational safeguards appropriate to the information and service.</p>
      </PolicySection>

      <PolicySection id="retention" title="7. Retention and deletion">
        <p>We keep information only as long as reasonably needed for the purposes described in this policy, to provide the service, protect the integrity of business records, meet legal requirements, resolve disputes, and maintain security or audit evidence.</p>
        <p>Retention periods vary by record type. Account, transaction, audit, and accounting records may need different periods. When information is no longer required, we delete it, anonymize it, or securely isolate it until deletion is completed. Backup copies may remain for a limited period before being overwritten.</p>
      </PolicySection>

      <PolicySection id="security" title="8. Safeguards">
        <p>Vanteloq uses safeguards designed for the sensitivity of the information, including authenticated access, tenant-scoped records, role-based server permissions, protected provider authorization flows, encrypted credential storage, request controls, and audit events for important actions.</p>
        <p>No online service can promise absolute security. Users must protect their credentials, use strong passwords, enable available account protections, and promptly report suspected unauthorized access.</p>
      </PolicySection>

      <PolicySection id="rights" title="9. Access, correction, and privacy requests">
        <p>You may ask to access or correct personal information under our control, subject to legal exceptions. You may also ask about how information was used or disclosed, withdraw consent where applicable, or raise a privacy concern.</p>
        <p>Send a clear request to <a href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</a>. We may need to verify your identity and authority before responding. If information is controlled by a Vanteloq customer, we may direct the request to that customer.</p>
        <p>If a concern is not resolved, you may contact the <a href="https://oipc.ab.ca/">Office of the Information and Privacy Commissioner of Alberta</a> or the <a href="https://www.priv.gc.ca/">Office of the Privacy Commissioner of Canada</a>, depending on which law applies.</p>
      </PolicySection>

      <PolicySection id="automation" title="10. Analysis and human review">
        <p>Vanteloq may organize records and produce calculations, alerts, or suggested next steps from available data. These outputs depend on the quality, completeness, timing, and definitions of the source records. Material business, financial, legal, tax, employment, or inventory decisions should be reviewed by an authorized person and, where appropriate, a qualified professional.</p>
      </PolicySection>

      <PolicySection id="children" title="11. Business users and children">
        <p>Vanteloq is a business service for people authorized to act for an organization. It is not directed to children, and we do not knowingly collect personal information from children for their own use of the service.</p>
      </PolicySection>

      <PolicySection id="changes" title="12. Changes to this policy">
        <p>We may update this policy when the service, providers, or legal requirements change. We will post the revised policy with a new update date. If a change materially affects how personal information is used, we will provide additional notice or seek consent where required.</p>
      </PolicySection>
    </LegalShell>
  );
}
