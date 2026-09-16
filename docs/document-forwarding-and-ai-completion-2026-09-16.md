# Document Forwarding and AI Completion Review

## Customer behavior

Email Documents is a collapsed option in Documents. The receiving service remains Coming Soon until the separate provider setup and live acceptance are complete. An eligible owner or administrator can enable a private address only after accepting the attachment storage notice. Each address is bound to one workspace and can be replaced or disabled.

Supported attachments enter the existing private quarantine. Email does not authorize a file scan, text extraction, AI processing, document classification, a bank statement import or an accounting entry. Those actions keep their existing consent and review steps. Originals are retained under the document retention rules; the email body is not retained by this receiver. Sender addresses are explicitly unverified. Customer documents never route to the owner's support inbox.

The interface uses the existing restrained blue palette, boxed inputs, left-aligned notices and 44-pixel buttons. Mobile review found no horizontal page overflow. Permission denial removes the private address and sender details, and stale requests cannot restore them. Integration tabs wrap without splitting their labels, and chart axes use larger labels.

## Data protection

The dedicated receiver accepts at most 5 supported attachments, 10 MB decoded total and 15 MB raw MIME. It checks content signatures and sends only supported attachments to a fixed HTTPS endpoint. A private HMAC binds the request method, path, time, delivery identifier and body digest. Redirects are refused.

The application independently checks the signature, limits, exact address generation, current identity, membership, role, workspace scope, permissions and BookLoQ access. A delivery lease excludes simultaneous processing. Durable storage intents precede object writes; document records, provenance and completion of the intent commit atomically. Deletion leaves a replay marker so resending the same delivery cannot restore a deleted original. Unknown interrupted writes remain subject to review, and account deletion cannot falsely report completion while an unresolved intent remains.

## AI privacy correction

An isolated overlapping-request test found that a reply could finish after consent withdrawal or membership suspension and still return and save its messages. The corrected route checks current authorization before sending evidence and again after the provider returns. Conditional database writes form the completion boundary. A withdrawal or suspension committed first prevents later history persistence; deleting a conversation prevents its pending reply from recreating it. Memory-off requests do not save conversations or messages.

The authorization snapshot includes role and location restrictions, subscription access, session validity, consent, selected business sources and their selection version. Ordinary data synchronization does not invalidate a reply by itself. Data already sent while authorized cannot be recalled from the provider by this completion check.

## Verification boundaries

The integrated email and cleanup tests passed 19 cases, including actual local Workers processing of a 10 MB fictional attachment. Independent account-deletion tests passed 14 cases. The atomic AI completion tests passed 7 cases. TypeScript and production artifact validation passed. New-source lint issues were corrected and the affected files passed their follow-up check. The new pinned parser dependency had no known vulnerabilities in its package-manager audit at the time of testing.

The final AI route scenario passed concurrent workspace isolation, foreign-history denial, withdrawal with memory on and off, suspension, withdrawal immediately before persistence, plan revocation before provider transmission, and deletion of a pending conversation. A separate integrated follow-up passed 17 cases, including the built upload-size and signed-cleanup routes plus the affected AI/email tests. Earlier route attempts encountered a local time limit and a fixture import failure; both were resolved before the final successful run, without dropping their assertions.

Separate accounting regressions passed 50 cases covering statements, signed cash movements, profit presentation, inventory costs, basket calculations and reorder limits. These checks do not turn unverified bank data into revenue or certify a real accounting close.

Live email receipt, the provider CPU budget, support-address verification and paid-plan activation are separate release gates. Local concurrent-user tests establish the tested isolation and race behavior, not a production capacity guarantee. Provider approvals, a demonstrated production restore and the outstanding hosting TLS issue remain outside this patch's completion claim.
