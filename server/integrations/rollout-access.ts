import type { AccessContext } from "../authorization";
import { ApiError } from "../api";
import { getInternalAccessGrant } from "../internal-access";
import { PREVIEW_INTEGRATION_IDS } from "../../domain/integration-availability";
import { plaidReadiness } from "./plaid";

export async function requireIntegrationRollout(context: AccessContext, provider: string) {
  const preview = PREVIEW_INTEGRATION_IDS.includes(provider)
    || (provider === "plaid" && !plaidReadiness().liveDataEligible);
  if (preview && !await getInternalAccessGrant(context)) {
    throw new ApiError(403, "INTEGRATION_COMING_SOON", "This integration is coming soon. Your existing records remain available.");
  }
}
