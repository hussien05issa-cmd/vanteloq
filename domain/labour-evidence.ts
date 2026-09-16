/** POS daily summaries do not supply wages. Legacy zeroes have no evidence. */
export function recordedLabourCost(row: { labourCostCents: number | null; labourCostReported?: boolean | null; sourceProvider?: string | null }): number | null {
  if (row.sourceProvider || row.labourCostCents === null || row.labourCostReported === false) return null;
  return row.labourCostReported === true || row.labourCostCents > 0 ? row.labourCostCents : null;
}
