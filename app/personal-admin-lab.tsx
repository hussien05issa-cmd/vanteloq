"use client";

import { useEffect, useReducer, useRef, type Dispatch } from "react";
import { initialPersonalLab, personalLabReducer, type PersonalLabAction, type PersonalLabState } from "../domain/personal-admin-lab";
import { industryShowcase } from "../domain/industry-showcase";
import { resolveIndustryTemplate } from "../domain/industry-templates";
import { IndustryConfigurationFields } from "./industry-configuration";
import BuildYourOverview from "./build-your-overview";
import WorkspaceIcon from "./workspace-icon";
import "./personal-admin-lab.css";

const steps = ["Business type", "Your dashboard", "Sample workflow"] as const;

export function PersonalBusinessLabView({ state, dispatch }: { state: PersonalLabState; dispatch: Dispatch<PersonalLabAction> }) {
  const title = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(state.step);
  const template = resolveIndustryTemplate(state.configuration.templateId);
  const workflow = industryShowcase(template.id);
  useEffect(() => {
    if (previousStep.current !== state.step) title.current?.focus();
    previousStep.current = state.step;
  }, [state.step]);
  return <section className="personal-business-lab" aria-labelledby="personal-lab-title">
    <header><div><p>Personal admin</p><h2 id="personal-lab-title">Business lab</h2><span>Explore every business type and rehearse setup in your own preview.</span></div><button type="button" onClick={() => dispatch({ type: "restart" })}><WorkspaceIcon name="Settings"/>Restart onboarding preview</button></header>
    <p className="personal-lab-boundary">Only this preview resets. Your business records, saved dashboard, billing and account setup stay as they are. Preview choices last while this panel is open.</p>
    <ol className="personal-lab-progress" aria-label="Onboarding preview progress">{steps.map((step, index) => <li key={step} aria-current={state.step === index + 1 ? "step" : undefined}><span aria-hidden="true">{index + 1}</span>{step}</li>)}</ol>
    <div className="personal-lab-step" key={state.generation}>
      <h3 ref={title} tabIndex={-1}>{steps[state.step - 1]}</h3>
      {state.step === 1 && <><p>Choose a starting point. These tools and recommendations belong to this rehearsal.</p><IndustryConfigurationFields value={state.configuration} onChange={configuration => dispatch({ type: "configuration", configuration })}/></>}
      {state.step === 2 && <BuildYourOverview industry={template.label} value={state.overview} onChange={overview => dispatch({ type: "overview", overview })}/>}
      {state.step === 3 && <><div className="personal-lab-sample-heading"><div><p>Fictional sample data</p><h4>{template.label}</h4><span>{workflow.title}</span></div><WorkspaceIcon name="Dashboard"/></div><p>{workflow.description}</p><div className="personal-lab-samples">{workflow.steps.map(step => <article key={step.title}><header><WorkspaceIcon name={step.icon}/><h4>{step.title}</h4></header><p>{step.recordTitle}</p><span>{step.metric}</span><strong>{step.value}</strong><small>{step.context}</small><dl>{step.rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p>{step.outcome}</p></article>)}</div><p className="personal-lab-sample-note">{workflow.boundary}</p><p className="personal-lab-complete" role="status"><WorkspaceIcon name="Tasks"/>Preview complete. You can go back, try another business type or restart.</p></>}
    </div>
    <footer><button type="button" disabled={state.step === 1} onClick={() => dispatch({ type: "back" })}>Back</button><span>Step {state.step} of 3</span>{state.step < 3 ? <button type="button" className="primary" onClick={() => dispatch({ type: "next" })}>{state.step === 1 ? "Build the sample dashboard" : "Explore the sample workflow"}<span aria-hidden="true">→</span></button> : <button type="button" className="primary" onClick={() => dispatch({ type: "restart" })}>Try another business type</button>}</footer>
  </section>;
}

export default function PersonalBusinessLab() {
  const [state, dispatch] = useReducer(personalLabReducer, undefined, initialPersonalLab);
  return <PersonalBusinessLabView state={state} dispatch={dispatch}/>;
}
