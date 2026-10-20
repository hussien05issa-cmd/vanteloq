import { getDb } from "../db";
import { auditEvents } from "../db/schema";
import { clientSource, hashIdentifier } from "./api";

export type AuditInput = {
  request: Request;
  requestId: string;
  organizationId?: string | null;
  actorUserId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  outcome?: "success" | "failure";
  details?: Record<string, string | number | boolean | null>;
};

async function auditValues(input: AuditInput) {
  const serialized = JSON.stringify(input.details ?? {});
  if (serialized.length > 2_000) throw new Error("Audit metadata exceeds the safe limit.");

  return {
    id: crypto.randomUUID(),
    organizationId: input.organizationId ?? null,
    actorUserId: input.actorUserId ?? null,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    outcome: input.outcome ?? "success",
    requestId: input.requestId,
    sourceHash: await hashIdentifier(clientSource(input.request)),
    detailsJson: serialized,
    createdAt: new Date(),
  };
}

// Prepare before committing financial changes so a failed audit insert rolls
// back the same D1 batch instead of leaving an unaudited successful posting.
export async function prepareAudit(database: D1Database, input: AuditInput): Promise<D1PreparedStatement> {
  const value = await auditValues(input);
  return database.prepare(`INSERT INTO audit_events
    (id, organization_id, actor_user_id, action, resource_type, resource_id, outcome,
     request_id, source_hash, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(value.id, value.organizationId, value.actorUserId, value.action, value.resourceType,
      value.resourceId, value.outcome, value.requestId, value.sourceHash, value.detailsJson,
      Math.floor(value.createdAt.getTime() / 1_000));
}

export async function recordAudit(input: AuditInput): Promise<void> {
  await getDb().insert(auditEvents).values(await auditValues(input));
}

