# Google verification readiness

Prepared September 16, 2026. This is a submission brief, not Google approval.

## Verified configuration and remaining evidence

The coordinating agent inspected Cloud project `vanteloq` and matched the live OAuth request to the production web client:

- Client name: Vanteloq Production.
- Client ID: `688191538221-hcm1edtcie4ukg04fpg3475slsrsc7jr.apps.googleusercontent.com`.
- Callback: `https://vanteloq.com/api/v1/integrations/google/callback`.
- Brand verification: shown as verified.
- Sensitive scopes: Analytics and Google Ads still require verification.
- Scope justification and accessible demonstration video: not submitted. The console requires a video before saving this stage.
- Latest reauthorization: coordinating agent reported a successful callback. Resource selection and report acceptance still require verification.

A live OAuth client match and enabled APIs do not establish production data access for each service. Complete scope verification, eligible resource selection and successful provider reports separately.

## Scope justification

The following draft is 987 characters. Recheck against the final deployed behaviour and requested scope list before submission.

> Vanteloq helps business owners review their own marketing performance. openid and email identify the connected Google account. analytics.readonly lists authorized GA4 properties and reads sessions, engagement, page views, key events and realtime activity. webmasters.readonly lists Search Console sites and reads search clicks, impressions, queries and pages. adwords reads selected Google Ads accounts, campaigns, spend, clicks and conversions; Google offers no narrower reporting scope. business.manage lists authorized Business Profile locations, reads performance and reviews, and publishes only the exact review reply a permitted user separately confirms; these endpoints do not offer a narrower read-only scope. Users choose resources and business/location scope, review data before approval, and can disconnect. With separate AI consent, permitted aggregate traffic, search and advertising totals may be sent to OpenAI for requested analysis; Business Profile content is excluded.

## What the source actually implements

| Requested scope | User-facing use | Source evidence |
| --- | --- | --- |
| `openid`, `email` | Identify which Google account is connected. | `server/integrations/marketing.ts`: authorization, token exchange and identity lookup. |
| `https://www.googleapis.com/auth/analytics.readonly` | Discover GA4 properties; display sessions, engagement, views, key events, acquisition channels, pages, devices and rolling realtime activity. | `marketing.ts` resource discovery and daily metrics; `marketing-reporting.ts` GA4 reports. |
| `https://www.googleapis.com/auth/webmasters.readonly` | Select an accessible Search Console site; display clicks, impressions, queries, pages, devices and average position. | `marketing.ts` site discovery; `marketing-reporting.ts` Search Console reports. |
| `https://www.googleapis.com/auth/business.manage` | Select Business Profile locations, read their discovery/actions/reviews, and publish a separately confirmed review reply. | `marketing.ts` Business Profile API calls; `marketing-routes.ts` location ownership, permissions and confirmation; `app/growth-workspace.tsx` review controls. |
| `https://www.googleapis.com/auth/adwords` | Discover authorized Google Ads client accounts and show campaign/daily spend, clicks, impressions and attributed conversions. | `google-ads-access.ts`, `marketing.ts`, `marketing-reporting.ts`. No Google campaign mutation was identified in these reporting adapters. |

Analytics and Search Console use read-only scopes. Google's Ads reporting authorization uses `adwords`; Business Profile review replies require `business.manage`. Do not describe the entire Google connection as read-only because the review reply feature writes to Google. [Google Ads OAuth internals](https://developers.google.com/google-ads/api/docs/oauth/internals), [Business Profile reply endpoint](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/updateReply).

Resource selection records organization or location scope. The application requires selected resources, data review and approval before promoting measurements into business reports. Disconnect removes the connection's imported marketing metrics, selected resources, local secrets and pending OAuth state, then attempts provider revocation. If Google revocation fails, the response instructs the user to revoke Vanteloq in Google account settings.

With separate AI consent, `server/marketing-evidence.ts` permits approved, permission-filtered aggregate marketing totals. It explicitly excludes Business Profile content. The privacy page also excludes search queries, page addresses and raw credentials from the automated AI evidence summary. Do not claim that no Google-derived information can reach OpenAI.

## Recording script for the actual application

Use a real authorized demonstration account and a business workspace containing only its own resources. Do not map Lexedge or Vanteloq resources into Supplement World merely to populate the recording. Keep customer records, secrets, passwords and verification codes out of the recording.

