import { ApiError } from "../api";
import type { SyncContext } from "./sync/types";
import type { ScheduledPosProvider } from "./sync-policy";

export async function dispatchScheduledSync(provider: ScheduledPosProvider, connectionId: string, request: Request, requestId: string, context: SyncContext) {
  const input = { connectionId, reason: "manual" };
  switch (provider) {
    case "lightspeed-r": return (await import("./sync/lightspeed-r")).runSync(request, requestId, context, input, "scheduled");
    case "lightspeed": return (await import("./sync/lightspeed")).runSync(request, requestId, context, input, "scheduled");
    case "square": return (await import("./sync/square")).runSync(request, requestId, context, input, "scheduled");
    case "clover": return (await import("./sync/clover")).runSync(request, requestId, context, input, "scheduled");
    case "shopify": case "shopify-pos": return (await import("./sync/shopify-pos")).runSync(request, requestId, context, input, "scheduled", provider);
    case "moneris": return (await import("./sync/moneris")).runSync(request, requestId, context, input, "scheduled");
    case "stripe": return (await import("./sync/stripe")).runSync(request, requestId, context, input, "scheduled");
    default: throw new ApiError(400, "SYNC_PROVIDER_UNSUPPORTED", "This provider does not support automatic sync.");
  }
}

