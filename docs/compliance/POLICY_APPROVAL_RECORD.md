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
| Production edge accepted TLS 1.1 at adoption | Current protocol probe on October 1, 2026 rejected TLS 1.0/1.1 and accepted certificate-authorized TLS 1.2/1.3 on the four tested hosts. Retain the dated result and retest after edge changes. | Hussien Issa | Verified for the tested hosts on October 1, 2026 |
| Managed scanning is not evidenced across every worker endpoint and production asset | Deploy managed endpoint and external production scanning; retain reports | Hussien Issa | __________________ |
| Critical-system MFA inventory is incomplete | Verify every administrator and factor; retain an MFA register without secrets | Hussien Issa | Before answering Plaid critical-system MFA |
| First periodic access and retention reviews have not occurred | Schedule, complete, and retain signed review records | Hussien Issa | Within 90 days of approval |

## Technical review evidence, October 1, 2026

This entry records source and retained-evidence review by Codex. It does not sign or approve the policy for the owner, establish completion of an access/retention review, or confirm production disposal.

- The current AI preference and retry tables have user/workspace deletion cascades, and account cleanup explicitly removes their rows. AI retention wording now distinguishes saved chats, browser-held open-chat context, saved preferences and activity-triggered retry cleanup.
- Rejected/quarantined-file and import-staging periods are labelled operator targets where automatic age-based disposal and completed production review have not been verified. The document cleanup scheduler resumes already-authorized cleanup only.
- The parent task supplied and this review inspected `output/public-tls-2026-10-01.json` from the workspace root, checked at 2026-10-01T08:03:05.964Z. It covers vanteloq.com, www.vanteloq.com, connectors.vanteloq.com and vanteloq.hussien05issa.chatgpt.site. Each refused TLS 1.0 and 1.1; each accepted TLS 1.2 and 1.3 with certificate authorization. This replaces the historical TLS exception for those tested endpoints and time.
- Actual Sites production D1/R2 backup export and isolated restoration remain pending. A source archive and the fictional hosted recovery drill do not close that requirement.
- Owner approval and periodic-review signature/date fields above remain unchanged.

