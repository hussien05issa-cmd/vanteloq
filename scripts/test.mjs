import { access, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const requested = process.argv.slice(2);
const files = requested.length ? requested : (await readdir(new URL("../tests/", import.meta.url))).filter(name => /\.test\.(?:tsx?|mjs)$/.test(name)).sort().map(name => `tests/${name}`);
for (const file of files) await access(new URL(file, new URL("../", import.meta.url)));
const child = spawn(process.execPath, ["--experimental-transform-types", "--import", "./scripts/test-loader.mjs", "--test", "--test-concurrency=1", ...files], { cwd: root, stdio: "inherit", env: { ...process.env, WRANGLER_WRITE_LOGS: "false" } });
process.on("SIGINT", () => child.kill("SIGINT"));
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
