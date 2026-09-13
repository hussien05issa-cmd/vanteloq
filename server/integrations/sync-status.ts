import { eq } from "drizzle-orm";
import { getD1, getDb, getRuntimeEnv } from "../../db";
import { integrationSyncSchedules } from "../../db/schema";
import { isScheduledPosProvider } from "./sync-policy";

export async function loadSyncSchedules(organizationId: string, canManage: boolean) {
  const schedules = await getDb().select().from(integrationSyncSchedules).where(eq(integrationSyncSchedules.organizationId, organizationId));
  const heartbeat = await getD1().prepare("SELECT MAX(created_at) AS latest FROM integration_sync_ticks").first<{ latest: number | null }>();
  const configured = (getRuntimeEnv().POS_SYNC_SECRET?.length ?? 0) >= 32;
  const healthy = Boolean(heartbeat?.latest && Date.now() / 1000 - heartbeat.latest < 300);
  return (provider: string, connectionId: string) => {
    if (!isScheduledPosProvider(provider)) return null;
    const schedule = schedules.find(row => row.connectionId === connectionId && row.provider === provider);
    return { configured, healthy, canManage, enabled: schedule?.enabled ?? false,
      status: schedule?.lastStatus ?? "off", lastErrorCode: schedule?.lastErrorCode ?? null,
      nextRunAt: schedule?.enabled ? schedule.nextRunAt.toISOString() : null,
      lastFinishedAt: schedule?.lastFinishedAt?.toISOString() ?? null,
      intervalMinutes: (schedule?.intervalSeconds ?? 900) / 60 };
  };
}
