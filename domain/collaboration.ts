export type CollaborationScope = { organizationWide: boolean; locationIds: readonly string[] | null };
/** A latest page beyond the last server-read message leaves an unobserved gap.
 * Locally sent messages cannot establish that the intervening history was read. */
export function messageLatestPageNeedsReset(newestReadId: number | null, incoming: readonly { id: number }[], hasEarlier: boolean) {
  return hasEarlier && newestReadId !== null && incoming.length > 0 && incoming[0].id > newestReadId;
}
/** A complete latest page replaces cached history, including deleted messages. */
export function reconcileMessagePage<T extends { id: number }>(current: readonly T[], incoming: readonly T[], earlier: boolean, hasEarlier: boolean, reset = false): T[] {
  if (!earlier && (!incoming.length || !hasEarlier || reset)) return [...incoming];
  const retained = earlier ? current : current.filter(item => item.id < incoming[0].id);
  const rows = new Map(retained.map(item => [item.id, item]));
  for (const item of incoming) rows.set(item.id, item);
  return [...rows.values()].sort((a, b) => a.id - b.id);
}

export function taskArchiveCursor(value: string | null): number | null {
  if (value === null) return null;
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("Choose a valid task archive page.");
  return Number(value);
}
export function taskInCollaborationScope(task: { locationId: string | null }, scope: CollaborationScope) {
  return task.locationId === null ? scope.organizationWide : scope.locationIds === null || scope.locationIds.includes(task.locationId);
}
export function collaborationMessageInput(value: Record<string, unknown>) {
  if (Object.keys(value).some(key => !["body", "locationId", "taskId"].includes(key))) throw new Error("Choose a valid message field.");
  if (typeof value.body !== "string" || !value.body.trim() || value.body.trim().length > 4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value.body)) throw new Error("Write a message of 1 to 4,000 characters.");
  const locationId = value.locationId == null || value.locationId === "" ? null : value.locationId;
  if (locationId !== null && (typeof locationId !== "string" || locationId.length > 200)) throw new Error("Choose a valid team channel.");
  const taskId = value.taskId == null ? null : value.taskId;
  if (taskId !== null && (!Number.isSafeInteger(taskId) || Number(taskId) <= 0)) throw new Error("Choose a valid task discussion.");
  return { body: value.body.trim(), locationId: locationId as string | null, taskId: taskId as number | null };
}
export function validCollaborationDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