1. **Product and purpose.** Open `https://vanteloq.com`, show the Vanteloq branding, then the authenticated Marketing workspace. Say: “Vanteloq lets business owners review the marketing sources they choose for their business.”
2. **User starts connection.** In Integrations, open Google and start authorization. Show the account selection and full English OAuth consent workflow. Keep the app name, requested permissions and client ID in the authorization address visible. Do not skip the consent screens or substitute a mockup.
3. **Account and resource choice.** Return through the production callback. Show the connected account, discover resources, choose the exact GA4 property, Search Console site, Business Profile location and Ads client belonging to the demonstration business, and select their correct organization or location scope. Do not select every resource automatically.
4. **Data review.** Load the sample and show its source, date and review controls before approving that chosen demonstration business's data. Explain that Google account authorization alone does not approve a resource for business reporting.
5. **Analytics.** Open Marketing > Reports. Select GA4 and show a dated report and its chart/table, followed by one channel or page view. Explain that key events depend on the property's configuration.
6. **Search Console.** Show clicks, impressions and a query or page breakdown. Show the reporting period and explain the processing delay. Average position is a source metric, not a guaranteed search ranking.
7. **Google Ads.** Show an authorized client account, its currency and daily/campaign results. Explain that attributed conversions are reported by Google Ads and are not proof of profit. If access is denied, resolve project access before treating this segment as complete.
8. **Business Profile.** Show the selected location, its original discovery/action series and the review response centre. Load reviews on demand. Show the reply field and explicit exact-text confirmation. Demonstrate that publication is disabled without confirmation and that editing a confirmed draft requires confirmation again. A real publication needs the account owner's approval of that exact text and target review; never post a fake review response for a video. If no reply is actually published, describe this segment as a confirmation-control demonstration, not a verified publication.
9. **Optional requested AI analysis.** Show the separate workspace-data consent and ask a question using the demonstration account's approved aggregate totals. Explain that Google Business Profile content is excluded. The recording must reflect the actual consent and data-use workflow.
10. **Disconnect and control.** Use the dedicated demonstration connection to show the disconnect confirmation and successful disconnection. Check provider-side revocation result. Do not disconnect an operational customer connection to stage this shot.

Record the complete grant flow and every requested scope's actual feature, then upload the reviewed recording as an accessible, preferably unlisted, YouTube video. Confirm access without the uploader's session and submit the real URL. Google requires the app branding and complete English consent screen; incomplete functional evidence can delay review. [Google sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification), [Google demo requirements](https://support.google.com/cloud/answer/13804565?hl=en).

## Production checks outside OAuth verification

- **Google Ads project access.** Google sunset developer tokens on September 9, 2026. Access levels now belong to the Cloud project owning the OAuth client. Existing token headers are optional and ignored; new applications and access upgrades belong in that project's Google Ads API Overview. Check the actual project access level and a production account query. An existing token does not prove production access. [Google migration notice, updated September 11](https://developers.google.com/google-ads/api/docs/api-policy/developer-token?hl=en).
- **Business Profile approval.** Check the project's Business Profile API approval and quota. Google documents 0 QPM as unapproved and 300 QPM as approved. Review access also uses `mybusiness.googleapis.com`, beyond the separately enabled Account Management, Business Information and Performance APIs. [Business Profile prerequisites](https://developers.google.com/my-business/content/prereqs).
- **Reporting transport.** Source review found `redirect: "error"` in the detailed report helper while the built Workers directory adapter documents that mode as unsupported. Change to manual redirect handling with explicit rejection before credentialed report acceptance tests.
- **Exact reply consent.** Source review found that editing a reply did not clear its previous confirmation. Reset confirmation on text changes and test this before demonstrating exact-text approval.
- **Business Profile storage claims.** Detailed reports/reviews are on demand, but the existing sampled metrics path also processes Business Profile series. Do not claim that all Business Profile content is never stored without reviewing that separate cache/retention path.

## Acceptance record to finish

Record the release, time, authorized account class, selected resource types, provider success/error codes, refresh result, actual report display, and Google submission status. Use sanitized evidence only. Mark unavailable scopes or services explicitly. No video has been generated or submitted by this document, and no Google approval is claimed.


## Current test outcome

The owner completed reauthorization and live resource discovery succeeded. No discovered marketing resources were mapped into Supplement World: only unrelated business properties and a Google Ads test account were available. The Google Ads Cloud project shows Explorer access, including production-account operations. My Business Account Management API is enabled but its quota is 0 requests per minute, so Business Profile API approval is outstanding. The OAuth data-access submission is still blocked on an accessible genuine demonstration video. No video was uploaded or verification submitted.

Implemented persistent resource errors/reconnect guidance, accurate unreviewed-resource labels, Worker-compatible report fetch with redirect rejection, an explicit Ads enable flag with legacy configuration fallback, removal of developer-token headers, project-approval error guidance, and reconfirmation after editing a Google review reply. Focused tests passed 97/97, including native Worker requests and redirect rejection. No customer measurements were approved or changed during this review.
