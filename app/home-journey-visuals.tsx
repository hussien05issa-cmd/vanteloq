type JourneyIconName = "email" | "security" | "business" | "plan" | "records" | "check" | "arrow" | "person";

export function JourneyIcon({ name }: { name: JourneyIconName }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {name === "email" && <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></>}
    {name === "security" && <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8.5 11.5 2.5 2.5 4.5-5"/></>}
    {name === "business" && <><rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 7h1m4 0h1M9 11h1m4 0h1M10 21v-6h4v6"/></>}
    {name === "plan" && <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/></>}
    {name === "records" && <><path d="M7 3h10l3 3v15H7V3Z"/><path d="M4 7v14M11 9h5M11 13h5M11 17h3"/></>}
    {name === "check" && <path d="m5 12 4 4L19 6"/>}
    {name === "arrow" && <path d="M4 12h16m-6-6 6 6-6 6"/>}
    {name === "person" && <><circle cx="12" cy="8" r="3"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></>}
  </svg>;
}

/** Illustrative interface diagrams, not live source status or interactive controls. */
export function OperatingStepPreview({ step }: { step: "connect" | "verify" | "review" }) {
  return <span className={`home-operating-preview ${step}`} aria-hidden="true">
    <span className="operating-preview-label">{step === "connect" ? "Source to workspace" : step === "verify" ? "Record checks" : "Review queue"}</span>
    {step === "connect" && <span className="operating-source-flow">
      <span className="operating-source-chips"><em>POS</em><em>CSV</em></span>
      <JourneyIcon name="arrow"/>
      <span className="operating-records"><JourneyIcon name="records"/><small>Records</small></span>
    </span>}
    {step === "verify" && <span className="operating-checks">
      {["Dates", "Totals", "Locations"].map(label => <span key={label}><span>{label}</span><JourneyIcon name="check"/></span>)}
    </span>}
    {step === "review" && <span className="operating-task">
      <span><JourneyIcon name="person"/><span>Assigned owner</span></span>
      <span className="operating-approval">Approval needed<JourneyIcon name="arrow"/></span>
    </span>}
  </span>;
}

export function AccountSteps() {
  const steps = [
    { icon: "email", title: "Verify your email", detail: "Confirm that the address is yours." },
    { icon: "security", title: "Secure your account", detail: "Set up an authenticator app." },
    { icon: "business", title: "Add your business", detail: "Enter your business details." },
    { icon: "plan", title: "Choose your plan", detail: "Review a plan and continue to Stripe checkout." },
  ] as const;
  return <section className="home-account-steps home-account-roadmap" aria-labelledby="account-roadmap-title">
    <header><strong id="account-roadmap-title">What happens after you create an account</strong></header>
    <ol>{steps.map((step, index) => <li key={step.icon} className={`account-checkpoint ${step.icon}`}>
      <span className="account-checkpoint-icon"><JourneyIcon name={step.icon}/></span>
      <span className="account-checkpoint-number" aria-hidden="true">{index + 1}</span>
      <div><strong>{step.title}</strong><p>{step.detail}</p></div>
    </li>)}</ol>
  </section>;
}
