# Complimentary workspace access

Complimentary invitations are separate from employee invitations. Each accepted invitation creates an empty workspace for its verified recipient, skips the business-profile form and checkout, and keeps email verification, authenticator verification and explicit current legal acceptance.

Operators configure the private Sites runtime secret `VANTELOQ_COMPLIMENTARY_INVITATIONS` as a JSON array with `id` (a new UUID), `email`, `plan` (`starter`, `growth` or `pro`), `bookloq` (boolean), and `expiresAt` (an ISO timestamp or null). Do not put recipient addresses or this configuration in the public repository. Deploy the saved release after updating the environment.

The recipient uses the normal signup link, verifies the configured email and completes authenticator setup. The server then presents the short invitation acceptance screen automatically. It does not accept a plan, entitlement or email from client metadata. Acceptance creates a subject-bound grant and an audit entry with the workspace in the same database batch. Existing employee invitations take precedence; an existing workspace is never silently reassigned.

Entitlements use the existing plan catalogue, including location, user and feature limits. BookLoQ is included only when configured. The grant belongs to the recipient's own owner membership, not every member or another workspace. Scheduled POS sync checks the same grant against its existing approved owner authorization. Free access is labelled complimentary and cannot start a subscription checkout.

Removing the private configuration entry and redeploying revokes the grant. Expiry is checked at request time. An inactive persisted claim cannot be accepted again while the configuration remains. The database claim is deleted with the associated account/workspace. Recipient removal must also remove its operator configuration to withdraw eligibility for future signup.

Business identity and address fields start blank; the screen identifies CAD as the initial currency. Owners must review their business and tax settings before using accounting features. No records from other businesses, bank connections, AI consent, saved AI memory or marketing consent are copied or created by this invitation.

Validation includes an isolated real route/database flow covering acceptance, billing exclusion, cross-account rejection, MFA, legal consent, plan/add-on limits, expiry, revocation and duplicate acceptance. The UI was checked on desktop and mobile using fictional data. A recipient's actual email verification and authenticator setup must be completed by that recipient.
