import { useState } from "react";
import { createRoot } from "react-dom/client";
import FoodserviceWorkspace from "../../app/foodservice-workspace";
import DealershipWorkspace from "../../app/dealership-workspace";
import IndustryFitPreview from "../../app/industry-fit-preview";
import IndustryConfigurationSettings, { IndustryConfigurationFields } from "../../app/industry-configuration";
import { defaultIndustryConfiguration } from "../../domain/industry-templates";

const views = ["Food costs", "Food overview", "Dealership", "Business settings", "Setup fields", "Business fit"] as const;
function Preview() {
  const [view, setView] = useState<typeof views[number]>("Food costs");
  const [business, setBusiness] = useState(sessionStorage.getItem("industry-preview-workspace") || "cafe");
  const [configuration, setConfiguration] = useState(defaultIndustryConfiguration("cafe"));
  function selectView(next: typeof views[number]) {
    if (next === "Dealership" || next.startsWith("Food")) {
      const selected = next === "Dealership" ? "dealership" : "cafe";
      sessionStorage.setItem("industry-preview-workspace", selected); setBusiness(selected);
    }
    setView(next);
  }
  return <><header className="fixture-header"><div><strong>Vanteloq industry review</strong><p>Isolated preview. All businesses and records are fictional. Saves use a local test database.</p></div><label>Preview business<select value={business} onChange={event => { sessionStorage.setItem("industry-preview-workspace", event.target.value); setBusiness(event.target.value); }}><option value="cafe">Fictional café</option><option value="dealership">Fictional dealership</option></select></label></header>
    <nav className="fixture-nav" aria-label="Industry preview">{views.map(item => <button key={item} type="button" aria-current={view === item ? "page" : undefined} onClick={() => selectView(item)}>{item}</button>)}</nav>
    <main className="fixture-main" key={`${view}:${business}`}>{view === "Food costs" ? <FoodserviceWorkspace/> : view === "Food overview" ? <FoodserviceWorkspace compactOverview onOpen={() => selectView("Food costs")}/> : view === "Dealership" ? <DealershipWorkspace activeLocationId={null}/> : view === "Business settings" ? <IndustryConfigurationSettings/> : view === "Setup fields" ? <section className="industry-settings"><h1>Set up your business view</h1><p>This field preview is unsaved. Use Business settings to test persisted configuration changes.</p><IndustryConfigurationFields value={configuration} onChange={setConfiguration}/></section> : <IndustryFitPreview/>}</main>
  </>;
}
createRoot(document.getElementById("root")!).render(<Preview/>);
