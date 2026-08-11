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
        <h3>Google and Meta connections</h3>
        <p>A Google or Meta connection remains unavailable for measurement until an authorized user selects the exact eligible account or property, assigns it organization-wide or to an owned workspace location, and approves a warning-free sample. Vanteloq may retain encrypted authorization credentials while the connection is active, the selected provider and resource identifiers, the chosen workspace scope, connection and sync status, and derived daily measurements with source and freshness details. We use that information only to provide the connected reporting and operational features requested by the workspace.</p>
        <p>Vanteloq does not access, import, store, or aggregate Google Business Profile review text, ratings, or reply content. Review reading and replies remain in Google&apos;s own interface.</p>
        <h3>Connected financial account information</h3>
        <p>When an authorized workspace owner chooses a bank connection, Vanteloq may use Plaid as a service provider to connect selected business accounts. Depending on the connection and consent shown, Vanteloq may receive account and institution names, masked account identifiers, account type, balances, transactions, transaction descriptions, pending or posted status, currency, provider item and account identifiers, and connection or sync status.</p>
        <p>Bank sign-in information entered in Plaid Link is handled by Plaid and the financial institution. Vanteloq does not receive the online banking credentials entered in that flow. When a Plaid connection is configured and an authorized workspace user completes the provider consent flow, the connection uses only the read-only data products disclosed in that flow and does not allow Vanteloq to move money. We use connected records for bookkeeping review, reconciliation, supported cash context, connection support, security, and audit evidence.</p>
        <h3>Uploaded invoices, receipts, and other documents</h3>
        <p>When a user uploads a business document, we may collect the original file, file name, type, size, cryptographic duplicate-check value, uploader, upload time, document category, storage reference, review status, and links to related transactions or records. If document extraction is enabled, we may also process proposed supplier, customer, date, amount, tax, currency, line-item, confidence, and source-page fields. Extracted fields remain subject to human review.</p>
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
          <li>store and review uploaded source documents, detect duplicate files, and support document extraction where that feature is enabled;</li>
          <li>provide reports, calculations, alerts, audit context, and operational workflows;</li>
          <li>maintain integrations and show their connection or verification status;</li>
          <li>respond to support requests and service communications;</li>
          <li>protect the service, investigate misuse, and meet legal obligations;</li>
          <li>improve reliability and usability using the service and security information described above; and</li>
          <li>send commercial electronic messages only with express or implied consent, or when an applicable CASL exception permits the message, with the required sender information and unsubscribe method;</li>
        </ul>
        <p>We do not sell personal information. We do not use workspace business data to create advertising profiles.</p>
      </PolicySection>

      <PolicySection id="authority" title="4. Consent and workspace authority">
        <p>We obtain consent where required and identify the purpose before or when information is collected. You may withdraw consent, subject to legal, security, and contractual limits. Withdrawal may prevent features that need the information from continuing to operate.</p>
        <p>A workspace customer decides which authorized users and supported sources are added. The customer is responsible for having the authority to provide business records and personal information to Vanteloq. If Vanteloq processes personal information for a customer, that customer remains responsible for its own notices, permissions, and legal obligations.</p>
        <h3 id="financial-connections">Financial-connection consent</h3>
        <p>Before Plaid Link opens, Vanteloq shows a separate financial-data authorization that names the requested data categories, each processing purpose, the read-only limitation, retention consequences, and withdrawal choices. The authorization is not preselected. An authenticated user must actively accept it, and Vanteloq records the workspace, user identifier, acceptance time, provider, data categories, purposes, and versions of this Privacy Policy and the authorization notice. Plaid then presents the eligible institutions, accounts, and provider-specific permissions in Plaid Link.</p>
        <p>A financial connection begins only after both steps are completed. A workspace owner can disconnect the connection, which stops scheduled access and causes stored provider access credentials to be revoked or deleted. The owner can then use the protected Plaid deletion control to delete unreviewed imports and remove bank/provider identifiers from accounting records that must remain. Approved, reconciled, or posted accounting fields and limited audit evidence may remain when needed for legal recordkeeping or a documented retention requirement.</p>
        <p>For Google and Meta, authorization alone does not approve measurement collection. An authorized workspace user must complete the provider resource and owned-location selection described above before measurement sync can begin. Disconnecting stops scheduled access and removes the local authorization credential even if the provider&apos;s remote revocation service is temporarily unavailable.</p>
        <p>Commercial electronic messages require express or implied consent, or an applicable CASL exception. A purchase, transaction, customer profile, or imported contact does not automatically establish consent to receive those messages. Customers remain responsible for determining which rule applies and for their notices, sender identification, contact information, unsubscribe controls, consent evidence, and suppression lists.</p>
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
        <p>Current infrastructure and product flows may involve Cloudflare for hosting and security, Supabase for authentication, Stripe for billing or supported payment data where configured, Plaid for a bank connection selected by an authorized workspace owner, and the provider chosen by a workspace for another authorized integration. Plaid also provides information about its handling of connected account data in its <a href="https://plaid.com/legal/#end-user-privacy-policy">End User Privacy Policy</a>.</p>
      </PolicySection>

      <PolicySection id="transfers" title="6. Processing outside Canada">
        <p>Some service providers may process or store personal information outside Canada. Cloudflare may process web traffic through its global network for hosting, delivery, and security. Supabase processes authentication information in the configured project region and may use subprocessors in other countries. Stripe may process billing and supported payment information in the United States and other countries outside Canada when configured. Plaid may process authorized financial-connection information in the United States and other countries identified in its privacy materials when configured. A customer-selected integration may also process authorization and synchronized records in countries disclosed by that provider.</p>
        <p>Information processed in another country may be subject to that country’s laws and lawful access rules. We assess providers and use contractual, technical, and organizational safeguards appropriate to the information and service. Contact the Privacy Officer at <a href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</a> to ask about a current service-provider location or safeguards relevant to a specific connection.</p>
      </PolicySection>

      <PolicySection id="retention" title="7. Retention and deletion">
        <p>We keep information only as long as reasonably needed for the purposes described in this policy, to provide the service, protect the integrity of business records, meet legal requirements, resolve disputes, and maintain security or audit evidence.</p>
        <p>Retention periods vary by record type. Account, transaction, audit, and accounting records may need different periods. When information is no longer required, we delete it, anonymize it, or securely isolate it until deletion is completed. Backup copies may remain for a limited period before being overwritten.</p>
        <p>Provider access credentials are kept only while the connection is active and are revoked or deleted after disconnection. Scheduled collection then stops. After disconnecting Plaid, an owner can permanently delete unreviewed Plaid imports. For a transaction already approved, reconciled, or posted into a journal, the deletion workflow removes Plaid identifiers, pending links, and transaction descriptions while retaining the minimum accounting fields needed to preserve ledger integrity.</p>
        <p>After a Google or Meta disconnection, Vanteloq removes the local access credential and stops collection. Selected resource identifiers, derived measurements, and limited audit evidence are deleted or retained only for the documented service, security, legal, or workspace recordkeeping purposes described in this policy.</p>
        <p>The operational retention schedule is reviewed at least annually and after a material provider, product, infrastructure, or legal change. Quarterly reviews identify expired purpose, unresolved deletion requests, legal holds, and records eligible for deletion or de-identification. A verified legal hold suspends deletion only for the affected records and documented period.</p>
        <p>Imported bank transactions, approved accounting records, original invoices and receipts, corrections, and review history may need a longer period because they support the customer’s books or legal obligations. Customers should export required records before closing an account and should confirm their retention duties with a qualified professional.</p>
        <p>Unsubscribe and suppression information may be kept in a minimal form so that a prior marketing choice can continue to be honoured. Security, incident, and audit records may be kept for a documented period that is proportionate to the risk and any applicable legal requirement.</p>
      </PolicySection>

      <PolicySection id="security" title="8. Safeguards">
        <p>Vanteloq uses safeguards designed for the sensitivity of the information, including authenticated access, records separated and scoped by organization, role-based server permissions, protected provider authorization flows, encrypted credential storage, request controls, and recorded audit and security events for important actions.</p>
        <p>Production browser, API, authentication, webhook, and provider traffic uses HTTPS. Vanteloq&apos;s production change control requires the managed edge to reject protocol versions below TLS 1.2 before Plaid production access is enabled. Stored application data is encrypted at rest by the managed database platform. Plaid access tokens and provider item identifiers receive an additional application-level AES-GCM encryption layer under a hosted key that is not stored with the database record. Vanteloq does not place raw Plaid credentials in browser storage, source control, ordinary connection-status responses, or application logs.</p>
        <p>No online service can promise absolute security. Users must protect their credentials, use strong passwords, enable available account protections, and promptly report suspected unauthorized access.</p>
      </PolicySection>

      <PolicySection id="rights" title="9. Access, correction, and privacy requests">
        <p>You may ask to access or correct personal information under our control, subject to legal exceptions. You may also ask about how information was used or disclosed, withdraw consent where applicable, or raise a privacy concern.</p>
        <p>Workspace controls may also allow an authorized owner to export records, disconnect a provider, correct reviewable fields, or request account deletion. A disconnection is not the same as deleting legally retained accounting records. We will explain any applicable limitation when responding to a verified request.</p>
        <p>Send a clear request to <a href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</a>. We may need to verify your identity and authority before responding. If information is controlled by a Vanteloq customer, we may direct the request to that customer.</p>
        <p>If a concern is not resolved, you may contact the <a href="https://oipc.ab.ca/">Office of the Information and Privacy Commissioner of Alberta</a> or the <a href="https://www.priv.gc.ca/">Office of the Privacy Commissioner of Canada</a>, depending on which law applies.</p>
      </PolicySection>

      <PolicySection id="automation" title="10. Analysis and human review">
        <p>Vanteloq may organize records and produce calculations, alerts, or suggested next steps from available data. These outputs depend on the quality, completeness, timing, and definitions of the source records. Material business, financial, legal, tax, employment, or inventory decisions should be reviewed by an authorized person and, where appropriate, a qualified professional.</p>
        <p>Document extraction can misread text, numbers, tax, dates, pages, suppliers, or other fields. Vanteloq keeps extracted values provisional until an authorized reviewer compares them with the original document. An extracted value is not an approved accounting entry, payment instruction, tax position, or professional conclusion.</p>
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
