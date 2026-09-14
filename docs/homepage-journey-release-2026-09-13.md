# Homepage and customer journey implementation

The homepage audit led to a shorter public journey: understand the retail question, try a working example, check compatibility, understand the evidence, compare prices and create a workspace.

## Implemented

- Eight main homepage sections replace repetitive sales sections. The current Vanteloq and LexEdge identity, animated AI orbit, automatic feature scene and reduced-motion support remain.
- The hero, overview, receipt inspector and retail analysis use the same fictional receipt records, dates and location definitions. Each shop has distinct activity. Missing costs withhold profit; an incomplete comparison is not silently replaced when changing views.
- Three guided demo questions lead into revenue drivers, inventory and BookLoQ. Suggestions can be hidden. Source inspection exposes daily summaries and individual receipt lines.
- A compatibility selector gives provider-specific availability, supported data and setup requirements. Meta is labelled as requiring provider setup; sandbox, development and production-approval limitations remain visible.
- Homepage and pricing share the plan catalogue. BookLoQ adds its actual catalogue price to the displayed total. Validated plan preferences carry into signup and billing, including a user-metadata fallback after verification. These preferences never grant entitlements or establish trusted checkout prices.
- Signup explains the next steps and collapses detailed password instructions while retaining password enforcement, account verification, consent and MFA requirements.
- Shared public navigation connects pricing, demo, help, contact and feature guides. Mobile account actions precede social links.
- Three substantive feature guides explain retail intelligence, inventory and cash, and financial review. They include limitations, demo links, canonical metadata and sitemap entries.
- The workspace overview has a source, coverage and first-insight checklist based on existing permission-filtered records.
- Consent-controlled public analytics includes demo engagement, plan selection, compatibility checks and successful inquiries. Form values, contact details, query text, financial records and AI prompts are excluded.
- The previously missing inquiry sending credential was configured privately with sending access restricted to the Vanteloq domain. No credential or private destination was added to public source.

## Verification

Production build, type checking and lint pass. Relevant automated coverage includes demo arithmetic, receipt reconciliation, missing data, plan preferences, signup and Stripe contracts, inquiry validation and mocked delivery, origin and CAPTCHA enforcement, retail access boundaries, rendered public links and consent-controlled analytics. Browser checks cover desktop, 390-pixel phone and 768-pixel tablet layouts, menu/Escape behaviour, selected-plan signup, receipt inspection, compatibility selection and hidden suggestions.

The inquiry flow's automated tests mock the email provider. Production configuration and actual delivery must be verified separately. No new paid subscription or authenticated AI request was made as part of this public journey release.

## Remaining work requiring separate evidence or implementation

- A permissioned pilot story needs actual customer outcomes and permission. The public demonstration stays explicitly fictional.
- An owner-reviewed historical trading calendar remains a product improvement. Missing records do not establish closure, and default weekly hours must not be retroactively assumed to describe historical trading.
- Full account-verification, payment and first-insight cohort measurement requires a separate first-party design. Public Google Analytics was not expanded to private workspace data.
- Search Console indexing and field Core Web Vitals need sufficient live measurements before any SEO or speed improvement can be claimed.
- Provider production approvals and each customer's authorization and reconciliation are independent of public UI availability. This release does not make sandbox or pending integrations production-ready.

This implementation is not a certification of legal, accessibility, accounting or security compliance, nor evidence of conversion uplift.
