import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, operationalFailureKind } from "../server/api.ts";

test("operational diagnostics classify D1 causes without returning SQL or private values", () => {
  const privateDetail = "fictional-secret-and-customer@example.invalid";
  const examples: [string, string][] = [
    ["D1_ERROR: Network connection lost.", "database_transient"],
    ["D1_ERROR: Replica disconnected from primary.", "database_transient"],
    ["D1_ERROR: Internal error in D1 DB storage caused object to be reset.", "database_transient"],
    ["D1_ERROR: D1 DB reset because its code was updated.", "database_transient"],
    ["D1_ERROR: Cannot resolve D1 DB due to transient issue on remote node.", "database_transient"],
    ["D1_ERROR: too many SQL variables", "database_parameter_limit"],
    ["D1_ERROR: no such column: fictional_column", "database_schema"],
    ["D1_ERROR: FOREIGN KEY constraint failed", "database_constraint"],
    ["D1_ERROR: D1 DB is overloaded. Too many requests queued.", "database_busy"],
    ["D1_ERROR: D1 DB storage operation exceeded timeout which caused object to be reset.", "upstream_timeout"],
    ["D1_ERROR: unknown database failure", "database_error"],
  ];
  for (const [message, expected] of examples) {
    const failure = new Error(`Failed query: ${privateDetail}`, { cause: new Error(`${message} ${privateDetail}`) });
    assert.equal(operationalFailureKind(failure), expected);
    assert.equal(operationalFailureKind(new Error(`${message} ${privateDetail}`)), expected);
    assert.equal(operationalFailureKind(failure).includes(privateDetail), false);
  }
});

test("operational diagnostics preserve application and non-database categories", () => {
  assert.equal(operationalFailureKind(new ApiError(409, "TEST", "D1_ERROR: private detail")), "application");
  assert.equal(operationalFailureKind(new TypeError("private detail")), "type_error");
  assert.equal(operationalFailureKind(new Error("fetch failed")), "network_error");
  assert.equal(operationalFailureKind(new Error("unexpected private detail")), "unexpected");
  assert.equal(operationalFailureKind("private detail"), "unexpected");
  assert.equal(operationalFailureKind(null), "unexpected");
});
