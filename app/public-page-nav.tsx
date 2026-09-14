import Link from "next/link";
import ProductBrandLogo from "./product-brand-logo";
export default function PublicPageNav() {
  return <header className="demo-page-nav unified-public-nav"><Link href="/" aria-label="Vanteloq home"><ProductBrandLogo product="vanteloq"/><strong>Vanteloq</strong></Link><nav aria-label="Public navigation"><Link href="/demo">Try the demo</Link><Link href="/#connections">Connections</Link><Link href="/pricing">Pricing</Link><Link href="/help">Help</Link><Link href="/?start=signin">Sign in</Link><Link className="public-nav-create" data-public-event="signup_start" href="/?start=signup">Create workspace</Link></nav></header>;
}
