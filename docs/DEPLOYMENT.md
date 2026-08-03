# Deployment, rollback, and environment guide

## Environments

- Local: simulated bindings and synthetic test identities only; never production data
- Test: automated build and hostile-path checks against disposable state
- Staging: separate Site, D1 database, secrets, provider applications, and callback URLs
- Production: production Site and D1 with restricted operator access

Staging and production must never share provider tokens, database bindings, buckets, webhook secrets, encryption keys, or API credentials.

## Deployment sequence

1. Review the full diff and generated migration SQL.
2. Confirm backward compatibility and a restoration point.
3. Run lint, type checking, render tests, security tests, dependency audit, and secret scan.
4. Resolve all Critical findings and document every accepted High finding.
5. Run the agent preview and exercise public landing, sign-in transition, onboarding, task create/update, empty workspaces, integrations metadata, and mobile navigation.
6. Create an immutable Sites checkpoint from the Site checkout.
7. Wait for terminal deployment status and verify the exact checkpoint through the Sites deployment-status API.
8. Run production smoke checks for health, anonymous data isolation, sign-in, workspace resolution, and task persistence.
9. Observe errors, latency, D1 health, authentication failures, and migration outcomes before widening access.

## Rollback

1. Stop writes or place the application in restricted mode when data compatibility is uncertain.
2. Select the last verified immutable application version.
3. Verify whether the database migration is backward-compatible before application rollback.
4. Redeploy the last verified version only when its schema contract still holds.
5. If data restore is required, preserve current evidence, restore into an isolated database first, verify integrity and tenant counts, then switch according to the recovery runbook.

Never reverse a destructive migration without a tested restoration point. Phase-one migration is additive and retains legacy prototype tables to reduce rollback risk.

## Secret inventory

No application secret is currently required in source. Future hosted names will include provider client IDs/secrets, webhook secrets, token-encryption keys, email credentials, error-tracking DSNs, and alert destinations. Values belong only in encrypted environment configuration and must be distinct per environment.

