import {
  siDoordash,
  siQuickbooks,
  siShopify,
  siSquare,
  siStripe,
  siUbereats,
  siWoocommerce,
  siXero,
} from "simple-icons";

type SimpleIcon = typeof siShopify;

const simpleMarks: Record<string, SimpleIcon> = {
  Shopify: siShopify,
  Square: siSquare,
  Stripe: siStripe,
  QuickBooks: siQuickbooks,
  Xero: siXero,
  WooCommerce: siWoocommerce,
  DoorDash: siDoordash,
  "Uber Eats": siUbereats,
};

export default function IntegrationBrandLogo({ name, compact = false }: { name: string; compact?: boolean }) {
  const icon = simpleMarks[name];

  if (icon) {
    return <span className={`integration-logo brand-${slug(name)}${compact ? " compact" : ""}`} role="img" aria-label={`${name} logo`}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path fill={`#${icon.hex}`} d={icon.path}/></svg>
    </span>;
  }

  return <span className={`integration-logo brand-${slug(name)}${compact ? " compact" : ""}`} role="img" aria-label={isCompany(name) ? `${name} logo` : `${name} icon`}>
    <CustomMark name={name}/>
  </span>;
}

function CustomMark({ name }: { name: string }) {
  if (name === "Lightspeed") return <svg viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#ED1C2E" d="M8.5 16.5 20.6 4.4h14.7l-12 12.1H8.5Z"/>
    <path fill="#ED1C2E" d="m8.5 26.2 8.2-8.1h14.7l-8.2 8.1H8.5Z" opacity=".78"/>
    <path fill="#ED1C2E" d="m8.5 36 8.1-8.2h14.7L23.2 36H8.5Z" opacity=".56"/>
    <path fill="#ED1C2E" d="m17 43.5 6.8-6.8h15.7l-6.8 6.8H17Z" opacity=".34"/>
  </svg>;

  if (name === "Clover") return <svg viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#29A36A" d="M21.8 7.5H16a8.5 8.5 0 0 0-8.5 8.5v5.8h14.3V7.5Zm4.4 0H32a8.5 8.5 0 0 1 8.5 8.5v5.8H26.2V7.5Zm14.3 18.7V32a8.5 8.5 0 0 1-8.5 8.5h-5.8V26.2h14.3Zm-18.7 0v14.3H16A8.5 8.5 0 0 1 7.5 32v-5.8h14.3Z"/>
  </svg>;

  if (name === "Moneris") return <svg viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#35B7B0" d="M6 34.8V17.6c0-2.5 1.9-4.5 4.3-4.5 1.6 0 3.1.9 3.8 2.4l1.4 2.9 3.4-6.8a5.8 5.8 0 0 1 10.4 0l3.3 6.8 1.5-2.9a4.2 4.2 0 0 1 8 2.1v17.2h-6.4V22.1l-5.4 10.8h-5.2L24 30.7l-1.1 2.2h-5.2l-5.3-10.8v12.7H6Z"/>
  </svg>;

  if (name === "Amazon") return <svg viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#101820" d="M26.7 26.8c-2.1 1.6-5.1 2.5-7.7 2.5-4 0-6.8-2.5-6.8-6.3 0-3 1.6-5 4-6 2.2-1 5.3-1.2 7.7-1.5v-.6c0-1.2-.1-2-.6-2.7-.5-.6-1.4-.9-2.3-.9-1.7 0-3.2.9-3.6 2.7l-4.4-.4c.9-4.5 4.9-5.9 8.7-5.9 2 0 4.5.5 6 1.8 2 1.7 1.8 4 1.8 6.5v5.9c0 1.8.7 2.6 1.5 3.6l-4.3 3.7v-2.4Zm-2.8-7.7c-2.9 0-6 .6-6 3.3 0 1.4.8 2.4 2.3 2.4 1.1 0 2.2-.7 2.9-1.8.8-1.3.8-2.5.8-3.9Z"/>
    <path fill="#FF9900" d="M9.3 34.2c8.5 5 19.1 5.6 27.7 1.2.8-.4 1.5.5.7 1.1-7.7 5.9-20 6.2-28.8-.2-.8-.6-.5-1.6.4-1.1Z"/>
    <path fill="#FF9900" d="M34.6 33.1c1-.1 3.4-.4 3.8.2.4.5-.4 2.8-.8 3.8-.1.3.2.4.5.2 1.7-1.5 2.1-4.6 1.8-5-.4-.5-3.5-.9-5.3.4-.3.2-.2.5 0 .4Z"/>
  </svg>;

  if (name === "Bank feeds") return <svg viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#2165B5" d="m24 6 18 9v4H6v-4l18-9Zm-13 17h5v13h-5V23Zm10.5 0h5v13h-5V23ZM32 23h5v13h-5V23ZM7 39h34v4H7v-4Z"/>
  </svg>;

  if (name === "Payroll") return <svg viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#2165B5" d="M7 10h34v28H7V10Zm5 6v16h24V16H12Z"/>
    <circle cx="20" cy="23" r="4" fill="#2165B5"/>
    <path fill="#2165B5" d="M14.5 30c.7-3 2.5-4.5 5.5-4.5s4.8 1.5 5.5 4.5h-11ZM28 20h5v2h-5v-2Zm0 5h5v2h-5v-2Z"/>
  </svg>;

  return <svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#2165B5" d="M11 7h20l6 6v28H11V7Zm18 4v5h5l-5-5ZM17 23h14v-3H17v3Zm0 6h14v-3H17v3Zm0 6h10v-3H17v3Z"/></svg>;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function isCompany(value: string) {
  return !["Bank feeds", "Payroll", "Daily CSV"].includes(value);
}
