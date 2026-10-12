import ProductBrandLogo from "./product-brand-logo";
import "./brand-signature.css";

/** The supplied Vanteloq mark, shared by the assistant and the rest of the product. */
export default function VanteloqAiLogo({
  size = 48,
  className = "",
  decorative = false,
  thinking = false,
  active = false,
}: {
  size?: number;
  className?: string;
  decorative?: boolean;
  thinking?: boolean;
  active?: boolean;
}) {
  return <span
    className={`vanteloq-ai-logo vanteloq-ai-artwork ${size < 40 ? "is-compact " : ""}${thinking ? "is-thinking " : active ? "is-attentive " : ""}${className}`}
    style={{ width: size, height: size }}
    role={decorative ? undefined : "img"}
    aria-label={decorative ? undefined : "Vanteloq AI logo"}
    aria-hidden={decorative || undefined}
  >
    <span aria-hidden="true"><ProductBrandLogo product="vanteloq" /></span>
  </span>;
}
