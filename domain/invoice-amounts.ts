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
export function invoiceLineAmounts(quantityMilli: number, unitPriceCents: number, taxRateBasisPoints: number) {
  if (![quantityMilli, unitPriceCents, taxRateBasisPoints].every(value => Number.isSafeInteger(value) && value >= 0))
    throw new Error("Enter a valid quantity, price and tax rate.");
  const subtotal = (BigInt(quantityMilli) * BigInt(unitPriceCents) + BigInt(500)) / BigInt(1000);
  const tax = (subtotal * BigInt(taxRateBasisPoints) + BigInt(5000)) / BigInt(10000);
  return { subtotalCents: amount(subtotal), taxCents: amount(tax), totalCents: amount(subtotal + tax) };
}
export function invoiceTotals(lines: { subtotalCents: number; taxCents: number }[]) {
  const subtotal = lines.reduce((sum, line) => sum + BigInt(line.subtotalCents), BigInt(0));
  const tax = lines.reduce((sum, line) => sum + BigInt(line.taxCents), BigInt(0));
  return { subtotalCents: amount(subtotal), taxCents: amount(tax), totalCents: amount(subtotal + tax) };
}
