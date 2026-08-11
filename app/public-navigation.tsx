/* eslint-disable @next/next/no-html-link-for-pages -- native links avoid a vinext hydration failure on server-rendered public pages */
import ProductBrandLogo from "./product-brand-logo";

export default function PublicNavigation() {
  return (
    <header className="resource-nav">
      <a className="resource-brand" href="/" aria-label="Vanteloq home">
        <ProductBrandLogo product="vanteloq" priority />
        <span>Vanteloq<small>BUSINESS OPERATING SYSTEM</small></span>
      </a>
      <nav aria-label="Public navigation">
        <a href="/">Home</a>
        <a href="/resources">Resources</a>
      </nav>
      <div>
        <a className="resource-signin" href="/?auth=signin">Sign in</a>
        <a className="resource-create" href="/?auth=signup">Create workspace</a>
      </div>
    </header>
  );
}
