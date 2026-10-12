/** Original customer-supplied artwork. View boxes frame the original pixels;
 * the files are not recoloured, redrawn or transcoded. */
export const PRODUCT_BRAND_ASSETS = {
  vanteloq: {
    name: "Vanteloq",
    source: "/brand/origin-metal-2026/vanteloq.jpg",
    width: 1254,
    height: 1254,
    frames: {
      icon: { x: 396, y: 382, width: 467, height: 379 },
      full: { x: 259, y: 382, width: 738, height: 483 },
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
  lexedge: {
    name: "LexEdge Consulting",
    source: "/brand/origin-metal-2026/lexedge.jpg",
    width: 1254,
    height: 1254,
    frames: {
      icon: { x: 430, y: 369, width: 421, height: 344 },
      full: { x: 203, y: 369, width: 854, height: 564 },
    },
  },
} as const;

export type ProductBrand = keyof typeof PRODUCT_BRAND_ASSETS;
export type ProductBrandVariant = "icon" | "full";
