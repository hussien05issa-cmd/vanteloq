# API inventory and security rules

All application endpoints are versioned under `/api/v1`. Responses are JSON, sensitive API responses use `Cache-Control: no-store`, and errors contain a safe code, message, and request ID.

| Method | Route | Authentication / authorization | Body limit | Rate limit | Notes |
|---|---|---|---:|---:|---|
| GET | `/api/v1/onboarding` | Optional identity; returns only the current identity's workspace | None | Edge controls | Anonymous response contains no organization data |
| POST | `/api/v1/onboarding` | Trusted identity; no existing membership | 32 KiB | 5/hour/user and 20/hour/source | Same-origin required; strict allowlist; convergent identity write followed by a retry-safe workspace/audit/membership batch |
| GET | `/api/v1/tasks` | Active owner/admin/manager/employee/read-only membership | None | 120/minute/user+source | Organization is derived server-side; maximum 200 rows |
| POST | `/api/v1/tasks` | Active owner/admin/manager/employee membership | 32 KiB | 60/minute/user | Same-origin and UUID `Idempotency-Key` required |
| PATCH | `/api/v1/tasks` | Active owner/admin/manager/employee membership | 32 KiB | 120/minute/user | Task ID is always paired with derived organization ID |
| GET | `/api/v1/command-centre` | Active owner/admin/manager/read-only membership | None | 120/minute/user+source | Maximum 730 tenant-owned daily records; returns metrics, comparisons, balances, freshness, data quality, evidence, limitations, and suggested actions |
| GET | `/api/v1/daily-metrics` | Active owner/admin/manager/read-only membership | None | 60/minute/user | Maximum 20 tenant-owned import-history records |
| POST | `/api/v1/daily-metrics` | Active owner/admin/manager membership | 512 KiB | 12/hour/user | Same-origin and UUID `Idempotency-Key`; 1–366 unique date/location rows; convergent upserts; audited import |
| GET | `/api/v1/events` | Active owner/admin/manager/read-only membership | None | 60/minute/user | Maximum 200 tenant-owned business-memory events; measured impact requires at least 7 verified days on both sides |
| POST | `/api/v1/events` | Active owner/admin/manager membership | 32 KiB | 30/hour/user | Same-origin; strict event type/date validation; audited write |
| GET | `/api/v1/bookloq` | Active owner/admin/manager/read-only membership plus section permission | None | 120/minute/user | Returns only tenant-owned ledger-derived balances, statements, alerts, AP/AR, close, forecast, audit, and supporting records |
| POST | `/api/v1/bookloq/demo` | Active owner/admin membership | 32 KiB | 3/day/user | Same-origin; loads only an explicitly labelled demo into an empty ledger; retry is convergent |
| POST | `/api/v1/bookloq/journals` | Active owner/admin with `post_journals` | 64 KiB | 30/hour/user | Same-origin and UUID `Idempotency-Key`; integer minor units; 2–50 lines; active tenant accounts; balanced; open period; audited |
| PATCH | `/api/v1/bookloq/journals` | Active owner/admin with `post_journals` | 16 KiB | 20/hour/user | Same-origin and UUID `Idempotency-Key`; creates one linked counter-entry in an open period; never overwrites lines |
| POST | `/api/v1/bookloq/actions` | Active owner/admin plus action-specific finance permission | 16 KiB | 60/minute/user | Same-origin; explicit transitions for close work, alert status, period lock, and reason-required owner unlock; audited |
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

Unknown fields are rejected. Strings are normalized and bounded. Dates, emails, URLs, phone numbers, business hours, roles, status values, source modes, currencies, timezones, provider choices, integer monetary values, counts, import sizes, event types, and date/location uniqueness use explicit validation. BookLoQ additionally rejects unbalanced journals, mixed debit/credit lines, inactive or cross-tenant account IDs, locked-period postings, repeated reversals, incomplete close locks, and unexplained unlocks.
