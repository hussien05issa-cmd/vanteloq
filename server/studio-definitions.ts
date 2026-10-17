import { getD1 } from "../db";
import { businessClock } from "../domain/intraday-sales";
import { StudioValidationError } from "../domain/data-studio";
import type { StudioScope } from "../domain/data-studio";
import { STUDIO_DEFINITION_LIMIT, validateStudioDefinitionWrite, type StudioDefinition, type StudioDefinitionDeleteInput, type StudioDefinitionWriteInput } from "../domain/studio-definitions";
import { ApiError } from "./api";
import { recordAudit } from "./audit";
import { revalidateStudioPolicy, studioPolicy, type StudioPolicy } from "./data-studio";

type StoredDefinition = { id: string; title: string; app: string; scope_json: string; content_json: string; version: number; updated_at: number };
const actorSql = "WITH studio_actor(organization_id,user_id) AS (SELECT ?,?)";
// This receipt is ephemeral authorization metadata, never saved definition data.
// Comparing it inside the mutation closes revocation between a policy read and
// the committing batch, including changes that do not advance updated_at.
const authoritySql = `(SELECT json_object(
  'user',(SELECT json_array(status,auth_subject,auth_provider) FROM users WHERE id=a.user_id),
  'membership',(SELECT json_group_array(json_array(id,role,status)) FROM memberships WHERE organization_id=a.organization_id AND user_id=a.user_id),
  'team',(SELECT json_group_array(json_array(t.id,t.status,t.role_id,t.remote_login,t.permitted_locations_json,r.permissions_json,r.system_key,r.location_scope_json)) FROM team_members t LEFT JOIN access_roles r ON r.id=t.role_id AND r.organization_id=t.organization_id WHERE t.organization_id=a.organization_id AND t.user_id=a.user_id),
  'workspace',(SELECT json_array(timezone,currency,setup_complete) FROM workspaces WHERE id=a.organization_id),
  'locations',(SELECT json_group_array(json_array(id,status,currency,timezone)) FROM organization_locations WHERE organization_id=a.organization_id),
  'sources',(SELECT json_group_array(json_array(id,status,data_promotion_status,source_namespace,sync_lease_owner,sync_lease_expires_at,last_successful_sync_at)) FROM integration_connections WHERE organization_id=a.organization_id),
  'mappings',(SELECT json_group_array(json_array(id,connection_id,local_location_id,status,external_location_ref)) FROM integration_location_mappings WHERE organization_id=a.organization_id),
  'selections',(SELECT json_group_array(json_array(id,connection_id,local_location_id,fact_family,channel,version)) FROM integration_source_authorities WHERE organization_id=a.organization_id),
  'subscription',(SELECT json_array(base_plan,status,trial_ends_at,trial_access_ends_at,current_period_ends_at,version) FROM tenant_subscriptions WHERE organization_id=a.organization_id),
  'addons',(SELECT json_group_array(json_array(id,addon_key,status,current_period_ends_at,scheduled_removal_at)) FROM tenant_addons WHERE organization_id=a.organization_id),
  'internal',(SELECT json_group_array(json_array(id,active,access_level,mfa_required)) FROM internal_access WHERE organization_id=a.organization_id AND user_id=a.user_id),
  'complimentary',(SELECT json_group_array(json_array(grant_id,active)) FROM complimentary_access WHERE organization_id=a.organization_id AND user_id=a.user_id),
  'free',(SELECT policy_version FROM free_plan_enrollments WHERE organization_id=a.organization_id),
  'sessions',(SELECT json_group_array(json_array(id,revoked,expires_at)) FROM workspace_sessions WHERE organization_id=a.organization_id AND user_id=a.user_id),
  'deleting',(SELECT COUNT(*) FROM account_deletion_jobs WHERE stage IN ('confirmed','local_deleted') AND (user_id=a.user_id OR (scope='workspace' AND organization_id=a.organization_id)))
) FROM studio_actor a)`;
const mutationAuthoritySql = `(${actorSql} SELECT ${authoritySql})`;

function conflict(): never { throw new ApiError(409, "STUDIO_DEFINITION_CONFLICT", "This saved analysis changed in another tab or is no longer available. Keep your draft, then reload the saved version before trying again."); }
function clockDate(policy: StudioPolicy) {
  const clock = businessClock(new Date(), policy.context.organization.timezone);
  if (!clock) throw new ApiError(409, "STUDIO_SETTINGS_REVIEW", "Review the business time zone before saving an analysis.");
  return clock.date;
}
function definition(row: StoredDefinition, today: string): StudioDefinition {
  const draft = validateStudioDefinitionWrite({ title: row.title, app: row.app, scope: JSON.parse(row.scope_json), content: JSON.parse(row.content_json) }, today);
  return { ...draft, id: row.id, version: row.version, updatedAt: new Date(row.updated_at).toISOString() };
}

