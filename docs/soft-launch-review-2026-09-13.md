# Soft launch review, September 13, 2026

## Release scope
- Private custom plan and contact forms, accessible from public pricing, the subscription gate and workspace billing. Contact details and requirements are delivered to a server-configured recipient. No payment or subscription change occurs when a visitor submits an inquiry.
- Explicit contact consent, bounded input, same-origin checks, persistent IP rate limits, Turnstile hostname/action verification, a fixed recipient and sender, provider retry idempotency, and a success response only after a delivery receipt. Recipient and API credentials are server secrets.
- BookLoQ statement totals treat contra accounts by their account class while preserving account-level normal-balance displays. Integer arithmetic validates ledger totals, reconciliation differences and tax rounding.
- Four visible arithmetic checks for posted ledgers. Balancing alone does not establish completeness, reconciliation, tax accuracy or an audit opinion.
- Vanteloq AI receives permission-filtered statement aggregates, financial checks and bounded 13-week cash scenarios. It does not receive raw ledger entries or customer, supplier, bank or employee identifiers.
- An interactive fictional financial-check example on the homepage uses the same check function as the workspace.

## Verification
Type checking, lint and production build validation were completed. Targeted tests cover contra assets, sales returns, drawings, missing postings, overflow, rounding, permission filtering, consent, anti-spam controls, idempotency, private recipient handling and public contact routes. Existing integration/security tests cover cross-tenant and location boundaries, OAuth/webhook controls, protected finance routes, retail data scope and AI chat consent/history. Desktop and phone layouts were inspected.

One contact-flow test initially installed its provider mock before the framework initialized its fetch wrapper. The fixture now installs the mock after route initialization; the corrected delivery flow passes. This was a test harness issue, not a reason to weaken production verification.

## Operational readiness
- A signed-in production OpenAI test returned analysis from the permitted retail evidence and identified incomplete reporting coverage and unavailable ledger evidence. This proves the current API connection can respond, not that every answer is correct.
- R-Series owner-authorized background synchronization is enabled and historical backfill is progressing. Wait for completion and reconcile a representative source period before relying on full-period totals.
- Test merchant sources remain excluded from production reporting.
- Custom contact email delivery requires a send-only Resend credential restricted to the sending domain, securely installed in runtime configuration, followed by a live submission and delivery-log check. Do not advertise the form as verified until that check is complete.

## Remaining production work
- QuickBooks: obtain and configure production app access, connect the intended business and reconcile an initial import. Sandbox access is not production accounting data.
- Plaid: complete production approval and repair/authorize the appropriate live bank connection. Sandbox results are test data.
- Meta: finish app credentials, requested permissions and any provider review before enabling customer connections.
- Every subscribing business must authorize its own merchant account, map locations, finish import and review its source before reporting. An implemented connector is not a universal merchant approval.
- Reviewed labour, stock valuation, enrollment and expiry inputs are still needed where the source does not supply them. Keep unavailable measures blank.
- Complete a representative paid subscription lifecycle check, operational backup/restore exercise and qualified accounting/legal review before expanding beyond a controlled launch.

## OpenAI scope
The financial review follows source checking, cash planning and variance-analysis practices described in official OpenAI finance workflows. Those ChatGPT workflows do not automatically install desktop finance tools, spreadsheet editing or live financial feeds into a third-party API application. Vanteloq implements its own calculations and permission boundaries; AI explains the evidence.

References:
- https://learn.chatgpt.com/use-cases/finance-model-cleanup
- https://learn.chatgpt.com/use-cases/cash-flow-forecast
- https://learn.chatgpt.com/use-cases/variance-driver-bridge
