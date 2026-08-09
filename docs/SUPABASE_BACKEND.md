# Supabase backend transition

Public account sessions use Supabase Auth. The browser receives only
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; API routes
validate bearer sessions against Supabase before resolving the existing
workspace and role. Set `SUPABASE_AUTH_MODE=public` only after the Sites access
policy is public and the production variables are deployed.

Vanteloq currently keeps its operating source of truth in Sites-managed D1 and
its files in R2. Supabase is introduced behind a server-only readiness boundary
so the team can validate schema, authorization, reconciliation, and rollback
before moving any production records.

## Runtime contract

- `SUPABASE_BACKEND_MODE=off` keeps the integration disabled.
- `SUPABASE_BACKEND_MODE=shadow` enables the authenticated readiness probe.
- `SUPABASE_URL` is the HTTPS project API origin.
- `SUPABASE_SECRET_KEY` is stored only in the hosted encrypted environment.
- `SUPABASE_SCHEMA` defaults to `public`.

The browser never receives the secret key. `/api/v1/backend` is limited to
owners and administrators with integration visibility. Its response contains
only mode, configured state, readiness state, schema version, and check time.

## Initial database contract

The first Supabase migration should create a single readiness table:

```sql
create table public.vanteloq_backend_status (
  service text primary key check (service = 'vanteloq'),
  schema_version integer not null check (schema_version > 0),
  updated_at timestamptz not null default now()
);

alter table public.vanteloq_backend_status enable row level security;
revoke all on public.vanteloq_backend_status from public, anon, authenticated;
grant select on public.vanteloq_backend_status to service_role;

insert into public.vanteloq_backend_status (service, schema_version)
values ('vanteloq', 1);
```

No anonymous or authenticated Data API policy is created. The server-side
secret is never used from React or shipped in a `NEXT_PUBLIC_` variable.

## Promotion gates

1. Create the dedicated Supabase project in the approved organization/region.
2. Apply the readiness migration and run security/performance advisors.
3. Add the URL and secret to the hosted encrypted environment; enable `shadow`.
4. Confirm the readiness endpoint reports schema version 1.
5. Port one bounded, tenant-keyed data domain and reconcile D1 and Postgres.
6. Add rollback and drift monitoring before making Supabase authoritative.

Every migrated business table must carry `organization_id`, indexes for its
tenant access patterns, RLS enabled as defense in depth, explicit grants, and
tests proving cross-tenant reads and writes fail. Supabase Auth is the public
authentication boundary; the Worker remotely validates every bearer token and
requires AAL2 before application API access.

The local-growth domain is the first bounded migration candidate. Its contract
contains `growth_touchpoints`, `growth_transactions`, and
`search_visibility_observations`; raw contact details are excluded and the
shared `journey_ref` must be a provider-side pseudonymous reference. Until the
project is approved and promoted through the gates above, D1 remains
authoritative and `SUPABASE_BACKEND_MODE` remains `off`.
