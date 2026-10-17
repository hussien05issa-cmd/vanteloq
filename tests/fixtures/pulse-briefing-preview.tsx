// Isolated browser regression fixture. No network, account or provider records.
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import BusinessPulse from "../../app/business-pulse";
import ExpandingSurface from "../../app/expanding-surface";
import OwnerBriefingPanel, { useBriefingSelection } from "../../app/owner-briefing";
import { buildOwnerBriefing } from "../../domain/owner-briefing";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
localStorage.setItem("vanteloq.motion", "system");
Object.defineProperty(document, "hidden", { configurable: true, value: false });
const originalMatchMedia = window.matchMedia.bind(window);
window.matchMedia = query => query === "(prefers-reduced-motion: reduce)"
  ? { matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }
  : originalMatchMedia(query);

const animations: { finish: () => void; pending: boolean }[] = [];
HTMLElement.prototype.animate = function () {
  let resolve!: () => void, reject!: (reason: Error) => void;
  const finished = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  const control = { pending: true, finish: () => { if (control.pending) { control.pending = false; resolve(); } } };
  animations.push(control);
  // Only the finished promise and cancellation are exercised by ExpandingSurface.
  return { finished, cancel: () => { if (control.pending) { control.pending = false; reject(new Error("Cancelled fixture animation")); } } } as unknown as Animation;
};

