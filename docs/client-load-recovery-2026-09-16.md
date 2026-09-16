# Client module-load recovery

Live browser diagnostics recorded a failed dynamic import for an older billing-onboarding file. Its URL now returns 404. The framework's generic global error screen offered Reload and Back, but the application had no branded recovery for a failed lazy-loaded access gate. A fresh page load worked, and production HTML sends `Cache-Control: no-store, max-age=0`.

An eager React boundary now wraps the existing signup, team-invitation and authenticated workspace branches. Their MFA, session, legal and subscription gates remain in the same order. Only recognized module or stylesheet loading failures display the recovery screen. Application, API, authorization and navigation errors retain their existing handling.

The fallback focuses its heading, uses Vanteloq's existing mark and navy/off-white styling, explains that either an update or a connection interruption can cause the failure, and offers Reload Vanteloq and Get Help. Reload requires a click. There is no automatic reload, storage of form values, or recovery loop. The failed subtree can lose unsaved memory when React unmounts it, which the screen discloses; it does not claim drafts are saved.

Five focused tests passed for browser-specific module errors, unrelated-error propagation, protected-child removal, accessible rendering and omission of sensitive error URLs. Independent review found no blocking issue. The loopback fixture exercised an actual rejected React.lazy import: a draft outside the failed subtree remained until the user chose reload, and reload restored the initial fixture. Desktop and 360-pixel mobile layouts were visually inspected; mobile scroll width stayed at 360 pixels without horizontal overflow.

The boundary cannot recover an initial entry bundle that fails before React starts. It also does not keep old deployment assets available. This is a scoped recovery improvement, not a claim of complete offline support or unsaved-form recovery.
