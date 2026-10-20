/** Browser-only transport for the loopback fixture. No production credentials. */
export function apiFetch(input: string, init: RequestInit = {}) {
  if (!input.startsWith("/api/v1/")) throw new Error("The fixture accepts only local application routes.");
  const headers = new Headers(init.headers);
  headers.set("x-preview-workspace", sessionStorage.getItem("industry-preview-workspace") || "cafe");
  return fetch(input, { ...init, headers, credentials: "omit" });
}
