/** A request captures its business before authentication or other asynchronous work.
 * This identifies a requested scope; only the server can authorize membership. */
export const BUSINESS_CONTEXT_HEADER = "X-Vanteloq-Workspace";
export function businessContextId(value: string | null): string | null {
  if (value === null) return null;
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw new Error("Choose a valid business workspace.");
  return value;
}
export function requestedBusinessContext(request: Request): string | null {
  const header = businessContextId(request.headers.get(BUSINESS_CONTEXT_HEADER));
  const query = businessContextId(new URL(request.url).searchParams.get("workspace"));
  if (header && query && header !== query) throw new Error("The requested business does not match this page. Reopen the business before continuing.");
  return header ?? query;
}
export function businessContextHeaders(headers: HeadersInit | undefined, pageUrl: string): Headers {
  const result = new Headers(headers);
  const workspace = businessContextId(new URL(pageUrl).searchParams.get("workspace"));
  const explicit = businessContextId(result.get(BUSINESS_CONTEXT_HEADER));
  if (workspace && explicit && workspace !== explicit) throw new Error("This request belongs to a different business.");
  if (workspace) result.set(BUSINESS_CONTEXT_HEADER, workspace);
  return result;
}
