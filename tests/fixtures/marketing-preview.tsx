/* eslint-disable @next/next/no-html-link-for-pages -- Standalone local fixture without a Next router. */
import { createRoot } from "react-dom/client";
import MarketingReporting from "../../app/marketing-reporting";

createRoot(document.getElementById("root")!).render(<>
  <nav aria-label="Preview states" className="preview-nav"><b>LOCAL TEST FIXTURE</b><a href="/">Populated</a><a href="/?state=empty">Empty</a><a href="/?state=error">Provider error</a><a href="/?state=source-error">Source error</a></nav>
  <main><MarketingReporting locationId={null} navigate={(view) => { document.getElementById("navigation-result")!.textContent = view; }}/><p id="navigation-result" role="status"/></main>
</>);
