/** The same original Vanteloq AI mark is used in public and private surfaces. */
export default function VanteloqAiLogo({ size = 48, className = "", decorative = false }: { size?: number; className?: string; decorative?: boolean }) {
  // A local static image keeps the mark independent of external provider assets.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={`vanteloq-ai-logo ${className}`} src="/brand/vanteloq-ai.png" width={size} height={size} alt={decorative ? "" : "Vanteloq AI logo"} aria-hidden={decorative || undefined} />;
}
