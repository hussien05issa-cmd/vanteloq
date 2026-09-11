# Vanteloq AI implementation and activation

Updated September 11, 2026. This document describes the current implementation, not a security or legal certification.

## OpenAI only

Vanteloq AI uses the OpenAI Responses API. The provider selector and Gemini integration have been removed. The API defaults to OpenAI and rejects removed or unknown provider modes before collecting evidence. There is no automatic provider fallback. `OPENAI_API_KEY` is a server secret; `OPENAI_MODEL` optionally overrides the current default, `gpt-5-mini`.

OpenAI was verified in production for App help and Business analysis. Operational credit and usage limits still apply. Known billing, quota and authorization failures return actionable sanitized errors. Requests use manual redirect handling, a 45-second timeout, `store: false`, no action tools and completed text responses only.

## Evidence, privacy and consent

- Business analysis uses approved records scoped to organization, permitted locations and metric permissions. The server calculates matching periods and financial ratios before sending a bounded summary. Missing costs, stale records and incomplete comparisons remain explicit.
- Authorized BookLoQ aggregates use the actual finance authorization path. Demonstration ledgers and absent cash are excluded from live evidence.
- App help sends product instructions and the user's question without attaching workspace records. It is not an account inspection or a transaction execution tool.
- The unchecked data-use control names OpenAI. The current AI notice is `vanteloq-ai-v6-openai`. Changing purpose or memory resets acceptance. Historical audit records are retained.
- Memory defaults off. With memory off, chat history is neither loaded into prompts nor saved in the application chat database. With memory on, at most six recent messages can be reused only while evidence, purpose and permissions still match.
- Saved conversations are isolated by user and organization. Deletion controls remove active chat records. Provider logs and managed backups have separate retention rules.
- No credentials, account numbers, raw invoices, customer identities, private marketing resource identifiers or raw transaction lists are automatically attached.
- AI does not move money, post journals, file taxes, place purchases or publish campaigns. People retain approval responsibility.

OpenAI's API [data controls](https://developers.openai.com/api/docs/guides/your-data) describe training defaults and retention. Administrators must keep optional provider data-sharing disabled for confidential business analysis. `store: false` is not a zero-retention guarantee.

## Customer journey and source reliability

The homepage now pairs the existing Vanteloq and LexEdge marks, provides five primary navigation links, and offers a sample-data demo before signup. Local fonts, keyboard focus, mobile tap targets and privacy choices preserve the current blue/navy visual identity.

An empty intraday feed displays “Awaiting records” instead of a verified zero-sales result. Verified zero-dollar transactions, refunds and daily summaries retain their numerical meaning. Source sync completion is not described as proof of current reporting coverage.

Connection cards wait for actual status instead of inventing missing credentials during loading. Sandbox or unverified Moneris accounts cannot be approved for reporting; legacy approvals are also excluded by the shared fact and commerce query guards. Records remain retained.

## Remaining release gates

1. Reconcile fresh real POS totals with the matching store, currency and period.
2. Obtain Plaid production access and verify a real bank connection and reconciliation. Sandbox is not live finance.
3. Complete QuickBooks ledger import, account/tax mapping, closed-period handling and Intuit production review. Company authorization alone does not implement ledger sync.
4. Complete account/resource authorization and acceptance samples for each commerce or marketing provider. Meta requires its missing application configuration.
5. Configure transactional invoice delivery and prove delivery, bounce and retry handling. Password-reset delivery is a separate authentication service.
6. Complete independent document scanning before enabling quarantined document processing.
7. Complete controlled production checkout, billing webhook and cancellation acceptance, operational monitoring, restore drills, load tests and an independent accessibility/security review.

Tests cover the changed boundaries but cannot establish that every provider, browser, workload or legal obligation is satisfied. No claim of outperforming all competitors or guaranteed conversion improvement is made.
