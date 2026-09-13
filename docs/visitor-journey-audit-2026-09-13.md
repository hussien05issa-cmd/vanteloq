# Vanteloq visitor journey and soft launch audit
Review date: September 13, 2026. Release scope: the public visitor journey and the pending finance/contact release.

## Decision
The revised design and application checks are suitable for a controlled pilot. Broad acquisition should wait for working contact delivery and the operational checks below. This is a code and browser review, not an independent penetration test, accounting assurance engagement or legal certification.

## Journey, in visitor order
1. **Understand the product: improved.** Shortened the first screen to product performance, basket patterns, revenue drivers and cash planning. Preserved the supplied Vanteloq/LexEdge identity, optimized interface image, blue theme and local fonts. The demo and pricing actions are visible together.
2. **See the evidence: verified.** Feature shortcuts open Products, Baskets, the revenue bridge or BookLoQ cash directly. The interactive demo uses fictional records and the workspace calculation functions. No customer records, invented testimonials, rankings or unverified certification badges were added.
3. **Choose a plan: verified.** A location/team selector uses the billing catalogue to show a capacity match. Excess capacity leads to a custom plan inquiry. A feature table distinguishes Starter, Growth and Pro, with the optional BookLoQ price separate. Prices are monthly CAD; checkout determines taxes and the final total.
4. **Sign up or ask for help: partial.** Existing account and checkout entry points remain. Private contact/custom-plan forms require email activation. Until configured, submission is disabled and the UI reports that it is unavailable. It never reports an unsent message as sent.
5. **Use the product: existing live evidence, bounded.** The earlier signed-in production check obtained an OpenAI response using permitted retail aggregates and identified incomplete reporting coverage. R-Series background backfill was progressing; no recent sales are expected while the store is closed. Reconcile a complete source period before relying on full-period trends.

## Findings resolved
| Priority | Finding | Change and evidence |
| --- | --- | --- |
| High | Strongest capabilities were buried below a long introduction | Concise hero, feature shortcuts and decision examples now precede the full demo |
| High | Product/basket links opened a generic demo tab | Dedicated hash routing opens the intended view; unsupported/prototype keys fail closed |
| Medium | Plan differences were difficult to compare | Shared catalogue capacity matching, seven feature comparisons and BookLoQ add-on separation |
| Medium | Mobile menu Escape did not restore focus | Escape closes the menu and returns focus to its trigger |
| Medium | Repeated explanatory copy diluted the visitor path | Shorter copy, optional expanded context, clearer demo/pricing actions |
| Medium | Responsive comparison could widen the page | Keyboard-focusable horizontal table region; measured mobile page width stays within viewport |

## Validation
- Production build and artifact validation passed; TypeScript and lint passed.
- 102 selected tests passed with zero failures. Coverage includes public routes and SEO, source boundary claims, inquiry consent/captcha/idempotency/private-recipient behavior, cross-origin protections, anonymous access rejection, billing catalogue validation and webhook verification, accounting checks and permission-filtered AI finance context.
- Two SEO assertions initially expected old headings. They were updated for the intentional copy change; the full selected suite then passed.
- Desktop, 768-pixel tablet and 390-pixel phone viewport reviews completed. Phone content width was 375 pixels after the browser scrollbar, with no page overflow. The plan table scrolls within its own region.
- Browser actions verified product/basket deep links, Pro matching for four locations, custom-plan matching beyond 25 users, and Escape focus restoration.
- A lockfile advisory check queried the documented npm bulk endpoint and matched returned advisory version ranges against 669 locked package entries, including development entries. No matching advisories were returned at the time of review. This does not establish absence of undisclosed vulnerabilities or runtime misconfiguration.
- Existing optimized interface artwork was retained rather than replacing product evidence with decorative generated images. Saved screenshots were opened and inspected.

Audit method reference: [npm bulk advisory documentation](https://docs.npmjs.com/cli/v11/commands/npm-audit/).

## Remaining launch requirements
| Item | Remaining action | Launch effect |
| --- | --- | --- |
| Contact and custom-plan email | Approve creation of the prepared send-only Resend key restricted to vanteloq.com, store it privately, deploy, submit one authorized test and verify delivery | Required before advertising contact/custom-plan delivery |
| R-Series | Finish historical backfill and reconcile a representative period with source totals | Current history remains incomplete; test Square data stays excluded |
| QuickBooks | Production app access, intended company authorization and first-import reconciliation | Sandbox only |
| Plaid | Production approval and live bank authorization/repair | Do not advertise live bank connectivity yet |
| Meta | App credentials, required permissions and provider review | Customer connections unavailable until completed |
| Other supported providers | Each customer authorizes their own account, maps locations and reviews imported records | Configured credentials do not mean every merchant is approved |
| Operating inputs | Reviewed costs, inventory valuation, labour, loyalty enrollment and expiry records where absent | Missing values stay unavailable; no fabricated zeroes |
| Paid subscriptions | Complete a representative paid checkout, renewal/change/cancellation and webhook lifecycle check | Automated tests passed; no new charge was made during this audit |
| Operations | Demonstrate backup restoration, monitor failures and confirm support ownership | Required before wider rollout |
| Professional review | Accounting review of representative books and qualified review of privacy/terms | Application tests are not accounting or legal certification |

## Evidence files
Saved locally under outputs/design-audit-204:
- 01-pricing-before.png, 02-home-before.png
- 03-home-desktop.png, 05-pricing-mobile.png, 06-home-mobile.png
- 07-home-tablet.png, 08-feature-proof-desktop.png, 09-plan-cards-desktop.png

Logs under outputs: launch204-final-tests.log, launch204-typecheck.log, launch204-lint.log, launch204-final-build.log and launch204-dependency-audit.json.

