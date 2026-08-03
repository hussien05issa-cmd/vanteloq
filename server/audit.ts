import { getDb } from "../db";
import { auditEvents } from "../db/schema";
import { clientSource, hashIdentifier } from "./api";

type AuditInput = {
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

export async function recordAudit(input: AuditInput): Promise<void> {
  const serialized = JSON.stringify(input.details ?? {});
  if (serialized.length > 2_000) throw new Error("Audit metadata exceeds the safe limit.");

  await getDb().insert(auditEvents).values({
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
  });
}

