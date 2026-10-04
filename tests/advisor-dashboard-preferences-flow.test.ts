import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";
import { Miniflare } from "miniflare";
import { GET, POST } from "../app/api/v1/preferences/route.ts";
import type { VanteloqRuntimeEnv } from "../db/index.ts";
import type { DashboardPreferences } from "../domain/dashboard-preferences.ts";
import { BUSINESS_CONTEXT_HEADER } from "../domain/business-context.ts";
import { registerSupabaseTestServer } from "./helpers/supabase-loopback-transport.mjs";

const origin = "https://vanteloq.example";
type Preferences = {
  preferenceScope: { userId: string; workspaceId: string };
  dashboardPreferences: DashboardPreferences;
  hiddenNavigation: string[];
  preferredLocationId: string | null;
};
type StoredPreferences = {
  user_id: string;
  dashboard_preferences_json: string;
  hidden_navigation_json: string;
  preferred_location_id: string | null;
  email_notifications: number;
  remembered_profile: number;
};
type Actor = { id: string; email: string };
const owner: Actor = { id: "preferences-owner", email: "preferences-owner@example.invalid" };
const colleague: Actor = { id: "preferences-colleague", email: "preferences-colleague@example.invalid" };

test("reviewed dashboard apply and Undo enforce personal scope and atomic preference comparisons", { timeout: 120_000 }, async t => {
  const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('isolated')}}", d1Databases: { DB: crypto.randomUUID() } });
  let identityRequests = 0;
  const auth = createServer((request, response) => {
    identityRequests++;
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      id: `subject:${claims.email}`, email: claims.email, email_confirmed_at: "2026-01-01T00:00:00Z", user_metadata: {},
    }));
  });
  const runtime = globalThis as typeof globalThis & { __vanteloqEnv?: VanteloqRuntimeEnv };
  const previous = runtime.__vanteloqEnv;
  await new Promise<void>(resolve => auth.listen(0, "127.0.0.1", resolve));
  try {
    const address = auth.address();
    assert.ok(address && typeof address !== "string");
    const database = await mf.getD1Database("DB") as unknown as D1Database;
    for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(file => /^\d{4}.*\.sql$/.test(file)).sort()) {
      for (const sql of (await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8")).split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) {
        await database.prepare(sql).run();
      }
    }

    // The only intercepted operation is the real preference upsert's execution.
    // Reads, authentication, normalization and the SQL statement all remain real.
    let beforePreferencesWrite: (() => Promise<unknown>) | undefined;
    let interceptedWrites = 0;
    function wrapStatement(statement: D1PreparedStatement, sql: string): D1PreparedStatement {
      return new Proxy(statement, {
        get(target, key) {
          if (key === "bind") return (...values: unknown[]) => wrapStatement(target.bind(...values), sql);
          if (["all", "raw", "run", "first"].includes(String(key))) return async (...args: unknown[]) => {
            if (beforePreferencesWrite && /^\s*insert\s+into\s+["`]?account_preferences\b/i.test(sql)) {
              const concurrentWrite = beforePreferencesWrite;
              beforePreferencesWrite = undefined;
              interceptedWrites++;
              await concurrentWrite();
            }
            const method = Reflect.get(target, key) as (...values: unknown[]) => Promise<unknown>;
            return method.apply(target, args);
          };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    }
    const wrappedDatabase = new Proxy(database, {
      get(target, key) {
        if (key === "prepare") return (sql: string) => wrapStatement(target.prepare(sql), sql);
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    runtime.__vanteloqEnv = {
      DB: wrappedDatabase, SUPABASE_URL: registerSupabaseTestServer(address.port), SUPABASE_PUBLISHABLE_KEY: "fictional-preferences-fixture",
    };
    const now = Math.floor(Date.now() / 1000);
    for (const actor of [owner, colleague]) {
      await database.prepare("INSERT INTO users(id,email,display_name,auth_subject,auth_provider,created_at,updated_at) VALUES(?,?,? ,?,'supabase',?,?)")
        .bind(actor.id, actor.email, actor.id, `subject:${actor.email}`, now, now).run();
    }
    for (const workspace of ["workspace-a", "workspace-b"]) {
      await database.prepare("INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,created_at,updated_at) VALUES(?,'Fixture owner','Fixture workspace','Fixture workspace','fixture@example.invalid','Retail','Edmonton','Fixture','T5A1A1','[]',?,?)")
        .bind(workspace, now, now).run();
      if (workspace === "workspace-a") await database.prepare("INSERT INTO memberships(id,user_id,organization_id,role,status,created_at,updated_at) VALUES(?,?,?,'owner','active',?,?)")
        .bind(`owner-${workspace}`, owner.id, workspace, now, now).run();
      await database.prepare("INSERT INTO tenant_subscriptions(organization_id,base_plan,billing_interval,status,cancel_at_period_end,version,created_at,updated_at) VALUES(?,'pro','month','active',0,1,?,?)")
        .bind(workspace, now, now).run();
      await database.prepare("INSERT INTO organization_locations(id,organization_id,name,country_code,address_line_1,locality,administrative_area,timezone,currency,created_at,updated_at) VALUES(?,?,'Primary','CA','Fixture','Edmonton','AB','America/Edmonton','CAD',?,?)")
        .bind(`location-${workspace}`, workspace, now, now).run();
    }
    await database.prepare("INSERT INTO memberships(id,user_id,organization_id,role,status,created_at,updated_at) VALUES('colleague-member',?,'workspace-a','admin','active',?,?)")
      .bind(colleague.id, now, now).run();

    function request(actor = owner, workspace = "workspace-a", body?: unknown) {
      const payload = Buffer.from(JSON.stringify({ email: actor.email, aal: "aal2", session_id: `preferences:${actor.id}` })).toString("base64url");
      return new Request(`${origin}/api/v1/preferences`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          authorization: `Bearer test.${payload}.signature`, accept: "application/json", [BUSINESS_CONTEXT_HEADER]: workspace,
          ...(body === undefined ? {} : { "content-type": "application/json", origin, "sec-fetch-site": "same-origin" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    }
    async function responseBody(response: Response, status = 200) {
      assert.equal(response.status, status, await response.clone().text());
      return response.json();
    }
    const read = async (actor = owner, workspace = "workspace-a") => await responseBody(await GET(request(actor, workspace))) as Preferences;
    const write = (body: unknown, actor = owner, workspace = "workspace-a") => POST(request(actor, workspace, body));
    const stored = (actor = owner) => database.prepare("SELECT user_id,dashboard_preferences_json,hidden_navigation_json,preferred_location_id,email_notifications,remembered_profile FROM account_preferences WHERE user_id=?")
      .bind(actor.id).first<StoredPreferences>();
    const reviewed = (before: Preferences, after: DashboardPreferences) => ({
      dashboardPreferences: after, expectedDashboardPreferences: before.dashboardPreferences, expectedPreferenceScope: before.preferenceScope,
    });

    await t.test("GET exposes the authenticated scope and reviewed first save works", async () => {
      const initial = await read();
      assert.deepEqual(initial.preferenceScope, { userId: owner.id, workspaceId: "workspace-a" });
      assert.equal(await stored(), null);
      const result = await responseBody(await write(reviewed(initial, { ...initial.dashboardPreferences, chart: "bar" })));
      assert.equal(result.dashboardPreferences.chart, "bar");
      assert.equal(JSON.parse((await stored())!.dashboard_preferences_json).workspaceId, "workspace-a");
      assert.ok(identityRequests >= 2, "GET and POST must pass through the Supabase identity endpoint");
    });

    await t.test("apply and Undo preserve BookLoQ collections, current navigation and personal settings", async () => {
      await responseBody(await write({
        collectionsPreferences: { horizon: 7, density: "compact", widgets: [{ id: "aging", visible: false }] },
        hiddenNavigation: ["Inventory"], preferredLocationId: "location-workspace-a",
      }));
      await database.prepare("UPDATE account_preferences SET email_notifications=0,remembered_profile=0 WHERE user_id=?").bind(owner.id).run();
      const before = await read();
      const after = { ...before.dashboardPreferences, chart: "line" as const, defaultPeriod: "7d" as const };
      const applied = await responseBody(await write(reviewed(before, after))) as Preferences;
      assert.equal(applied.dashboardPreferences.chart, "line");
      assert.equal(applied.dashboardPreferences.defaultPeriod, "7d");
      assert.deepEqual(applied.dashboardPreferences.collections, before.dashboardPreferences.collections);
      assert.deepEqual(applied.hiddenNavigation, ["Inventory"]);
      assert.equal(applied.preferredLocationId, "location-workspace-a");

      // A later navigation-only save does not invalidate or get overwritten by Undo.
      await responseBody(await write({ hiddenNavigation: ["Customers", "Marketing"], preferredLocationId: null }));
      const undone = await responseBody(await write(reviewed(applied, before.dashboardPreferences))) as Preferences;
      assert.deepEqual(undone.dashboardPreferences, before.dashboardPreferences);
      assert.deepEqual(undone.hiddenNavigation, ["Customers", "Marketing"]);
      assert.equal(undone.preferredLocationId, null);
      const row = (await stored())!;
      assert.equal(row.email_notifications, 0);
      assert.equal(row.remembered_profile, 0);
    });

    await t.test("stale layout or BookLoQ review returns 409 without changing saved preferences", async () => {
      for (const change of [{ dashboardPreferences: { ...(await read()).dashboardPreferences, defaultPeriod: "90d" } }, { collectionsPreferences: { horizon: 90, density: "comfortable" } }]) {
        const before = await read();
        await responseBody(await write(change));
        const concurrent = await stored();
        const rejected = await responseBody(await write(reviewed(before, { ...before.dashboardPreferences, chart: "line" })), 409);
        assert.equal(rejected.error.code, "DASHBOARD_REVIEW_CHANGED");
        assert.deepEqual(await stored(), concurrent);
      }
    });

    await t.test("foreign actor and workspace scopes cannot reuse another review", async () => {
      const own = await read();
      const otherActor = await read(colleague);
      const original = await stored();
      for (const [actor, workspace, before, wrongScope] of [
        [colleague, "workspace-a", otherActor, own.preferenceScope],
        [owner, "workspace-a", own, { ...own.preferenceScope, workspaceId: "workspace-b" }],
        [owner, "workspace-a", own, otherActor.preferenceScope],
      ] as const) {
        const rejected = await responseBody(await write({ ...reviewed(before, { ...before.dashboardPreferences, chart: "bar" }), expectedPreferenceScope: wrongScope }, actor, workspace), 409);
        assert.equal(rejected.error.code, "DASHBOARD_REVIEW_CHANGED");
      }
      const missingScope = reviewed(own, { ...own.dashboardPreferences, chart: "bar" });
      const rejected = await responseBody(await write({ ...missingScope, expectedPreferenceScope: null }), 409);
      assert.equal(rejected.error.code, "DASHBOARD_REVIEW_CHANGED");
      assert.deepEqual(await stored(), original);
      assert.equal(await stored(colleague), null);
      // Move this disposable actor's membership to simulate a workspace switch.
      // The live schema permits one membership per user, so no invalid rows are needed.
      await database.prepare("UPDATE memberships SET organization_id='workspace-b' WHERE user_id=?").bind(owner.id).run();
      try {
        const switched = await read(owner, "workspace-b");
        const rejected = await responseBody(await write({
          ...reviewed(switched, { ...switched.dashboardPreferences, chart: "bar" }), expectedPreferenceScope: own.preferenceScope,
        }, owner, "workspace-b"), 409);
        assert.equal(rejected.error.code, "DASHBOARD_REVIEW_CHANGED");
        assert.deepEqual(await stored(), original);
      } finally {
        await database.prepare("UPDATE memberships SET organization_id='workspace-a' WHERE user_id=?").bind(owner.id).run();
      }
    });

    await t.test("execution-time JSON change defeats an already-validated reviewed upsert atomically", async () => {
      const before = await read();
      const original = (await stored())!;
      const concurrentDashboard = { ...before.dashboardPreferences, chart: before.dashboardPreferences.chart === "bar" ? "line" : "bar" };
      const concurrentRaw = JSON.stringify({ workspaceId: "workspace-a", dashboard: concurrentDashboard });
      beforePreferencesWrite = () => database.prepare("UPDATE account_preferences SET dashboard_preferences_json=? WHERE user_id=?").bind(concurrentRaw, owner.id).run();
      const rejected = await responseBody(await write({
        ...reviewed(before, { ...before.dashboardPreferences, defaultPeriod: "today" }),
        hiddenNavigation: ["Suppliers"], preferredLocationId: "location-workspace-a",
      }), 409);
      assert.equal(rejected.error.code, "DASHBOARD_REVIEW_CHANGED");
      assert.equal(interceptedWrites, 1, "The concurrent write must happen at upsert execution, after the API read and review check");
      const actual = (await stored())!;
      assert.equal(actual.dashboard_preferences_json, concurrentRaw);
      assert.equal(actual.hidden_navigation_json, original.hidden_navigation_json);
      assert.equal(actual.preferred_location_id, original.preferred_location_id);
      assert.equal((await read()).dashboardPreferences.chart, concurrentDashboard.chart);
    });

    await t.test("a concurrently created first preference row is not replaced by a reviewed insert", async () => {
      const before = await read(colleague);
      assert.equal(await stored(colleague), null);
      const concurrentRaw = JSON.stringify({ workspaceId: "workspace-a", dashboard: { ...before.dashboardPreferences, chart: "bar" } });
      beforePreferencesWrite = () => database.prepare("INSERT INTO account_preferences(user_id,dashboard_preferences_json,hidden_navigation_json,email_notifications,remembered_profile,created_at,updated_at) VALUES(?,?,'[\"Suppliers\"]',0,0,?,?)")
        .bind(colleague.id, concurrentRaw, now, now).run();
      const rejected = await responseBody(await write(reviewed(before, { ...before.dashboardPreferences, defaultPeriod: "today" }), colleague), 409);
      assert.equal(rejected.error.code, "DASHBOARD_REVIEW_CHANGED");
      assert.equal(interceptedWrites, 2);
      const actual = (await stored(colleague))!;
      assert.equal(actual.dashboard_preferences_json, concurrentRaw);
      assert.deepEqual(JSON.parse(actual.hidden_navigation_json), ["Suppliers"]);
      assert.equal(actual.email_notifications, 0);
    });
  } finally {
    runtime.__vanteloqEnv = previous;
    await mf.dispose();
    auth.closeAllConnections();
    await new Promise<void>((resolve, reject) => auth.close(error => error ? reject(error) : resolve()));
  }
});
