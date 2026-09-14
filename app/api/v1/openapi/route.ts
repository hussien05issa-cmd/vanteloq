import { handleApi, jsonResponse } from "../../../../server/api";

const specification = {
  openapi: "3.1.0",
  info: { title: "Vanteloq API", version: "1.0.0" },
  servers: [{ url: "/api/v1" }],
  paths: {
    "/opportunities": {
      get: { summary: "Read saved opportunity reviews in the selected location scope", description: "Requires dashboard entitlement, insight permission and organization-wide location access. Saved evidence and notes require the financial permissions used at capture. Returns up to 100 recent reviews, linked task metadata when permitted and recent activity. Location-limited accounts receive no saved organization-wide records.", responses: { "200": { description: "Saved reviews and review capability" }, "403": { description: "Access denied" } } },
      post: { summary: "Capture a current finding for review", description: "Same-origin, idempotency-key protected write. Supply decisionId, from and to matching the current dashboard period. The server captures the existing permission-filtered decision; client-supplied evidence is rejected. Captures deduplicate by organization, location scope, rule and period.", responses: { "200": { description: "Captured or existing review" }, "409": { description: "Finding or reporting period changed" } } },
      patch: { summary: "Record a review state and note", description: "Same-origin, idempotency-key protected, version-checked atomic update and activity event. Fields: id, version, status, note and optional snoozedUntil. Statuses: reviewed, monitoring, snoozed, resolved, dismissed. Snooze must be within 90 days. Resolution and dismissal require a reason. No source records or financial transactions are changed.", responses: { "200": { description: "Updated review or replay" }, "400": { description: "Invalid review" }, "404": { description: "Review unavailable to this account" }, "409": { description: "Concurrent edit; reload first" } } },
    },
    "/retail-intelligence": {
      get: { summary: "Read scoped retail products, baskets, revenue drivers and reviewed operating evidence", description: "Requires sales analytics, dashboard and revenue access. from/to are inclusive business-local dates, up to 366 days. Selected location and authoritative, approved source accounts are enforced. Cost, inventory, payroll and customer fields follow separate permissions. Complete-record limits fail explicitly; missing costs and baselines remain unavailable. Recorded comparisons do not prove causes or complete trading-day coverage.", parameters: [{ name: "from", in: "query", schema: { type: "string", format: "date" } }, { name: "to", in: "query", schema: { type: "string", format: "date" } }, { name: "location", in: "query", schema: { type: "string" } }], responses: { "200": { description: "Retail evidence with formulas, coverage and limitations" }, "403": { description: "Scope, permission or entitlement denied" }, "409": { description: "Source overlap or sync in progress" }, "413": { description: "Narrow the complete-record selection" }, "429": { description: "Rate limited" } } },
    },
    "/retail-measurements": {
      get: { summary: "Read permitted reviewed evidence datasets and source choices", description: "kind is stock, labour, loyalty or catalog. Requires managerial import access and the corresponding inventory, payroll or customer permissions. Source-wide classifications require organization-wide location access.", responses: { "200": { description: "Scoped choices and versioned datasets" }, "403": { description: "Access denied" } } },
      post: { summary: "Save or delete reviewed stock, labour, loyalty or catalogue evidence", description: "Same-origin, rate-limited request. Supply kind, action, source context, dates, reviewed:true and expectedVersion (null for a new dataset). Saves also require a source label and strict CSV. Each context is replaced atomically; stale and concurrent changes return 409. Monetary inputs are integer cents. Unknown optional values remain blank. Provider records are not modified; content-free audit metadata is retained.", responses: { "200": { description: "Dataset saved or deleted" }, "400": { description: "Invalid or unreviewed evidence" }, "403": { description: "Permission or source scope denied" }, "409": { description: "Dataset changed; reload and review" }, "429": { description: "Rate limited" } } },
    },
    "/advisor/chat": {
      get: { summary: "Read provider readiness", responses: { "200": { description: "Provider readiness without credentials" } } },
      post: { summary: "Request evidence-bound Vanteloq AI analysis", description: "Requires current explicit data-use consent, AI entitlement and insight permission. provider defaults to openai; all other values are rejected before evidence is collected. memoryEnabled defaults false: no historical messages are sent and no chat content is saved. With memory enabled, conversationId may refer only to the current user's existing conversation in this workspace. Only matching evidence and permissions allow history reuse.", responses: { "200": { description: "Analysis or explicit setup requirement" }, "400": { description: "Invalid question or memory choice" }, "403": { description: "Permission or entitlement required" }, "404": { description: "Conversation unavailable" }, "409": { description: "Consent or source reconciliation required" } } },
      delete: { summary: "Delete one of your saved chats", description: "Same-origin request with conversationId. Privacy access remains independent of an AI subscription or insights permission. Messages and conversation are deleted together; content-free audit metadata remains.", responses: { "200": { description: "Deleted" }, "404": { description: "Conversation unavailable" } } },
    },
    "/advisor/conversations": {
      get: { summary: "List your saved chat dates in the current workspace", description: "Returns up to 50 metadata-only records; old question and reply content is excluded. hasMore indicates older entries. Also prunes chats inactive for 90 days.", responses: { "200": { description: "Conversation metadata" } } },
      delete: { summary: "Delete all your saved chats in this workspace", description: "Requires a same-origin request and confirmDeleteAll: true. Other users and workspaces are excluded.", responses: { "200": { description: "Deleted count" }, "400": { description: "Confirmation required" } } },
    },
    "/marketing/reports": {
      get: {
        summary: "Read approved marketing sources or an on-demand provider report within the user's workspace and location permissions",
        description: "Requires marketing.view, the marketing workspace entitlement and the selected source entitlement. Source approval is checked before and after retrieval. Reports are not persisted. No campaign modifications occur.",
        parameters: [
          { name: "location", in: "query", schema: { type: "string" } },
          { name: "selectionId", in: "query", description: "Omit to list permitted sources.", schema: { type: "string", minLength: 8, maxLength: 80 } },
          { name: "view", in: "query", schema: { type: "string", enum: ["daily", "channels", "pages", "devices", "queries", "realtime", "keywords", "campaigns", "platforms"], default: "daily" } },
          { name: "days", in: "query", schema: { type: "integer", enum: [7, 28, 90], default: 28 } },
        ],
        responses: { "200": { description: "Permitted source list or bounded source report with provenance and limitations" }, "400": { description: "Unsupported report or period" }, "401": { description: "Authentication required" }, "403": { description: "Permission or entitlement required" }, "404": { description: "Resource outside the permitted scope" }, "409": { description: "Source approval or configuration required; source changed during retrieval" }, "429": { description: "Application or provider rate limit" }, "502": { description: "Provider report unavailable" } },
      },
    },
    "/auth/signin": {
      post: { summary: "Create a Turnstile-protected, rate-limited Supabase password session", responses: { "200": { description: "Authenticated session established" }, "400": { description: "Generic invalid credentials" }, "403": { description: "Origin rejected or email not confirmed" }, "429": { description: "Rate limited" }, "503": { description: "Secure sign-in unavailable" } } },
    },
    "/auth/signup": {
      get: { summary: "Get the configured Turnstile action", responses: { "200": { description: "Public site key and action" }, "503": { description: "Secure account protection unavailable" } } },
    },
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
      post: { summary: "Import bounded, resumable R-Series sales and inventory into verified operating data", responses: { "200": { description: "Import, reconciliation and checkpoint result" }, "409": { description: "Provider authorization needs recovery" } } },
    },
    "/integrations/lightspeed-r/disconnect": {
      post: { summary: "Delete tenant R-Series credentials while retaining staged audit history", responses: { "200": { description: "Connection revoked" }, "403": { description: "Integration-management permission required" } } },
    },
    "/integrations/square/authorize": {
      post: { summary: "Begin tenant-bound Square read-only OAuth", responses: { "200": { description: "Short-lived authorization URL" }, "403": { description: "Integration-management permission required" }, "503": { description: "Square credentials not configured" } } },
    },
    "/integrations/square/callback": {
      get: { summary: "Consume single-use Square OAuth state, verify the seller and discover locations", responses: { "303": { description: "Return to the integration workspace" }, "400": { description: "Invalid or expired callback" } } },
    },
    "/integrations/square/locations": {
      get: { summary: "Discover Square seller locations and tenant mappings", responses: { "200": { description: "Location mappings" }, "409": { description: "Square is not connected" } } },
      post: { summary: "Map a Square location to a tenant-owned location", responses: { "200": { description: "Mapping saved and audited" }, "404": { description: "Square or local location not found" } } },
    },
    "/integrations/square/sync": {
      post: { summary: "Import bounded Square orders, payments, catalog, customers and inventory into staged operating data", responses: { "200": { description: "Import, reconciliation and checkpoint result" }, "409": { description: "Provider authorization or location mapping needs recovery" } } },
    },
    "/integrations/square/disconnect": {
      post: { summary: "Revoke Square access and delete encrypted tenant credentials", responses: { "200": { description: "Connection revoked" }, "403": { description: "Integration-management permission required" } } },
    },
    "/integrations/square/webhook": {
      post: { summary: "Validate a signed Square change notification and record a refresh signal", responses: { "204": { description: "Verified signal accepted" }, "401": { description: "Square signature invalid" }, "413": { description: "Payload too large" } } },
    },
    "/integrations/google/authorize": {
      post: { summary: "Begin tenant-bound Google visibility OAuth for Search Console, Analytics, Business Profile and configured Ads reporting", responses: { "200": { description: "Short-lived authorization URL" }, "403": { description: "Integration-management permission required" }, "503": { description: "Google credentials not configured" } } },
    },
    "/integrations/google/resources": {
      get: { summary: "Discover and read tenant selections for Google visibility resources", responses: { "200": { description: "Available and selected Google resources" }, "403": { description: "Marketing visibility permission required" }, "409": { description: "Google connection requires recovery" } } },
      post: { summary: "Save tenant-scoped Google resource selections and location mappings", responses: { "200": { description: "Resource selections saved and audited" }, "400": { description: "Invalid selection" }, "403": { description: "Marketing-management permission required" } } },
    },
    "/integrations/google/sync": {
      post: { summary: "Import selected Google visibility and advertising metrics into verified daily records", responses: { "200": { description: "Metric import and source lineage" }, "403": { description: "Marketing-management permission required" }, "409": { description: "Resource selection or authorization needs recovery" } } },
    },
    "/integrations/google/business-profile/reviews": {
      get: { summary: "Fetch the selected Business Profile review queue on demand without persisting review content", responses: { "200": { description: "Current Google review page" }, "403": { description: "Marketing visibility permission required" }, "409": { description: "Business Profile location selection required" } } },
      post: { summary: "Publish one human-written Business Profile reply after exact confirmation", responses: { "200": { description: "Google accepted the reply" }, "400": { description: "Invalid or unconfirmed reply" }, "403": { description: "Marketing-management permission required" }, "409": { description: "Review does not belong to the selected location" } } },
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
    "/inventory-lifecycle": {
      get: { summary: "Read tenant lot records, FEFO guidance and evidence-bound shelf-life risk", responses: { "200": { description: "Recorded lots and calculated risk" }, "401": { description: "Authentication required" }, "403": { description: "Inventory visibility required" } } },
      post: { summary: "Create or update an audited tenant inventory lot", responses: { "200": { description: "Lot updated" }, "201": { description: "Lot created" }, "400": { description: "Invalid lot record" }, "403": { description: "Inventory adjustment permission required" }, "409": { description: "Duplicate or stale lot record" } } },
    },
    "/growth": {
      get: { summary: "Calculate tenant-scoped first-touch local growth attribution from verified events", responses: { "200": { description: "Attributed channels or an explicit unavailable state" }, "403": { description: "Marketing permission required" }, "429": { description: "Rate limited" } } },
      post: { summary: "Ingest an idempotent discovery, conversion, POS, or search visibility record", responses: { "202": { description: "Verified source record accepted" }, "400": { description: "Invalid source record" }, "403": { description: "Origin or marketing management permission rejected" }, "429": { description: "Rate limited" } } },
    },
    "/bookloq": {
      get: { summary: "Get the tenant's deterministic BookLoQ accounting workspace", responses: { "200": { description: "Ledger-derived balances, statements, alerts, close status and supporting records" }, "401": { description: "Authentication required" }, "403": { description: "BookLoQ permission required" }, "429": { description: "Rate limited" } } },
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
      get: { summary: "List or download tenant documents", responses: { "200": { description: "Document list or security-cleared attachment" }, "403": { description: "Document permission required" }, "423": { description: "Original remains quarantined until an independent security scan marks it clean" } } },
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
