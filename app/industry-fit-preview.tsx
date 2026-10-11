"use client";
import { useEffect, useRef, useState } from "react";
import { INDUSTRY_TEMPLATES, resolveIndustryTemplate, type IndustryId } from "../domain/industry-templates";
import { industryShowcase, type WorkflowStep } from "../domain/industry-showcase";
import { industryOperationsShowcase } from "../domain/industry-operations-showcase";
import { useMotionPreference } from "./use-motion-preference";
import WorkspaceIcon from "./workspace-icon";
import ProductBrandLogo from "./product-brand-logo";
import "./industry-fit-preview.css";

const featured = [{ id: "retail", label: "Retail", icon: "Inventory" }, { id: "dealership", label: "Dealerships", icon: "Operations" }, { id: "cafe", label: "Cafés", icon: "Sales" }, { id: "restaurant", label: "Restaurants", icon: "Reports" }] as const;

function RecordPreview({ step }: { step: WorkflowStep }) {
  return <div className="industry-record">
    <div className="industry-record-heading"><span className="industry-record-icon"><WorkspaceIcon name={step.icon}/></span><div><span>{step.recordLabel}</span><strong>{step.recordTitle}</strong></div><span className="industry-sample">Sample data</span></div>
    <div className="industry-record-value"><span>{step.metric}</span><strong>{step.value}</strong><p>{step.context}</p></div>
    <dl className="industry-record-rows">{step.rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <div className="industry-record-outcome"><WorkspaceIcon name="Action Centre"/><p>{step.outcome}</p></div>
  </div>;
}

export default function IndustryFitPreview() {
  const [selected, setSelected] = useState<IndustryId>("retail");
  const [step, setStep] = useState(0), [playing, setPlaying] = useState(false), [mode,setMode]=useState<"operations"|"overview">("operations");
  const [visible, setVisible] = useState(false), [pageVisible, setPageVisible] = useState(true);
  const section = useRef<HTMLElement>(null), record = useRef<HTMLDivElement>(null);
  const motion = useMotionPreference();
  const [previousMotion, setPreviousMotion] = useState(motion);
  // Disabling motion disarms the tour; re-enabling it never resumes playback.
  if (previousMotion !== motion) { setPreviousMotion(motion); if (!motion) setPlaying(false); }
  const template = resolveIndustryTemplate(selected), workflow = mode==="operations"?industryOperationsShowcase(selected):industryShowcase(selected), active = workflow.steps[step];
  const running = playing && motion && visible && pageVisible;

  useEffect(() => {
    const element = section.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.1 });
    observer.observe(element);
    const readVisibility = () => setPageVisible(document.visibilityState === "visible");
    readVisibility(); document.addEventListener("visibilitychange", readVisibility);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", readVisibility); };
  }, []);
  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => { if (step === 2) setPlaying(false); else setStep(step + 1); }, 4800);
    return () => window.clearTimeout(timer);
  }, [running, step, selected, mode]);
  useEffect(() => {
    if (!motion || !record.current?.animate || !visible) return;
    const animation = record.current.animate([
      { opacity: 0.35, transform: "translateY(12px) scale(.985)" },
      { opacity: 1, transform: "translateY(-1px) scale(1.002)", offset: 0.78 },
      { opacity: 1, transform: "translateY(0) scale(1)" },
    ], { duration: 420, easing: "cubic-bezier(.2,.7,.2,1)" });
    const details=Array.from(record.current.querySelectorAll(".industry-record-rows>div,.industry-record-outcome")).map((element,index)=>element.animate([{opacity:.55,transform:"translateY(8px)"},{opacity:1,transform:"translateY(0)"}],{duration:320,delay:index*45,easing:"cubic-bezier(.18,.75,.2,1)"}));
    return () => {animation.cancel();details.forEach(a=>a.cancel());};
  }, [selected, step, mode, motion, visible]);

  const choose = (id: IndustryId) => { setPlaying(false); setStep(0); setSelected(id); };
  const chooseStep = (index: number) => { setPlaying(false); setStep(index); };
  return <section className="industry-fit" ref={section} id="business-workflows" aria-labelledby="industry-fit-title" data-playing={running} data-visible={visible&&pageVisible} data-motion-enabled={motion}>
    <div className="industry-fit-heading"><div><p className="demo-eyebrow">BUILT AROUND YOUR BUSINESS</p><h2 id="industry-fit-title">Your kind of business.<br/><em>Your way forward.</em></h2></div><p>From the shelf to the showroom, the counter to the kitchen. Explore the details that turn daily work into a clearer next step.</p></div>
    <div className="industry-fit-modes" role="group" aria-label="Product walkthrough"><button type="button" aria-pressed={mode==="operations"} onClick={()=>{setMode("operations");setPlaying(false);setStep(0);}}>Daily workflows</button><button type="button" aria-pressed={mode==="overview"} onClick={()=>{setMode("overview");setPlaying(false);setStep(0);}}>Numbers & overview</button></div>
    <div className="industry-fit-toolbar"><div className="industry-fit-choices" role="group" aria-label="Explore business workflows">{featured.map(choice => <button type="button" key={choice.id} aria-pressed={selected === choice.id} onClick={() => choose(choice.id)}><WorkspaceIcon name={choice.icon}/>{choice.label}</button>)}</div>
      <label className="industry-fit-more"><span>All business types</span><select value={selected} onChange={event => choose(event.target.value as IndustryId)}>{INDUSTRY_TEMPLATES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    </div>
    <div className="industry-fit-stage">
      <div className="industry-fit-story"><span className="industry-fit-label">{template.label}</span><h3>{workflow.title}</h3><p>{workflow.description}</p>
        <div className="industry-workflow-path" role="group" aria-label={`${template.label} workflow stages`}>{workflow.steps.map((item, index) => <button key={item.title} type="button" aria-pressed={step === index} aria-controls="industry-workflow-record" onClick={() => chooseStep(index)}><span className="industry-path-node" aria-hidden="true"><WorkspaceIcon name={item.icon}/></span><span><strong>{item.title}</strong><span>{item.description}</span></span><span className="industry-path-arrow" aria-hidden="true">↗</span></button>)}</div>
        <div className="industry-fit-playback"><button type="button" disabled={!motion} onClick={() => { if (playing) setPlaying(false); else { if (step === 2) setStep(0); setPlaying(true); } }} aria-label={running ? "Pause workflow tour" : "Play workflow tour"}><span aria-hidden="true">{running ? "Ⅱ" : "▷"}</span>{running ? "Pause tour" : "Play the workflow"}</button><span>{motion ? "Choose any stage to explore" : "Motion off. Explore each stage."}</span></div>
      </div>
      <div className="industry-fit-window" id="industry-workflow-record" role="region" aria-label={`${template.label}: sample workflow`}>
        <span className="industry-stage-status" role="status">{template.label}, {active.title}, stage {step + 1} of 3.</span>
        <div className="industry-window-bar"><strong><ProductBrandLogo product="vanteloq"/> Vanteloq</strong><span>{workflow.workspace}</span></div>
        <div className="industry-window-progress" aria-hidden="true">{workflow.steps.map((item, index) => <span key={item.title} data-current={index === step} data-complete={index < step}><i/>{item.shortTitle}</span>)}</div>
        <div className="industry-flow-track" aria-hidden="true"><svg viewBox="0 0 480 38" fill="none"><path d="M22 19H458"/><path className="industry-flow-trail" d="M22 19H458" style={{strokeDasharray:"436",strokeDashoffset:String(436-(step+1)/3*436)}}/>{[22,240,458].map((x,index)=><g key={x} data-current={index===step} data-active={index<=step}><circle cx={x} cy="19" r="8"/><circle className="industry-flow-halo" cx={x} cy="19" r="14"/></g>)}</svg></div>
        <div ref={record}><RecordPreview step={active}/></div>
        <p className="industry-record-boundary">{workflow.boundary}</p>
        <div className="industry-window-navigation"><button type="button" disabled={step === 0} onClick={() => chooseStep(step - 1)} aria-label="Previous workflow stage">←</button><span>{active.title}</span><button type="button" disabled={step === 2} onClick={() => chooseStep(step + 1)} aria-label="Next workflow stage">→</button></div>
      </div>
    </div>
    <div className="industry-fit-footer"><p>Your business type shapes the fields, tools and recommended metrics you see. Update it in Settings as your operation evolves.</p><a href="/how-it-works">Explore the product guide <span aria-hidden="true">↗</span></a></div>
    <p className="industry-fit-note">Interactive examples use fictional records. Feature access depends on your plan and permissions. Operational records remain separate from posted accounting figures. Connection availability is listed below.</p>
  </section>;
}
