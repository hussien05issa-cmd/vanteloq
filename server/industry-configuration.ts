import { getD1 } from "../db";
import { defaultIndustryConfiguration, validateIndustryConfiguration, type IndustryConfiguration } from "../domain/industry-templates";
import type { AccessContext } from "./authorization";

export async function getWorkspaceIndustry(context: AccessContext) {
  const row = await getD1().prepare("SELECT config_json config, revision, updated_at updatedAt FROM workspace_industry_config WHERE organization_id=?").bind(context.organizationId).first<{ config: string; revision: number; updatedAt: number }>();
  // Existing businesses retain their label and records until an administrator reviews a change.
  if (!row) return { configuration: defaultIndustryConfiguration(context.organization.industry), revision: 0, updatedAt: null as number | null };
  return { configuration: validateIndustryConfiguration(JSON.parse(row.config)), revision: row.revision, updatedAt: row.updatedAt };
}
export function initialIndustryStatement(organizationId: string, userId: string, configuration: IndustryConfiguration, label: string, now: number) {
  return getD1().prepare("INSERT OR IGNORE INTO workspace_industry_config(organization_id,industry_label,config_json,revision,updated_by,updated_at) VALUES(?,?,?,1,?,?)").bind(organizationId,label,JSON.stringify(configuration),userId,now);
}
