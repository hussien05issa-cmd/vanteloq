# Vanteloq Policy Approval Record

This record adopts the policies listed below. Do not sign until the open exceptions and operating responsibilities are understood.

## Policies

- Vanteloq Information Security Policy, version 1.0, prepared 2026-08-13
- Vanteloq Data Retention and Disposal Policy, version 1.0, prepared 2026-08-13

## Owner acknowledgement

By signing, I approve these policies as Vanteloq operating requirements. I accept responsibility for maintaining the risk and action registers, enforcing the defined access and remediation requirements, retaining evidence, reviewing controls quarterly, reviewing the policies annually, and disclosing exceptions accurately to Plaid and other reviewers.

| Field | Entry |
| --- | --- |
| Name | Hussien Issa |
| Title | Owner and Security Lead |
| Signature | ______________________________ |
| Approval date | ______________________________ |
| First quarterly review due | ______________________________ |
| Next annual policy review | ______________________________ |

## Known exceptions at adoption

| Exception | Required treatment | Owner | Target date |
| --- | --- | --- | --- |
| Production edge accepts TLS 1.1 | Configure a TLS 1.2 minimum or migrate the custom domain to an edge configuration that enforces it; independently retest | Hussien Issa | Before Plaid production submission |
| Managed scanning is not evidenced across every worker endpoint and production asset | Deploy managed endpoint and external production scanning; retain reports | Hussien Issa | __________________ |
| Critical-system MFA inventory is incomplete | Verify every administrator and factor; retain an MFA register without secrets | Hussien Issa | Before answering Plaid critical-system MFA |
| First periodic access and retention reviews have not occurred | Schedule, complete, and retain signed review records | Hussien Issa | Within 90 days of approval |

