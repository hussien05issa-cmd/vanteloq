import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";
import { createEnvironment, createReportWorkspace, dispatch, seedReportLocation, origin, context } from "./helpers/retail-worker-fixture.mjs";

test("Google and Meta account management rechecks organization-wide location access", { timeout: 120_000 }, async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  try {
    const account = await createReportWorkspace(worker, environment, database, "marketing-scope");
    const secondLocation = await seedReportLocation(database, account.organizationId, "Second store");
    const roleId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const permissions = ["integrations.manage", "integrations.view", "marketing.manage", "marketing.view"];
    await database.batch([
      database.prepare("INSERT INTO access_roles (id,organization_id,name,description,color,permissions_json,location_scope_json,archived,created_by_user_id,created_at,updated_at) VALUES (?,?,'Scoped admin','','#245fce',?,'[]',0,?,?,?)")
        .bind(roleId, account.organizationId, JSON.stringify(permissions), account.userId, now, now),
      database.prepare("INSERT INTO team_members (id,organization_id,user_id,role_id,first_name,last_name,email,employee_code,primary_location_id,permitted_locations_json,status,remote_login,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,'Scoped','Admin',?,'MARKETING-SCOPE',?,?,'active',1,?,?,?)")
        .bind(crypto.randomUUID(), account.organizationId, account.userId, roleId, account.owner.email, account.locationId, JSON.stringify([account.locationId]), account.userId, now, now),
      database.prepare("UPDATE memberships SET role='admin' WHERE user_id=? AND organization_id=?")
        .bind(account.userId, account.organizationId),
    ]);

    const denied = async (response, label) => {
      assert.equal(response.status, 403, `${label}: ${await response.clone().text()}`);
      assert.equal((await response.json()).error.code, "ORGANIZATION_SCOPE_REQUIRED", label);
    };
    for (const provider of ["google", "meta"]) {
      const connectionId = crypto.randomUUID();
      await database.prepare("INSERT INTO integration_connections (id,organization_id,provider,source_namespace,status,external_account_name,scopes_json,data_promotion_status,created_at,updated_at) VALUES (?,?,?,?,'connected','Fictional test account','[]','blocked',?,?)")
        .bind(connectionId, account.organizationId, provider, connectionId, now, now).run();
      for (const [endpoint, body] of [
        ["authorize", {}],
        ["resources", { action: "discover", connectionId }],
        ["resources", { action: "replace", connectionId, resources: [] }],
        ["sync", { mode: "sample", connectionId }],
        ["sync", { mode: "incremental", connectionId }],
        ["disconnect", { connectionId }],
      ]) {
        await denied(await dispatch(worker, environment, `/api/v1/integrations/${provider}/${endpoint}`, {
          ...account.owner, method: "POST", body,
        }), `${provider}/${endpoint}`);
      }
      for (const action of ["approve_data", "exclude_data"]) {
        await denied(await dispatch(worker, environment, "/api/v1/integrations", {
          ...account.owner, method: "POST", body: { action, provider, connectionId },
        }), `${provider}/${action}`);
      }

      // A previously issued state must not preserve access after the actor's scope narrows.
      const state = randomBytes(32).toString("base64url");
      const stateHash = createHash("sha256").update(state).digest("hex");
      await database.prepare("INSERT INTO integration_oauth_states (state_hash,organization_id,actor_user_id,provider,connection_id,expires_at,created_at) VALUES (?,?,?,?,?,?,?)")
        .bind(stateHash, account.organizationId, account.userId, provider, connectionId, now + 600, now).run();
      await denied(await worker.fetch(new Request(`${origin}/api/v1/integrations/${provider}/callback?state=${state}&code=fictional-code`, {
        headers: { cookie: `__Host-vanteloq-oauth-${provider}=${state}` },
      }), environment, context), `${provider}/callback`);
      const savedState = await database.prepare("SELECT consumed_at FROM integration_oauth_states WHERE state_hash=?").bind(stateHash).first();
      assert.equal(savedState.consumed_at, null);
      const connection = await database.prepare("SELECT status FROM integration_connections WHERE id=?").bind(connectionId).first();
      assert.equal(connection.status, "connected");
    }
    assert.equal((await database.prepare("SELECT COUNT(*) count FROM integration_secrets").first()).count, 0);
    assert.equal((await database.prepare("SELECT COUNT(*) count FROM integration_sync_runs").first()).count, 0);
    assert.equal((await database.prepare("SELECT COUNT(*) count FROM marketing_resource_selections").first()).count, 0);

    await database.prepare("UPDATE team_members SET permitted_locations_json=? WHERE user_id=? AND organization_id=?")
      .bind(JSON.stringify([account.locationId, secondLocation]), account.userId, account.organizationId).run();
    // Full-scope admins pass authorization and reach the connection ownership check.
    const fullScope = await dispatch(worker, environment, "/api/v1/integrations/google/resources", {
      ...account.owner, method: "POST", body: { action: "discover", connectionId: "missing-test-connection" },
    });
    assert.equal(fullScope.status, 404, await fullScope.clone().text());
    await database.prepare("UPDATE memberships SET role='owner' WHERE user_id=? AND organization_id=?")
      .bind(account.userId, account.organizationId).run();
    const owner = await dispatch(worker, environment, "/api/v1/integrations/meta/resources", {
      ...account.owner, method: "POST", body: { action: "discover", connectionId: "missing-test-connection" },
    });
    assert.equal(owner.status, 404, await owner.clone().text());
  } finally {
    await dispose();
  }
});
