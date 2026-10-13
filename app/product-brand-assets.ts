/** Original customer-supplied artwork. View boxes frame the original pixels;
 * the files are not recoloured, redrawn or transcoded. */
export const PRODUCT_BRAND_ASSETS = {
  vanteloq: {
    name: "Vanteloq",
    source: "/brand/glass-2026-10-12/vanteloq.jpg",
    width: 1254,
    height: 1254,
    frames: {
      icon: { x: 373, y: 376, width: 509, height: 409 },
      full: { x: 227, y: 376, width: 803, height: 528 },
    },
  },
  bookloq: {
    name: "BookLoQ",
    source: "/brand/origin-metal-2026/bookloq.jpg",
    width: 1280,
    height: 853,
    frames: {
      icon: { x: 66, y: 254, width: 376, height: 302 },
      full: { x: 66, y: 254, width: 1162, height: 302 },
    },
  },
} as const;

export type ProductBrand = keyof typeof PRODUCT_BRAND_ASSETS;
export type ProductBrandVariant = "icon" | "full";
