# Vanteloq mobile performance

The public homepage must remain responsive and readable while preserving the working demo, privacy controls and account journeys. Measure the actual production page before and after meaningful changes. Lighthouse is a lab signal, not a claim about all real users.

## Stylesheet boundaries

- Original CSS files remain the source of truth. The root layout imports their public projections through the `public-surface` query.
- `build/public-surface-css.mjs` omits only selectors whose positively required first class is in the audited non-public anchor list. For comma-separated rules it retains every public selector with the same declarations and cascade position. It keeps shared styles, fonts, variables, animations and public/authentication/demo styles. Mixed `:is()` expressions remain untouched.
- Do not expand this to substring matching, broad prefixes, negated classes or approximate dead-code removal.
- The lazy workspace imports the complete originals in exactly the old order, before its isolated component styles. This preserves the cascade, including after sign-out. There is a deliberate transfer tradeoff: shared public rules can be downloaded again with the complete workspace styles. Do not claim this reduces every authenticated page's CSS payload.
- The boundary tests verify that excluded anchors are absent from public, demo and authentication code, including loading, error and not-found routes. A new shared component may require an anchor to be removed from the list. Dynamic class prefixes and ambiguous generic roots must not be added just because a literal search finds no match.
- The expanded audit also covers retired presentation roots that no current runtime route uses. Their source rules remain intact in the originals; this is a delivery optimisation, not deletion of the original design system.
- Keep `app/workspace-base-styles.ts` in the same order as `app/layout.tsx`. Do not edit generated production assets.

## Rendering and navigation

- Avoid eagerly prefetching the full demo from the homepage. The explicit demo links remain normal navigable links.
- Read geometry before writing style during scroll handling. Schedule work once per animation frame and do not write unchanged values.
- Preserve image dimensions and responsive sources. Keep original brand masters; use appropriately sized delivery assets.
- Respect reduced motion. Avoid timers or decorative animation that repeatedly rerender the page.
- Test 390px mobile navigation, carousel controls, account forms and the public demo, plus the actual workspace when shared styling changes.
- Keep missing financial data, permissions, consent and source checks intact. Performance work must not remove these controls.

## Initial baseline

September 18, 2026, 10:48 p.m. MDT: mobile Performance 87, FCP 2.9s, LCP 3.4s, TBT 0ms, CLS 0. Desktop Performance 99. Accessibility, Best Practices and SEO were 100 on both. The report estimated 880ms of mobile render-blocking delay and 116KiB unused CSS.

The first projection build reduces the initial root stylesheet from 147,394 to 93,649 gzip bytes (36.5%). Confirm production PageSpeed independently before reporting a new score.

Reference: https://web.dev/articles/defer-non-critical-css
