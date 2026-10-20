# Animated industry workflow showcase

This addition expands the existing homepage industry section. It does not replace the homepage, pricing or connection directory.

## Experience

Retail, dealerships, cafés and restaurants have prominent selectors. The complete business-type selector uses the existing 12 industry templates. Related retail types reuse a relevant sales-and-stock example; services, hospitality and custom businesses use a BookLoQ receivables example rather than claiming unsupported specialist operations.

Each workflow has three selectable stages, a sample record, visible calculation or input context, a practical next step and a boundary explaining what the result does not establish. All figures are fictional. The component is an interactive marketing explanation, not a live workspace or exact screenshot of an operational screen.

The design keeps the existing navy and blue identity, actual Vanteloq artwork, translucent outer surface, solid readable records, restrained shadows and single-column mobile controls. The homepage brand descriptor now says Business analytics rather than Retail analytics.

## Motion and access

- User-initiated Play walks through the three stages once, then stops.
- Stage buttons and Previous/Next work independently of motion.
- Only transform and opacity animate on the record. No new animation library, video, external font or polling request.
- The tour pauses outside the visible page/viewport. Unmount and stage changes clear timers and cancel unfinished Web Animations.
- Turning motion off disarms playback. Turning it back on requires a new Play action.
- Operating-system reduced motion and Vanteloq's own preference are respected.
- A concise status announcement describes stage changes. Controls retain keyboard focus.

Accessibility reference: [W3C Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html). This informed user-controlled playback and no automatic cycling, not a claim of accessibility certification.

## Higgsfield result

The requested plugin was used to prepare and attempt one silent decorative film. Seedance 2.5 preflight estimated 72 credits for 6 seconds at 1080p. Submission returned Requires plus plan or higher. No job ID or media was created. No subscription was changed and no retry was made. The implemented showcase uses native interactive UI animation; no Higgsfield-generated asset is claimed.

## Verification

Type checking, changed-file ESLint, the existing six homepage/industry configuration tests and production build passed. The existing large-chunk build warning remains. The browser review covered the actual homepage at 1365, 390 and 320 px; no horizontal page overflow occurred. The primary workflows, BookLoQ example, stage buttons, keyboard Enter, tour completion and interrupted playback were reviewed with fictional data. No console errors were observed in the public preview. Reduced motion was checked through Vanteloq's setting and source rules; the OS setting was not emulated.

The public preview script now renders the real homepage rather than the separate how-it-works guide.

## Publication boundary

Saved on the existing industry expansion draft branch. Not published or merged. Sites release 328 still reports incomplete input: SQLITE_ERROR during migration. The exact failed SQL statement and applied migration boundary are still needed before safe repair. The last confirmed live release is 327. Support case 16393023 already has the product clarification. This section must ship with the matching industry implementation, not independently ahead of it.
