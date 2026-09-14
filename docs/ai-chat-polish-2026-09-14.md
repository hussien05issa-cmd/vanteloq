# Vanteloq AI chat polish

## Behaviour

- Restore accepted OpenAI data-use receipts for the current person and workspace. Match the current notice, privacy policy and disclosed data categories. No consent is granted by local storage or by starting a chat.
- Keep the first-use choice below the composer. After acceptance, move its status and withdrawal control into Settings. New chats and memory changes retain a valid agreement. Help-only consent cannot enable business-data analysis.
- Require a current server receipt before evidence collection and again before contacting OpenAI. A stale browser cannot recreate withdrawn consent by submitting a chat. Withdrawal remains available without the AI entitlement.
- Bound the full client operation, including session lookup and response parsing, to 75 seconds. Keep the question on failure, timeout or cancellation. Ignore late responses after Stop or unmount.
- Forward request cancellation to the provider when the hosting request signal propagates it. The provider call also has its own 45-second deadline. A proxy may continue server work after a browser disconnect; Stop is not a guarantee that a provider request was never processed.
- Gather independent retail, marketing and BookLoQ context concurrently while retaining their existing authorization and redaction paths.
- Reveal completed, validated answers progressively. This is a presentation animation, not provider token streaming. Keep financial tables complete, offer immediate full-answer display, and respect reduced motion. Never render provider HTML.
- Remove duplicate assistant headings and consolidate response notes into a quiet footer.
- Refine the shared vector V and orbit with blue and violet highlights, a moving gradient and restrained orbit motion. No raster asset replacement or new runtime dependency.

## Validation

- Client/provider/brand tests cover first-use and restored consent, safe rich text, cancellation, body-read timeout, completed provider output and credential-safe errors.
- Built-Worker intelligence tests cover receipt ownership, help-only scope, stale notice, withdrawal, permissions, location isolation, memory and BookLoQ evidence.
- Browser checks use the isolated fictional fixture for new chat, reload, Settings, withdrawal, Stop, timeout, progressive text, complete financial tables and mobile layout.
- Stop and Send are separate keyed controls. The Stop handler cancels the click default so changing the button back to Send cannot submit the form again.

No notice version, database schema, billing setting or connector credential changes are needed for this release.
