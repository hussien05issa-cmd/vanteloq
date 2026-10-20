type SearchableTransaction = {
  description: string;
  originalDescription: string;
  contactName?: string | null;
  accountName?: string | null;
  sourceSystem: string;
  externalSourceId: string;
};

export function transactionMatchesQuery(transaction: SearchableTransaction, query: string) {
  const normalized = query.trim().normalize("NFKC").toLowerCase();
  if (!normalized) return true;
  const fields = [transaction.description, transaction.originalDescription, transaction.contactName,
    transaction.accountName, transaction.sourceSystem, transaction.sourceSystem.replaceAll("_", " "), transaction.externalSourceId];
  return fields.map(value => value ?? "").join(" ").normalize("NFKC").toLowerCase().includes(normalized);
}

type CloseControl = { periodId: string; status: string };
export function periodCloseState<T extends CloseControl>(period: { id: string; status: string } | null, controls: readonly T[]) {
  const items = period ? controls.filter(item => item.periodId === period.id) : [];
  const complete = items.filter(item => item.status === "complete").length;
  return {
    items,
    complete,
    progress: items.length ? complete / items.length : 0,
    editable: !!period && ["open", "review"].includes(period.status),
    readyToLock: !!period && ["open", "review"].includes(period.status) && items.length > 0 && complete === items.length,
  };
}
