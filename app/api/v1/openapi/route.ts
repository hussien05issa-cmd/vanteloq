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
  },
};

export async function GET(request: Request) {
  return handleApi(request, async () => jsonResponse(specification));
}
