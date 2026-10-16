# Cinematic hero interaction and Workspace reconciliation QA

Date: October 16, 2026

## Reference and scope

Selected reference: C:/Users/User/.codex/codex-remote-attachments/01a12e40-4a37-7a12-8bc3-19bc9b23a406/CD1EDC16-EB1B-49A1-B25E-1F86CFD5CA21/1-Photo-1.jpg (1280 x 834 raster).

Adapt the reference's editorial composition, concise left copy, single prominent action and large product visual to Vanteloq. Preserve the supplied logos, Geist typography, exact animated source principle, signup/demo paths and full working dashboard. The user's correction supersedes the first still life: the product visual must show a cinematic business dashboard. Public appearance follows the device; internal Dark, Light and System choices remain available and independent.

## Version 391 baseline evidence

Local preview: http://127.0.0.1:5228/.

- Desktop: 1440 x 1000 CSS pixels, approximately 1x capture density. output/hero-dashboard-desktop-local.jpg.
- Complete selected hero and working dashboard: 1425 x 2074 CSS-pixel region at desktop. output/hero-dashboard-full-local.jpg.
- Tablet: 768 x 1024 CSS pixels, approximately 1x. output/hero-dashboard-tablet-local.jpg.
- Phone: 390 x 844 CSS pixels, approximately 1x. output/hero-dashboard-mobile-local.jpg.
- Focused expanded metric on phone: output/hero-metric-mobile-corrected.jpg.
- Dashboard generation reference: output/hero-dashboard-reference.jpg, captured from the actual HomeDashboardPreview with fictional sample records only.

Evidence files are in the parent workspace's output directory. Comparison uses composition and readable hierarchy, not pixel registration: the supplied raster includes an unrelated watch storefront and social overlay. The implementation screenshots are normalized by recorded CSS viewport and capture density.

## Visual comparison and corrections

- Typography: Geist is retained and browser font status was loaded. The business headline leads, followed by one concise value statement. The exact source principle remains above it in smaller blue type, with its existing word motion. Desktop and mobile wrapping were inspected.
- Spacing/layout: asymmetric two-column hero on desktop, then the unchanged full-width interactive dashboard. Below 800px, copy, actions, illustration and working dashboard stack in that order. No horizontal document overflow was reported at the three target widths. Reserved image dimensions prevent an unreserved image slot.
- Colors: existing public tokens provide the device palette. The actual captured OS theme was dark. Blue actions, readable off-white text and dark neutral surfaces remain consistent. Declared light/dark contrast pairs and device changes are covered by focused tests. A live OS-light screenshot was not captured.
- Imagery: Runway task de64b6e1-f418-4464-8365-bcc575e00341 produced a 2560 x 1712 dashboard illustration from the real fictional-data screenshot. It was inspected standalone and in the page. The generated screen preserves the reference's four metrics, sales chart and goal rings. The page explicitly labels it as a sample dashboard illustration. The actual interactive dashboard below remains the source of inspectable sample values.
- Image delivery: four local WebP sizes (640, 960, 1440 and 1920 pixels wide), 36,542 to 196,322 bytes. The page uses responsive sources, reserved dimensions, eager/high-priority hero delivery and no third-party runtime image request. The rejected still-life assets were removed from the public source.
- Copy and actions: Build your dashboard is the sole filled hero action. Open the demo remains a quieter text link. No promotional badge, unrelated prop, new font, dependency or autoplay video was introduced.

Iteration history:

1. The first generated still life was rejected by the user as unrelated to the business. Replaced it with a cinematic display grounded in the real product screenshot.
2. Removed obsolete mobile heading/padding overrides and changed the frame to preserve the complete landscape dashboard image without cropping its UI.
3. Removed public theme controls and separated device appearance from saved workspace preferences, including public detail portals and cookie notice rendering.
4. Browser inspection found a pale public metric panel with low-contrast dark-theme copy. Added a public-boundary-only paint owner for panels, headings, chart labels, source disclosures and controls. Kept private styles/preferences unchanged.
5. Removed the outer panel's fractional horizontal scrollbar while preserving nested chart/table scrolling. Recaptured the phone panel and confirmed readable dark content.

No unresolved P0, P1 or P2 findings remain in this scoped hero/appearance review. An independent source review found no application regression. This is not a whole-product security or payment certification.

## Interaction and technical checks

- Public navigation has no manual theme selector on desktop or in the opened phone menu.
- Homepage DOM reports public appearance=system and theme=dark while the actual device preference is dark. Store tests cover live OS changes, saved internal overrides, no public storage writes, remount cleanup and deterministic server rendering.
- Internal Dark, Light and System settings remain present; their existing persistence/recovery tests pass.
- Hero signup opens the existing account dialog and closes normally. No account was created. Localhost account verification reported its existing unavailable verification service; a successful account submission was not claimed.
- Open the demo navigates to the functioning /demo page and browser Back returns to the homepage.
- The public Before connecting and Show more detail controls have been removed. The preview opens with receipt-backed fictional sample records. Keyboard activation opens Gross Margin, displays its source context and closes with Escape. The close animation completes with the dialog removed. The public portal uses the system-theme boundary.
- Existing spring endpoint/interruption tests and reduced-motion safeguards remain. Reduced motion was source/test verified, not toggled in the user's OS.
- Fresh preview tab reported no error or warning console entries. An older development tab retained a transient hot-reload warning from deleting the former public control; the clean load did not reproduce it.
- Final TypeScript check, production build and artifact validation passed. All 69 focused homepage, appearance, navigation, discovery, customization, sample/empty dashboard, trend and surface-motion tests passed. git diff --check passed.
- The pre-existing build warning about client chunks larger than 500 kB remains. No end-user performance benchmark is claimed.

