# Provider configuration review

Reviewed September 16, 2026. This records configuration evidence, not a launch certification. Clover and Lightspeed X-Series merchant authorizations, sample imports and transaction tests were deliberately skipped at the owner's request. The Moneris adapter was checked with local fixtures only.

| Provider | Confirmed or changed | Still required |
| --- | --- | --- |
| Clover | Existing app matches hosted client ID; five read permission groups configured; OAuth callback uses the primary Vanteloq host; webhook subscriptions saved; policy URLs, listing copy, categories, public support details, current V icon and functional description saved; app launch now enters the signed-in Integrations flow | App is still Draft. Three genuine public demo screenshots are prepared, with upload approval pending. A real functional workflow video, merchant reconciliation and provider approval remain. Only the default US free distribution tier is present; paid tiers are locked pending banking setup. Clover billing-policy compatibility and Canadian distribution must be resolved. Refund coverage and unit quantity semantics still require reconciliation before claiming accurate production reports. |
| Lightspeed X-Series | Existing public application matches hosted client ID and exact callback; current API version and seven read scopes documented | Explicit public-app approval was not shown. Public label and API health are not approval evidence. Merchant acceptance remains deferred. |
| Moneris | Signed-in developer portal has a sandbox Vanteloq Payments Read application; production panel explicitly denies access. Corrected environment loading, next-page cursor handling, read-only scope enforcement, success-state validation and canonical payment fields | The owner confirmed this is for future subscribers, so no Vanteloq-owned merchant account is needed. Each subscriber supplies credentials for its own production merchant. Business-report approval remains blocked until currency, refund, settlement and payment-change handling are complete. |
| QuickBooks | Signed-in Vanteloq app found; production policy URLs, launch/connect/disconnect URLs, categories and app classification saved; developer profile accepted and app details advanced from 0% to 83%; callback and portal-return navigation added to Vanteloq | Verified hosting country/IP information and compliance questionnaire remain. Opening the assessment returned an Intuit maintenance page. Production credentials are locked and hosted environment stays sandbox. The adapter currently verifies company identity; a full accounting ledger importer and reconciliation workflow remain separate implementation work. |

## Callback correction

Clover previously returned to `connectors.vanteloq.com` while authorization began on `vanteloq.com`. The browser-bound OAuth state cookie is host-only. Hosted `CLOVER_REDIRECT_URI` now uses `https://vanteloq.com/api/v1/integrations/clover/callback`. Cookie protections remain unchanged.

The provider Site URL is `https://vanteloq.com/`. Clover documents that the explicit OAuth redirect URI may be a valid subpath of this URL. The Alternate Launch Path is `/?start=signin&integration=clover&action=connect`. It directs the merchant to sign in and open the Clover card instead of sending a fresh app launch to a callback that requires an existing authorization state. The user must still select Connect, choose and authorize the correct merchant, and satisfy all account and access checks. Unsolicited codes or merchant IDs from a launch are not accepted as authorization.

The current Clover app checklist confirms the icon, legal information, support information, categories, benefits, description and app settings are complete. The functional description was subsequently saved. Public demo screenshots contain fictional data and do not replace Clover's required functional workflow video. No production submission has been made.

Clover's public monetization documentation requires app fees and app usage payments to be implemented through Clover or Fiserv. Vanteloq's existing Stripe subscription model must be confirmed as an approved arrangement or adapted for Clover distribution. Do not silently create a second subscription, promise a free Vanteloq service or connect banking details without the owner's decision.

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

- [Clover Site URL, redirect URI and launch path](https://docs.clover.com/dev/docs/using-cors)
- [Clover submission requirements](https://docs.clover.com/dev/docs/gdp-submit-your-app-for-approval)
- [Clover monetization rules](https://docs.clover.com/dev/docs/monetizing-your-apps)
- [Lightspeed authorization and public-app approval](https://x-series-api.lightspeedhq.com/docs/authorization)
- [Moneris production onboarding](https://developer.moneris.com/moneris-api/docs/getting-started-guide)
- [Moneris credential setup](https://developer.moneris.com/moneris-api/docs/authentication-api-keys)
- [Moneris List Payments](https://developer.moneris.com/moneris-api/reference/getpayments)

For Intuit's hosting questionnaire, confirm the hosting provider's country and applicable network range. Do not substitute an arbitrary DNS/CDN address for an unverified hosting declaration.
