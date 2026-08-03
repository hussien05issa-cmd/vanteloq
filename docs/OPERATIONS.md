# Operations, backup, and restoration

## Initial service objectives

- RPO target: 24 hours
- RTO target: 8 hours
- Availability and latency objectives: define before public SLA
- Restore owner: named production operator
- Security escalation: platform owner and security owner; legal/privacy counsel when personal data may be affected

These are targets, not evidence that backups or alerts are configured.

## Monitoring checklist

- `/api/health` external uptime probe
- `/api/readiness` dependency-aware readiness probe
- Request error rate and p50/p95/p99 latency
- D1 errors, query latency, and storage growth
- Elevated 401/403/429 responses and onboarding failures
- New owner/admin membership, future role changes, integration changes, exports, and security-setting changes
- Deployment and migration failure
- Future queue age, sync freshness, webhook failure, and import rejection rate
- Backup success, age, retention, and quarterly restore result
- Domain and certificate expiry

Alerts must contain severity, affected component, start time, relevant metric, request IDs where safe, and the matching runbook. They must never contain tokens, tax numbers, customer payloads, or authentication headers.

## Backup validation and restore drill

1. Confirm encrypted D1 backup/PITR capabilities and restricted backup identity in the production account.
2. Record backup timestamp and expected organization/user/task/audit counts.
3. Restore to an isolated non-public recovery database.
4. Run schema migrations only when required for the selected application version.
5. Validate foreign keys, organization-to-membership counts, tenant-scoped task counts, audit chronology, and sampled checksums.
6. Run application smoke tests against the isolated restore without sending email/webhooks or contacting providers.
7. Record actual RPO/RTO and destroy the isolated copy through the approved process.

A backup is not accepted until this restoration drill succeeds. Account-level Cloudflare configuration remains an operator action outside this repository.

