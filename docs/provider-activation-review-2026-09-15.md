# Provider activation review

Reviewed September 15, 2026, against the owner's open provider dashboards and the current hosted configuration. This supplements the V1 launch review; it is not a production certification.

| Service | Observed state | Required next step |
| --- | --- | --- |
| Supabase authentication | The approved follow-up found Pro already active. Leaked-password protection was enabled, saved and confirmed after reloading. A fresh security-advisor response returned zero lints. Email confirmation, secure email change and secure password change remain enabled. Seven physical daily backups are visible, most recently September 15, 2026 at 11:36:16 UTC. | This security setting gate is complete. Backup availability is verified, but no restore was performed. Supabase backup coverage does not include the Sites-managed business database or document storage. |
| Stripe subscription billing | Hosted Stripe test checkout was exercised with an explicitly approved test key, fictional customer and isolated local database. A declined card granted no access; a successful retry activated Starter and BookLoQ. Real signed checkout and subscription events were accepted. The separate Stripe connector session remains expired. | Complete the separate hosted signup/email/MFA journey and production endpoint delivery acceptance. The isolated billing test does not establish those authentication or hosted-runtime outcomes. |
| Shopify and Shopify POS | The existing app has 0 installs and its App Store listing is a draft. The active app version has both Vanteloq callbacks, the required read scopes, API version 2026-07 and privacy webhook URLs. Historical-order access is granted. | Complete App Store registration, which currently shows a one-time $19 fee, business type and associated-account declarations. Prepare the listing and reviewer access, complete merchant acceptance, then submit for Shopify review. The fee alone is not approval. |
| Lightspeed X-Series | The existing public app has API health OK and 0 connections. Its saved callback matches Vanteloq's hosted callback. | Authorize a real X-Series merchant and reconcile its approved sample. No credential rotation is needed to correct the callback. This is separate from the R-Series pilot. |
| Plaid | The owner submitted business verification and the production request on September 15. The dashboard confirms Pay-as-you-go, six selected products and an estimated review within 2–3 business days. A separate security questionnaire remains required. The deployed environment is still sandbox. | Complete the security questionnaire with documented controls and accurate owner attestations. Confirm the approved products match the application's read-only Transactions use. Verify hosting locations rather than asserting Canada-only processing. Obtain production access, configure matching credentials and test a Canadian institution before enabling live banking. |
| Moneris | The open tab is public developer documentation, not an authenticated production merchant setup. Vanteloq's observed connection is a sandbox test. The displayed partner form is a merchant-referral/partner inquiry. | Establish the correct production read-only reporting route and merchant access with Moneris. A referral form does not prove reporting access. Do not invent payment volume or submit business declarations. Reconcile a production sample before claiming live reporting. |
| Clover | The owner reached the Test Merchant dashboard. It subsequently timed out after 15 minutes of inactivity. Vanteloq also shows the Test Merchant connection in staging, excluded from reports. | Application production status and real merchant acceptance remain unverified. A test merchant login does not establish production availability. |
| Google marketing | Owner reauthentication succeeded. The available projects are Lexedge Private Console Access, Hussien Command Centre and Default Gemini Project. The Gemini project has no OAuth client. Vanteloq's marketing OAuth project was not identified in this account. | Access the account/project that owns the existing Vanteloq marketing client before changing its configuration. Select only resources belonging to the business being reported; unrelated resources must not be mapped into the retail pilot. |
| Xero | The open page is signup. Vanteloq's adapter remains unavailable. | Implementation and provider authorization are needed; signing into Xero alone does not complete the integration. |
| QuickBooks and Meta | No current provider administration tab was supplied in this inspection. Their previously documented limits remain. | QuickBooks still requires a ledger adapter as well as production review. Meta requires app configuration and permissions/review. |

## Changes from this inspection

- The public catalogue now labels Shopify and Shopify POS as **App review pending**.
- Moneris is labelled **Production setup needed**, with the existing sandbox limitation explained before signup.
- The shared catalogue explains these same prerequisites inside the workspace.
- The provider configuration document now distinguishes implemented services from uncompleted activation requirements.
- After owner approval, Pro was confirmed active and leaked-password protection was enabled. The security advisor returned no lints, and seven scheduled physical backups were visible.

## Recovery and monitoring

Supabase backups cover its project, not the Sites-managed D1 business database or R2 documents. A separate isolated D1/R2 restore drill remains required. The available Sites tools expose read-only database inspection but no backup export or restore operation. Do not attempt to restore over production or claim the runbook is a completed drill.

The inspected 3-hour production error-log window contained 2 HTTP 401 responses and no worker exception. This is a bounded observation, not continuous monitoring or a substitute for an alert owner.

The owner submitted Plaid's business request directly. The security questionnaire has not been submitted. With specific owner approval, the existing Stripe test key was used in process memory for the isolated billing test; no new key or real charge was created. Test products and fictional subscriptions were created in Stripe test mode. The owner approved Supabase Pro; the dashboard already showed Pro active when the follow-up began, so the agent did not submit an additional purchase.

## Security questionnaire evidence

The public privacy notice and explicit bank-data authorization are implemented. Application TOTP MFA precedes protected Plaid actions. The information security policy in `docs/compliance/INFORMATION_SECURITY_POLICY.md` still records owner approval as outstanding, and the administrator MFA inventory is incomplete. Do not answer that policies are operationalized or periodic reviews have occurred without actual evidence. Endpoint protection on one device is not a complete vulnerability-management program or evidence for every administrator device.
