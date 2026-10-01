# Collections and Private Files Release Review

## Delivered behaviour

- BookLoQ Cash & Collections shows open receivables, open payables, overdue invoices and bills due within the selected planning horizon. Balances use integer cents, include valid partial payments and retain disputed amounts for review.
- Ageing and due-date charts open filtered source records. The due-date line represents cumulative scheduled inflows less outflows, not a bank balance or a prediction of payment. Undated, disputed, invalid and foreign-currency records are identified separately.
- Users can choose visible cards, order, density and a 7-, 30- or 90-day planning horizon. Record searches retain input focus while results load.
- Empty charts preserve their visual structure and explain how to populate them. The homepage includes an interactive, explicitly fictional BookLoQ preview and an empty-state view.
- New connector authorizations require a versioned acknowledgement with links to the provider and Vanteloq privacy notices. This does not silently grant additional provider permissions. The Plaid request uses the same validated consent field as the server.
- Connected-tool logos retain their colour. Requested public legal and verification copy has been simplified.

## Private file capability and availability

The implementation supports private Google Sheets/Drive and Microsoft OneDrive connections, but both launch flags remain disabled. Public copy says Coming Soon until provider verification and a real authorization/import/revocation walkthrough pass.

- Google: the approved HTTPS callback is registered; Drive and Sheets APIs are enabled. The read-only Drive consent-screen scope still requires the owner's approval and Google's restricted-scope verification.
- Microsoft: Vanteloq Files is registered for work/school and personal accounts with the correct HTTPS Web callback. Creation and private storage of its client secret await approval. Publisher verification is still required for customer consent availability.
- The requested OAuth scopes are read-only. Google Drive access is broad within the consenting account; Microsoft uses delegated Files.Read. The UI explains that scope before connection, then imports only selected files.
- Connection secrets and selected sheet snapshots are encrypted. Access is restricted by authenticated user, organization, role and subscription. OAuth uses expiring, single-use state and PKCE.
- Changes are checked while the linked-files panel is open and visible, or when the user requests a check. This is not an always-on background synchronization service.
- Sheets are limited to 1,000 data rows and 52 columns; oversize content is rejected instead of silently truncated. Documents are bounded and pass through the existing quarantine and review flow.
- A selected file is a reviewed copy. It does not automatically post journals or change financial totals. Supported daily-metric CSV tables can be opened in the existing reviewed import workflow. Disconnecting removes connection credentials and linked snapshots; separately imported documents follow their own deletion controls.

## Verification

- TypeScript and production build passed before final publication.
- Focused tests cover collections arithmetic and ageing, financial entitlements, full-record totals, saved preferences, file consent, OAuth replay rejection, encrypted snapshots, cross-workspace denial, oversized revision preservation and credential removal.
- The migration journal now includes 0061, with an up-to-date schema snapshot. A regression check requires every SQL migration to appear exactly once in deployment order. A subsequent schema comparison generates no duplicate migration statements.
- Browser review covered desktop, narrow mobile, empty states, record search focus, saved layout preferences and interactive homepage controls.
- Provider file connections have not passed live end-to-end tests and must not be advertised as available. Private workspace production review still requires an active signed-in owner session.

## Activation checklist

1. Approve and securely configure provider credentials and read-only permissions.
2. Complete Google scope verification and Microsoft publisher verification.
3. Test each provider with fictional files: consent, file selection, changed file, oversized file, revoked access and disconnect.
4. Confirm no accounting records change without the existing review/import action.
5. Enable each provider independently only after its checks pass, then update its public availability.
