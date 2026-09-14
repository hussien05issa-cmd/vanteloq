# Reference Theme QA

## Scope and Visual Source

User-provided reference: `ChatGPT Image Sep 14, 2026, 09_53_17 AM.png`, 1536 x 1024. Implemented the light alpine composition, left-aligned two-line headline, navy glossy actions, frosted navigation, product image on the right, provider strip and four outlined feature cards. Existing Vanteloq, LexEdge, BookLoQ and AI brand assets remain the product identities.

The generated alpine artwork is an illustrative sample workspace, explicitly labelled in the interface. It is not a photograph of a customer account or a live report. Responsive WebP exports are 1832 x 859 (165,380 bytes) and 1200 x 562 (73,310 bytes). The real interactive demo remains separate and uses its existing deterministic calculations.

## Viewports and Capture Normalization

- Desktop layout checked at 1536 x 1024 CSS pixels.
- Tablet checked at 768 x 1024; feature cards switch to two columns.
- Phone checked at 390 x 844; navigation remains visible, copy precedes the image, and cards become one column.
- AI and opportunity component fixtures checked at 960 x 800 with fictional records.
- The desktop app initially cropped captures to its host panel and produced duplicate tiles in stitched screenshots. Those captures were rejected as visual evidence. A local QA-only iframe rendered the unchanged page at 1536 x 1024, scaled to 62.5% for capture. The source was normalized to the same 960 x 640 display size. Both full frames were inspected together. This harness is outside the application source and is not deployed.
- Direct phone, AI settings and opportunity screenshots were also inspected. No content overflow was found in the tested document widths.

## Iterations and Findings

1. Corrected inherited feature-section margins and width so the content aligns with the hero and provider strip.
2. Corrected primary-button specificity so the navy glossy treatment overrides the earlier blue fill.
3. Moved the photographic focal point to the top on desktop, keeping the laptop frame visible. Kept the device on the right when the image adapts to mobile.
4. Strengthened the pale overlay behind the hero copy for readability over mountain detail.
5. Applied the same restrained surfaces to shared workspace cards, navigation, BookLoQ and the AI composer. Financial records remain opaque.
6. Follow-up consistency pass unified the primary-action gradient across account entry, workspace and AI controls; added frosted secondary actions; corrected BookLoQ navigation contrast and selection styling. Resolved an older input/control selector overriding action height. The opportunity heading action was rechecked at a 44px minimum height and 12px corners, with no horizontal document overflow at 960px.

Intentional differences from the supplied artwork: preserved existing brand identities, truthful demo/signup actions, actual product modules, visible social links and provider availability labels. No free-trial or universal integration-readiness claim was introduced. The lower page retains working finance proof, provider details, pricing, privacy and help.

## Interaction Verification

- Central shop selection changes homepage sample sales from $24,594 to $11,584 and updates the comparison and evidence link.
- The missing-journal-line control changes BookLoQ's result from four arithmetic checks passed to a statement difference requiring review.
- Create Workspace opens the existing single-column signup dialog with required marks and unchecked legal acceptance. Local account submission is deliberately unavailable in the fixture.
- Provider links reach the directory. QuickBooks visibly retains its sandbox-only explanation and production limitations.
- AI Settings opens with workspace data, memory and saved-chat controls. No agreement or data-sharing setting was changed during QA.
- Existing automated checks cover homepage routes, provider messaging, form semantics, accessible charts and financial display behavior.
- No JavaScript console errors were reported in the checked opportunity fixture.

This is a visual and interaction regression review for the theme change, not a new audit of every production integration or a WCAG certification. No unresolved P0, P1 or P2 visual issue was found in the checked scope.

## Final Result

passed

## BookLoQ and Subscription Follow-up, September 14, 2026

Reference: `ChatGPT Image Sep 14, 2026, 11_22_22 AM.png`, 1536 x 1024. Applied its pale silver-blue materials, readable navy typography, four primary KPI cards, restrained lines and generous chart surfaces. Preserved actual product identities, financial terminology and explicit sample/source-status labels. No gaming aesthetic or new decorative animation was introduced.

The reference and final BookLoQ overview were inspected at the same normalized 960 x 640 size, using a 1536 x 1024 iframe for the application. The second BookLoQ navigation remains because this is an accounting module inside the existing application; it collapses and becomes a section selector on mobile. Missing bank balances remain unavailable instead of copying the reference's invented totals.

Phone QA at 390 x 844 verified the BookLoQ section selector, More Financial Details disclosure, cash-period buttons, chart inspection/table disclosure, and onboarding field errors. Found and fixed the weekly cash-plan table escaping the viewport: the document returned to 375px content width inside the 390px viewport, while wide accounting columns scroll within the labelled region. Raised weekly table copy sizes and removed negative-zero currency display. The homepage proof labels remain 14px with a pale backing at mobile sizes.

The real billing gate was tested in a fictional local harness. The visible workspace updated from Starter without BookLoQ to Starter plus BookLoQ, then Pro without BookLoQ. Past-due access was replaced by billing recovery; an inactive employee saw owner guidance with no personal checkout. This confirms the client state transition, not a production card charge.

No unresolved P0, P1 or P2 visual issue was found in these checked surfaces. This does not claim every production workspace or provider was inspected. Existing authenticated live verification still depends on an available signed-in browser session.
