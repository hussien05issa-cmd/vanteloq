/** Only fixed, public explanations may cross the AI evidence boundary. */
export function advisorUnavailableReason(area: "retail" | "bookloq", body: unknown): string {
  const error = body && typeof body === "object" && "error" in body ? body.error : null;
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  if (area === "retail" && code === "RETAIL_SOURCE_OVERLAP") {
    return "Retail evidence was withheld because sales sources overlap or a source is still syncing. Open Reports to review the source selection and Integrations & data to check sync status. This does not mean the workspace has no sales records.";
  }
  if (area === "retail" && code === "RETAIL_LABOUR_OVERLAP") {
    return "Retail evidence was withheld because paid-hours datasets overlap for the same location and period. Review the paid-hours inputs in Intelligence before comparing labour efficiency.";
  }
  if (area === "bookloq" && code === "ADDON_NOT_INCLUDED") {
    return "BookLoQ summaries were not included because this account does not currently have access to the BookLoQ add-on. Check Billing for access; this is not evidence that a ledger is empty.";
  }
  return area === "retail"
    ? "Retail records were not supplied for this request. Check Intelligence for source, date-range or access requirements. Do not infer that the account has no records."
    : "BookLoQ summaries were not supplied for this request. Check BookLoQ and the account's access before interpreting its balances. Do not infer that a ledger is missing or empty.";
}
