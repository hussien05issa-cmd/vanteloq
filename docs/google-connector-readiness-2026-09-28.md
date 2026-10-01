# Google connector completion record

Checked September 28, 2026. This record separates implementation, hosted configuration and provider approval. It does not certify Google approval or customer availability.

## Current provider and hosting evidence

- Google Cloud project: `vanteloq`.
- Google Auth Platform reports that branding is verified.
- Data access is **not verified**. Analytics and Google Ads are listed as sensitive scopes; the justification and genuine demonstration-video fields remain outstanding.
- Hosting revision 63 contains the marketing client ID and secret, encryption key and callback `https://vanteloq.com/api/v1/integrations/google/callback`.
- Google Ads is enabled in configuration and uses API v25. Its legacy developer-token value is not proof of project access or a successful customer query.
- The private Google Files feature flag is absent, so that connector remains disabled. Its implementation requests `drive.readonly`, which is broader than access to just the file the user selects in Vanteloq. Do not describe this grant as selected-file-only.
- No new customer resources were selected, no customer measurements were approved, and no data-access verification submission was made during this check.

## Business Profile handling

The September 28 change removes Business Profile performance from durable marketing snapshots and excludes previously stored Business Profile metrics from growth summaries and AI evidence. Selected location reports remain available on demand, subject to connection, role, feature and location checks. Existing rows are preserved by this change; it is not a historical-data cleanup.

Before claiming retention compliance, check whether production contains historical Business Profile metric rows. If it does, arrange an approved, provider-policy-compliant cleanup. Do not claim that excluding a record from reports deletes it from storage or backups.

Google's content-storage policy limits caching and restricts aggregation. Fetch original authorized Business Profile reports on demand; do not turn their contents into a permanent performance database or AI training/evidence source. [Business Profile policies](https://developers.google.com/my-business/content/policies#content-storage).

## Remaining completion steps

1. Record a real English OAuth walkthrough and each requested scope's working feature using a dedicated authorized demonstration business. Do not mix LexEdge resources into Supplement World. The existing [recording script](google-verification-readiness-2026-09-16.md) describes the required screens; its old stored-metric step must exclude Business Profile.
2. Review the recording for private records and secrets, then upload the approved recording as an accessible unlisted video. Submit its real URL with an accurate scope justification in Google Auth Platform.
3. Confirm the Google Ads project's access level and run a permitted production reporting query. The September 9, 2026 developer-token sunset means access is attached to the OAuth client's Cloud project. [Google Ads access migration](https://developers.google.com/google-ads/api/docs/api-policy/developer-token).
4. Check Business Profile approval and quota. The older September 16 record reported a submitted application and 0 QPM. That remains historical evidence until its current quota or approval is checked. [Business Profile prerequisites](https://developers.google.com/my-business/content/prereqs).
5. After approval, verify consent, exact business/resource selection, sample review for Analytics/Search/Ads, reports, token refresh, permission denial and disconnect/revocation. Change public availability only after these checks pass.
6. Handle Google Files separately. Its `drive.readonly` scope is restricted; server-side processing/storage may require a security assessment. Alternatively, design and verify a narrower `drive.file` plus Google Picker flow before changing the grant. Do not enable the current connector solely because the marketing callback works. [Drive scope guidance](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

## Verification limits

Final focused verification passed 91 checks: 27 connector/reporting tests, 59 Ads/Worker tests and 5 Business Profile storage/access checks. The production build, artifact validation, TypeScript and diff whitespace checks passed. Focused ESLint reported no errors and one existing unused-import warning. Fixtures used fictional data in isolated local databases.

The read-only production database overview did not expose the marketing tables in its bounded response, so historical Business Profile row presence could not be established. Unknown does not mean zero.

Local fixture tests exercise calculations, callbacks, permissions and provider-response handling. They do not prove Google has approved the application, that a real customer account contains data, or that a recorded demonstration meets review requirements. The marketing refresh is user-triggered; this record does not claim continuous background synchronization.
