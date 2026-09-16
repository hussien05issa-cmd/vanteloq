# Provider activation review

Reviewed September 15, 2026, against the owner's open provider dashboards and the current hosted configuration. This supplements the V1 launch review; it is not a production certification.

| Service | Observed state | Required next step |
| --- | --- | --- |
| Supabase authentication | Correct Vanteloq project is healthy. Email confirmation, secure email change and secure password change are enabled. The security advisor reports disabled leaked-password protection. The project is on Free, and the overview reports no backups. | Pro is required for leaked-password protection. The prepared upgrade quotes $25 today and a $25 monthly base estimate, with usage charges possible. Obtain owner approval, complete payment if required, enable the control and rerun the advisor. No upgrade was confirmed during this inspection. |
| Stripe subscription billing | The browser is signed into Vanteloq. Test mode is accessible. The separate Stripe connector session is expired; browser login does not refresh that connector. Live prices, webhook and portal evidence is in the launch review. | Reconnect the Stripe connector if API access is needed, or supply an isolated test configuration through the provider's secure setup. Complete the separate subscriber checkout, signed webhook, entitlements, failure and cancellation journey without charging a real customer. |
| Shopify and Shopify POS | The existing app has 0 installs and its App Store listing is a draft. The active app version has both Vanteloq callbacks, the required read scopes, API version 2026-07 and privacy webhook URLs. Historical-order access is granted. | Complete App Store registration, which currently shows a one-time $19 fee, business type and associated-account declarations. Prepare the listing and reviewer access, complete merchant acceptance, then submit for Shopify review. The fee alone is not approval. |
| Lightspeed X-Series | The existing public app has API health OK and 0 connections. Its saved callback matches Vanteloq's hosted callback. | Authorize a real X-Series merchant and reconcile its approved sample. No credential rotation is needed to correct the callback. This is separate from the R-Series pilot. |
| Plaid | Production onboarding is unfinished. Six products are selected, but the plan and business verification steps are incomplete. The deployed environment is sandbox. | Owner must provide the correct company/individual status and registered business details. Review the plan and applicable pricing, complete truthful security and use-case declarations, then request production access. Never switch the environment before matching production credentials and approval exist. |
| Moneris | The open tab is public developer documentation, not an authenticated production merchant setup. Vanteloq's observed connection is a sandbox test. The displayed partner form is a merchant-referral/partner inquiry. | Establish the correct production read-only reporting route and merchant access with Moneris. A referral form does not prove reporting access. Do not invent payment volume or submit business declarations. Reconcile a production sample before claiming live reporting. |
| Clover | The open dashboard is at login. | Owner sign-in, application production status check and merchant acceptance remain required. |
| Google marketing | Opening the Cloud console from the public homepage reaches "Verify it's you". No selected Analytics, Search Console, Business Profile or Ads resource is verified by that page. | Owner must finish reauthentication. Select only resources belonging to the business being reported. Existing resources for other businesses must not be mapped into the retail pilot. |
| Xero | The open page is signup. Vanteloq's adapter remains unavailable. | Implementation and provider authorization are needed; signing into Xero alone does not complete the integration. |
| QuickBooks and Meta | No current provider administration tab was supplied in this inspection. Their previously documented limits remain. | QuickBooks still requires a ledger adapter as well as production review. Meta requires app configuration and permissions/review. |

## Changes from this inspection

- The public catalogue now labels Shopify and Shopify POS as **App review pending**.
- Moneris is labelled **Production setup needed**, with the existing sandbox limitation explained before signup.
- The shared catalogue explains these same prerequisites inside the workspace.
- The provider configuration document now distinguishes implemented services from uncompleted activation requirements.

## Recovery and monitoring

Supabase backups cover its project, not the Sites-managed D1 business database or R2 documents. A separate isolated D1/R2 restore drill remains required. The available Sites tools expose read-only database inspection but no backup export or restore operation. Do not attempt to restore over production or claim the runbook is a completed drill.

The inspected 3-hour production error-log window contained 2 HTTP 401 responses and no worker exception. This is a bounded observation, not continuous monitoring or a substitute for an alert owner.

No payment, new credential, contractual submission, provider approval or production-data import was performed by this inspection.