const briefing = buildOwnerBriefing({ now: "2026-10-09T15:00:00Z", timezone: "America/Edmonton", hours: [], signals: ["a", "b", "c", "d"].map(id => ({ id, title: `Finding ${id}`, detail: `Recorded fixture detail ${id}`, nextStep: `Next step ${id}`, category: "operations", destination: "Operations", severity: "medium", evidence: [{ label: `Evidence ${id}`, value: `Value ${id}`, source: `Fictional source ${id}` }] })) });
const selections: string[] = [], actions: string[] = [];
function Journey({ scope, canCreate = true }: { scope: string; canCreate?: boolean }) {
  const { detailsRef, selectedPriority, onFinding } = useBriefingSelection(scope, briefing.priorities);
  return <div className="operating-shell" data-workspace-theme="light" data-selected-priority={selectedPriority?.id ?? ""}>
    <BusinessPulse key={`pulse:${scope}`} sourceName="Fictional source" coverage="Fixture coverage" syncText="Fixture sync" syncing={false} needsAttention={false} onConnections={() => actions.push("connections")} overview={{ scope, period: "Fixture period", metrics: [], priorities: briefing.priorities, criticalCount: 0, onFinding: item => { selections.push(item.id); onFinding(item); } }}/>
    <details key={`briefing:${scope}`} ref={detailsRef} className="journey-brief"><summary>Daily briefing</summary><OwnerBriefingPanel briefing={briefing} scopeLabel={scope} selectedPriority={selectedPriority} onEvidence={item => actions.push(`evidence:${item.id}`)} onAction={canCreate ? item => actions.push(`action:${item.id}`) : undefined}/></details>
  </div>;
}
let closed = 0;
function Surface({ open }: { open: boolean }) {
  const originRef = useRef<HTMLButtonElement>(null);
  return <><button ref={originRef}>Origin</button><ExpandingSurface open={open} onClose={() => {}} onAfterClose={() => { closed++; }} originRef={originRef} title="Lifecycle"><button>Panel action</button></ExpandingSurface></>;
}
const mount = document.getElementById("fixture")!;
const root = createRoot(mount);
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const get = <T extends Element = HTMLElement>(selector: string) => { const element = document.querySelector<T>(selector); if (!element) throw new Error(`Missing ${selector}`); return element; };
const click = async (element: HTMLElement) => { await act(async () => { element.focus(); element.click(); }); };
const finish = async () => { await act(async () => { for (const animation of [...animations]) animation.finish(); }); };
const renderJourney = async (scope = "location-a", canCreate = true) => { await act(async () => root.render(<Journey scope={scope} canCreate={canCreate}/>)); };
const openPulse = async () => { await click(get(".business-pulse-control")); await finish(); };
const chooseSecond = async () => { await click(get(".pulse-attention button:nth-of-type(2)")); };
const cases: [string, () => Promise<void>][] = [
  ["Pulse waits for exit, then opens and focuses exact evidence and next action", async () => {
    await renderJourney(); await openPulse(); await chooseSecond();
    assert(selections.length === 0, "Finding activated before closing completed");
    assert(document.querySelector('[role="dialog"]'), "Closing dialog vanished before the controlled animation finished");
    await finish();
    assert(selections.join() === "b", "Wrong finding selected");
    assert(get<HTMLDetailsElement>(".journey-brief").open, "Briefing stayed closed");
    const article = get('[data-briefing-priority="b"]');
    assert(article.querySelector<HTMLDetailsElement>(".owner-priority-detail")?.open, "Priority stayed closed");
    assert(article.querySelector<HTMLDetailsElement>(".owner-briefing-evidence")?.open, "Evidence stayed closed");
    assert(document.activeElement === article.querySelector(".owner-priority-summary"), "Dialog restore stole the finding focus");
    assert(article.textContent?.includes("Fictional source b"), "Wrong source evidence");
    await click(Array.from(article.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Create an action")!);
    assert(actions.join() === "action:b", "Wrong next action");
  }],
  ["Selecting the same finding reopens manually collapsed details and restores focus", async () => {
    get<HTMLDetailsElement>(".journey-brief").open = false;
    get<HTMLDetailsElement>('[data-briefing-priority="b"] .owner-priority-detail').open = false;
    get<HTMLDetailsElement>('[data-briefing-priority="b"] .owner-briefing-evidence').open = false;
    await openPulse(); await chooseSecond(); await finish();
    assert(get<HTMLDetailsElement>(".journey-brief").open, "Outer briefing did not reopen");
    assert(get<HTMLDetailsElement>('[data-briefing-priority="b"] .owner-priority-detail').open, "Selected finding did not reopen");
    assert(get<HTMLDetailsElement>('[data-briefing-priority="b"] .owner-briefing-evidence').open, "Selected evidence did not reopen");
    assert(document.activeElement === get('[data-briefing-priority="b"] .owner-priority-summary'), "Repeat selection did not receive focus");
  }],
  ["Scope changes clear selection and cancel pending actions, including returning to the prior scope", async () => {
    await openPulse(); await chooseSecond(); const before = selections.length;
    await renderJourney("location-b"); await finish();
    assert(selections.length === before, "Unmounted prior-scope callback fired");
    assert(get(".operating-shell").getAttribute("data-selected-priority") === "", "Prior scope selection leaked");
    assert(!get<HTMLDetailsElement>(".journey-brief").open, "New scope inherited an open finding");
    await renderJourney("location-a");
    assert(get(".operating-shell").getAttribute("data-selected-priority") === "", "Returning scope restored stale selection");
  }],
  ["Evidence remains available without unauthorized create controls", async () => {
    await renderJourney("limited-scope", false); await openPulse(); await chooseSecond(); await finish();
    const article = get('[data-briefing-priority="b"]');
    assert(article.textContent?.includes("Fictional source b"), "Allowed evidence disappeared");
    assert(!article.textContent?.includes("Create an action"), "Unauthorized action exposed");
  }],
  ["Ordinary dismissal restores the opener without choosing a finding", async () => {
    await openPulse(); const before = selections.length;
    await click(get('[aria-label="Close Business Pulse"]')); await finish();
    assert(selections.length === before, "Dismissal selected a finding");
    assert(document.activeElement === get(".business-pulse-control"), `Dismissal lost opener focus: active=${document.activeElement?.tagName}.${document.activeElement?.className}; opener inert=${Boolean(get(".business-pulse-control").closest("[inert]"))}`);
  }],
  ["Reopening during a pending Pulse exit cancels its selected action", async () => {
    await openPulse(); await chooseSecond(); const before = selections.length;
    await click(get(".business-pulse-control")); await finish();
    assert(selections.length === before, "Interrupted selection ran");
    assert(document.querySelector('[role="dialog"]'), "Reopened Pulse disappeared");
    await click(get('[aria-label="Close Business Pulse"]')); await finish();
    assert(selections.length === before, "Cancelled selection ran on later dismissal");
  }],
  ["Shared surface callback waits for a completed exit and ignores interrupted exits and unmount", async () => {
    await act(async () => root.render(<Surface open/>)); await finish();
    await act(async () => root.render(<Surface open={false}/>));
    assert(closed === 0, "Early exit callback");
    await act(async () => root.render(<Surface open/>)); await finish();
    assert(closed === 0, "Interrupted exit callback");
    await act(async () => root.render(<Surface open={false}/>)); await finish();
    assert(closed === 1, "Completed exit must call once");
    await act(async () => root.render(<Surface open={false}/>));
    assert(closed === 1, "Closed rerender called again");
    await act(async () => root.render(<Surface open/>)); await finish();
    await act(async () => root.render(<Surface open={false}/>));
    await act(async () => root.render(<p>Unmounted</p>)); await finish();
    assert(closed === 1, "Unmount called an abandoned exit");
  }],
  ["Static reduced-motion exit also focuses the selected finding after modal cleanup", async () => {
    localStorage.setItem("vanteloq.motion", "off");
    await renderJourney("static-scope"); await openPulse(); await chooseSecond();
    assert(!document.querySelector('[role="dialog"]'), "Static exit stayed mounted");
    assert(document.activeElement === get('[data-briefing-priority="b"] .owner-priority-summary'), "Static restore stole focus");
  }],
];

const report = document.getElementById("results")!;
let passed = 0;
for (const [name, run] of cases) {
  try { await run(); passed++; report.append(Object.assign(document.createElement("li"), { textContent: `PASS: ${name}` })); }
  catch (error) { report.append(Object.assign(document.createElement("li"), { textContent: `FAIL: ${name}: ${error instanceof Error ? error.message : String(error)}` })); }
}
document.getElementById("result-summary")!.textContent = `${passed}/${cases.length} browser regression cases passed`;
await act(async () => root.unmount());
