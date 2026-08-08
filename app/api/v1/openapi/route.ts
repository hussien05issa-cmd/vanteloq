import { handleApi, jsonResponse } from "../../../../server/api";

const specification = {
  openapi: "3.1.0",
  info: { title: "Vanteloq API", version: "1.0.0" },
  servers: [{ url: "/api/v1" }],
  paths: {
    "/onboarding": {
      get: { summary: "Get the signed-in user's workspace", responses: { "200": { description: "Workspace context" }, "401": { description: "Authentication required" } } },
      post: { summary: "Create the signed-in user's first workspace", responses: { "201": { description: "Workspace created" }, "400": { description: "Invalid input" }, "401": { description: "Authentication required" }, "409": { description: "Workspace already exists" }, "429": { description: "Rate limited" } } },
    },
    "/tasks": {
      get: { summary: "List tenant-owned tasks", responses: { "200": { description: "Bounded task list" }, "401": { description: "Authentication required" }, "403": { description: "Membership required" } } },
      post: { summary: "Create an idempotent tenant-owned task", parameters: [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", format: "uuid" } }], responses: { "201": { description: "Task created" }, "400": { description: "Invalid input" }, "403": { description: "Insufficient permission" }, "429": { description: "Rate limited" } } },
      patch: { summary: "Change task status", responses: { "200": { description: "Task updated" }, "400": { description: "Invalid input" }, "403": { description: "Insufficient permission" }, "404": { description: "Task not found in this tenant" } } },
    },
    "/integrations": {
      get: { summary: "List configured and available integrations", responses: { "200": { description: "Tenant integration metadata" }, "403": { description: "Membership required" } } },
    },
    "/backend": {
      get: { summary: "Read the server-only Supabase transition readiness gate", responses: { "200": { description: "Sanitized backend readiness" }, "401": { description: "Authentication required" }, "403": { description: "Owner or administrator access required" }, "429": { description: "Rate limited" } } },
    },
    "/integrations/lightspeed/authorize": {
      post: { summary: "Begin owner-approved Lightspeed X-Series read-only OAuth", responses: { "200": { description: "Short-lived authorization URL" }, "403": { description: "Integration-management permission required" }, "503": { description: "Provider credentials not configured" } } },
    },
    "/integrations/lightspeed/callback": {
      get: { summary: "Validate Lightspeed OAuth state and stage the connection", responses: { "303": { description: "Return to the integration workspace" }, "400": { description: "Invalid or expired callback" }, "409": { description: "Required read scopes were not granted" } } },
    },
    "/integrations/lightspeed/outlets": {
      get: { summary: "Discover Lightspeed outlets and their tenant mappings", responses: { "200": { description: "Outlet mappings" }, "403": { description: "Integration visibility required" } } },
      post: { summary: "Map a discovered outlet to a tenant-owned location", responses: { "200": { description: "Mapping saved and audited" }, "403": { description: "Integration-management permission required" }, "404": { description: "Location is not in this tenant" } } },
    },
    "/integrations/lightspeed/sync": {
      post: { summary: "Read and stage a bounded sales sample without metric promotion", responses: { "200": { description: "Staging and reconciliation result" }, "403": { description: "Integration-management permission required" }, "409": { description: "Provider authorization needs recovery" } } },
    },
    "/integrations/lightspeed/disconnect": {
      post: { summary: "Revoke local Lightspeed access and delete encrypted credentials", responses: { "200": { description: "Connection revoked; audit history retained" }, "403": { description: "Integration-management permission required" } } },
    },
    "/integrations/lightspeed/webhook": {
      post: { summary: "Verify and queue a signed provider change signal", responses: { "204": { description: "Verified signal queued; polling remains source of truth" }, "401": { description: "Signature invalid" }, "413": { description: "Payload too large" } } },
    },
    "/integrations/lightspeed-r/authorize": {
      post: { summary: "Begin tenant-bound Lightspeed R-Series read-only OAuth", responses: { "200": { description: "Short-lived authorization URL" }, "403": { description: "Integration-management permission required" }, "503": { description: "R-Series OAuth client not configured" } } },
    },
    "/integrations/lightspeed-r/callback": {
      get: { summary: "Consume single-use OAuth state, verify the R-Series account and discover shops", responses: { "303": { description: "Return to the integration workspace" }, "400": { description: "Invalid or expired callback" } } },
    },
    "/integrations/lightspeed-r/shops": {
      get: { summary: "Discover R-Series shops and tenant mappings", responses: { "200": { description: "Shop mappings" }, "409": { description: "R-Series not connected" } } },
      post: { summary: "Map an R-Series shop to a tenant-owned location", responses: { "200": { description: "Mapping saved and audited" }, "404": { description: "Shop or local location not found" } } },
    },
    "/integrations/lightspeed-r/sync": {
      post: { summary: "Read and stage a bounded R-Series sales sample without metric promotion", responses: { "200": { description: "Staging and reconciliation result" }, "409": { description: "Provider authorization needs recovery" } } },
    },
    "/integrations/lightspeed-r/disconnect": {
      post: { summary: "Delete tenant R-Series credentials while retaining staged audit history", responses: { "200": { description: "Connection revoked" }, "403": { description: "Integration-management permission required" } } },
    },
    "/command-centre": {
      get: { summary: "Calculate the tenant's evidence-bound owner command centre", responses: { "200": { description: "Verified metrics, comparisons, source freshness and recommendations" }, "401": { description: "Authentication required" }, "403": { description: "Membership required" }, "429": { description: "Rate limited" } } },
    },
    "/daily-metrics": {
      get: { summary: "List bounded daily-summary import history", responses: { "200": { description: "Tenant-owned import metadata" }, "403": { description: "Membership required" } } },
      post: { summary: "Upsert validated daily operating summaries", parameters: [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", format: "uuid" } }], responses: { "201": { description: "Daily summaries imported" }, "400": { description: "Invalid or inconsistent input" }, "403": { description: "Insufficient permission or origin rejected" }, "413": { description: "Request too large" }, "429": { description: "Rate limited" } } },
    },
    "/events": {
      get: { summary: "List business-memory events with measured before/after impact where supported", responses: { "200": { description: "Tenant-owned events" }, "403": { description: "Membership required" } } },
      post: { summary: "Record a decision or material business event", responses: { "201": { description: "Event recorded" }, "400": { description: "Invalid input" }, "403": { description: "Insufficient permission or origin rejected" }, "429": { description: "Rate limited" } } },
    },
    "/operations": {
      get: { summary: "Read cursor-based operational events, message outbox status and inventory projections", responses: { "200": { description: "Tenant-scoped operational feed" }, "401": { description: "Authentication required" }, "403": { description: "Membership required" }, "429": { description: "Rate limited" } } },
      post: { summary: "Record an idempotent settled payment, append inventory movements and prepare a held confirmation", responses: { "200": { description: "Duplicate event safely acknowledged" }, "202": { description: "Event accepted and projections prepared" }, "400": { description: "Invalid input" }, "403": { description: "Origin or role rejected" }, "409": { description: "Payment totals do not reconcile" }, "429": { description: "Rate limited" } } },
    },
    "/bookloq": {
      get: { summary: "Get the tenant's deterministic BookLoQ accounting workspace", responses: { "200": { description: "Ledger-derived balances, statements, alerts, close status and supporting records" }, "401": { description: "Authentication required" }, "403": { description: "BookLoQ permission required" }, "429": { description: "Rate limited" } } },
    },
    "/bookloq/demo": {
      post: { summary: "Load an explicitly labelled Canadian retail demonstration ledger into an empty workspace", responses: { "200": { description: "Existing demonstration ledger returned without duplication" }, "201": { description: "Demonstration ledger created" }, "403": { description: "Owner or administrator permission required" }, "409": { description: "Live ledger data already exists" }, "429": { description: "Rate limited" } } },
    },
    "/bookloq/journals": {
      post: { summary: "Post a balanced journal in minor currency units", parameters: [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", format: "uuid" } }], responses: { "201": { description: "Balanced journal posted" }, "400": { description: "Invalid or unbalanced entry" }, "403": { description: "Posting permission required" }, "409": { description: "Period is locked" }, "429": { description: "Rate limited" } } },
      patch: { summary: "Reverse a posted journal with a linked, balanced counter-entry", responses: { "201": { description: "Reversal posted" }, "400": { description: "Invalid reversal request" }, "403": { description: "Posting permission required" }, "404": { description: "Journal not found in this tenant" }, "409": { description: "Entry already reversed or period locked" } } },
    },
    "/bookloq/actions": {
      post: { summary: "Resolve alerts, update close work, or lock and controlled-unlock accounting periods", responses: { "200": { description: "Tenant-owned accounting workflow updated and audited" }, "400": { description: "Invalid state transition" }, "403": { description: "Required BookLoQ permission missing" }, "404": { description: "Record not found in this tenant" }, "409": { description: "Close prerequisites are incomplete" }, "429": { description: "Rate limited" } } },
    },
    "/governance": {
      get: { summary: "Get organization profile, locations, team, roles and permission catalogue", responses: { "200": { description: "Tenant governance workspace" }, "403": { description: "Administrative access required" } } },
      post: { summary: "Update tenant profile, locations, employees, roles or workplace PINs", responses: { "200": { description: "Governance change saved and audited" }, "400": { description: "Invalid input" }, "403": { description: "Administrative permission required" }, "409": { description: "Protected owner or duplicate record" } } },
    },
    "/organization-logo": {
      get: { summary: "Read the current tenant-scoped organization logo", responses: { "200": { description: "Verified image object" }, "404": { description: "No custom logo" } } },
      post: { summary: "Verify and store a tenant-scoped organization logo", responses: { "200": { description: "Logo stored" }, "400": { description: "Invalid image" }, "403": { description: "Branding permission required" }, "413": { description: "Image too large" } } },
      delete: { summary: "Remove the current tenant-scoped logo", responses: { "200": { description: "Logo removed" }, "403": { description: "Branding permission required" } } },
    },
    "/purchasing": {
      get: { summary: "List tenant purchase orders, lines, receipts and invoice matches", responses: { "200": { description: "Purchase-order centre" }, "403": { description: "Purchasing view permission required" } } },
      post: { summary: "Create, approve, send-confirm, receive or match a purchase order", responses: { "200": { description: "Workflow updated and audited" }, "201": { description: "Purchase order created" }, "400": { description: "Invalid input" }, "403": { description: "Action permission required" }, "409": { description: "Invalid lifecycle transition" } } },
    },
    "/documents": {
      get: { summary: "List or download tenant documents", responses: { "200": { description: "Document list or attachment" }, "403": { description: "Document permission required" } } },
      post: { summary: "Verify and quarantine a tenant invoice or receipt", responses: { "201": { description: "Document stored for review" }, "400": { description: "Invalid file" }, "409": { description: "Duplicate document" }, "413": { description: "File too large" } } },
      delete: { summary: "Remove an unprocessed tenant document", responses: { "200": { description: "Document removed" }, "403": { description: "Retention permission required" }, "409": { description: "Protected record" } } },
    },
    "/reports": {
      get: { summary: "Run a source-backed aggregate report or authorized CSV export", responses: { "200": { description: "Report result or CSV" }, "400": { description: "Unsupported report or filters" }, "403": { description: "Report or data permission required" } } },
    },
    "/data-quality": {
      get: { summary: "Calculate tenant source completeness and affected metrics", responses: { "200": { description: "Data-quality score and corrections" }, "403": { description: "Integration visibility required" } } },
    },
  },
};

export async function GET(request: Request) {
  return handleApi(request, async () => jsonResponse(specification));
}
