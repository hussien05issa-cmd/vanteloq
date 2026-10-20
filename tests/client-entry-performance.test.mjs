import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: ["app/vanteloq-app.tsx"], bundle: true, write: false, metafile: true,
  format: "esm", platform: "browser", packages: "external", logLevel: "silent",
  plugins: [{ name: "omit-test-styles", setup(builder) {
    builder.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
  } }],
});
const inputs = bundle.metafile.inputs;
function eagerInputs(entry) {
  const seen = new Set();
  function visit(name) {
    if (seen.has(name)) return;
    seen.add(name);
    for (const dependency of inputs[name]?.imports ?? []) {
      if (!dependency.external && dependency.kind !== "dynamic-import") visit(dependency.path);
    }
  }
  visit(entry);
  return seen;
}

test("initial dashboard delivery excludes unrelated settings and record-management modules", () => {
  const eager = eagerInputs("app/vanteloq-app.tsx");
  for (const deferred of ["app/governance-workspaces.tsx", "app/control-workspaces.tsx", "app/vehicle-inventory-panel.tsx", "app/collaboration-messages.tsx"]) {
    assert.equal(eager.has(deferred), false, `${deferred} must load when its workspace opens`);
  }
  assert.equal(eager.has("app/executive-overview.tsx"), true, "the dashboard remains immediately available");
});

test("session initialization loads the authentication SDK after module evaluation", () => {
  for (const name of eagerInputs("app/vanteloq-app.tsx")) {
    for (const dependency of inputs[name]?.imports ?? []) {
      if (dependency.path === "@supabase/supabase-js") {
        assert.equal(dependency.kind, "dynamic-import", `${name} must not eagerly evaluate the SDK`);
      }
    }
  }
  assert.ok(inputs["app/supabase-browser.ts"].imports.some(dependency => dependency.path === "@supabase/supabase-js"), "secure session initialization remains available");
});

