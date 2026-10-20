// Use Node entry points directly: Windows does not execute POSIX bin shims.
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertRscAssetFiles } from "../build/rsc-asset-integrity.mjs";
import { canonicalMigrationSql, canonicalizeMigrationArtifacts } from "../build/migration-artifacts.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const [mode, ...extra] = process.argv.slice(2);
const commands = {
  dev: ["vite/bin/vite.js", ...extra],
  build: ["vinext/dist/cli.js", "build", ...extra],
  start: ["vinext/dist/cli.js", "start", ...extra],
  typecheck: ["typescript/bin/tsc", "--noEmit", ...extra],
  lint: ["eslint/bin/eslint.js", ".", "--ignore-pattern", "dist", "--ignore-pattern", ".next", ...extra],
  "db:generate": ["drizzle-kit/bin.cjs", "generate", ...extra],
};
await mkdir(resolve(root, ".wrangler/logs"), { recursive: true });
const env = { ...process.env, WRANGLER_WRITE_LOGS: "false", WRANGLER_LOG_PATH: resolve(root, ".wrangler/logs"), MINIFLARE_REGISTRY_PATH: resolve(root, ".wrangler/registry") };

async function validate() {
  const manifest = JSON.parse(await readFile(resolve(root, "dist/.openai/hosting.json"), "utf8"));
  const source = JSON.parse(await readFile(resolve(root, ".openai/hosting.json"), "utf8"));
  if (manifest.project_id !== source.project_id) throw new Error("Built Sites project does not match the source manifest.");
  const worker = await import(pathToFileURL(resolve(root, "dist/server/index.js")).href);
  if (typeof worker.default?.fetch !== "function") throw new Error("Worker entry must export fetch.");
  for (const file of ["dist/server/__vite_rsc_assets_manifest.js", "dist/server/ssr/__vite_rsc_assets_manifest.js"]) {
    const { default: assets } = await import(pathToFileURL(resolve(root, file)).href);
    await assertRscAssetFiles(assets, resolve(root, "dist/client"));
  }
  for (const file of (await readdir(resolve(root, "drizzle"))).filter(name => /^\d{4}.*\.sql$/.test(name))) {
    const originalSql = await readFile(resolve(root, "drizzle", file), "utf8");
    const sourceSql = canonicalMigrationSql(originalSql);
    if (originalSql !== sourceSql) throw new Error(`Migration checkout is not LF; rebuild before packaging: ${file}`);
    const packagedSql = await readFile(resolve(root, "dist/.openai/drizzle", file), "utf8");
    if (packagedSql !== sourceSql) throw new Error(`Packaged migration differs from canonical source: ${file}`);
  }
  async function inspect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await inspect(path);
      else if ([".js", ".css", ".html"].includes(extname(path)) && /\/workspace\/sites\/[^/]+\/\.vinext\/fonts\//.test(await readFile(path, "utf8"))) throw new Error(`Workstation font URL in ${entry.name}`);
    }
  }
  await inspect(resolve(root, "dist"));
  console.log("Validated Sites artifact: Worker, project, canonical SQL and complete RSC asset references.");
}

if (mode === "validate") await validate();
else {
  if (!commands[mode]) throw new Error(`Unknown command: ${mode}`);
  // Sites' packager copies source migrations over staged build metadata.
  // Enforce the Git LF contract before either copy can run.
  if (mode === "build") await canonicalizeMigrationArtifacts(resolve(root, "drizzle"));
  const [entry, ...args] = commands[mode];
  const child = spawn(process.execPath, [resolve(root, "node_modules", entry), ...args], { cwd: root, env, stdio: "inherit" });
  const timeout = mode === "build" ? setTimeout(() => {
    console.error("Build exceeded its 10-minute limit. No new artifact is verified.");
    child.kill("SIGTERM");
  }, 600_000) : null;
  process.on("SIGINT", () => child.kill("SIGINT"));
  const code = await new Promise((done, reject) => { child.on("error", reject); child.on("exit", (code) => done(code ?? 1)); });
  if (timeout) clearTimeout(timeout);
  if (code !== 0) process.exit(code);
  if (mode === "build") await validate();
}
