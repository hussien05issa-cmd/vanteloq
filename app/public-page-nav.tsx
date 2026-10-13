"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import ProductBrandLogo from "./product-brand-logo";
import PublicAppearanceControl from "./public-appearance-control";
import { useModalFocus } from "./use-modal-focus";
import { planSelectionUrl } from "../shared/plan-selection";
import "./public-shell.css";

type PrimaryAction = {
  href: string;
  label: string;
  shortLabel?: string;
};

export default function PublicPageNav({ signIn, appearanceControl = false, primaryAction }: { signIn?: () => void; appearanceControl?: boolean; primaryAction?: PrimaryAction }) {
  const path = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLElement>(null), shell = useRef<HTMLElement>(null), resources = useRef<HTMLDetailsElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const action = primaryAction ?? { href: planSelectionUrl({ plan: "free", bookloq: false }), label: "Start Free", shortLabel: "Start" };
  useModalFocus(shell, open, close);
  useEffect(() => {
    const media = matchMedia("(min-width: 801px)");
    const resize = () => { if (media.matches) setOpen(false); };
    const dismiss = (event: PointerEvent) => { if (resources.current && !resources.current.contains(event.target as Node)) resources.current.open = false; };
    media.addEventListener("change", resize); document.addEventListener("pointerdown", dismiss);
    return () => { media.removeEventListener("change", resize); document.removeEventListener("pointerdown", dismiss); };
  }, []);
  return <header ref={shell} className={`public-shell-nav${primaryAction ? " has-primary-action" : ""}`} role={open ? "dialog" : undefined} aria-modal={open ? true : undefined} aria-label={open ? "Public navigation" : undefined}>
    <Link className="public-shell-brand" href="/" aria-label="Vanteloq home"><ProductBrandLogo product="vanteloq" priority/><span className="public-shell-brand-word" aria-hidden="true">Vanteloq</span></Link>
    {open && <button className="public-shell-scrim" aria-label="Close navigation" onClick={close} tabIndex={-1}/>}
    <nav id="public-main-navigation" ref={menu} className={`public-shell-links${open ? " is-open" : ""}`} aria-label="Public navigation" onKeyDown={event => { if (event.key === "Escape" && resources.current) resources.current.open = false; }}>
      <Link href="/how-it-works" aria-current={path === "/how-it-works" ? "page" : undefined} onClick={close}>How it works</Link><Link href="/solutions" aria-current={path.startsWith("/solutions") ? "page" : undefined} onClick={close}>Businesses</Link><Link href="/advisory" aria-current={path === "/advisory" ? "page" : undefined} onClick={close}>Advisory</Link><Link href="/pricing" aria-current={path === "/pricing" ? "page" : undefined} onClick={close} data-public-event="pricing_view" data-public-section="header">Pricing</Link>
      {!primaryAction && <Link prefetch={false} className="public-demo-link" href="/book-demo" aria-current={path === "/book-demo" ? "page" : undefined} onClick={close}>Book a free demo</Link>}
      <details ref={resources}><summary>Resources</summary><div className="public-shell-resources"><Link href="/help" onClick={close}>Help & setup</Link><Link href="/resources" onClick={close}>Business guides</Link><Link href="/#connections" onClick={close}>Connections & integrations</Link><Link href="/integrations" onClick={close}>Integration guides</Link><Link href="/tools" onClick={close}>Planning tools</Link><Link href="/demo" onClick={close}>Interactive demo</Link><Link href="/about" onClick={close}>About Vanteloq</Link><Link href="/contact" onClick={close}>Contact</Link></div></details>
      {open && <div className="public-shell-mobile-account"><Link prefetch={false} href="/?start=signin" onClick={close}>Sign in</Link><button type="button" onClick={close}>Close menu</button></div>}
    </nav>
    <div className="public-shell-account">{appearanceControl && <PublicAppearanceControl/>}{signIn ? <button className="public-shell-signin" type="button" onClick={signIn}>Sign in</button> : <Link prefetch={false} className="public-shell-signin" href="/?start=signin">Sign in</Link>}<Link prefetch={false} className="public-shell-free" aria-label={action.label} data-public-event={primaryAction ? "demo_booking_start" : "signup_start"} data-public-section="header" data-public-plan={primaryAction ? undefined : "free"} href={action.href}><span className="public-shell-free-full">{action.label}</span><span className="public-shell-free-short" aria-hidden="true">{action.shortLabel ?? action.label}</span></Link></div>
    <button type="button" className="public-shell-menu" aria-expanded={open} aria-controls="public-main-navigation" onClick={() => setOpen(value => !value)}>{open ? "Close" : "Menu"}</button>
  </header>;
}
