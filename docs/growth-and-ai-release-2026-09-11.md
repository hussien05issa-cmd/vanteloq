# Growth, BookLoQ and AI release review

Reviewed September 11, 2026. This is a code and product review with competitor research, not an independent certification or a claim of market superiority.

## Product position

Vanteloq combines retail operating evidence, financial review and follow-through. Its strongest demonstrable message is: inspect a number, understand its source, test a cash decision and assign the next action. Do not describe it as replacing every accounting, CRM, payroll or banking product.

Salesforce offers [product demonstrations](https://www.salesforce.com/products/demos/) and [guided small-business onboarding](https://www.salesforce.com/small-business/onboarding-demos/?bc=OTH). QuickBooks lets people [practice with sample companies](https://quickbooks.intuit.com/learn-support/en-us/help-article/accountant-features/practice-sample-client-companies-quickbooks-online/L8dbIHyx0_US_en_US) and explains its [cash planning capability](https://quickbooks.intuit.com/ca/cash-flow/). The useful lesson is to demonstrate an actual task and its limits before asking for a subscription. These references do not establish that Vanteloq outperforms those products.

## Implemented

1. **Homepage and conversion path.** Retail-specific positioning, three concrete product outcomes, links to the demo, pricing and help. Visitors can continue from the demo to signup or pricing.
2. **BookLoQ cash demo.** A purchase slider, delayed-receipt scenario, missing-bank-evidence state and expandable 13-week records. It calls the same cash-flow calculation used by the finance workspace. Values are explicitly fictional and never taken from a customer's private workspace.
3. **Transparent pricing.** The public page reads the same plan and add-on catalogue as billing. It shows monthly CAD pricing, team and location limits, the BookLoQ add-on and final-checkout qualifications. No invented discounts, testimonials or ratings.
4. **Searchable product help.** A server-rendered help centre covers source connection, reporting differences, BookLoQ, cash, privacy, team access, marketing and follow-through. The same curated guidance feeds AI app-help instructions, reducing inconsistent answers.
5. **BookLoQ-aware AI.** Business analysis can attach permitted organization-wide BookLoQ summaries through the existing BookLoQ API authorization, subscription and redaction path. Only an explicit numeric allowlist is forwarded. Demonstration ledgers, identities, account identifiers and raw records are excluded. Cumulative ledger balances are labelled separately from retail KPI periods.
6. **App help mode.** Explains Vanteloq and BookLoQ without automatically attaching workspace records. Users still control what they type. It has a separate consent purpose; switching modes resets consent and the visible conversation.
7. **Provider and data accuracy repairs.** Default to a ready provider without silently selecting both. Distinguish billing, credits, setup and rate limits. Evidence follows current location permissions and contributing report sources. Test POS connections stay excluded, and missing data remains unavailable.

Existing privacy settings, optional conversation memory, saved-chat deletion, suggestion collapse, animated AI branding and business-permission checks remain in place. AI is explanatory and cannot post journals, initiate payments or file returns.

## SEO and measurement

Help and pricing have distinct server-rendered content, titles, descriptions, canonicals and sitemap entries. Help uses breadcrumb structured data. No fabricated review schema was added. Google recommends [helpful, people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content) and [clear crawlable structure](https://developers.google.com/search/docs/fundamentals/seo-starter-guide); those changes support discovery but do not guarantee rankings.

After analytics consent, a fixed public-event vocabulary measures demo interaction, pricing views and signup starts. It excludes form content, workspace data and URL query text. It does not measure completed signup or paid conversion yet, so signup starts must not be reported as customer acquisitions.

Suggested measurement sequence: establish a baseline, inspect demo-to-signup drop-off, improve the largest friction point, then compare a defined period or controlled experiment. No conversion lift has yet been measured.

## Verification

- Production build, TypeScript check and lint passed.
- The current production-dependency audit reported zero known vulnerabilities. This is a point-in-time registry check, not proof that the application has no security defects.
- 86 focused tests passed: AI client, providers, KPIs, BookLoQ projection, shared demo calculation, rendered SEO and security boundaries.
- Three Worker/database scenarios passed: excluded test POS reporting, restricted-location/profit and consent/chat controls, and BookLoQ-to-AI evidence matching through the actual access path.
- The BookLoQ flow compared outbound evidence with the authorized BookLoQ summary, excluded demonstration and selected-location ledgers, and confirmed app help did not attach BookLoQ records.
- Real OpenAI calls using fictional inputs succeeded, including a $100 revenue / $60 cost calculation and a BookLoQ analysis that separated a recorded ledger result from cash affordability.
- Browser checks covered the homepage, demo, pricing, help and AI design states. The mobile cash demo handled missing data without horizontal page overflow. Switching help to analysis cleared consent and disabled Send until fresh acceptance.

Provider-backed production acceptance is a separate gate. A test API key in a local fixture does not establish production secret configuration, and screenshots do not establish full accessibility compliance or security certification.

## Production readiness gates

| Area | Remaining acceptance requirement |
| --- | --- |
| OpenAI | Store the paid account's API key as the production server secret, apply it with a deployment, then complete an authenticated, consented chat. A working local key does not configure Sites. |
| Gemini | Verify paid-service business-data protection for the configured key before enabling confidential workspace analysis. |
| Live POS reporting | Fresh sync, location mapping, source approval and reconciliation against the merchant's same date range; do not call an old snapshot real time. Keep test accounts excluded. |
| Plaid | Current environment is sandbox. Production approval, live connection, current balances and reconciliation are separate requirements. |
| QuickBooks | Current adapter verifies company access. Ledger import and data promotion are explicitly disabled, and the environment remains sandbox. Implement and reconcile imports before advertising them. |
| Invoice email | Configure the server's Resend key and verified invoice sender; validate delivered mail, bounce handling and safe retry. Password-reset email is a different delivery path. |
| Documents | Uploaded files remain quarantined until an independent malware scan marks them clean. Do not bypass quarantine to make download or email appear functional. |
| Marketing providers | Complete provider setup and approval, resource selection, fresh sync and attributable results. Configuration alone does not prove marketing performance. |
| Subscription billing | Controlled checkout, webhook, portal and cancellation acceptance. Do not create a real charge merely to claim checkout passed. |
| Operations | Load and concurrent-sync testing, monitored ingestion, backup restoration, accessibility testing with assistive technology and production performance measurement remain broader release work. |

The build still warns about large client chunks. Measure real loading and interaction performance before choosing the next code split. No guarantee of error-free operation, regulatory compliance, complete integration coverage or competitor superiority is made.
