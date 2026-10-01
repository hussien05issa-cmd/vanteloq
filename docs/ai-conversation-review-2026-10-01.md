# Vanteloq AI conversation review

Date: October 1, 2026. Local implementation and isolated validation completed. Publication is recorded in the final release report.

## Root causes and changes

The previous system instructions required an evidence footer even for small questions. The frontend also read a different source-summary property from the one returned by the route, used an artificial text reveal, and had no transient conversation proof when saved memory was off. These were application behaviours, not evidence that a different model was needed.

Greetings now take a narrow, safe path using only a known first name. Ordinary replies lead with the answer; necessary financial limitations remain beside the affected claim. Sources, dates and record actions are disclosed separately. OpenAI Responses API text deltas now stream through the server and client; reasoning events are never displayed. Completed replies are not artificially delayed.

Preferences cover response length, explanation level, format, business priorities, text size and spacing. Saving is explicit, scoped to user and workspace, and stores no financial facts. Memory remains off by default. A signed, short-lived browser-held proof allows recent follow-ups without storing the transcript in the chat database. It is bound to current session, workspace, location scope, permissions, consent and history-deletion generation. It expires after 30 minutes and holds at most six messages within a bounded payload.

Saved conversations can be reopened, renamed, searched within loaded titles, and deleted. Titles require current access to the conversation evidence. Deleting any conversation advances the authority generation in the same database batch, preventing an in-flight answer from recreating it. Attachment-derived conversations remain paused for persistent saving until a new chat begins. Original attachments must be selected again when a summary is insufficient.

Retries use a scoped request identifier and deterministic saved-message identifiers. A reply already committed can be recovered after interrupted request bookkeeping. For memory-off replies the server deliberately does not retain the answer; if delivery was lost, the interface offers another generation rather than pretending to recover it.

## Examples and observations

| Question | Before | After |
|---|---|---|
| Hello | Introduction plus unrelated partial-period warning and raw evidence footer | Known-name greeting with no financial record query or provider call |
| Can I calculate gross profit? | Mandatory evidence boilerplate could accompany the answer | Explicitly says gross profit cannot be calculated without costs; sales remain available |
| How much did sales grow? | Raw coverage fields could appear | Explains the comparison period is incomplete and does not invent a growth rate |
| Follow-up with memory off | No reliable earlier-turn context | Recent authorised conversation context is available without a saved transcript |

Real OpenAI probes used fictional records only. PDF receipt subtotal CAD20, GST1 and total21 were read correctly; image quantity12 and stock value60 were read correctly; CSV10+15 totalled25 and its embedded instruction was ignored. Initial probes revealed raw field names and long-dash punctuation; the instructions were tightened and all three affected cases were rerun successfully. Focused first-text latency was 1.517–2.190 seconds; completion 2.013–2.787 seconds. These are small sample observations, not service guarantees.

## Verification

- 35 focused tests passed: client, provider, streaming parser, response renderer, preferences and isolated API flow.
- Additional history, completion and authority tests passed, including permission loss, cross-workspace access, delete-during-generation, retry collisions and attachment-derived privacy.
- Real provider tests are in output/advisor-live-evaluation.json and output/advisor-live-focused.json. The earlier file preserves the initial output rather than rewriting failed quality observations.
- Browser fixture: desktop and 390px mobile; no horizontal overflow, explicit preference save, streamed partial text, keyboard activation and Stop recovery confirmed.
- Type checking and production build passed before the final small attachment-thumbnail addition; the final release pass repeats the required checks.

## Limits

The UI fixture uses fictional local streaming; provider probes separately exercise OpenAI. Neither proves every future model answer is correct. Title search covers loaded conversations, not a semantic search of every historic message. Follow-up proofs expire or invalidate when access changes. Fetch does not expose reliable browser upload-byte progress, so the UI shows truthful processing status instead of a fabricated percentage. Chat uploads never post journals or alter inventory. Source completeness and provider availability remain separate from connection status.
