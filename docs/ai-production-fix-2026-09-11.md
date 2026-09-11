# Vanteloq AI production repair

OpenAI billing and the saved local key worked, but production lacked its runtime secret. After securely configuring it, live chat exposed a second issue: the deployed Worker runtime rejected `redirect: "error"` before contacting either AI provider.

Provider requests now use `manual`. Non-success responses, including redirects, fail without forwarding credentials. A regression constructs the real provider request options inside the Worker runtime; a separate test verifies redirect refusal.

Authenticated production tests returned an App help answer and a business analysis answer using permitted aggregate evidence with memory off. The business answer identified historical, incomplete Lightspeed coverage and unavailable BookLoQ figures. These tests do not certify the underlying source's completeness.

App help now uses dedicated product-support instructions and sends only an explicit no-workspace-data marker, rather than an empty financial evidence object. This prevents empty placeholder fields from suggesting that the user's ledger was inspected and found empty. The permission and BookLoQ integration tests verify that financial evidence is excluded from this mode.

Gemini remains gated until its paid-service protections are confirmed. Production Plaid, QuickBooks ledger import and the other launch gates remain separate work.
