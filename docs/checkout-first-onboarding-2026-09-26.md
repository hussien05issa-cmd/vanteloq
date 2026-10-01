# Checkout-first onboarding verification

Updated 26 September 2026.

New customer flow: create and verify an account, choose a subscription, pay in Stripe, complete business setup, then open the product. Existing plan prices remain unchanged. Previously authorised internal and complimentary access remains separate from paid customer access.

The first checkout creates only a pending billing workspace. It stores current legal acceptance and the verified account identity, but does not invent a business address, create business locations, or grant product access. Completing business setup requires server-confirmed subscription access. A checkout success URL alone does not grant access. Paid but unfinished workspaces cannot use product APIs until setup is complete.

Account lookup now uses the verified Supabase identity before its email fallback. Changing an email does not detach that identity from its existing workspace. A different authentication identity cannot take over an occupied workspace merely by matching its email. Identity conflicts are reported before the business form, with account-recovery instructions.

Verification completed:

- Production build and TypeScript checks passed.
- 34 focused tests passed, including account identity recovery, billing lifecycle events, unpaid access denial, consent, manual addresses, BookLoQ entitlement and concurrent checkout requests.
- A reproduced email-change lookup failure is covered by a regression test.
- New checks cover viewing prices without creating records, consent before preparing checkout, idempotent checkout preparation, unpaid setup denial, pending product access denial, and retaining the same workspace after paid completion.
- An independent code review found no remaining blockers after fixes for setup-session renewal and concurrent setup responses.
- Desktop and mobile interface review used an isolated preview of the actual billing component with fictional account data.
- Stripe live account acct_1Tk90iBmKMLpjFJQ reports charges and payouts enabled, with no currently due account requirements. Live Starter, Growth, Pro, BookLoQ standalone and BookLoQ add-on monthly CAD prices match the application catalogue. The billing subscription webhook is enabled at the configured Vanteloq endpoint.

Limits: no real payment was made in this verification. Automated payment lifecycle tests use isolated fixtures and signed test events. The exact account involved in the reported owner-details error was not identified during this pass, so an account-specific recovery is not claimed. No existing workspace records were deleted or rebound to a different authenticated owner.
