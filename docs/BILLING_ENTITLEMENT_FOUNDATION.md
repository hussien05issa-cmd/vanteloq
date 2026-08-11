# Billing and entitlement foundation

This document records the verified Stripe Billing and entitlement boundary. It is deliberately explicit about what is implemented in code and what still requires hosted Stripe configuration.

## Verified architecture audit

- Supabase Auth verifies the signed-in user and email. Vanteloq binds the verified Supabase subject to its D1 user record.
- D1 remains the application and tenant-authorization source of truth. Every application query is scoped through an authenticated membership and organization.
- Before this work, the repository had no Stripe catalogue, subscription synchronization, or plan entitlement engine. BookLoq and advanced application routes were role-protected but were not paid-plan protected.
- Stripe Billing is intended to be authoritative for normal-customer billing. Internal founder access is intentionally outside Stripe.

## Central server catalogue

`server/entitlements/catalog.ts` is the sole plan/add-on definition. It contains stable internal keys, inherited feature sets, exact CAD prices, Stripe lookup keys, and user/location limits.

| Access | Monthly | Annual | Users | Active locations |
| --- | ---: | ---: | ---: | ---: |
| Starter | $49 CAD | $490 CAD | 3 | 1 |
| Growth | $99 CAD | $990 CAD | 10 | 3 |
| Pro | $179 CAD | $1,790 CAD | 25 | 10 |
| BookLoq add-on | $39 CAD | $390 CAD | Not applicable | Not applicable |

The Pro location value of 10 is an initial centralized policy value, not an unlimited claim. AI capability levels are represented, but numerical quotas remain `null` until reliable metering exists.

BookLoq is not included in any base plan. It resolves only from the independent `bookloq` add-on or an authorized internal full-access grant.

## Entitlement resolution

`server/entitlements/engine.ts` resolves access in this order:

1. verified tenant membership;
2. active internal access override;
3. Stripe-synchronized base subscription and add-ons;
4. centralized features and limits.

Only `trialing` and `active` normal subscriptions grant paid features. Failed, canceled, paused, incomplete, or unpaid billing states fail closed. A scheduled downgrade retains the current plan until its effective Stripe event.

Persistent D1 tables exist for subscription snapshots, independent add-ons, and internal access. The engine exposes reusable feature, add-on, plan, limit, user-capacity, and location-capacity checks.

## Founder access

The exact verified Supabase account `hussienissa@lexedgeconsulting.com` can bootstrap one subject-bound `founder` internal-access record for the owner membership. The bootstrap cannot be called with an arbitrary email, does not accept public input, and does not create a Stripe customer, subscription, trial, payment, or invoice.

An active founder grant resolves all normal paid Vanteloq features plus BookLoq. It takes precedence over missing or failed billing state. Full internal entitlement resolution requires Supabase AAL2. The application provides TOTP enrollment and challenge UI for the founder session.

Bootstrap uses insert-if-absent semantics so a revoked record is not silently reactivated. Grant creation is audit logged.

## Implemented Stripe Billing flow

- The owner/admin Billing screen reads synchronized subscription facts and the central catalogue; it never invents a billing state.
- Checkout sessions are created only on the server. Client-supplied Price IDs are not accepted.
- Stripe prices are resolved by stable lookup key and verified against exact CAD amount, interval, active state, and catalogue definition before Checkout opens.
- Stripe-hosted Checkout requires a payment method. Existing customers are sent to the Stripe-hosted customer portal for changes and cancellation.
- The dedicated Billing webhook verifies the raw-body Stripe HMAC with a five-minute replay window, enforces a 256 KB body limit, records a payload hash, atomically claims events, and ignores duplicates.
- Webhook processing retrieves the current authoritative subscription from Stripe, validates every recognized plan/add-on price against the catalogue, rejects multiple base plans, ignores stale events, and synchronizes subscription and BookLoq entitlement state.
- Vanteloq stores Stripe customer, subscription, item, and price identifiers plus billing status and periods. It does not store card details or payment-method payloads.

Expected Stripe Price lookup keys:

- `vanteloq_starter_monthly_cad`, `vanteloq_starter_yearly_cad`
- `vanteloq_growth_monthly_cad`, `vanteloq_growth_yearly_cad`
- `vanteloq_pro_monthly_cad`, `vanteloq_pro_yearly_cad`
- `bookloq_monthly_cad`, `bookloq_yearly_cad`

## Tests passed at this boundary

- exact price and lookup-key catalogue assertions;
- monotonic Starter → Growth → Pro inheritance without feature leakage;
- independent BookLoq behavior;
- active/trialing state authorization and fail-closed billing states;
- scheduled-downgrade behavior before the effective event;
- exact founder email, verified subject binding, owner role, and AAL2 enforcement;
- D1 migrations and tenant isolation;
- server-verified Checkout price selection and organization binding;
- fail-closed catalogue mismatch handling;
- raw webhook HMAC, tamper rejection, replay rejection, and anonymous route boundaries;
- subscription normalization without payment data;
- existing build, security, Lightspeed, BookLoq, inventory, governance, and operating-flow suites.

## Hosted configuration still required

The application fails closed until the following are configured in the hosted environment and Stripe Dashboard:

- create the Stripe products/prices with the exact lookup keys and exact catalogue amounts above;
- set `STRIPE_SECRET_KEY` and the dedicated `STRIPE_BILLING_WEBHOOK_SECRET` securely in the hosted environment;
- register `/api/v1/billing/stripe/webhook` in Stripe for Checkout Session and customer subscription events;
- configure and activate the Stripe customer portal;
- run a Stripe test-mode purchase, renewal/change, cancellation, replay, and failed-payment QA matrix;
- decide whether a trial is offered; no trial is claimed or granted by the current Checkout flow;
- add automated reconciliation for a missed webhook and operational alerting for failed event receipts;
- finish plan locks across existing API routes, AI tools, background jobs, and frontend modules.

## Not active yet

The following broader product work must not be described as complete:

- upgrade, downgrade, cancellation, reactivation, or BookLoq billing changes;
- plan locks across existing API routes, AI tools, background jobs, and frontend modules;
- onboarding plan selection and the complete Stripe test/live-mode QA matrix.

Do not activate checkout or paid feature enforcement using unverified or client-supplied Stripe Price IDs.
