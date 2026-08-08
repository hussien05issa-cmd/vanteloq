import assert from "node:assert/strict";
import test from "node:test";
import { probeSupabaseBackend, supabaseConfiguration } from "../server/supabase.ts";

test("Supabase stays disabled until the hosted backend is deliberately enabled", async () => {
  const result = await probeSupabaseBackend({});
  assert.equal(result.status, "disabled");
  assert.equal(result.configured, false);
});

test("partial or unsafe Supabase configuration fails closed", async () => {
  const partial = await probeSupabaseBackend({ SUPABASE_BACKEND_MODE: "shadow", SUPABASE_URL: "http://unsafe.example" });
  assert.equal(partial.status, "misconfigured");
  assert.equal(supabaseConfiguration({ SUPABASE_SCHEMA: "not-valid!" }).schema, "public");
});

test("the server-only readiness probe authenticates and validates the schema contract", async () => {
  const secret = "sb_secret_server_only";
  let receivedAuthorization = "";
  const result = await probeSupabaseBackend(
    {
      SUPABASE_BACKEND_MODE: "shadow",
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SECRET_KEY: secret,
      SUPABASE_SCHEMA: "public",
    },
    async (_input, init) => {
      receivedAuthorization = new Headers(init?.headers).get("authorization") ?? "";
      return Response.json([{ service: "vanteloq", schema_version: 1 }]);
    },
  );
  assert.equal(receivedAuthorization, `Bearer ${secret}`);
  assert.equal(result.status, "ready");
  assert.equal(result.schemaVersion, 1);
  assert.doesNotMatch(JSON.stringify(result), /sb_secret/);
});
