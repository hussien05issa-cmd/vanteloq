import type { Metadata } from "next";
import { LEGAL_EMAIL, LegalShell, PolicySection } from "../legal-shell";

export const metadata: Metadata = {
  title: "Terms of Service | Vanteloq",
  description: "Read the terms that apply to Vanteloq accounts, workspaces, connected data, and service use.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalShell eyebrow="TERMS OF SERVICE" title="The rules for using Vanteloq." summary="These terms explain account authority, acceptable use, customer data, service limits, and each party's responsibilities.">
      <div className="legal-note"><strong>Please read these terms carefully.</strong> By creating an account, accepting an order, or using Vanteloq, you agree to these Terms of Service on behalf of yourself and, where applicable, the organization you represent.</div>

      <PolicySection id="agreement" title="1. Agreement and operator">
        <p>Vanteloq is operated by LexEdge Consulting in Alberta, Canada. “Vanteloq,” “we,” “us,” and “our” refer to LexEdge Consulting operating the Vanteloq service. “Customer” means the organization that creates or receives a workspace. “User” means an individual permitted to access that workspace.</p>
        <p>If you use Vanteloq for an organization, you confirm that you have authority to accept these terms for that organization. If you do not have that authority or do not agree, do not create or use the workspace.</p>
      </PolicySection>

      <PolicySection id="service" title="2. The service">
        <p>Vanteloq provides business operations, analytics, record organization, integration, reporting, and workflow tools. Available features depend on workspace access, configuration, supported sources, verified records, and technical availability.</p>
        <p>Some features may be identified as pilot, staging, demonstration, preview, disabled, or not connected. Those labels are part of the service description. They must not be treated as a promise that a feature is production-ready or will become available by a particular date.</p>
      </PolicySection>

      <PolicySection id="accounts" title="3. Accounts and workspace administration">
        <p>You must provide accurate registration information, protect account credentials, and keep contact details current. Accounts are personal to the authorized user and may not be shared. You are responsible for activity performed through your account unless you promptly report unauthorized access.</p>
        <p>The customer controls workspace membership, roles, permissions, source connections, and exports. Workspace owners and administrators must only grant access that is appropriate for each user’s duties.</p>
        <p>A workspace owner represents that they are authorized to make organization wide decisions, including inviting or removing users, accepting current service terms, connecting providers, managing billing, exporting records, and permanently deleting the workspace and every linked Vanteloq account. The customer must promptly change access when a user&apos;s duties or employment changes.</p>
      </PolicySection>

      <PolicySection id="data" title="4. Customer data and connected services">
        <p>Customer retains ownership of business records, personal information, files, and other content submitted to the service, called “Customer Data.” Customer gives Vanteloq a limited right to host, copy, transmit, organize, calculate, display, and otherwise process Customer Data only as needed to provide, secure, and support the service, follow Customer instructions, or comply with law.</p>
        <p>Customer confirms that it has the rights, authority, notices, and consents needed to provide Customer Data and connect third-party services. Customer must follow the terms of each connected provider. Third-party services remain responsible for their own systems, records, availability, and acts.</p>
        <p>When an authorized user completes a Plaid connection, the customer instructs Vanteloq and Plaid to access the selected business account information and approved read-only data categories for bookkeeping, reconciliation, supported cash analysis, connection support, and security. The connection does not authorize Vanteloq to move money. The customer is responsible for selecting only accounts it is authorized to connect. Provider and subprocessor handling, including processing outside Canada, is further described in the Privacy Policy and the provider’s applicable terms.</p>
        <p>Disconnecting a provider stops future scheduled access and causes stored access credentials to be revoked or deleted. It does not automatically erase imported transactions, approved accounting entries, uploaded source documents, corrections, or audit evidence that remains subject to a customer policy or legal retention requirement. Customers should export required records before ending access.</p>
        <p>Uploaded invoices, receipts, statements, and other files remain Customer Data. The customer must have authority to store them and must not upload malicious, unlawful, irrelevant, or unnecessary personal information. Vanteloq may reject, quarantine, or restrict a file to protect the service or enforce configured document controls.</p>
        <p>Vanteloq may restrict or disconnect an integration that creates a security risk, violates provider rules, loses authorization, or cannot be reconciled reliably.</p>
        <p>The <a href="/data-processing">Data Processing Addendum</a> forms part of these terms when Vanteloq processes personal information for the customer. Current core providers and optional connected services are listed in the <a href="/subprocessors">Subprocessor and Connected Service Notice</a>.</p>
      </PolicySection>

      <PolicySection id="acceptable-use" title="5. Acceptable use">
        <p>You must not:</p>
        <ul>
          <li>use the service unlawfully or violate another person’s rights;</li>
          <li>access a workspace, record, feature, or account without authorization;</li>
          <li>upload malicious code or attempt to bypass security, rate limits, access controls, or audit records;</li>
          <li>probe or test the service for vulnerabilities without written permission;</li>
          <li>interfere with service availability or use automated access that creates unreasonable load;</li>
          <li>copy, resell, reverse engineer, or create a competing service from protected Vanteloq materials except where law expressly permits;</li>
          <li>use the service to make deceptive, discriminatory, or unlawful decisions about individuals; or</li>
          <li>submit data you are not authorized to use.</li>
        </ul>
        <p>If the customer uses Vanteloq records, plans, or connected services for commercial electronic messages, the customer remains responsible for establishing express or implied consent, or an applicable CASL exception, and for sender identification, required contact information, a functioning unsubscribe method, consent evidence, and suppression of recipients who opted out. A purchase, transaction, customer profile, or imported contact is not automatically marketing consent. Vanteloq will not send or schedule an external campaign unless that capability is explicitly identified as available and an authorized user completes the applicable preview and approval controls.</p>
      </PolicySection>

      <PolicySection id="outputs" title="6. Calculations, recommendations, and professional advice">
        <p>Vanteloq outputs depend on the source records, definitions, dates, mappings, assumptions, and limits shown in the product. Missing, delayed, duplicated, or incorrect source data can produce incomplete or incorrect outputs.</p>
        <p>Text or data extracted from an invoice, receipt, statement, or other source file can be incomplete or incorrect. Extracted supplier, date, amount, tax, account, and line-item fields remain proposed values until an authorized person compares them with the original record. Vanteloq does not automatically approve an entry, tax claim, payment, or filing merely because a field was extracted or matched.</p>
        <p>Vanteloq and BookLoQ do not replace an accountant, lawyer, tax professional, financial adviser, payroll professional, or other qualified adviser. Users must review material decisions and source records. The customer remains responsible for filings, payments, remittances, employment decisions, purchase commitments, accounting entries, marketing communications, and business actions. The service does not move money, pay invoices, submit tax filings, or make professional determinations unless a separate capability is explicitly identified, authorized, and operational.</p>
        <h3>Payroll accounting in this release</h3>
        <p>BookLoQ supports manual accounting entries from a payroll report that the customer has already verified. It does not calculate employee deductions, produce a compliant pay run, pay employees, remit deductions, or file payroll returns. Recording an accrual or matching a bank transaction does not establish that payroll obligations have been satisfied. The customer must use a qualified payroll professional or an appropriate payroll provider for those tasks.</p>
        <p>Use aggregate accounting totals and a nonidentifying report reference in payroll journals. Do not enter Social Insurance Numbers, employee banking details, provider passwords, or individual compensation details in journal descriptions. Retain the original payroll reports and required records in an appropriately protected recordkeeping system, including records required after an account is closed.</p>
      </PolicySection>

      <PolicySection id="fees" title="7. Fees and subscriptions">
        <p>The selected monthly fee, included features, optional add-ons, taxes, total due, trial terms if any, and renewal details are shown in the Vanteloq plan screen and Stripe Checkout before purchase. Government imposed taxes may be added as shown in Checkout. The customer must enter a payment method and authorizes Stripe to charge it according to the displayed order.</p>
        <p>New subscriptions renew month to month until cancelled. The customer can cancel in the Stripe billing portal. Access ordinarily continues through the paid period after cancellation. Deleting the entire Vanteloq workspace is different: it permanently removes access and instructs Vanteloq to cancel the subscription immediately before deleting the workspace. Fees already charged are nonrefundable except where the checkout terms, these terms, or applicable law requires otherwise.</p>
        <p>A free trial applies only if its length, first charge date, renewal amount, and cancellation method are shown in the active Stripe Checkout or a signed order. No public price, discount, free trial, feature entitlement, or paid subscription is promised outside the current Vanteloq plan screen, active checkout, or signed order. If a display and Checkout differ, do not purchase and contact Vanteloq.</p>
      </PolicySection>

      <PolicySection id="availability" title="8. Availability and changes">
        <p>We work to keep Vanteloq reliable, but the service may be interrupted for maintenance, provider failures, security events, internet conditions, or other causes. We may change or discontinue features to improve the service, meet legal or provider requirements, protect users, or address technical risk.</p>
        <p>We will use reasonable efforts to give notice when a material change will significantly reduce an active paid service, unless urgent security, legal, or provider action is required.</p>
      </PolicySection>

      <PolicySection id="confidentiality" title="9. Confidentiality">
        <p>Each party may receive non-public business, technical, or security information from the other. The receiving party will use that information only for the service relationship, protect it with reasonable care, and disclose it only to people who need it and are bound to protect it. This duty does not apply to information that is public without breach, already known lawfully, independently developed, or received lawfully from another source.</p>
      </PolicySection>

      <PolicySection id="intellectual-property" title="10. Intellectual property">
        <p>Vanteloq and its licensors retain all rights in the service, software, designs, documentation, branding, and materials, excluding Customer Data. Subject to these terms and any active order, we grant the customer a limited, non-exclusive, non-transferable right for its authorized users to access the service for internal business purposes.</p>
        <p>If you provide feedback, you allow us to use it without restriction or payment, provided we do not identify you publicly without permission.</p>
      </PolicySection>

      <PolicySection id="suspension" title="11. Suspension and termination">
        <p>We may suspend access when reasonably necessary to address a security threat, unauthorized use, non-payment, legal requirement, provider restriction, or material breach of these terms. Where practical, we will give notice and an opportunity to correct the issue.</p>
        <p>Either party may end an unpaid service at any time. Paid services may be ended according to the order and cancellation controls. Every user can use the protected account deletion control; an owner can use the separate workspace deletion control. Workspace deletion cancels billing immediately and permanently removes the active workspace, files, local credentials, memberships, and linked Vanteloq authentication accounts. A nonowner&apos;s deletion removes that person&apos;s account and personal profile while leaving customer business records with an anonymous authorship reference where needed for integrity. Customers should export records they must retain before deletion.</p>
        <p>Limited records may remain when required by law, a documented legal hold, security, dispute resolution, or the customer&apos;s own recordkeeping instruction. Provider records retained independently are governed by that provider. Details appear in the Privacy Policy and Data Processing Addendum.</p>
      </PolicySection>

      <PolicySection id="warranties" title="12. Disclaimers">
        <p>To the extent permitted by law, the service is provided “as is” and “as available.” We do not promise uninterrupted operation, error-free outputs, a particular business result, or compatibility with every provider, device, or record format.</p>
        <p>Nothing in these terms excludes a warranty or right that cannot lawfully be excluded.</p>
      </PolicySection>

      <PolicySection id="liability" title="13. Limits of liability">
        <p>To the extent permitted by law, neither party will be liable for indirect, incidental, special, exemplary, or consequential loss, or for lost profits, revenue, goodwill, or data, arising from the service.</p>
        <p>To the extent permitted by law, Vanteloq’s total liability arising from the service will not exceed the fees paid by the customer to Vanteloq for the affected service during the 12 months before the event giving rise to the claim. If no fees were paid, the maximum is CAD $100.</p>
        <p>These limits do not apply where they are prohibited by law and do not limit liability for fraud, wilful misconduct, breach of confidentiality, infringement, or obligations that cannot legally be limited.</p>
      </PolicySection>

      <PolicySection id="indemnity" title="14. Customer responsibility for claims">
        <p>The customer will defend and indemnify Vanteloq against third-party claims arising from Customer Data, the customer’s unlawful use of the service, or the customer’s breach of section 4 or 5, except to the extent the claim was caused by Vanteloq’s breach or misconduct.</p>
      </PolicySection>

      <PolicySection id="law" title="15. Governing law and disputes">
        <p>These terms are governed by the laws of Alberta and the federal laws of Canada that apply there, without regard to conflict-of-law rules. The courts located in Edmonton, Alberta have exclusive jurisdiction, unless applicable law requires another forum.</p>
        <p>Before starting a formal claim, each party will try in good faith to resolve the issue by written notice and discussion for at least 30 days, unless urgent injunctive relief is needed.</p>
      </PolicySection>

      <PolicySection id="general" title="16. General terms">
        <p>These terms, the Privacy Policy, Cookie Notice, Data Processing Addendum, an active order, and any referenced service terms form the entire agreement for the service. An order controls if it expressly conflicts with these terms. A failure to enforce a term is not a waiver. If one part is unenforceable, the rest remains effective. Nothing in these terms waives a right or remedy that cannot lawfully be waived.</p>
        <p>You may not assign these terms without our written consent, except with a sale of substantially all relevant business assets. We may assign them as part of a reorganization, financing, or sale of the service. Neither party is responsible for delay caused by events beyond reasonable control, except payment obligations.</p>
      </PolicySection>

      <PolicySection id="changes-contact" title="17. Changes and contact">
        <p>We may update these terms as the service or law changes. We will post the updated terms with a new date. When a material change affects an authenticated user, Vanteloq requires a new affirmative acceptance before billing status or workspace access is shown. Continued use alone is not used as the only acceptance method for that material update.</p>
        <p>Questions or legal notices can be sent to <a href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</a>.</p>
      </PolicySection>
    </LegalShell>
  );
}
