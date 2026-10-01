import { ApiError } from "./api.ts";
/** Metadata only: no question, answer, attachment or token is stored here. */
export async function claimAdvisorRequest(db: D1Database, org: string, user: string, turn: unknown, digest: string, conversationId: string) {
  if(turn==null) return null; // Compatibility for already-open clients.
  if(typeof turn!=="string" || !/^[a-zA-Z0-9-]{8,80}$/.test(turn)) throw new ApiError(400,"ADVISOR_TURN_INVALID","Start a new message and try again.");
  const now=Date.now();
  await db.prepare("DELETE FROM advisor_requests WHERE organization_id=? AND user_id=? AND updated_at<?").bind(org,user,now-24*60*60_000).run();
  const result=await db.prepare("INSERT INTO advisor_requests VALUES(?,?,?,?,'running',?,?,?) ON CONFLICT(organization_id,user_id,turn_id) DO UPDATE SET state='running',updated_at=excluded.updated_at WHERE advisor_requests.request_hash=excluded.request_hash AND (advisor_requests.state='failed' OR (advisor_requests.state='running' AND advisor_requests.updated_at<?))").bind(org,user,turn,digest,conversationId,now,now,now-120_000).run();
  const row=await db.prepare("SELECT request_hash,state,conversation_id FROM advisor_requests WHERE organization_id=? AND user_id=? AND turn_id=?").bind(org,user,turn).first<{request_hash:string;state:string;conversation_id:string}>();
  if(!row || row.request_hash!==digest) throw new ApiError(409,"ADVISOR_RETRY_CHANGED","This message or its access changed. Send it as a new message.");
  if(!result.meta.changes && row.state!=="completed") throw new ApiError(409,"ADVISOR_TURN_PENDING","This reply is already being prepared. Wait a moment before retrying.");
  return {id:turn, conversationId:row.conversation_id, replay:row.state==="completed"};
}
export async function settleAdvisorRequest(db:D1Database,org:string,user:string,turn:string|null,state:"completed"|"failed") {
  if(turn) await db.prepare("UPDATE advisor_requests SET state=?,updated_at=? WHERE organization_id=? AND user_id=? AND turn_id=? AND state='running'").bind(state,Date.now(),org,user,turn).run();
}
