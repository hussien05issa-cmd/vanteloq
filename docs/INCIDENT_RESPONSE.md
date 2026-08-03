# Incident-response plan

## Lifecycle

1. Preparation: owners, access, communications, evidence retention, backups, and runbooks are current.
2. Detection: alerts or reports create an incident record with time, signal, and affected service.
3. Triage: assign severity and determine whether identity, tenant, provider, or personal data is involved.
4. Containment: block malicious traffic, revoke sessions/provider grants, disable affected integration, or restrict writes.
5. Eradication: patch the root cause, rotate affected credentials, and remove persistence.
6. Recovery: deploy a verified artifact, restore clean data if needed, and monitor closely.
7. Notification: legal/privacy counsel determines statutory, contractual, user, and provider obligations.
8. Review: preserve a blameless timeline, control failures, corrective owners, and deadlines.

## Emergency actions

- Revoke all affected sessions through the configured identity provider.
- Suspend a user or membership without changing historical audit records.
- Revoke and rotate integration grants and secrets.
- Disable provider callbacks and outbound synchronization.
- Apply Cloudflare blocking/rate rules for confirmed malicious traffic.
- Put sensitive mutations into restricted mode while preserving read-only status information.
- Preserve application, audit, deployment, and provider logs with documented custody.
- Identify affected organizations through membership and resource IDs, never by broad assumptions.

Emergency access must be time-limited, approved by two authorized people when practical, scoped to the incident, fully logged, and reviewed after use.

