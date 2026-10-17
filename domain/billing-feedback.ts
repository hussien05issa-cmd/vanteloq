export function billingRequestMessage(reason: unknown, purpose: "status" | "portal" | "checkout") {
  const interrupted = reason instanceof Error && ["TimeoutError", "AbortError"].includes(reason.name);
  if (interrupted) {
    if (purpose === "status") return "Billing status took too long to load. Try again.";
    if (purpose === "portal") return "The billing page did not open in time. Try again to open Stripe and check your subscription. This request did not confirm a subscription change.";
    return "Checkout did not open in time. Check your subscription status before trying again.";
  }
  if (reason instanceof TypeError) return "Billing could not connect. Check your connection and try again.";
  return reason instanceof Error ? reason.message : purpose === "status" ? "Billing status could not be loaded. Try again." : "Stripe billing could not be opened. Try again.";
}
