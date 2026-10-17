# Data Studio R1 independent review

Review baseline: deployed source `e95bff89752cd9e53b862b8ab6981573d59c3cbf`. Reviewed R1 candidate: `c1ca103dad9b77c86bc8ad492e0daeb633b649b6`, with callback-safety follow-up `880cedf696b443b15179fac9120cd96044c11400`. These are isolated immutable review commits, not the eventual pushed production source commit. Reviews were read-only and did not execute native or full-suite tests.

## Standards review

No further Standards or security findings in the final reviewed correction diff.

Timestamp normalization preserves existing seconds and millisecond values as explicit UTC instants without mutating source records. Weighted margin displays the server-calculated ratio and retains unavailable/restricted states. The footer opens Studio through the existing authorized preview and export paths.

The fixture corrections preserve the controls under test:

- SQLite batch serialization prevents nested transactions while retaining rollback and revocation hooks.
- Provider fixtures now use the owning connection's provider and the publication version required by production SQL.
- Historical-cost fixtures supply dated or retained line evidence. Ambiguous costs remain unavailable or generate warnings.
- Provisional obligations remain reserved once, with unreviewed amounts classified as expected.
- Consent constants update valid requests; stale-consent and MFA denial assertions remain.
- The explicit pilot grant lets location authorization tests reach their intended boundary. Exact denial codes and no-side-effect assertions remain.

The evidence documents clearly identify pending full regression, final rebuild, and authenticated production acceptance. No independent whole-product security audit is claimed.

## Specification review

No further R1 code finding in the final reviewed candidate compared with `61634f25176a6dabc281dccf44974a64337a5710`.

- Timestamps follow the existing seconds-or-milliseconds convention in `server/inventory-costs.ts`. The Studio adapter applies it without changing stored records. Fixtures cover identical UTC instants through preview and XLSX, plus invalid values.
- Weighted margin displays the authoritative total-profit/total-sales ratio, preserving unavailable and restricted states. An unequal-sales fixture verifies the weighted calculation.
- The working export entry opens Executive Review with the selected dates. Panel wiring retains location/source scope, and download remains permission gated.
- Regression fixtures supply current provider lineage, retained cost evidence and consent versions. No production financial or authorization rule was relaxed.

Final build/regression receipts, publication, and authenticated owner acceptance remain release gates. Local evidence does not establish those outcomes. R2, R3 and R4 remain outside this review.

## Earlier findings and verification

| Finding | Correction and evidence |
| --- | --- |
| Failed or revoked export could retain protected preview | Failed download clears result; API revocation fixture and browser denied-export check |
| Snapshot identity omitted scope/settings | Hash binds dates, tenant, currency, timezone, policy, source selection, recorded rows and ledger evidence; changed-scope/profile tests |
| Fractional POS quantities were rejected | Exact integer thousandths, bounded floating residue normalization, negative quantities, actual API/XLSX fixtures |
| Large counts could lose Excel precision | Values exceeding 15-digit support are exported as exact text; workbook readback |
| Standard BookLoQ cash account was not recognised | Shared existing cash-account classifier; separately labelled posted-account fixture |

These are resolved patch findings, not a guarantee that the entire platform or every provider has been production verified.

## Callback-safety follow-up

Both reviewers found no further finding in `880cedf696b443b15179fac9120cd96044c11400`. QuickBooks checks current tenant entitlements using the saved initiation assurance before consuming OAuth state or exchanging the code. This invokes the existing internal-grant MFA rule without inventing a callback assurance claim. Identity binding, active membership, permission checks and one-time state consumption remain intact.

The Lightspeed positive fixture supplies embedded quantities and separately retained costs. Later fixture corrections retain quantities and costs for historical rows, use dates inside the rolling reporting period, and verify that warning runs invalidate current publication proof until a clean corrected version republishes. Square's dated historical return cost is explicitly asserted as a known negative cost while renewed publication remains gated. The cash scenario retains its foreign-currency obligation warning independently of a sandbox balance. These corrections do not weaken production financial or authorization controls.

Both reviewers completed the closing fixture/evidence review at `e90459c09aec58be0a67441b05c92e235def6cf1` with no further finding. They confirmed that the exact negative Square cost, Lightspeed warning refusal/recovery and unavailable sandbox cash assertions remain enforced, and that the report distinguishes the initial full-run failures from successful reruns. This closing review did not execute tests or establish deployed owner acceptance.
