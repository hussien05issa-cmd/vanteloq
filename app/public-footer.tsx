"use client";
import Link from "next/link";
import SocialLinks from "./social-links";
import { useMotionPreference, setMotionPreference } from "./use-motion-preference";
import "./public-shell.css";
export default function PublicFooter() {
  const motion = useMotionPreference();
  return <footer className="public-shell-footer" id="company"><div className="public-shell-footer-main"><div><strong>Vanteloq</strong><p>Business analytics for independent retailers.<br/>Owned and operated by LexEdge Consulting.</p><div id="social"><SocialLinks/></div></div><nav aria-label="Product resources"><Link href="/solutions/retail">For independent retail</Link><Link href="/demo">Explore the demo</Link><Link href="/pricing">Plans & pricing</Link><Link href="/custom-plan">Custom requirements</Link></nav><nav aria-label="Help and company"><Link href="/help">Help & setup</Link><Link href="/resources">Business guides</Link><Link href="/contact">Contact</Link><Link href="/social">Vanteloq on social</Link></nav></div><div className="public-shell-footer-bottom"><span>© 2026 LexEdge Consulting</span><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/cookies">Cookies</Link><Link href="/data-processing">Data processing</Link><Link href="/subprocessors">Service providers</Link><Link href="/legal">Legal</Link><button type="button" aria-pressed={!motion} onClick={() => setMotionPreference(!motion)}>Motion: {motion ? "on" : "off"}</button></div></footer>;
}
