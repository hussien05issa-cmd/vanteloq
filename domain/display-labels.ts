const PROVIDER_LABELS: Record<string, string> = {
  multiple: "Multiple POS sources",
  "lightspeed-r": "Lightspeed Retail R-Series",
  lightspeed: "Lightspeed Retail X-Series",
  shopify: "Shopify",
  "shopify-pos": "Shopify POS",
  square: "Square",
  clover: "Clover",
  stripe: "Stripe",
  moneris: "Moneris",
  google: "Google",
  meta: "Meta",
  plaid: "Plaid",
  "uber-eats": "Uber Eats",
  doordash: "DoorDash",
  "normalized-pos": "Normalized POS",
};

const PRESERVED_TERMS: Record<string, string> = {
  aal2: "AAL2",
  api: "API",
  csv: "CSV",
  gst: "GST",
  hst: "HST",
  id: "ID",
  mfa: "MFA",
  oauth: "OAuth",
  pdf: "PDF",
  pii: "PII",
  pos: "POS",
  sku: "SKU",
  tls: "TLS",
  url: "URL",
};

export function providerDisplayName(provider: string | null | undefined) {
  if (!provider) return "Connected source";
  return PROVIDER_LABELS[provider.toLowerCase()] ?? humanizeIdentifier(provider);
}

export function humanizeIdentifier(value: string | null | undefined) {
  if (!value) return "Not available";
  return value
    .trim()
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\b[a-z0-9]+\b/g, (word, offset) => {
      const preserved = PRESERVED_TERMS[word];
      if (preserved) return preserved;
      return offset === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word;
    });
}

export function workspaceViewLabel(view: string) {
  if (view === "Advisor") return "Vanteloq AI";
  return view;
}
