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
    : "/brand/bookloq-logo.jpeg";

  return (
    <span className={`product-brand-logo ${product} ${variant} ${className}`.trim()}>
      {/* Local product artwork is served directly so previews and production do not depend on an image-transformation binding. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={source}
        alt={`${name} logo`}
        width={product === "vanteloq" && variant === "full" ? 1030 : 1024}
        height={product === "vanteloq" && variant === "full" ? 576 : 1024}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
      />
    </span>
  );
}
