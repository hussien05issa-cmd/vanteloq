type SimpleIcon = { hex: string; path: string };

// Keep the small set of marks used by Vanteloq local. Importing the package
// barrel pulls thousands of unused exports into every RSC analysis pass.
const simpleMarks: Record<string, SimpleIcon> = {
  Shopify: {
    hex: "7AB55C",
    path: "M15.337 23.979l7.216-1.561s-2.604-17.613-2.625-17.73c-.018-.116-.114-.192-.211-.192s-1.929-.136-1.929-.136-1.275-1.274-1.439-1.411c-.045-.037-.075-.057-.121-.074l-.914 21.104h.023zM11.71 11.305s-.81-.424-1.774-.424c-1.447 0-1.504.906-1.504 1.141 0 1.232 3.24 1.715 3.24 4.629 0 2.295-1.44 3.76-3.406 3.76-2.354 0-3.54-1.465-3.54-1.465l.646-2.086s1.245 1.066 2.28 1.066c.675 0 .975-.545.975-.932 0-1.619-2.654-1.694-2.654-4.359-.034-2.237 1.571-4.416 4.827-4.416 1.257 0 1.875.361 1.875.361l-.945 2.715-.02.01zM11.17.83c.136 0 .271.038.405.135-.984.465-2.064 1.639-2.508 3.992-.656.213-1.293.405-1.889.578C7.697 3.75 8.951.84 11.17.84V.83zm1.235 2.949v.135c-.754.232-1.583.484-2.394.736.466-1.777 1.333-2.645 2.085-2.971.193.501.309 1.176.309 2.1zm.539-2.234c.694.074 1.141.867 1.429 1.755-.349.114-.735.231-1.158.366v-.252c0-.752-.096-1.371-.271-1.871v.002zm2.992 1.289c-.02 0-.06.021-.078.021s-.289.075-.714.21c-.423-1.233-1.176-2.37-2.508-2.37h-.115C12.135.209 11.669 0 11.265 0 8.159 0 6.675 3.877 6.21 5.846c-1.194.365-2.063.636-2.16.674-.675.213-.694.232-.772.87-.075.462-1.83 14.063-1.83 14.063L15.009 24l.927-21.166z",
  },
  Square: {
    hex: "3E4348",
    path: "M4.01 0A4.01 4.01 0 000 4.01v15.98c0 2.21 1.8 4 4.01 4.01h15.98C22.2 24 24 22.2 24 19.99V4A4.01 4.01 0 0019.99 0H4zm1.62 4.36h12.74c.7 0 1.26.57 1.26 1.27v12.74c0 .7-.56 1.27-1.26 1.27H5.63c-.7 0-1.26-.57-1.26-1.27V5.63a1.27 1.27 0 011.26-1.27zm3.83 4.35a.73.73 0 00-.73.73v5.09c0 .4.32.72.72.72h5.1a.73.73 0 00.73-.72V9.44a.73.73 0 00-.73-.73h-5.1Z",
  },
  Stripe: {
    hex: "635BFF",
    path: "M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z",
  },
  QuickBooks: {
    hex: "2CA01C",
    path: "M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm.642 4.1335c.9554 0 1.7296.776 1.7296 1.7332v9.0667h1.6c1.614 0 2.9275-1.3156 2.9275-2.933 0-1.6173-1.3136-2.9333-2.9276-2.9333h-.6654V7.3334h.6654c2.5722 0 4.6577 2.0897 4.6577 4.667 0 2.5774-2.0855 4.6666-4.6577 4.6666H12.642zM7.9837 7.333h3.3291v12.533c-.9555 0-1.73-.7759-1.73-1.7332V9.0662H7.9837c-1.6146 0-2.9277 1.316-2.9277 2.9334 0 1.6175 1.3131 2.9333 2.9277 2.9333h.6654v1.7332h-.6654c-2.5725 0-4.6577-2.0892-4.6577-4.6665 0-2.5771 2.0852-4.6666 4.6577-4.6666Z",
  },
  Xero: {
    hex: "13B5EA",
    path: "M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm6.585 14.655c-1.485 0-2.69-1.206-2.69-2.689 0-1.485 1.207-2.691 2.69-2.691 1.485 0 2.69 1.207 2.69 2.691s-1.207 2.689-2.69 2.689zM7.53 14.644c-.099 0-.192-.041-.267-.116l-2.043-2.04-2.052 2.047c-.069.068-.16.108-.258.108-.202 0-.368-.166-.368-.368 0-.099.04-.191.111-.263l2.04-2.05-2.038-2.047c-.075-.069-.113-.162-.113-.261 0-.203.166-.366.368-.366.098 0 .188.037.258.105l2.055 2.048 2.048-2.045c.069-.071.162-.108.26-.108.211 0 .375.165.375.366 0 .098-.029.188-.104.258l-2.056 2.055 2.055 2.051c.068.069.104.16.104.258 0 .202-.165.368-.365.368h-.01zm8.017-4.591c-.796.101-.882.476-.882 1.404v2.787c0 .202-.165.366-.366.366-.203 0-.367-.165-.368-.366v-4.53c0-.204.16-.366.362-.366.166 0 .316.125.346.289.27-.209.6-.317.93-.317h.105c.195 0 .359.165.359.368 0 .201-.164.352-.375.359 0 0-.09 0-.164.008l.053-.002zm-3.091 2.205H8.625c0 .019.003.037.006.057.02.105.045.211.083.31.194.531.765 1.275 1.829 1.29.33-.003.631-.086.9-.229.21-.12.391-.271.525-.428.045-.058.09-.112.12-.168.18-.229.405-.186.54-.083.164.135.18.391.045.57l-.016.016c-.21.27-.435.495-.689.66-.255.164-.525.284-.811.345-.33.09-.645.104-.975.06-1.095-.135-2.01-.93-2.28-2.01-.06-.21-.09-.42-.09-.645 0-.855.421-1.695 1.125-2.205.885-.615 2.085-.66 3-.075.63.405 1.035 1.021 1.185 1.771.075.419-.21.794-.734.81l.068-.046zm6.129-2.223c-1.064 0-1.931.865-1.931 1.931 0 1.064.866 1.931 1.931 1.931s1.931-.867 1.931-1.931c0-1.065-.866-1.933-1.931-1.933v.002zm0 2.595c-.367 0-.666-.297-.666-.666 0-.367.3-.665.666-.665.367 0 .667.299.667.665 0 .369-.3.667-.667.666zm-8.04-2.603c-.91 0-1.672.623-1.886 1.466v.03h3.776c-.203-.855-.973-1.494-1.891-1.494v-.002z",
  },
  DoorDash: {
    hex: "FF3008",
    path: "M23.071 8.409a6.09 6.09 0 00-5.396-3.228H.584A.589.589 0 00.17 6.184L3.894 9.93a1.752 1.752 0 001.242.516h12.049a1.554 1.554 0 11.031 3.108H8.91a.589.589 0 00-.415 1.003l3.725 3.747a1.75 1.75 0 001.242.516h3.757c4.887 0 8.584-5.225 5.852-10.413",
  },
};

