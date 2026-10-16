import type { Metadata } from "next";
import Link from "next/link";
import DiscoveryShell from "../discovery-shell";
import "./workspace-gateway.css";

const WORKSPACE_URL = "https://vanteloq-workspace.hussien05issa.chatgpt.site/";

const apps = [
  { name: "Compose", description: "Draft and refine business documents with structured formatting, templates and export tools." },
  { name: "Model", description: "Build calculation workbooks, review formulas and move typed data into repeatable analysis." },
  { name: "Deckly", description: "Turn reviewed material into editable presentation slides for decisions and follow-through." },
  { name: "Blueprint", description: "Map plans, processes and responsibilities as connected visual work." },
  { name: "Calendar", description: "Keep milestones, deadlines and planned work visible beside the artifacts they support." },
  { name: "Studio", description: "Review imported datasets, data types and summary analysis before reusing the results." },
] as const;

export const metadata: Metadata = {
  title: "Vanteloq Workspace | Business documents, models and planning",
  description: "Open the standalone Vanteloq Workspace for Compose, Model, Deckly, Blueprint, Calendar and Studio, with a clear boundary from your Vanteloq account and connected business systems.",
  alternates: { canonical: "/vanteloqworkspace" },
  openGraph: {
    type: "website",
    url: "/vanteloqworkspace",
    title: "Vanteloq Workspace",
    description: "Six connected business tools for documents, models, presentations, planning, scheduling and reviewed data.",
  },
};

export default function VanteloqWorkspacePage() {
  return <DiscoveryShell
    className="workspace-gateway-site"
    fixedTheme="dark"
    primaryNavAction={{ href: WORKSPACE_URL, label: "Open Workspace", shortLabel: "Open" }}
  >
    <main id="discovery-main" className="workspace-gateway-main">
      <nav className="workspace-gateway-breadcrumbs" aria-label="Breadcrumb">
        <Link href="/">Home</Link><span aria-hidden="true">/</span><span>Vanteloq Workspace</span>
      </nav>

      <header className="workspace-gateway-hero">
        <div className="workspace-gateway-copy">
          <p className="workspace-gateway-eyebrow">VANTELOQ WORKSPACE</p>
          <h1>Make the document, model, deck and plan part of one working thread.</h1>
          <p className="workspace-gateway-lead">Vanteloq Workspace brings six focused tools together around saved business artifacts. Use it independently for writing, calculations, presentations, visual planning, deadlines and reviewed datasets.</p>
          <div className="workspace-gateway-actions">
            <a
              className="workspace-gateway-primary"
              href={WORKSPACE_URL}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
            >Open Vanteloq Workspace <span aria-hidden="true">↗</span></a>
            <Link className="workspace-gateway-secondary" href="/how-it-works">Explore the Vanteloq platform</Link>
          </div>
          <p className="workspace-gateway-handoff"><strong>Separate sign-in and data boundary.</strong> Your Vanteloq session and customer records are not forwarded.</p>
        </div>
      </header>

      <section className="workspace-gateway-section" aria-labelledby="workspace-apps-title">
        <div className="workspace-gateway-section-heading">
          <p>SIX FOCUSED APPS</p>
          <h2 id="workspace-apps-title">Choose the tool that fits the work.</h2>
          <span>Each app uses the shared Workspace library while keeping its own editing experience.</span>
        </div>
        <div className="workspace-gateway-apps">
          {apps.map(app => <article key={app.name}>
            <h3>{app.name}</h3>
            <p>{app.description}</p>
          </article>)}
        </div>
      </section>

      <section className="workspace-gateway-section workspace-gateway-boundary" aria-labelledby="workspace-boundary-title">
        <details>
          <summary id="workspace-boundary-title">Account and data access<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6"/></svg></summary>
          <div className="workspace-gateway-boundary-content">
            <h2>A deliberate handoff, not a silent account merge.</h2>
            <p>The Workspace opens as a separate Vanteloq application. Your current Vanteloq browser session, account tokens and customer records are not forwarded.</p>
            <div className="workspace-gateway-boundary-grid">
              <article><h3>Separate session</h3><p>Workspace uses its own supported sign-in flow. Opening it does not copy your Vanteloq commercial session, browser credentials or organization membership.</p></article>
              <article><h3>Workspace-owned records</h3><p>Files, revisions and tasks remain in the Workspace store and are authorized there. This access page does not proxy or cache customer content.</p></article>
              <article><h3>Commercial systems stay separate</h3><p>Vanteloq analytics, BookLoQ, accounting records and provider connections are not automatically shared with Workspace.</p></article>
              <article><h3>You choose the transfer</h3><p>Move approved material between systems only through an explicit reviewed export or import. No merchant sync or customer account is created here.</p></article>
            </div>
          </div>
        </details>
      </section>

      <section className="workspace-gateway-final" aria-labelledby="workspace-open-title">
        <div><p>READY WHEN YOU ARE</p><h2 id="workspace-open-title">Open a focused place to finish the work.</h2><span>Compose, Model, Deckly, Blueprint, Calendar and Studio remain available in the standalone Workspace.</span></div>
        <a href={WORKSPACE_URL} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open Workspace <span aria-hidden="true">↗</span></a>
      </section>
    </main>
  </DiscoveryShell>;
}
