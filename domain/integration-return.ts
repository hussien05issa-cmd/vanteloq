import { businessContextId } from "./business-context";

/** Drop transient provider and billing parameters without losing tenant context. */
export function integrationReturnPath(pageUrl: string): string {
  const url = new URL(pageUrl);
  const workspace = businessContextId(url.searchParams.get("workspace"));
  const params = new URLSearchParams();
  if (workspace) params.set("workspace", workspace);
  return url.pathname + (params.size ? `?${params.toString()}` : "");
}
