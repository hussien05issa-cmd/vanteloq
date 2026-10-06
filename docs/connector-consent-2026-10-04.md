# Connector permission notices, 4 October 2026

Vanteloq 1.0 Origin now explains the provider grant before account authorisation, with a separate unchecked acknowledgement and links to Vanteloq's and the provider's privacy policies. Server enforcement uses `provider-privacy-2026-10-04`; stale or absent acknowledgements are rejected.

## Coverage

Square, Stripe reporting, Lightspeed X-Series, Lightspeed R-Series, Clover, Shopify, Shopify POS, Google marketing, Meta marketing, Slack, Plaid, QuickBooks, Deel and Moneris have enforced connection acknowledgements. Google Drive and Microsoft OneDrive file connections have their separate `linked-files-2026-10-04` notice.

Google's explanation follows configured permissions, including Google Ads only when its scope is requested. Broad Business Profile and Ads management permissions are distinguished from Vanteloq's current reporting use and separately confirmed actions. QuickBooks company verification, Deel aggregate staging and Moneris payment reporting are described without claiming unsupported imports.

The shared notice provides readable permission summaries, use and retention information, a scrollable body, fixed action footer, keyboard focus containment, Escape dismissal, focus restoration and reduced-motion support. Plaid's existing detailed notice now uses the same focus controls and clears its acknowledgement after cancellation or reopening. File notices explain broad file grants, selected-file imports, refresh and provider revocation.

## Verification and limits

- Ten targeted domain and policy tests passed before publication.
- The actual shared Google component was exercised at desktop size and 390 x 844: disabled before acknowledgement, enabled afterward, completion, cancellation, fresh unchecked reopening, Escape, focus restoration, keyboard containment and no horizontal overflow.
- This review does not certify legal compliance or provider approval, and does not demonstrate a new external OAuth authorisation for every provider.
- Google's own unverified-app warning remains until Google approves the requested access. Vanteloq cannot remove it. No verification video was uploaded or submitted in this task.

Official policy references: [Google OAuth sensitive-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification), [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy).
