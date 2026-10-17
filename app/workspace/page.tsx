import type { Metadata } from "next";
import Link from "next/link";
import DiscoveryShell from "../discovery-shell";
import "./workspace.css";

const WORKSPACE_URL = "https://vanteloq-workspace.hussien05issa.chatgpt.site/workspace";

const apps = [
  {
    name: "Compose",
    asset: "/brand/workspace/compose.webp",
    width: 1983,
    height: 793,
    description: "Shape briefs, policies and decision documents around reviewed business context instead of detached text.",
    handoff: "Bring approved Model results or Studio summaries into a narrative, then review the document before it moves on.",
  },
  {
    name: "Model",
    asset: "/brand/workspace/model.webp",
    width: 1983,
    height: 793,
    description: "Build calculation workbooks for scenarios, assumptions and structured analysis with formulas kept visible.",
    handoff: "Start with permitted Studio data, then pass a reviewed result to Compose or Deckly when the preview supports that handoff.",
  },
  {
    name: "Deckly",
    asset: "/brand/workspace/deckly.webp",
    width: 1983,
    height: 793,
    description: "Turn approved material into an editable presentation for a decision, update or working session.",
    handoff: "Use reviewed narrative and model outputs as presentation inputs without treating an early draft as an approved conclusion.",
  },
  {
    name: "Blueprint",
    asset: "/brand/workspace/blueprint.webp",
    width: 1944,
    height: 809,
    description: "Map a plan, process and accountable owners in one visual working surface.",
    handoff: "Translate an approved direction into actions and dependencies, then choose which dates belong on Calendar.",
  },
  {
    name: "Calendar",
    asset: "/brand/workspace/calendar.webp",
    width: 1881,
    height: 836,
    description: "Keep milestones, deadlines and planned work visible beside the artifacts that explain them.",
    handoff: "Schedule selected Blueprint actions while keeping the original plan available for context and review.",
  },
  {
    name: "Studio",
    asset: "/brand/workspace/studio-glass-v2.webp",
    width: 1942,
    height: 809,
    description: "Inspect imported datasets, field types and summary patterns before reusing the results elsewhere.",
    handoff: "Review the permitted dataset first. Only selected, reviewed outputs should continue into Model or Compose.",
  },
] as const;

export const metadata: Metadata = {
  title: "Vanteloq Workspace | Business documents, models and planning",
  description: "Explore the standalone Vanteloq Workspace preview for Compose, Model, Deckly, Blueprint, Calendar and Studio, with a clear account and data boundary from the Vanteloq platform.",
  alternates: { canonical: "/workspace" },
  openGraph: {
    type: "website",
    url: "/workspace",
    siteName: "Vanteloq",
    title: "Vanteloq Workspace",
    description: "A standalone preview for connected business documents, models, presentations, planning, scheduling and reviewed data.",
    images: [{ url: "/brand/workspace/studio-glass-v2.webp", width: 1942, height: 809, alt: "Vanteloq Studio blue glass logo" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Vanteloq Workspace",
    description: "Explore six focused business apps in a standalone preview with explicit account and data boundaries.",
    images: ["/brand/workspace/studio-glass-v2.webp"],
  },
};

export default function WorkspacePage() {
  return <DiscoveryShell
    className="workspace-site"
    fixedTheme="dark"
    primaryNavAction={{
      href: WORKSPACE_URL,
      label: "Open Workspace",
      shortLabel: "Open",
      target: "_blank",
      rel: "noopener noreferrer",
      referrerPolicy: "no-referrer",
    }}
    accountAction={{
      href: WORKSPACE_URL,
      label: "Workspace sign in",
      shortLabel: "Sign in",
      target: "_blank",
      rel: "noopener noreferrer",
      referrerPolicy: "no-referrer",
    }}
  >
    <main id="discovery-main" className="workspace-main">
      <nav className="workspace-breadcrumbs" aria-label="Breadcrumb">
        <Link href="/">Vanteloq</Link><span aria-hidden="true">/</span><span>Workspace</span>
      </nav>

      <section className="workspace-hero" aria-labelledby="workspace-title">
        <div className="workspace-hero-copy">
          <p className="workspace-eyebrow">VANTELOQ WORKSPACE</p>
          <h1 id="workspace-title">Move the work forward without losing its context.</h1>
          <p className="workspace-lead">Write the document, test the model, shape the deck and carry the approved plan into accountable work. Vanteloq Workspace brings six focused tools into one standalone preview.</p>
          <div className="workspace-actions">
            <a className="workspace-primary" href={WORKSPACE_URL} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open Vanteloq Workspace <span aria-hidden="true">↗</span></a>
            <Link className="workspace-secondary" href="/">Back to the Vanteloq platform</Link>
          </div>
          <p className="workspace-preview-note">Standalone preview · Separate sign-in. Your Vanteloq records stay private.</p>
        </div>
        <aside className="workspace-hero-thread" aria-label="Workspace artifact flow">
          <span>ONE REVIEWED THREAD</span>
          <strong>Studio → Model → Compose → Deckly → Blueprint → Calendar</strong>
          <p>Review the source, refine the result and choose what moves into the next app. Handoffs are available where supported in the preview.</p>
          <div aria-hidden="true"><i/><i/><i/></div>
        </aside>
      </section>

      <section className="workspace-intro" aria-labelledby="workspace-family-title">
        <div>
          <p className="workspace-eyebrow">THE PRODUCT FAMILY</p>
          <h2 id="workspace-family-title">A focused app for each stage of the decision.</h2>
        </div>
        <p>Keep the source beside the work. Choose a focused tool for writing, calculations, presentations, planning, deadlines or data review.</p>
      </section>

      <div className="workspace-family">
        {apps.map((app, index) => <article className={index % 2 ? "is-reversed" : undefined} key={app.name}>
          <figure>
            <div className={`workspace-app-mark workspace-app-mark-${app.name.toLowerCase()}`} aria-hidden="true">
              <img src={app.asset} alt="" width={app.width} height={app.height} loading="lazy" decoding="async"/>
            </div>
          </figure>
          <div className="workspace-app-copy">
            <h3>{app.name}</h3>
            <p>{app.description}</p>
            <small>{app.handoff}</small>
          </div>
        </article>)}
      </div>

      <section className="workspace-handoff" aria-labelledby="workspace-handoff-title">
        <div>
          <p className="workspace-eyebrow">ARTIFACTS MOVE WITH INTENT</p>
          <h2 id="workspace-handoff-title">Review the input. Choose the handoff. Keep the source clear.</h2>
        </div>
        <div>
          <p>Where the preview supports a handoff, you select the source artifact and review what enters the next app. Unsupported links remain planned rather than appearing as finished automation.</p>
          <details><summary>Preview availability</summary><p><strong>Planned or configuration-dependent:</strong> commercial Vanteloq connections, BookLoQ sync, Google services and meeting features. No merchant data is shared automatically.</p></details>
        </div>
      </section>

      <aside className="workspace-boundary" aria-labelledby="workspace-boundary-title">
        <span aria-hidden="true">i</span>
        <div>
          <h2 id="workspace-boundary-title">Separate sign-in and data boundary</h2>
          <p>Workspace opens as a separate Vanteloq application. Your current Vanteloq session and customer records are not forwarded, and Vanteloq analytics, BookLoQ records and provider connections are not automatically shared. Move material only through an explicit, reviewed export or import.</p>
        </div>
      </aside>
    </main>
  </DiscoveryShell>;
}
