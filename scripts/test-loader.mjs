// Node's test runner with TSX and extensionless application imports, on every OS.
import { registerHooks, createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
const require = createRequire(resolve("package.json"));
registerHooks({
  resolve(specifier, context, next) {
    if (["next/link", "next/image", "next/navigation", "next/headers"].includes(specifier)) {
      const entry = resolve("node_modules", `${specifier}.js`);
      if (existsSync(entry)) return next(pathToFileURL(entry).href, context);
    }
    try { return next(specifier, context); } catch (error) {
      if (!specifier.startsWith(".")) throw error;
      for (const suffix of [".ts", ".tsx", ".js", "/index.ts", "/index.tsx"]) {
        const url = new URL(specifier + suffix, context.parentURL);
        if (existsSync(fileURLToPath(url))) return next(url.href, context);
      }
      throw error;
    }
  },
  load(url, context, next) {
    // Styles are bundled by Vite; server-rendered component tests need no CSS loader.
    if (url.endsWith(".css")) return { format: "module", source: "export default {};", shortCircuit: true };
    if (!url.endsWith(".tsx")) return next(url, context);
    const source = require("esbuild").transformSync(readFileSync(fileURLToPath(url), "utf8"), { loader: "tsx", format: "esm", jsx: "automatic", target: "esnext" }).code;
    return { format: "module", source, shortCircuit: true };
  },
});
