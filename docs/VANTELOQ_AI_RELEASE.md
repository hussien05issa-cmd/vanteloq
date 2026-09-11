# Vanteloq AI implementation and activation

Prepared 10 September 2026. This update is not proof of live provider operation or legal certification.

## Implemented behavior

- Vanteloq AI branding throughout the advisor and public description. Google Gemini, OpenAI, or both can be selected; unavailable configurations are explicitly labelled.
- Both mode sends the same permitted evidence independently and displays attributed answers. Partial failures identify the missing provider. A single-provider request is never rerouted silently.
- The server calculates two aligned 28-day periods, net sales, gross profit, weighted gross margin, average transaction value, units per transaction, labour-to-sales ratio, contribution after labour, and dated inventory/payables snapshots. Growth comparisons require complete observed-location coverage in both periods. Missing data is unavailable rather than zero.
- Approved daily records, authorized marketing aggregates, source freshness and eligible bank-cash aggregates are selected within the requesting user's organization, locations and permissions. The evidence contains no raw invoices, transactions, account numbers, customer identifiers, credentials or provider resource identifiers.
- Net profit, free cash flow, liquidity ratios, tax, forecasts and product/customer/employee analyses are not fabricated when their required data is absent. The model is instructed to distinguish evidence, hypotheses, assumptions and suggested next steps, with human review for consequential decisions.
- Separate explicit versioned consent records for Google and OpenAI; changing providers clears the checkbox. Memory is invalidated by provider choice, permissions, locations or evidence changes. Conversations remain private to their user and organization, with scoped deletion and existing 90-day inactivity cleanup on next use.
- Server-held keys, bounded questions, basic sensitive-input rejection, rate limiting, authentication/MFA and entitlement checks, no model tools or autonomous actions, safe provider errors and timeouts. The text-input filter is not comprehensive personal-data detection; users must avoid including such information.

## Activation status and required configuration

As inspected during this update, the live Sites configuration contains a Gemini key but no OpenAI key. The owner answered that Gemini billing was absent or uncertain. The secure OpenAI connector returned an unknown-tool error after reconnection; no new OpenAI credential was created.

1. Verify which Google Cloud project owns the configured Gemini key and that it has active Cloud Billing under the applicable paid-service terms. Do not infer this from a saved key, successful response or another billed project. Set `GOOGLE_GEMINI_PAID_SERVICE_CONFIRMED=true` only after verification; the new code otherwise blocks Gemini evidence transmission.
2. Complete secure OpenAI key provisioning, review project permissions/budget and disable optional account data sharing/training. Store `OPENAI_API_KEY` as a Sites secret. `OPENAI_MODEL` defaults to `gpt-5-mini`; the application uses Responses with `store:false`. No plaintext keys belong in source or conversation.
3. Review provider agreements, subprocessors, processing locations, customer/employee authority and notices, retention/deletion operations and applicable Alberta/Canadian or other jurisdictional duties with the responsible privacy/legal reviewer. Neither a checkbox nor this implementation establishes compliance by itself. Canadian-only processing and zero provider retention have not been established.
4. Publish the saved update when release is authorized. Until published, the new protections and branding are not active on the customer domain.
5. Test Gemini, OpenAI and both with synthetic data first, then an authorized account's permitted aggregates. Check arithmetic against source reports, withheld/missing inputs, current provider availability, consent, provider attribution, partial failure and deletion. Live model quality and end-to-end dual-provider operation are not yet verified.

## Verification completed

- Production build and TypeScript checks passed.
- Lint passed for changed application/provider/KPI code and affected flow tests.
- 71 targeted calculation, provider, consent, presentation, release-security, anonymous-access, origin and deletion checks passed.
- 13 integration/legal checks passed, including marketing evidence selection, both-provider requests, stale/no consent, Google billing gate, and onboarding recovery.
- The outbound advisor access test also passed after extension: restricted cost/payroll/inventory/payables/cash values and another location's sales are absent; a different user cannot read or delete the conversation; revoking revenue permission removes previous memory; deletion removes messages.
- Provider requests in these tests are fixtures. No live customer information was submitted to an AI provider for verification. Authenticated browser acceptance remains outstanding.

## Primary references reviewed

- [Gemini API terms](https://ai.google.dev/gemini-api/terms): paid and unpaid service data handling differ.
- [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data): no training by default, optional data sharing, abuse-monitoring retention and limitations of `store:false`.
- [Canadian privacy regulators' generative AI principles](https://www.priv.gc.ca/en/privacy-topics/technology/artificial-intelligence/gd_principles_ai/): accountability, appropriate purposes, consent and safeguards.

Review these terms again when activating or changing accounts, providers, regions or models. The public Privacy Policy and Subprocessor Notice were updated to describe the implemented flows and their limitations.
