export type BookLoQVisibility = { contactIdentity: boolean; accountsPayableReceivable: boolean; documents: boolean };

// Bank descriptions and review notes are unstructured source text and can
// contain the same identities as the explicitly protected contact columns.
export function visibleBookLoQTransaction<T extends { description: string; originalDescription: string }>(row: T, contactIdentity: boolean) {
  return contactIdentity ? row : { ...row, description: "Bank transaction", originalDescription: "", contactName: null };
}

export function visibleBookLoQInvoice<T extends { customerName: string }>(row: T, contactIdentity: boolean) {
  return contactIdentity ? row : { ...row, customerName: "Customer", customerEmail: "", emailedTo: null };
}

export function visibleBookLoQSupplier<T extends { supplierName: string }>(row: T, contactIdentity: boolean) {
  return contactIdentity ? row : { ...row, supplierName: "Supplier" };
}

export function visibleBookLoQMatch<T extends {
  supplierBillId: string | null; customerInvoiceId: string | null; documentId: string | null;
  targetLabel: string; note: string; reasonsJson: string;
}>(row: T, access: BookLoQVisibility) {
  const targetAllowed = row.documentId ? access.documents : access.accountsPayableReceivable;
  if (!targetAllowed) return { ...row, supplierBillId: null, customerInvoiceId: null, documentId: null,
    targetLabel: "Restricted supporting record", note: "", reasonsJson: "[]" };
  return access.contactIdentity ? row : { ...row, note: "", reasonsJson: "[]",
    targetLabel: row.documentId ? "Receipt" : row.customerInvoiceId ? "Customer invoice" : "Supplier bill" };
}

export function visibleBookLoQJournal<T>(row: T, contactIdentity: boolean) {
  return contactIdentity ? row : { ...row, memo: "Journal explanation restricted", sourceRef: null };
}

export function visibleBookLoQAlert<T>(row: T, contactIdentity: boolean) {
  return contactIdentity ? row : { ...row, title: "Financial review item", explanation: "Source detail requires contact identity access.",
    supportingRecordsJson: "[]", recommendedAction: "Review with an authorized accounting reviewer.", resolutionHistoryJson: "[]" };
}