export default function IntegrationBrandLogo({ name, compact = false }: { name: string; compact?: boolean }) {
  if (name === "QuickBooks" || name === "Shopify" || name === "Shopify POS") {
    return <span className={`integration-logo brand-provider-reference${compact ? " compact" : ""}`} role="img" aria-label={`${name} integration`}>
      <svg viewBox="0 0 48 48" aria-hidden="true"><path fill="currentColor" d="M12 13h16a7 7 0 0 1 0 14h-3v5h3a12 12 0 0 0 0-24H12v5Zm24 22H20a7 7 0 0 1 0-14h3v-5h-3a12 12 0 0 0 0 24h16v-5Z"/></svg>
    </span>;
  }
  if (name === "Google" || name === "Meta") {
    return <span className={`integration-logo brand-${slug(name)}${compact ? " compact" : ""}`} role="img" aria-label={`${name} logo`}>
      {/* Local brand artwork; provenance is recorded in docs/brand-asset-sources.md. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={name === "Google" ? "/brand/google-g-ui.webp" : "/brand/meta-mark.svg"} width={28} height={28} alt="" aria-hidden="true" />
    </span>;
  }
  if (name === "Lightspeed" || name.startsWith("Lightspeed ")) {
    return <span className={`integration-logo brand-lightspeed${compact ? " compact" : ""}`} role="img" aria-label="Lightspeed logo">
      {/* Standalone Lightspeed flame artwork; the wordmark is intentionally excluded. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/lightspeed-mark-ui.webp" alt="" aria-hidden="true" />
    </span>;
  }

  if (name === "Plaid") {
    return <span className={`integration-logo brand-plaid${compact ? " compact" : ""}`} role="img" aria-label="Plaid logo">
      {/* Plaid's standalone knot mark, cropped from the unchanged brand lockup. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/plaid-mark-ui.webp" alt="" aria-hidden="true" />
    </span>;
  }

  const icon = simpleMarks[name === "Shopify POS" ? "Shopify" : name];

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
  if (name === "WooCommerce") return <svg viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#96588A" d="M5 9h38v24H27l-7 7 1.7-7H5V9Z"/>
    <text x="9" y="26" fill="#fff" fontSize="12" fontWeight="800" fontFamily="Arial, sans-serif">WOO</text>
  </svg>;

  if (name === "Uber Eats") return <svg viewBox="0 0 48 48" aria-hidden="true">
    <text x="5" y="22" fill="#111" fontSize="14" fontWeight="800" fontFamily="Arial, sans-serif">UBER</text>
    <text x="7" y="37" fill="#06C167" fontSize="14" fontWeight="800" fontFamily="Arial, sans-serif">EATS</text>
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