## Publication handoff

Publish only after the current release checks below are complete, from the reviewed, clean committed source and its matching artifact. Read back the saved/deployed version and GitHub tree afterward. Authentication, financial calculations, integrations and database migrations were not changed.

final result: passed


## Vanteloq Advisory Hero, October 16, 2026

Reference: `C:\Users\User\.codex\codex-remote-attachments\01a08cfa-5e60-7461-a1fc-bc48876cea19\3F4A91D6-6A6D-4009-B399-0F3BE54D4D5A\1-Photo-1.jpg`. The reference was used for hierarchy, restraint and the single focal visual. Its third-party branding, claims and people were not reproduced.

The Advisory hero now follows one reading path: Vanteloq Advisory, the two-part value statement, one concise explanation, one primary action, and one original connected-systems visual. The supporting method link and Edmonton availability note follow the visual so they remain available without competing with the primary decision.

### Visual and Responsive Verification

- Desktop capture: `qa/advisory-hero/desktop-final.png`, 1440 x 1200 CSS pixels.
- Mobile capture: `qa/advisory-hero/mobile-390-final.png`, 390 x 844 CSS pixels.
- The mobile document measured 390px wide with a 390px scroll width. The hero measured 358px wide, so no horizontal overflow was present.
- The mobile media began at 558.3px and exposed 268.5px in the first viewport. The 42px headline, 16px body copy and 54px primary action were preserved.
- The desktop media began at 589.8px and exposed 585px in the first viewport.
- The desktop cinematic film is self-hosted, 1280 x 720, 15.04 seconds, H.264 High Profile, BT.709, silent and fast-start enabled. Compression reduced it from 11.85 MB to 4.86 MB without a visible loss in the checked frames.
- Mobile browsers receive a separate centre-cropped 640 x 480 rendition at 1.80 MB. It matches the displayed 4:3 frame and avoids downloading or decoding the larger desktop film.

### Motion, Accessibility and Failure States

- Normal-motion checks confirmed that the film mounted only after load, entered the viewport and became idle, then played muted and inline.
- Reduced-motion emulation at 390 x 844 mounted no video source and retained the responsive poster.
- Save Data, slow connections, hidden tabs, off-screen playback, autoplay rejection and media failure keep or restore the poster.
- The decorative poster uses an empty alternative text value, and the video is hidden from assistive technology and removed from the tab order.
- Browser lifecycle helpers have behavioral coverage for load state, visibility, connection gates, pause behavior and rejected playback.

No unresolved P0, P1 or P2 issue remains in the checked hero scope. The visual intentionally adapts the reference to Vanteloq's real identity and content instead of recreating the sample design.

Final result: passed

## Current release additions

- Hero: short 1.1-second entrance, fine-mouse depth limited to 1 and 1.4 degrees, touch press feedback and a visible Explore dashboard link. No idle animation loop or changing fictional business totals. Reduced motion suppresses all new movement.
- Interaction: mouse and keyboard enter the native #dashboard-preview region; focus and browser history are retained. Measured destination top was about 92 CSS pixels beneath the sticky navigation. Customize opened and closed with Escape. No account or layout was saved.
- Current hero evidence: output/hero-motion-desktop.jpg (1440 x 1000), output/hero-motion-hover.jpg, output/hero-motion-dashboard-target.jpg, output/hero-motion-mobile.jpg (390 x 844), and output/hero-motion-tablet.jpg (768 x 1024). All inspected. No horizontal document overflow was reported at these widths.
- Offscreen state clears pointer work and suppresses entrance animation. Independent review identified a stop-selector specificity issue; corrected and browser-verified as animation-name: none outside view.
- Workspace: scoped landing/navigation patch reconciled against version 391. Canonical /workspace, safe permanent legacy redirect, sitemap and public analytics are aligned. Existing /datstudio allowlist, APIs, private authentication, database migrations and financial calculations are unchanged.
- Corrected Workspace primary-button colour specificity. Six approved logos retain original dimensions, use WebP and load lazily; 556,364 bytes total versus 4,218,570 PNG bytes. Public copy describes the product and its preview boundary. Detailed planned integrations are disclosed on request.
- Current checks: 30 focused source/component tests, nine built-worker/discovery tests, full TypeScript checking, production build and Sites artifact validation passed. Initial route-test run overlapped the asset conversion and failed on the removed PNG path; rerun after conversion passed all six route tests. No unresolved code failure remains.
- Independent review also found an obsolete expansion-gated CSS rule suppressing customized panels. Removed the rule and added a regression assertion. Corrected shared navigation coverage at 801 to 1040 CSS pixels, retained semantic dark/light colours, and aligned its focus-reset breakpoint at 1041 pixels. All 24 affected checks and full TypeScript verification passed again.
- Final combined browser verification passed on desktop and mobile. The canonical `/workspace` route has no horizontal overflow, all six WebP app marks load at their natural dimensions, the responsive navigation exposes the correct Workspace sign-in action, and the external handoff opens the separate Workspace application without forwarding the commercial session. Advisory retained its existing hierarchy, its inquiry form reached the ready state, its social icons remained keyboard reachable, and its Workspace link resolves to `/workspace`.
- Final verification passed: 29 focused Advisory, navigation and Workspace tests; five production-route tests; full TypeScript checking; production build; Sites artifact validation; and `git diff --check`.

final result: passed
