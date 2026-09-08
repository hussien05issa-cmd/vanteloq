/* eslint-disable @next/next/no-html-link-for-pages -- Local-only verification fixture. */
import { createRoot } from "react-dom/client";
import GrowthWorkspace from "../../app/growth-workspace";
createRoot(document.getElementById("root")!).render(<>
  <nav className="preview-nav" aria-label="Preview states"><strong>LOCAL FIXTURE · NOT CUSTOMER DATA</strong><a href="/">Populated</a><a href="/?state=empty">Empty</a><a href="/?state=readonly">Read only</a><a href="/?state=save-error">First save fails</a></nav>
  <div className="operating-shell"><main className="main-panel preview-main"><header className="preview-header"><span>VANTELOQ WORKSPACE</span><h1>Marketing</h1><p id="navigation-result" role="status"/></header><GrowthWorkspace currency="CAD" activeLocationId={null} canOptimize={false} navigate={(view) => { document.getElementById("navigation-result")!.textContent = `Navigation target: ${view}`; }}/></main></div>
</>);
