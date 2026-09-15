import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { requireActiveWorkspaceSession, sessionLeaseId } from "../server/session-policy";
import { SESSION_IDLE_MS, SESSION_MAX_MS, sessionRemaining } from "../shared/session-policy";
import type { AccessContext } from "../server/authorization";

test("client session clock handles exact idle expiry, absolute expiry and time spent asleep", () => {
  assert.equal(sessionRemaining(SESSION_IDLE_MS - 1, 0, SESSION_MAX_MS), 1);
  assert.equal(sessionRemaining(SESSION_IDLE_MS, 0, SESSION_MAX_MS), 0);
  assert.equal(sessionRemaining(SESSION_MAX_MS, SESSION_MAX_MS - 1000, SESSION_MAX_MS), 0);
  assert.equal(sessionRemaining(SESSION_MAX_MS * 2, 0, SESSION_MAX_MS), 0);
});

test("server leases enforce idle, absolute, logout and concurrent expiry boundaries", async () => {
  const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('ok')}}", d1Databases: { DB: crypto.randomUUID() } });
  const db = await mf.getD1Database("DB");
  const runtime = globalThis as typeof globalThis & { __vanteloqEnv?: unknown };
  const previous = runtime.__vanteloqEnv;
  try {
    await db.exec("CREATE TABLE users (id TEXT PRIMARY KEY); CREATE TABLE workspaces (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('qa-user'); INSERT INTO workspaces VALUES ('qa-org'); INSERT INTO workspaces VALUES ('qa-other');");
    const migration = await readFile(new URL("../drizzle/0049_even_toxin.sql", import.meta.url), "utf8");
    for (const sql of migration.split("--> statement-breakpoint").filter(s => s.trim())) await db.prepare(sql).run();
    runtime.__vanteloqEnv = { DB: db };
    const context = { userId: "qa-user", organizationId: "qa-org", identity: { subject: "qa-subject", sessionId: "qa-session" } } as AccessContext;
    const start = 1_800_000_000_000;
    const first = await requireActiveWorkspaceSession(context, start);
    assert.equal(first.expiresAt, start + SESSION_MAX_MS);
    const unattended = { ...context, identity: { ...context.identity, sessionId: "unattended" } };
    await requireActiveWorkspaceSession(unattended, start);
    await requireActiveWorkspaceSession(unattended, start + 20 * 60_000);
    await requireActiveWorkspaceSession(unattended, start + 28 * 60_000);
    await assert.rejects(requireActiveWorkspaceSession(unattended, start + SESSION_IDLE_MS), { code: "SESSION_EXPIRED" });
    const poll = await requireActiveWorkspaceSession(context, start + SESSION_IDLE_MS - 1000);
    assert.equal(poll.lastSeenAt, start, "background reads cannot extend the idle deadline");
    const prior = await requireActiveWorkspaceSession(context, start + SESSION_IDLE_MS - 1, true);
    assert.equal(prior.expiresAt, first.expiresAt, "refresh cannot reset the absolute limit");
    const expiredAt = prior.lastSeenAt + SESSION_IDLE_MS;
    const concurrent = await Promise.allSettled([requireActiveWorkspaceSession(context, expiredAt), requireActiveWorkspaceSession(context, expiredAt + 1)]);
    assert.ok(concurrent.every(r => r.status === "rejected" && r.reason.code === "SESSION_EXPIRED"));
    assert.equal((await db.prepare("SELECT last_seen_at n FROM workspace_sessions WHERE id=?").bind(await sessionLeaseId(context)).first<{n:number}>())!.n, prior.lastSeenAt);
    const fresh = { ...context, identity: { ...context.identity, sessionId: "new-signin" } };
    await requireActiveWorkspaceSession(fresh, start);
    for (let offset = 20 * 60_000; offset < SESSION_MAX_MS; offset += 20 * 60_000) await requireActiveWorkspaceSession(fresh, start + offset, true);
    await assert.rejects(requireActiveWorkspaceSession(fresh, start + SESSION_MAX_MS), { code: "SESSION_EXPIRED" });
    const logout = { ...context, identity: { ...context.identity, sessionId: "logout" } };
    await requireActiveWorkspaceSession(logout, start);
    await db.prepare("UPDATE workspace_sessions SET revoked=1 WHERE id=?").bind(await sessionLeaseId(logout)).run();
    await assert.rejects(requireActiveWorkspaceSession(logout, start + 1), { code: "SESSION_EXPIRED" });
    assert.notEqual(await sessionLeaseId(context), await sessionLeaseId({ ...context, organizationId: "qa-other" }));
    await assert.rejects(requireActiveWorkspaceSession({ ...context, identity: { ...context.identity, sessionId: null } }, start), { code: "SESSION_EXPIRED" });
    await db.prepare("DELETE FROM users WHERE id='qa-user'").run();
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM workspace_sessions").first<{n:number}>())!.n, 0, "account deletion removes lease records");
  } finally { runtime.__vanteloqEnv = previous; await mf.dispose(); }
});
