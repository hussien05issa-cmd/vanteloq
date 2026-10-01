# Meta connector readiness, September 28, 2026

Meta remains **Coming Soon** for ordinary customers. The paid-ad connector is implemented and its focused tests pass, but production credentials, provider approval and real-account acceptance remain incomplete. This handoff does not authorize campaign changes or establish provider approval.

## Verified scope and configuration

Source review confirms OAuth, explicit ad-account selection, warning-free sample approval, paid-ad measurements, daily/campaign/publisher-platform reports, and explicitly confirmed campaign status or supported campaign-level daily-budget changes. Facebook Page and Instagram organic insights, feeds and messaging are not implemented. Meta is excluded from the background sync scheduler; do not promise automatic marketing refresh.

The coordinating audit checked hosted configuration on September 28:

| Environment variable | Current evidence |
| --- | --- |
| `META_MARKETING_APP_ID` | Absent. |
| `META_MARKETING_APP_SECRET` | Absent. Configure through protected server configuration only. |
| `META_MARKETING_REDIRECT_URI` | Present: `https://vanteloq.com/api/v1/integrations/meta/callback`. |
| `META_GRAPH_API_VERSION` | `v25.0`. This is also the source default. |
| `INTEGRATION_ENCRYPTION_KEY` | Present in hosting revision 63. Its private value was not printed or included in this document. |

Authorization requests exactly `ads_read,ads_management` and checks that both were granted. The grant supports reporting and confirmed campaign management; it must not be described as read-only. The application consumes the provider's actual token expiry, with no Meta refresh or long-lived-token exchange implemented. Reauthorization is required when less than five minutes of validity remains.

Source: `server/integrations/marketing.ts`, `marketing-routes.ts`, `marketing-reporting.ts`, `meta-security.ts`, and `sync-policy.ts`.

## Meta dashboard setup and approval

1. Identify the correct Vanteloq app, its business owner and administrator access. Configure the Marketing API product/use case and the Facebook Login flow used by the connector. Meta's official SDK documents app registration, adding Marketing API, and enabling App Secret Proof for server calls. The current connector already sends that proof. [Meta Business SDK](https://github.com/facebook/facebook-nodejs-business-sdk)
2. Configure the exact hosted callback above in the app's OAuth redirect settings and verify the saved value after reloading. The same value is sent during authorization and code exchange. Exact registered redirect matching is an OAuth security requirement. Meta's current settings labels and app configuration still need console confirmation. [OAuth Security BCP, section 2.1](https://www.rfc-editor.org/rfc/rfc9700.html#section-2.1)
3. Request the access needed for **both** `ads_read` and `ads_management`. Meta's official collection distinguishes Standard Access for an app managing its own ad accounts from Advanced Access for managing other people's accounts. A successful app-role test is insufficient evidence for customer access. [Meta Marketing API collection](https://www.postman.com/meta/facebook-marketing-api/collection/0zr4mes/facebook-marketing-api-mapi)
4. Complete the business verification, review evidence and publishing requirements shown for the chosen app and permissions. Record the resulting permission access levels and app publication status; none were verified in the dashboard during this audit. Review material should demonstrate authorization, exact account selection, reporting, and the confirmation controls supporting `ads_management`.
5. Check any separate Marketing API access-tier requirement in the dashboard. Meta renamed Ads Management Standard Access to **Marketing API Access Tier** in May 2026; this feature is distinct from the `ads_management` permission. Do not treat one approval as proof of the other. [Meta access-tier update](https://developers.meta.com/blog/updates-to-ads-management-standard-access-feature/)

### Privacy and data deletion

The source provides `/privacy` and `/account/deletion`. The account deletion page directs users to sign in and verify an authenticator. The connector's disconnect route deletes local credentials, selected resources and derived marketing measurements, and attempts provider revocation. It reports when provider-side revocation still needs action.

No dedicated Meta `signed_request` data-deletion or deauthorization callback was found in the current source. The OAuth callback is a GET authorization-code endpoint and must not be entered as a data-deletion callback.

**Provider confirmation still required:** Verify the app's current User Data Deletion configuration, whether an instructions URL is accepted for this app, and any required callback request validation, response/status contract and deletion timing. Do not claim `/account/deletion` satisfies Meta review until checked. Meta's [data-deletion callback documentation](https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback/), [Login security documentation](https://developers.facebook.com/docs/facebook-login/security/), and [Marketing API setup documentation](https://developers.facebook.com/docs/marketing-api/get-started/) returned HTTP 429 during this audit. Their current requirements could not be independently confirmed. No Meta dashboard state was changed.

## Acceptance before public release

1. Save the missing app credentials securely, verify configuration presence, and confirm OAuth uses the approved app and exact callback.
2. With an authorized internal test account, complete OAuth and confirm both scopes, account identity, token expiry, and access to the intended ad account. Test decline, expired/replayed state and revoked access without exposing credentials.
3. Select the exact ad account and workspace/location scope. Import and approve a warning-free sample. Compare source dates, currency, spend, impressions, clicks and unique reach against Meta. Detailed reports must preserve missing values and must not sum unique reach across scopes.
4. Verify reconnection and disconnect/data deletion with an approved test connection. Check that provider revocation succeeds or the application accurately reports the remaining provider action.
5. Validate campaign controls only on a designated test campaign with separate authorization for the exact change. Verify role/plan restrictions, campaign identity, confirmation and audit evidence. Do not change live budgets merely to complete review.
6. After customer-business permission approval and successful production acceptance, remove Meta from `PREVIEW_INTEGRATION_IDS`, review the rollout change, and verify customer access after deployment. Until then, `requireIntegrationRollout` blocks ordinary customer authorization even if credentials are configured.

## Completed local verification

On September 28, all **38 tests passed**, using fictional fixtures:

```text
node scripts/test.mjs tests/meta-security.test.ts tests/marketing-connectors.test.ts tests/marketing-reporting.test.tsx tests/customer-integration-availability.test.ts
```

Coverage includes proof/header handling, redirect rejection, actual token expiry, scopes, selected-account lineage, campaign confirmation, independent reach totals and customer availability. These results do not verify a live Meta authorization, App Review approval, hosted import or public rollout. This handoff changes documentation only.
