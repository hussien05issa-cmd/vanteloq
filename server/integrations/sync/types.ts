import type { AccessContext } from "../../authorization";

export type SyncContext = Pick<AccessContext, "organizationId" | "userId" | "organization">;
export type SyncTrigger = "manual" | "scheduled";
