import Image from "next/image";

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

  return (
    <span className={`product-brand-logo ${product} ${variant} ${className}`.trim()}>
      <Image
        src={`/brand/${product}-logo.jpeg`}
        alt={`${name} logo`}
        width={1024}
        height={1024}
        priority={priority}
        sizes={variant === "full" ? "(max-width: 620px) 42vw, 190px" : "42px"}
      />
    </span>
  );
}
