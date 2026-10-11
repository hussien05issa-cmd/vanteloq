const defaults: Record<string, { currency: string; timezone: string }> = {
  CA: { currency: "CAD", timezone: "America/Edmonton" },
  US: { currency: "USD", timezone: "America/New_York" },
  GB: { currency: "GBP", timezone: "Europe/London" },
  AU: { currency: "AUD", timezone: "Australia/Sydney" },
  NZ: { currency: "NZD", timezone: "Pacific/Auckland" },
  JP: { currency: "JPY", timezone: "Asia/Tokyo" },
  IN: { currency: "INR", timezone: "Asia/Kolkata" },
  MX: { currency: "MXN", timezone: "America/Mexico_City" },
  BR: { currency: "BRL", timezone: "America/Sao_Paulo" },
};

export function countryReportingDefaults(country: string) {
  return defaults[country] ?? { currency: "USD", timezone: "UTC" };
}

export function changeOnboardingCountry<T extends { country: string; province: string; currency: string; timezone: string }>(form: T, country: string): T {
  const previous = countryReportingDefaults(form.country);
  const next = countryReportingDefaults(country);
  return {
    ...form,
    country,
    province: country === form.country ? form.province : "",
    currency: form.currency === previous.currency ? next.currency : form.currency,
    timezone: form.timezone === previous.timezone ? next.timezone : form.timezone,
  };
}

export function validReportingTimezone(value: string): boolean {
  try { new Intl.DateTimeFormat("en-CA", { timeZone: value }).format(0); return Boolean(value.trim()); }
  catch { return false; }
}
