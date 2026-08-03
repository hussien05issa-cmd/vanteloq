# Data inventory and retention matrix

These are proposed operational defaults and require Canadian privacy/legal review before public launch.

| Data | Purpose | Classification | Proposed active retention | Deletion behavior |
|---|---|---|---|---|
| Public site content | Explain product | Public | While published | Remove with release |
| User identity and membership | Authentication and access | Confidential | Account life + 30 days | Delete/anonymize unless security/legal hold applies |
| Organization profile and hours | Reporting context | Confidential | Account life + 30 days | Delete on verified account deletion |
| Tax registration number | Tax/report context | Highly sensitive | Only while explicitly needed | Delete promptly when removed; never log |
| Tasks | Operating workflow | Confidential | Account life or owner-defined period | Tenant-scoped deletion/export |
| Audit events | Security/accountability | Confidential | Proposed 24 months | Append-only; anonymize actor where lawful after account deletion |
| Rate-limit buckets | Abuse prevention | Internal | Maximum twice the window; automated cleanup required | Delete automatically |
| Integration metadata | Connection health | Confidential | Connection life + 90 days | Remove identifiers on revocation; retain minimal audit event |
| Future provider tokens | Provider access | Highly sensitive | Connection life only | Revoke and delete encrypted material immediately |
| Future CSV source files | Import staging | Highly sensitive | Proposed 7 days after accepted/rejected import | Automated private-object deletion |
| Future normalized transactions | Analytics and reconciliation | Highly sensitive | Business-defined; legal review required | Export/correct/delete subject to lawful accounting retention |
| Backups | Recovery | Same as source | Proposed rolling 35 days | Expire automatically; documented delayed deletion semantics |

Vanteloq must support verified export, correction, and deletion workflows before customer/POS personal data is admitted. Optional marketing and analytics consent must remain separate from transactional processing.

