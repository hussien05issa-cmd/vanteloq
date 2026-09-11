/** The same original Vanteloq AI mark is used in public and private surfaces. */
export default function VanteloqAiLogo({ size = 48, className = "", decorative = false, thinking = false }: { size?: number; className?: string; decorative?: boolean; thinking?: boolean }) {
  // The original transparent artwork defines the silhouette; CSS moves the colour within it.
  return <span className={`vanteloq-ai-logo ${thinking ? "is-thinking" : ""} ${className}`} style={{ width: size, height: size }} role={decorative ? undefined : "img"} aria-label={decorative ? undefined : "Vanteloq AI logo"} aria-hidden={decorative || undefined} />;
}
