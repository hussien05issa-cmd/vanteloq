import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("the deployed recovery email includes a secure link and numeric code fallback", () => {
  const output = execFileSync(process.execPath, [
    "scripts/deploy-auth-email-templates.mjs",
    "--dry-run",
  ], { encoding: "utf8" });
  const summary = JSON.parse(output) as { recoveryDelivery?: unknown };

  assert.equal(summary.recoveryDelivery, "secure_link_and_numeric_code");
});