export async function listStudioDefinitions(request: Request, base: StudioPolicy, app: string | null): Promise<StudioDefinition[]> {
  const db = getD1(), { context } = base;
  const [result] = await db.batch([db.prepare(`SELECT id,title,app,scope_json,content_json,version,updated_at FROM studio_definitions WHERE organization_id=? AND user_id=? ${app ? "AND app=?" : ""} ORDER BY updated_at DESC,id LIMIT ?`)
    .bind(context.organizationId, context.userId, ...(app ? [app] : []), STUDIO_DEFINITION_LIMIT)]);
  const analyses: StudioDefinition[] = [], policies = new Map<string, { scope: StudioScope; policy: StudioPolicy }>();
  for (const row of result.results as StoredDefinition[]) {
    try {
      // Dates are validated independently for every definition. Reporting
      // authority depends on location and connection, so reuse that check for
      // different saved periods with the same authority within this request.
      const value = definition(row, clockDate(base)), key = JSON.stringify([value.scope.location, value.scope.connection]);
      const policy = policies.get(key)?.policy ?? await studioPolicy(request, value.scope, false);
      if (policy.context.organizationId !== context.organizationId || policy.context.userId !== context.userId) throw new ApiError(409, "STUDIO_SCOPE_CHANGED", "Your business context changed. Refresh the saved analyses.");
      if (!policies.has(key)) policies.set(key, { scope: value.scope, policy });
      analyses.push(value);
    } catch (error) {
      // A saved definition never confers access. Hide a now-inaccessible scope
      // while retaining the owner's draft in case access is restored.
      if (error instanceof StudioValidationError || (error instanceof ApiError && ["LOCATION_ACCESS_DENIED", "STUDIO_SOURCE_UNAVAILABLE"].includes(error.code))) continue;
      throw error;
    }
  }
  await revalidateStudioPolicy(request, { from: clockDate(base), to: clockDate(base), location: null, connection: null }, false, base.fingerprint);
  for (const { scope, policy } of policies.values()) await revalidateStudioPolicy(request, scope, false, policy.fingerprint);
  return analyses;
}

async function writeReceipt(request: Request, policy: StudioPolicy, input: StudioDefinitionWriteInput | StudioDefinition) {
  if (policy.context.role === "read_only" || policy.context.role === "integration") throw new ApiError(403, "INSUFFICIENT_PERMISSION", "Your role can view saved analyses but cannot change them.");
  const receipt = await getD1().prepare(`${actorSql} SELECT ${authoritySql} receipt`).bind(policy.context.organizationId, policy.context.userId).first<{ receipt: string }>();
  if (!receipt) throw new ApiError(409, "STUDIO_SCOPE_CHANGED", "Your reporting access changed. Your draft can be kept.");
  await revalidateStudioPolicy(request, input.scope, false, policy.fingerprint);
  return receipt.receipt;
}

export async function saveStudioDefinition(request: Request, requestId: string, policy: StudioPolicy, input: StudioDefinitionWriteInput): Promise<StudioDefinition> {
  const db = getD1(), { context } = policy, receipt = await writeReceipt(request, policy, input);
  const id = input.id ?? crypto.randomUUID(), now = Date.now();
  const values = [input.title, input.app, JSON.stringify(input.scope), JSON.stringify(input.content)];
  const statement = input.id
    ? db.prepare(`UPDATE studio_definitions SET title=?,app=?,scope_json=?,content_json=?,version=CASE WHEN ${mutationAuthoritySql}=? THEN version+1 ELSE 0 END,updated_at=? WHERE id=? AND organization_id=? AND user_id=? AND version=?`)
      .bind(...values, context.organizationId, context.userId, receipt, now, id, context.organizationId, context.userId, input.expectedVersion)
    : db.prepare(`INSERT INTO studio_definitions(id,organization_id,user_id,title,app,scope_json,content_json,version,created_at,updated_at) SELECT ?,?,?,?,?,?,?,CASE WHEN ${mutationAuthoritySql}=? THEN 1 ELSE 0 END,?,? WHERE (SELECT COUNT(*) FROM studio_definitions WHERE organization_id=? AND user_id=?)<?`)
      .bind(id, context.organizationId, context.userId, ...values, context.organizationId, context.userId, receipt, now, now, context.organizationId, context.userId, STUDIO_DEFINITION_LIMIT);
  let changes: number;
  try { const [result] = await db.batch([statement]); changes = Number(result.meta.changes); }
  catch (error) {
    if (/studio_definition_version_check/.test(String(error))) throw new ApiError(409, "STUDIO_SCOPE_CHANGED", "Your reporting access changed before the save completed. Keep your draft and refresh your access.");
    throw error;
  }
  if (!changes) {
    if (input.id) conflict();
    throw new ApiError(409, "STUDIO_DEFINITION_LIMIT", `Keep at most ${STUDIO_DEFINITION_LIMIT} private saved analyses. Delete one before saving another; your draft can be kept.`);
  }
  const version = input.id ? input.expectedVersion! + 1 : 1;
  await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: input.id ? "data_studio.definition_updated" : "data_studio.definition_created", resourceType: "studio_definition", resourceId: id, details: { app: input.app, version, pinned: input.content.pinned ?? false } });
  await revalidateStudioPolicy(request, input.scope, false, policy.fingerprint);
  return { id, title: input.title, app: input.app, scope: input.scope, content: input.content, version, updatedAt: new Date(now).toISOString() };
}

export async function deleteStudioDefinition(request: Request, requestId: string, base: StudioPolicy, input: StudioDefinitionDeleteInput): Promise<void> {
  const db = getD1(), { context } = base;
  const row = await db.prepare("SELECT id,title,app,scope_json,content_json,version,updated_at FROM studio_definitions WHERE id=? AND organization_id=? AND user_id=?").bind(input.id, context.organizationId, context.userId).first<StoredDefinition>();
  if (!row) conflict();
  const value = definition(row, clockDate(base)), policy = await studioPolicy(request, value.scope, false);
  const receipt = await writeReceipt(request, policy, value);
  const [result] = await db.batch([db.prepare(`DELETE FROM studio_definitions WHERE id=? AND organization_id=? AND user_id=? AND version=? AND ${mutationAuthoritySql}=?`)
    .bind(input.id, context.organizationId, context.userId, input.expectedVersion, context.organizationId, context.userId, receipt)]);
  if (!result.meta.changes) { await revalidateStudioPolicy(request, value.scope, false, policy.fingerprint); conflict(); }
  await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "data_studio.definition_deleted", resourceType: "studio_definition", resourceId: input.id, details: { app: value.app, version: input.expectedVersion } });
}
