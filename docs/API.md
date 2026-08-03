# API inventory and security rules

All application endpoints are versioned under `/api/v1`. Responses are JSON, sensitive API responses use `Cache-Control: no-store`, and errors contain a safe code, message, and request ID.

| Method | Route | Authentication / authorization | Body limit | Rate limit | Notes |
|---|---|---|---:|---:|---|
| GET | `/api/v1/onboarding` | Optional identity; returns only the current identity's workspace | None | Edge controls | Anonymous response contains no organization data |
| POST | `/api/v1/onboarding` | Trusted identity; no existing membership | 32 KiB | 5/hour/user and 20/hour/source | Same-origin required; strict allowlist; convergent identity write followed by a retry-safe workspace/audit/membership batch |
| GET | `/api/v1/tasks` | Active owner/admin/manager/employee/read-only membership | None | 120/minute/user+source | Organization is derived server-side; maximum 200 rows |
| POST | `/api/v1/tasks` | Active owner/admin/manager/employee membership | 32 KiB | 60/minute/user | Same-origin and UUID `Idempotency-Key` required |
| PATCH | `/api/v1/tasks` | Active owner/admin/manager/employee membership | 32 KiB | 120/minute/user | Task ID is always paired with derived organization ID |
| GET | `/api/v1/integrations` | Active owner/admin/manager/read-only membership | None | Edge controls | Metadata only; no token or connection action exists |
| GET | `/api/v1/openapi` | Public | None | Edge controls | OpenAPI 3.1 description; no secrets or internal identifiers |
| GET | `/api/health` | Public | None | Edge controls | Liveness only; no dependency details |
| GET | `/api/readiness` | Public | None | Edge controls | Returns only ready/unavailable after a minimal D1 query |

### Error shape

```json
{
  "error": {
    "code": "AUTHENTICATION_REQUIRED",
    "message": "Sign in to continue."
  },
  "requestId": "opaque-correlation-id"
}
```

Unknown fields are rejected. Strings are normalized and bounded. Dates, emails, URLs, phone numbers, business hours, roles, status values, source modes, currencies, timezones, and provider choices use explicit validation.
