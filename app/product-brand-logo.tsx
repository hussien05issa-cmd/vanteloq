type ProductBrandLogoProps = {
  product: "vanteloq" | "bookloq";
  variant?: "icon" | "full";
  priority?: boolean;
  className?: string;
};

const PRODUCT_NAMES = {
  vanteloq: "Vanteloq",
  bookloq: "BookLoQ",
} as const;

export default function ProductBrandLogo({
  product,
  variant = "icon",
  priority = false,
  className = "",
}: ProductBrandLogoProps) {
  const name = PRODUCT_NAMES[product];
  const source = product === "vanteloq"
    ? variant === "full"
      ? "/brand/vanteloq-logo.png"
      : "/brand/vanteloq-mark.png"
    : variant === "full"
      ? "/brand/bookloq-logo.jpeg"
      : "/brand/bookloq-logo.png";

  const dimensions = product === "vanteloq"
    ? variant === "full" ? { width: 1030, height: 576 } : { width: 447, height: 402 }
    : variant === "full" ? { width: 1024, height: 1024 } : { width: 1536, height: 1024 };

  return (
    <span className={`product-brand-logo ${product} ${variant} ${className}`.trim()}>
      {/* Local product artwork is served directly so previews and production do not depend on an image-transformation binding. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={source}
        alt={`${name} logo`}
        width={dimensions.width}
        height={dimensions.height}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
      />
      <sup className="brand-trademark" aria-hidden="true">™</sup>
    </span>
  );
}
