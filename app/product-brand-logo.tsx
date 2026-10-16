import { useId } from "react";
import { preload } from "react-dom";
import { PRODUCT_BRAND_ASSETS, type ProductBrand, type ProductBrandVariant } from "./product-brand-assets";

type ProductBrandLogoProps = {
  product: ProductBrand;
  variant?: ProductBrandVariant;
  priority?: boolean;
  clearCarrier?: boolean;
  fullArtwork?: boolean;
  className?: string;
  svgIdPrefix?: string;
};

export default function ProductBrandLogo({
  product,
  variant = "icon",
  priority = false,
  clearCarrier = product === "bookloq",
  fullArtwork = false,
  className = "",
  svgIdPrefix,
}: ProductBrandLogoProps) {
  const artwork = PRODUCT_BRAND_ASSETS[product];
  // Vanteloq uses the symbol alone, including legacy full-lockup call sites.
  // Full parent artwork is reserved for the dedicated brand banner.
  const displayedVariant = product === "vanteloq" && !fullArtwork ? "icon" : variant;
  const frame = artwork.frames[displayedVariant];
  const generatedId = useId();
  const fragmentPrefix = svgIdPrefix ?? generatedId;
  const clipId = `${fragmentPrefix}-clip`;
  const carrierMaskId = `${fragmentPrefix}-carrier`;
  const carrierFilterId = `${fragmentPrefix}-carrier-filter`;
  if (priority) preload(artwork.source, { as: "image", fetchPriority: "high" });

  return (
    <span className={["product-brand-logo", "product-brand-artwork", product, displayedVariant, clearCarrier && "clear-carrier", className].filter(Boolean).join(" ")}>
      <svg
        className="product-brand-viewport"
        role="img"
        aria-label={`${artwork.name} logo`}
        focusable="false"
        width={frame.width}
        height={frame.height}
        viewBox={`${frame.x} ${frame.y} ${frame.width} ${frame.height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <clipPath id={clipId}><rect x={frame.x} y={frame.y} width={frame.width} height={frame.height} /></clipPath>
          {clearCarrier && <>
            <filter id={carrierFilterId} colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
              <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  .2126 .7152 .0722 0 0" />
              <feComponentTransfer><feFuncA type="discrete" tableValues={`0 ${Array(63).fill("1").join(" ")}`} /></feComponentTransfer>
            </filter>
            <mask id={carrierMaskId} maskUnits="userSpaceOnUse" x={frame.x} y={frame.y} width={frame.width} height={frame.height}>
              <image href={artwork.source} width={artwork.width} height={artwork.height} filter={`url(#${carrierFilterId})`} />
            </mask>
          </>}
        </defs>
        {/* The original colour pixels are retained. The mask hides only the
            near-black JPEG carrier, including all default BookLoQ artwork. */}
        <image href={artwork.source} width={artwork.width} height={artwork.height} clipPath={`url(#${clipId})`} mask={clearCarrier ? `url(#${carrierMaskId})` : undefined} />
      </svg>
    </span>
  );
}
