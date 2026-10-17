// All invoice arithmetic uses integer minor units and rounds half up per line.
// Share this module between the editor preview and authoritative server validation.
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
function amount(value: bigint): number {
  if (value < BigInt(0) || value > MAX) throw new Error("The invoice exceeds the supported amount.");
  return Number(value);
}
export function decimalUnits(value: string, places: number): number {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(value.trim().replace(/^\.(?=\d)/, "0."));
  if (!match || (match[2]?.length ?? 0) > places) throw new Error("Enter a valid amount with the supported decimal places.");
  return amount(BigInt(match[1]) * BigInt(10) ** BigInt(places) + BigInt((match[2] ?? "").padEnd(places, "0") || "0"));
}
// Keep the existing numeric basis-point interface, including saved integer rates.
// One decimal basis point represents three decimal percentage places. Convert its
// decimal representation to an integer before doing any money multiplication.
export function invoiceTaxRateUnits(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10_000)
    throw new Error("Enter a tax rate from 0% to 100% with up to three decimal places.");
  try { return decimalUnits(String(value), 1); }
  catch { throw new Error("Enter a tax rate from 0% to 100% with up to three decimal places."); }
}
export function parseInvoiceTaxPercent(value: string): number {
  let units: number;
  try { units = decimalUnits(value, 3); }
  catch { throw new Error("Enter a tax rate from 0% to 100% with up to three decimal places."); }
  const basisPoints = units / 10;
  invoiceTaxRateUnits(basisPoints);
  return basisPoints;
}
export function formatInvoiceTaxPercent(taxRateBasisPoints: number): string {
  const units = String(invoiceTaxRateUnits(taxRateBasisPoints)).padStart(4, "0");
  const whole = units.slice(0, -3);
  const fraction = units.slice(-3).replace(/0+$/, "");
  return whole + (fraction ? "." + fraction : "") + "%";
}
export function invoiceLineAmounts(quantityMilli: number, unitPriceCents: number, taxRateBasisPoints: number) {
  if (![quantityMilli, unitPriceCents].every(value => Number.isSafeInteger(value) && value >= 0))
    throw new Error("Enter a valid quantity, price and tax rate.");
  const taxRateUnits = invoiceTaxRateUnits(taxRateBasisPoints);
  const subtotal = (BigInt(quantityMilli) * BigInt(unitPriceCents) + BigInt(500)) / BigInt(1000);
  const tax = (subtotal * BigInt(taxRateUnits) + BigInt(50_000)) / BigInt(100_000);
  return { subtotalCents: amount(subtotal), taxCents: amount(tax), totalCents: amount(subtotal + tax) };
}
export function invoiceTotals(lines: { subtotalCents: number; taxCents: number }[]) {
  const subtotal = lines.reduce((sum, line) => sum + BigInt(line.subtotalCents), BigInt(0));
  const tax = lines.reduce((sum, line) => sum + BigInt(line.taxCents), BigInt(0));
  return { subtotalCents: amount(subtotal), taxCents: amount(tax), totalCents: amount(subtotal + tax) };
}
