# Vanteloq Advisory Implementation Plan

**Goal:** Add a focused Vanteloq Advisory landing page that preserves the approved team, founder story, film and social profiles, while keeping the product homepage intact.

## 1. Lock the Route Contract

- Add a route rendering test for hierarchy, team order, approved titles, video behavior, FAQ count, social path, contact anchors and prohibited brand content.
- Run the focused test and confirm it fails because the route is not implemented.

## 2. Preserve First-Party Assets

- Copy the verified introduction MP4 and poster into `public/brand/advisory/`.
- Copy 256, 480, 768 and full WebP portraits for Zak, Ahmed and Hussien into `public/brand/advisory/team/`.
- Verify file sizes and hashes against the source inventory.

## 3. Build the Advisory Route

- Add `app/advisory/page.tsx` with metadata and Service and Person JSON-LD tied to Vanteloq Inc.
- Add `app/advisory/advisory.css` scoped below `.advisory-site`.
- Reuse `DiscoveryShell`, `SocialLinks` and the existing form component.
- Keep content concise and preserve the approved customer journey.

## 4. Extend the Secure Inquiry Flow

- Add an explicit `advisory` purpose in the form UI and server handler.
- Add advisory labels, consent, notice version, email subject/body and success state.
- Preserve all security and delivery controls.
- Update and run focused form and handler tests.

## 5. Connect Navigation and Discovery

- Add Advisory to the shared public navigation, footer and sitemap.
- Avoid a crowded header by moving Connections into Resources where needed.
- Add Advisory to the product homepage navigation only where it fits the existing responsive contract.
- Update focused navigation and SEO tests.

## 6. Verify the Complete Change

- Run focused page, form, navigation, SEO and security tests.
- Run lint, typecheck and the production build.
- Start the supported local preview and inspect `/advisory` at desktop and mobile widths.
- Check the full CTA and form-loading path, keyboard focus, overflow, image crops, video controls and both appearance themes.
- Fix any observed defects and repeat only affected checks.

## 7. Publish Through Sites

- Preserve the existing Sites project ID and audience.
- Package and commit the verified source with the Sites source helper.
- Save and deploy the resulting archive through the native Sites tools.
- Verify the deployed route and record the version, commit SHA and URL.
- Report actual mailbox receipt as unverified unless an authorized production submission is completed.

