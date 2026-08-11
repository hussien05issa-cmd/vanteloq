# Vanteloq Platform Hardening Design

## Goal

Prepare Vanteloq for its final connector phase by making provider behavior consistent, location scope real, navigation recoverable, BookLoQ bank and document flows honest, and every recommendation traceable to available evidence.

## Approved scope

The user approved this design by supplying the detailed requirements twice and directing the build to proceed one slice at a time.

## Architecture

All commerce providers write to one canonical data model. Product features depend on normalized data coverage, permissions, freshness, and location mappings, never on a provider brand. A Shopify account with the same verified fields as a Lightspeed account receives the same feature set.

Organization locations are the stable scope. Each external POS location maps to one organization location. The selected scope is sent to server routes, resolved against tenant-owned mappings, and applied before metrics leave the server. The interface cannot broaden an employee's permitted locations.

Navigation preferences only change presentation. Dashboard and Settings remain protected. Hidden workspaces stay permission-checked, keep their data, and can be restored from Settings.

Plaid is a server-side BookLoQ connector. Link tokens, public-token exchange, encrypted access tokens, cursor sync, verified webhooks, revocation, and pending-to-posted transaction lineage remain outside the browser. A connection is not described as live until hosted credentials and a successful production sync exist.

Invoice and receipt uploads use the existing private object-storage pipeline. Files remain quarantined and human-reviewed. Extraction, matching, categorization, tax treatment, and posting are never represented as automatic facts.

Purchasing intelligence combines demand history, on-hand stock, incoming purchase orders, lead time, unit cost, location demand, verified bank balances, known obligations, and the owner's protected cash floor. Missing cash or unit cost blocks the cash-constrained answer rather than inventing one.

Growth recommendations use explicit evidence packets. Each recommendation states what changed, why it matters, the supported action, the metric to watch, confidence, source, missing evidence, inventory and cash guards, and location scope. Google and Meta remain Coming soon until vendor authorization is configured and tested.

## Interface design

The sidebar uses clear operating groups and a compact location selector. Settings contains a workspace organizer with plain-language outcomes and data requirements for every item. Integration cards are grouped by category. Generic circles, decorative check marks, and the phrase "What this answers" are replaced with status labels, feature names, required data, and supported decisions.

Charts, status indicators, calendars, connector logos, and calculations stay deterministic UI. Generated raster art is limited to the two resource-article hero images requested by the user. It contains no numbers, charts, logos, interface claims, or embedded text.

## Legal and claim boundaries

BookLoQ assists with record organization, preliminary categorization, reconciliation, and accountant preparation. It does not provide legal, accounting, investment, or tax advice, file returns, initiate payments, guarantee accuracy, or replace professional review. Plaid access is read-only for the disclosed products and can be revoked. Retained accounting records follow the applicable retention workflow after disconnection.

Provider-attributed marketing outcomes remain separate from POS or accounting outcomes unless an approved matching rule exists. SEO recommendations do not promise ranking or lead growth. Estimated purchasing capacity does not guarantee available funds or prevent overdrafts.

## Error handling and testing

Every new behavior has a focused test that fails for the missing contract, then passes after the smallest implementation. Tenant checks, permission checks, same-origin checks, rate limits, masked identifiers, file limits, webhook verification, idempotency, and integer-cent arithmetic remain mandatory. Final verification includes focused tests, full lint and type checks, production build, security tests, migration checks, responsive inspection, and a production deployment status check.

