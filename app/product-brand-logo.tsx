import { useId } from "react";
import { preload } from "react-dom";
import { PRODUCT_BRAND_ASSETS, type ProductBrand, type ProductBrandVariant } from "./product-brand-assets";

type ProductBrandLogoProps = {
  product: ProductBrand;
  variant?: ProductBrandVariant;
  priority?: boolean;
  className?: string;
};

export default function ProductBrandLogo({
  product,
  variant = "icon",
  priority = false,
  className = "",
}: ProductBrandLogoProps) {
  const artwork = PRODUCT_BRAND_ASSETS[product];
  const frame = artwork.frames[variant];
  const clipId = useId();
  if (priority) preload(artwork.source, { as: "image", fetchPriority: "high" });

  return (
    <span className={`product-brand-logo product-brand-artwork ${product} ${variant} ${className}`.trim()}>
      <svg
        className="product-brand-viewport"
        role="img"
        aria-label={`${artwork.name} logo`}
        focusable="false"
        viewBox={`${frame.x} ${frame.y} ${frame.width} ${frame.height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs><clipPath id={clipId}><rect x={frame.x} y={frame.y} width={frame.width} height={frame.height} /></clipPath></defs>
        {/* Only the viewport changes. Both variants display the same original JPEG. */}
        <image href={artwork.source} width={artwork.width} height={artwork.height} clipPath={`url(#${clipId})`} />
      </svg>
    </span>
  );
}
