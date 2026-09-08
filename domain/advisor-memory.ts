/** Historical replies may contain data from permissions or sources that have since changed. */
export async function advisorEvidenceFingerprint(evidence: unknown, permissions: readonly string[], locationRefs: readonly string[] | null) {
  const content = JSON.stringify({ evidence, permissions: [...permissions].sort(), locationRefs: locationRefs === null ? null : [...locationRefs].sort() });
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function permittedAdvisorMemory(rows: Array<{ role: string; content: string; evidence_json: string }>, fingerprint: string) {
  return rows.filter((row) => {
    if (!["user", "assistant"].includes(row.role)) return false;
    try { return JSON.parse(row.evidence_json)?.accessFingerprint === fingerprint; }
    catch { return false; }
  }).map(({ role, content }) => ({ role, content })).slice(0, 6).reverse();
}
