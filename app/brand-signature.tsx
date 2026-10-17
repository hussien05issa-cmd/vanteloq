import ProductBrandLogo from "./product-brand-logo";
import "./brand-signature.css";

export default function BrandSignature({ className = "" }: { className?: string }) {
  return <div className={`brand-signature ${className}`.trim()}>
    <ProductBrandLogo product="vanteloq" variant="full" fullArtwork />
  </div>;
}
