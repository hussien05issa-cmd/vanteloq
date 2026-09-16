# Provider configuration review

Reviewed September 16, 2026. This records configuration evidence, not a launch certification. Clover and Lightspeed X-Series merchant authorizations, sample imports and transaction tests were deliberately skipped at the owner's request. The Moneris adapter was checked with local fixtures only.

| Provider | Confirmed or changed | Still required |
| --- | --- | --- |
| Clover | Existing app matches hosted client ID; five read permission groups configured; OAuth callback corrected to the primary Vanteloq host; App, Customers, Inventory, Merchants, Orders and Payments webhook subscriptions saved; policy URLs, description, benefits, tagline and categories saved | App is still Draft. Icon and genuine app screenshots, support details and provider review remain. The existing icon upload was previewed but not saved because Clover's crop clipped the V. Refund coverage and unit quantity semantics still require reconciliation before claiming accurate production reports. |
| Lightspeed X-Series | Existing public application matches hosted client ID and exact callback; current API version and seven read scopes documented | Explicit public-app approval was not shown. Public label and API health are not approval evidence. Merchant acceptance remains deferred. |
| Moneris | Signed-in developer portal has a sandbox Vanteloq Payments Read application; production panel explicitly denies access. Corrected environment loading, next-page cursor handling, read-only scope enforcement, success-state validation and canonical payment fields | The owner confirmed this is for future subscribers, so no Vanteloq-owned merchant account is needed. Each subscriber supplies credentials for its own production merchant. Business-report approval remains blocked until currency, refund, settlement and payment-change handling are complete. |
| QuickBooks | Signed-in Vanteloq app found; production policy URLs, launch/connect/disconnect URLs, categories and app classification saved; developer profile accepted and app details advanced from 0% to 83%; callback and portal-return navigation added to Vanteloq | Verified hosting country/IP information and compliance questionnaire remain. Production credentials are locked and hosted environment stays sandbox. The adapter currently verifies company identity; a full accounting ledger importer and reconciliation workflow remain separate implementation work. |

## Callback correction

Clover previously returned to `connectors.vanteloq.com` while authorization began on `vanteloq.com`. The browser-bound OAuth state cookie is host-only. The saved Clover Site URL and hosted `CLOVER_REDIRECT_URI` now use `https://vanteloq.com/api/v1/integrations/clover/callback`. Cookie protections remain unchanged.

Clover's existing webhook URL is `https://connectors.vanteloq.com/api/v1/integrations/clover/webhook`. Server-to-server webhook delivery does not rely on the browser state cookie. Delivery was not tested in this review.

## Moneris import boundaries

New connections save their environment in `source_namespace`, while the old loader incorrectly read only `domain_prefix`. The loader now resolves the exact merchant namespace, supports unambiguous legacy records and rejects environment changes that could mix test and production records.

The documented List Payments response supplies a `next` URI. The importer now extracts its cursor only from the same Moneris origin and payments path, rejects malformed responses and repeated cursors, and continues using fixed read-only endpoints. Missing success status and missing amounts cannot become successful zero-value payments. Cardholder fields are not retained.

Payment staging is not net settlement accounting. Current records do not preserve complete currency/refund/change evidence. The API now enforces the existing `dataPromotionEnabled: false` status, and the UI explains the limitation instead of offering a report-approval button.

## Verification

- Type checking and lint passed.
- Production build and artifact validation passed.
- Nine Moneris local fixture checks passed, including merchant namespace isolation, read-only scope, provider pagination links, invalid origins and documented payment fields.
- No Clover or X-Series tests, provider transaction creation, live merchant imports or customer data promotion were performed.
- Provider approval requirements were not bypassed or certified as complete.

## Official references

- [Lightspeed authorization and public-app approval](https://x-series-api.lightspeedhq.com/docs/authorization)
- [Moneris production onboarding](https://developer.moneris.com/moneris-api/docs/getting-started-guide)
- [Moneris credential setup](https://developer.moneris.com/moneris-api/docs/authentication-api-keys)
- [Moneris List Payments](https://developer.moneris.com/moneris-api/reference/getpayments)

For Intuit's hosting questionnaire, confirm the hosting provider's country and applicable network range. Do not substitute an arbitrary DNS/CDN address for an unverified hosting declaration.
