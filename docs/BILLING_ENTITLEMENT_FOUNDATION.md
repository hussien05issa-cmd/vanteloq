# Billing and entitlement foundation

This document records the verified boundary reached before Stripe catalogue creation. It is deliberately explicit about what is and is not active.

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
| BookLoq add-on | $39 CAD | $390 CAD | — | — |

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

## Tests passed at this boundary

- exact price and lookup-key catalogue assertions;
- monotonic Starter → Growth → Pro inheritance without feature leakage;
- independent BookLoq behavior;
- active/trialing state authorization and fail-closed billing states;
- scheduled-downgrade behavior before the effective event;
- exact founder email, verified subject binding, owner role, and AAL2 enforcement;
- D1 migrations and tenant isolation;
- existing build, security, Lightspeed, BookLoq, inventory, governance, and operating-flow suites.

## Not active yet

The following work must not be described as complete until the numbered implementation sequence reaches and verifies it:

- Stripe products/prices and validated Price IDs;
- checkout, payment-method-required trial, or onboarding plan persistence;
- webhook verification, idempotency, stale-event handling, or reconciliation;
- upgrade, downgrade, cancellation, reactivation, or BookLoq billing changes;
- plan locks across existing API routes, AI tools, background jobs, and frontend modules;
- billing/admin/pricing interfaces and the complete QA matrix.

Do not activate checkout or paid feature enforcement using unverified or client-supplied Stripe Price IDs.
