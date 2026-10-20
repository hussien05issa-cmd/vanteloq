import Link from "next/link";
import type { ReactNode } from "react";
import ProductBrandLogo from "./product-brand-logo";
import PublicSurface from "./public-surface";
import { LEGAL_DOCUMENT_UPDATED_LABEL } from "../shared/legal-versions";

export const LEGAL_UPDATED = LEGAL_DOCUMENT_UPDATED_LABEL;
export function LegalContactLink() { return <Link href="/contact">our private contact form</Link>; }

export function LegalShell({
  eyebrow,
  title,
  summary,
  children,
  updated = LEGAL_UPDATED,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  children: ReactNode;
  updated?: string;
}) {
  return (
    <PublicSurface className="legal-site">
      <header className="legal-header">
        <Link className="legal-brand" href="/" aria-label="Vanteloq home">
          <ProductBrandLogo product="vanteloq" priority />
          <span>Legal centre</span>
        </Link>
        <nav aria-label="Legal navigation">
          <Link href="/legal">Legal centre</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/cookies">Cookies</Link>
          <Link href="/data-processing">Data processing</Link>
        </nav>
        <Link className="legal-home-link" href="/">Back to Vanteloq</Link>
      </header>

      <main>
        <section className="legal-hero">
          <div>
            <p>{eyebrow}</p>
            <h1>{title}</h1>
            <span>{summary}</span>
            <dl>
              <div><dt>Last updated</dt><dd>{updated}</dd></div>
              <div><dt>Operator</dt><dd>Vanteloq Inc.</dd></div>
            </dl>
          </div>
          <aside aria-label="Document principles">
            <div className="legal-document-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg></div>
            <strong>Plain language, visible limits, real contacts.</strong>
            <p>These documents describe the service as it operates today. They do not claim certifications, providers, or rights that have not been verified.</p>
          </aside>
        </section>
        <div className="legal-layout">
          <aside className="legal-index">
            <strong>LEGAL DOCUMENTS</strong>
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/terms">Terms of Service</Link>
            <Link href="/cookies">Cookie Notice</Link>
            <Link href="/data-processing">Data Processing Addendum</Link>
            <Link href="/subprocessors">Subprocessors</Link>
            <Link href="/legal">Legal Centre</Link>
          </aside>
          <article className="legal-document">{children}</article>
        </div>
      </main>

      <footer className="legal-footer">
        <div><ProductBrandLogo product="vanteloq"/><span><small>Vanteloq Inc.</small></span></div>
        <nav aria-label="Legal footer navigation"><Link href="/">Home</Link><Link href="/resources">Resources</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/cookies">Cookies</Link><Link href="/data-processing">Data processing</Link><Link href="/subprocessors">Subprocessors</Link></nav>
        <p>Questions about these documents can be sent through <LegalContactLink/>.</p>
      </footer>
    </PublicSurface>
  );
}

export function PolicySection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section id={id}><h2>{title}</h2>{children}</section>;
}
