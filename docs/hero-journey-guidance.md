# Homepage hero interaction guidance

Reviewed October 16, 2026.

The hero should help an owner understand Vanteloq, inspect a useful example and choose whether to build a dashboard. Its composition, language, source principle, logo and conversion path stay stable while the product display gains restrained motion and a direct route to the working sample.

## Research applied

| Guidance | Application |
| --- | --- |
| Explain the offering, reveal it through examples and make the next action clear. [Nielsen Norman Group, Homepage Design](https://www.nngroup.com/articles/homepage-design-principles/) | One filled Build your dashboard action, a quieter full demo link and a clearly labelled interactive display. Remove the two public preview mode controls. |
| Prefer transform and opacity for animation, avoid repeated layout or paint work, and use layer hints sparingly. [web.dev, Animation guide](https://web.dev/articles/animations-guide) | Reuse the existing responsive WebPs. Use a short transform/opacity entrance, bounded pointer depth and press feedback. Add no video, animation dependency, animated filter or permanent will-change layer. |
| Nonessential movement from interaction should be removable using user preferences. [W3C, Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) | Follow the existing OS motion preference. Reduced motion disables the entrance, tilt, compression and smooth fragment scrolling; navigation and focus still work. |
| Automatically moving content lasting longer than five seconds requires an appropriate stopping mechanism unless essential. [W3C, Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html) | Use a 1.1-second entrance rather than a repeating presentation. Stop the entrance outside the viewport. There is no automatic change to business figures. |

These are implementation decisions informed by the sources, not measured conversion or retention improvements. They do not establish whole-site accessibility compliance.

## Interaction contract

- Initial HTML displays the image and a working fragment link. Content does not wait for animation or JavaScript visibility effects.
- The ready image settles once during its visible entry when the user permits motion. It remains a labelled illustration containing fictional sample data.
- Fine mouse input applies at most one queued animation-frame update per pointer event batch, with bounded 1-degree vertical and 1.4-degree horizontal rotation. There is no idle frame loop or per-frame React state update.
- Touch receives a small press response. Mouse-only tracking never runs for touch or pen input.
- The full display is one link with a persistent Explore dashboard cue and a clear focus outline. Activating it uses the native #dashboard-preview fragment, preserves browser history and focuses the accessible sample region. Native smooth scrolling is enabled only when motion is permitted.
- The working sample retains its metric, chart, source and customization controls. The cinematic illustration does not pretend its printed controls are independently live.
- Leaving the image, cancelling a pointer, pressing, focusing, resizing, hiding the page or removing the component clears pending pointer work. Visibility changes stop offscreen entrance motion. Media-query and observer subscriptions are removed on cleanup.
- Public appearance continues to follow the OS. Internal Light, Dark and System settings remain independent.

## Performance and verification boundaries

Image bytes, responsive sizes, reserved dimensions and high-priority delivery are unchanged. The largest hero WebP is 196,322 bytes. No new provider connection, customer-data query, font or media download is introduced by the interaction. Production build and focused regression checks remain required before release. Responsive screenshots and actual pointer/keyboard/fragment behavior are stronger evidence than a successful compile alone.

The implementation should be rechecked at desktop, tablet and phone widths; with keyboard focus; after interruption; and with reduced-motion preferences. Record real measurements separately from design intent. A source-level contrast check or successful release is not a complete hardware performance benchmark.

## Workspace coordination

The main site and separate Workspace application have different source repositories and hosting identities. Matching them means compatible navigation, product naming and authorization boundaries, not identical commit hashes.

The Workspace handoff was reconciled against main version 391 rather than deployed from its older checkout. The canonical public entry is /workspace; /vanteloqworkspace permanently redirects there while retaining only five named campaign parameters. The existing /datstudio navigation allowlist is unchanged. Workspace links use the separate app's fixed origin and do not forward account tokens or customer records. The shared navigation and footer identify the canonical entry, and custom primary actions no longer record a signup event.

The landing uses six existing approved product logos, re-encoded at their original pixel dimensions as WebP. Their combined file size is 556,364 bytes, compared with 4,218,570 bytes for the supplied PNGs, an 86.8% reduction. They load lazily below the landing hero. This is a file-size comparison, not a measured page-speed improvement. Keep both applications' sign-in, permissions and records separate until a real shared authorization design is implemented and tested.
