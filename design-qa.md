# Cinematic dashboard hero and public appearance QA

Date: October 16, 2026

## Reference and scope

Selected reference: C:/Users/User/.codex/codex-remote-attachments/01a12e40-4a37-7a12-8bc3-19bc9b23a406/CD1EDC16-EB1B-49A1-B25E-1F86CFD5CA21/1-Photo-1.jpg (1280 x 834 raster).

Adapt the reference's editorial composition, concise left copy, single prominent action and large product visual to Vanteloq. Preserve the supplied logos, Geist typography, exact animated source principle, signup/demo paths and full working dashboard. The user's correction supersedes the first still life: the product visual must show a cinematic business dashboard. Public appearance follows the device; internal Dark, Light and System choices remain available and independent.

## Captured implementation evidence

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
- Before connecting and Show sample records retain real empty/sample states. Keyboard activation opens Gross Margin, displays its source context and closes with Escape. The close animation completes with the dialog removed. The public portal uses the system-theme boundary.
- Existing spring endpoint/interruption tests and reduced-motion safeguards remain. Reduced motion was source/test verified, not toggled in the user's OS.
- Fresh preview tab reported no error or warning console entries. An older development tab retained a transient hot-reload warning from deleting the former public control; the clean load did not reproduce it.
- Final TypeScript check, production build and artifact validation passed. All 69 focused homepage, appearance, navigation, discovery, customization, sample/empty dashboard, trend and surface-motion tests passed. git diff --check passed.
- The pre-existing build warning about client chunks larger than 500 kB remains. No end-user performance benchmark is claimed.

## Publication handoff

This record approves the scoped local result for publication. Publish only the reviewed, clean committed source and its matching artifact. Read back the saved/deployed version and GitHub tree afterward. Authentication, financial calculations, integrations and database migrations were not changed.

final result: passed
