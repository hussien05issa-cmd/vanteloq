import { buildCollectionsDashboard, filterCollections, type CollectionKind, type CollectionRecord, type CollectionsFilter } from './collections-dashboard';

/** Public preview only. Invented documents never enter customer storage. */
export function collectionsDemo(asOf: string, kind: CollectionKind, filter: CollectionsFilter, empty = false) {
  const date = (offset: number) => new Date(Date.parse(asOf + 'T00:00:00Z') + offset * 86_400_000).toISOString().slice(0, 10);
  const rows: CollectionRecord[] = empty ? [] : (['receivable', 'payable'] as const).flatMap((type, k) =>
    [932000, 541000, 248000, 143000].map((amount, i) => ({
      id: 'sample-' + type + '-' + i, kind: type, reference: (type === 'receivable' ? 'SAMPLE-INV-' : 'SAMPLE-BILL-') + (100 + i),
      contactId: 'sample-contact-' + i, contactName: 'Sample ' + (type === 'receivable' ? 'customer ' : 'supplier ') + (i + 1),
      invoiceDate: date(-120), dueDate: date([14, -18, -45, -97][i]), status: 'open', approvalStatus: 'approved',
      totalCents: k ? Math.round(amount * .6) : amount, paidCents: 0, currency: 'CAD', updatedAt: null,
    })));
  const { records, ...report } = buildCollectionsDashboard(rows, asOf, 'CAD');
  const selected = filterCollections(records, kind, filter, asOf, 30);
  return { report, records: selected, total: selected.length };
}
