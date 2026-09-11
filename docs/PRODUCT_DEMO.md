# Public product demo

The public homepage and `/demo` share an interactive sample workspace. It demonstrates selected product behaviour using fictional retail records. It is not customer evidence, a live provider connection, a demand forecast or an AI-generated answer.

## What can be verified

- The demo imports `advisorKpis` and `advisorDailySeries`, the production KPI helpers used to prepare AI business evidence.
- Two sample shops have 56 days of records. Current and previous periods each contain 28 days. The current combined net sales total is CAD 105,070 across 2,604 transactions. Product costs are rounded to cents per daily record before aggregation.
- Location filters recalculate the totals. Records can be inspected and paginated. Missing costs prevent profit, margin and scenario calculations. Missing comparison days prevent growth claims.
- The scenario lab calculates gross profit at unchanged volume and product mix. Price and cost assumptions remain separate from actual sample KPIs. It excludes other operating expenses and is not net profit.
- Guided questions can be hidden and restored. Reset restores all demo controls. State exists only in the mounted component, without a database, account connection, provider request or saved conversation.
- The public site's existing cookie and analytics choices still apply. The demo itself does not send interaction data to an AI provider.

## Brand implementation

`VanteloqAiLogo` is shared by homepage AI promotion, workspace navigation, the composer, thinking state and replies. `public/brand/vanteloq-ai-nexus.png` supplies its transparent silhouette. A blue to violet CSS gradient moves inside the mark. The thinking treatment and gradient honour `prefers-reduced-motion`.

The asset was created with the built-in image-generation tool. Direction: a premium abstract V-shaped intelligence nexus made from folded bands, with clean negative space, blue to violet colour, no sparkle, mascot, text, glow or enclosing tile. A second pass removed the generated checkerboard to produce actual alpha transparency.

## Release checks

On September 11, 2026: production build, TypeScript and lint passed. The targeted suite passed 51 tests covering the demo, production KPI definitions, public routes, homepage claims, AI consent and provider behaviour, security helpers and rendered SEO. Browser checks covered location and data quality changes, record pagination, keyboard range controls, scenario reset, question dismissal and a 390-pixel mobile layout without page overflow.

## Evidence boundaries

The demo proves its displayed calculations and interactions. It does not prove complete integration coverage, production AI availability, operational scale, legal compliance, security certification or business outcomes. Homepage links expose calculation source, existing application security tests, privacy policies and provider availability. No customer testimonials or certifications were invented.

Live AI still requires provider activation and the user's separate data-use choice. Integration availability remains governed by the existing connector setup and approval workflows.
