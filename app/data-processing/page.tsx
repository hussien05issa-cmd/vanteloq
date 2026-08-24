import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL_EMAIL, LegalShell, PolicySection } from "../legal-shell";

export const metadata: Metadata = {
  title: "Data Processing Addendum | Vanteloq",
  description: "The Vanteloq Data Processing Addendum describes privacy, security, subprocessor, rights request, incident, and deletion commitments.",
  alternates: { canonical: "/data-processing" },
};

export default function DataProcessingPage() {
  return <LegalShell eyebrow="DATA PROCESSING ADDENDUM" title="Documented instructions for protected customer data." summary="This addendum describes how LexEdge Consulting processes personal information in Vanteloq for a business customer.">
    <div className="legal-note"><strong>Contract status:</strong> This Data Processing Addendum forms part of the Vanteloq Terms of Service when a customer accepts those terms or an order that incorporates them. A signed version is available for an eligible business customer on request.</div>
    <PolicySection id="roles" title="1. Parties and roles">
      <p>The customer is the organization that controls a Vanteloq workspace. LexEdge Consulting, operating as Vanteloq, processes Customer Data to provide the service. Depending on the applicable law and activity, the customer may be the organization responsible for the information and Vanteloq may act as its service provider or processor. Each party remains responsible for obligations that apply directly to it.</p>
    </PolicySection>
    <PolicySection id="instructions" title="2. Documented instructions and purpose">
      <p>Vanteloq processes Customer Data only to provide, secure, support, maintain, and improve the contracted service; follow lawful workspace instructions; prevent misuse; and comply with law. The Terms of Service, product controls, connected service choices, support requests, and an applicable order are the customer&apos;s documented instructions.</p>
      <p>The customer must have lawful authority for the information and instructions it provides. Vanteloq will notify the customer if an instruction appears unlawful unless law prohibits notice.</p>
    </PolicySection>
    <PolicySection id="details" title="3. Processing details">
      <ul>
        <li><strong>People:</strong> workspace users, customer contacts, suppliers, employees, and other individuals represented in business records selected by the customer.</li>
        <li><strong>Information:</strong> account, contact, commerce, payment reference, inventory, purchasing, financial, document, operational, support, security, and integration information described in the Privacy Policy.</li>
        <li><strong>Activities:</strong> hosting, authentication, importing, organization, reconciliation, calculation, reporting, storage, support, security, deletion, and customer-directed connected service processing.</li>
        <li><strong>Duration:</strong> the customer&apos;s use of Vanteloq and the limited retention period described in the Privacy Policy and applicable order.</li>
      </ul>
      <p>The customer must not submit sensitive personal information that is unnecessary for these purposes or use Vanteloq for high risk decisions about an individual unless a written order expressly authorizes that processing.</p>
    </PolicySection>
    <PolicySection id="security" title="4. Confidentiality and safeguards">
      <p>People authorized to process Customer Data are subject to confidentiality obligations and receive access according to their duties. Vanteloq maintains technical and organizational safeguards appropriate to the information, including authenticated access, multifactor authentication for protected functions, organization scoped authorization, encrypted transport, managed encryption at rest, application level encryption for supported provider credentials, secrets kept outside source code and browser responses, logging controls, change review, and incident response procedures.</p>
    </PolicySection>
    <PolicySection id="subprocessors" title="5. Subprocessors and connected services">
      <p>The customer authorizes the subprocessors listed in the <Link href="/subprocessors">Subprocessor and Connected Service Notice</Link>. Vanteloq requires subprocessors to protect personal information through appropriate contractual obligations. Vanteloq remains responsible for its own obligations when a subprocessor performs processing on its behalf.</p>
      <p>Vanteloq may update that list to operate or improve the service. A customer may object to a new subprocessor on reasonable data protection grounds by contacting <a href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</a> promptly after notice. The parties will work in good faith on a reasonable solution; if none is available, the affected feature or service may be ended.</p>
    </PolicySection>
    <PolicySection id="transfers" title="6. Processing outside Canada">
      <p>Customer Data may be processed outside Canada where a listed provider operates. Vanteloq uses contractual, technical, and organizational safeguards appropriate to the service and will provide available information about relevant locations and safeguards on request. Where an applicable law requires a specific transfer mechanism, the parties will cooperate to put that mechanism in place.</p>
    </PolicySection>
    <PolicySection id="rights" title="7. Individual requests and compliance assistance">
      <p>Taking account of the nature of the processing, Vanteloq will provide reasonable assistance so the customer can respond to verified requests for access, correction, deletion, or consent withdrawal. If Vanteloq receives a request about Customer Data controlled by the customer, Vanteloq may direct the requester to that customer unless law requires a direct response.</p>
      <p>Vanteloq will also provide reasonable information needed for the customer&apos;s privacy assessments, regulator inquiries, and compliance obligations, subject to confidentiality, security, proportionality, and the protection of other customers.</p>
    </PolicySection>
    <PolicySection id="incidents" title="8. Security incidents">
      <p>Vanteloq will investigate a confirmed unauthorized access, use, disclosure, alteration, loss, or destruction of Customer Data. It will notify the affected customer without undue delay when the incident affects Customer Data and notice is required or reasonably needed for the customer to meet its obligations. Notice will include available information about the nature, affected data, likely consequences, containment, and remediation. Notice is not an admission of fault.</p>
    </PolicySection>
    <PolicySection id="deletion" title="9. Return, deletion, and retention">
      <p>During the service, available controls let authorized users export records, disconnect services, delete scoped information, remove their account, or let an owner delete the entire workspace. On a verified workspace deletion, Vanteloq first cancels the Vanteloq Stripe subscription, then removes active workspace data, files, local integration credentials, memberships, and linked Vanteloq authentication accounts that are not still used by another workspace.</p>
      <p>Vanteloq may retain only information required by law, a documented legal hold, security need, or the customer&apos;s recordkeeping instruction. Such information is isolated from ordinary service use, protected, and deleted or anonymized when the reason ends. A nonidentifying deletion receipt may be retained for 24 months. Provider records retained independently under a provider&apos;s agreement or law are controlled by that provider.</p>
    </PolicySection>
    <PolicySection id="review" title="10. Review and contact">
      <p>On reasonable written request, Vanteloq will provide available policies, test summaries, or other evidence relevant to this addendum. Any audit must avoid unreasonable disruption and exposure of another customer&apos;s information or protected security details. Questions and requests can be sent to <a href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</a>.</p>
    </PolicySection>
  </LegalShell>;
}
