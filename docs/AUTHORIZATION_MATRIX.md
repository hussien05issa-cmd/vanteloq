# Authorization matrix

Authorization is evaluated server-side from the trusted identity and active membership. A client-supplied role or organization ID is ignored.

| Action | Owner | Admin | Manager | Employee | Read only | Integration |
|---|---:|---:|---:|---:|---:|---:|
| View organization-scoped tasks | Yes | Yes | Yes | Yes | Yes | No |
| Create/update tasks | Yes | Yes | Yes | Yes | No | No |
| View integration metadata | Yes | Yes | Yes | No | Yes | No |
| Create first workspace | Authenticated user without membership only | — | — | — | — | — |
| Edit organization profile | Planned | Planned | No | No | No | No |
| Configure/revoke integration | Planned | Planned | No | No | No | No |
| Invite or change members | Planned | Planned with limits | No | No | No | No |
| Transfer ownership | Planned, recent reauthentication | No | No | No | No | No |
| Export sensitive data | Planned, recent reauthentication | Planned by explicit grant | No | No | No | No |
| View audit history | Planned | Planned read only | No | No | No | No |

## BookLoQ finance permissions

The current platform roles map to BookLoQ permissions on the server. Hidden navigation is only a usability aid; every API independently checks membership, organization scope, and the required finance permission.

| BookLoQ action | Owner | Admin | Manager | Employee | Read only | Integration |
|---|---:|---:|---:|---:|---:|---:|
| View revenue and profit | Yes | Yes | Yes | No | Yes | No |
| View banking and payroll | Yes | Yes | No | No | Yes | No |
| Create transactions / edit drafts | Yes | Yes | Yes | No | No | No |
| Post or reverse journals | Yes | Yes | No | No | No | No |
| Approve bills / reconcile accounts | Yes | Yes | No | No | No | No |
| Lock accounting periods | Yes | Yes | No | No | No | No |
| Unlock a period with reason | Yes | No | No | No | No | No |
| Change tax settings / manage integrations | Yes | Yes | No | No | No | No |
| Export finance data / view finance audit | Yes | Yes | No | No | Yes | No |
| Initiate external payment | Permission vocabulary exists; provider action is disabled | Permission vocabulary exists; provider action is disabled | No | No | No | No |

Unimplemented actions remain denied. There is no master password, bypass account, hidden administrator, or client-controlled permission override.
