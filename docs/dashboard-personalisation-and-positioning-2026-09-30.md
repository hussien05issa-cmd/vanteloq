# Vanteloq v1.0 Origin: owner overview and positioning

## Product meaning

Know where you stand. Decide where to go.

Vanteloq brings an independent retailer's sales, stock and cash into focus. The owner chooses priorities, follows progress toward dated goals, inspects underlying records and assigns the next action. The homepage demonstrates this with the real dashboard components and clearly labelled fictional records. LexEdge Consulting remains the business behind the product.

The copy connects progress, team contribution, control and personalisation to implemented capabilities. It does not promise psychological effects, automatic business success, team chat, autonomous accounting or unapproved integrations.

## Delivered behaviour

- Six default commerce metrics with searchable metric selection, ordering, hiding, card widths, chart style and up to five named views.
- Workspace-scoped saved preferences, with existing layouts preserved by migration 0062. Foreign workspace envelopes cannot populate another workspace's layout. Concurrent collections and overview writes preserve each other's section.
- Dated goals with location scope and higher/lower directions. Unknown records never become zero or earned progress. Lower goals require a baseline for proportional progress, and are not completed early.
- Skippable Build Your Overview step with business-type recommendations. Billing, identity, legal acceptance and MFA remain enforced.
- Current invoice/bill balances and aging, with separate tax, currency and invalid-record disclosures. These are current balances, not historical period-end balances.
- Shared homepage/workspace UI, crisp SVG charts, isolated sample customisation and a structured disconnected state. The public preview never saves to a customer account.
- Restrained connector hover, selection and scroll motion, with reduced-motion support. Workspace connector cards provide more space and collapsed setup detail.
- AI responses show readable prose and optional Sources. The parent workspace retains a short-lived in-memory consent receipt across chat navigation. Every server message remains authorised; memory starts off. Interrupted consent changes invalidate the receipt and can retry.
- An outdated legal screen receives a refresh action, instead of repeatedly submitting obsolete terms. Acceptance remains affirmative and idempotent.

## Evidence and boundaries

The focused presentation, goal, preference, empty-state, AI-response and legal-controls suite passed 26 tests. The isolated onboarding integration test passed payment/MFA gates, owner recovery boundaries, preference round trips, concurrent dashboard saves, location validation, foreign-workspace rejection and repeated stale legal submissions followed by one valid acceptance. No production financial records were changed by these tests.

Local browser checks confirmed metric hiding and Save Layout in the sample, retained structured empty state, and an AI return with one consent GET, rather than another fetch. Sources opened only on request. Desktop/mobile visual checks identified and corrected preview sizing and mobile ordering.

These checks cover this change. They are not certification of every provider, a production backup restoration drill, or evidence of approval by an external integration provider. Existing integration availability remains unchanged. Provider approval work and Google's recording remain separate.
