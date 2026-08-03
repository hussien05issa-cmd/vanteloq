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

Unimplemented actions remain denied. There is no master password, bypass account, hidden administrator, or client-controlled permission override.

