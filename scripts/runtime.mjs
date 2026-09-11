// Use Node entry points directly: Windows does not execute POSIX bin shims.
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
  async function inspect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await inspect(path);
      else if ([".js", ".css", ".html"].includes(extname(path)) && /\/workspace\/sites\/[^/]+\/\.vinext\/fonts\//.test(await readFile(path, "utf8"))) throw new Error(`Workstation font URL in ${entry.name}`);
    }
  }
  await inspect(resolve(root, "dist"));
  console.log("Validated Sites artifact: Worker entry, project manifest and production asset paths.");
}

if (mode === "validate") await validate();
else {
  if (!commands[mode]) throw new Error(`Unknown command: ${mode}`);
  const [entry, ...args] = commands[mode];
  const child = spawn(process.execPath, [resolve(root, "node_modules", entry), ...args], { cwd: root, env, stdio: "inherit" });
  const timeout = mode === "build" ? setTimeout(() => child.kill("SIGTERM"), 180_000) : null;
  process.on("SIGINT", () => child.kill("SIGINT"));
  const code = await new Promise((done, reject) => { child.on("error", reject); child.on("exit", (code) => done(code ?? 1)); });
  if (timeout) clearTimeout(timeout);
  if (code !== 0) process.exit(code);
  if (mode === "build") await validate();
}
