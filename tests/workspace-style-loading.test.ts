import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import postcss from "postcss";
import ts from "typescript";

const workspace = resolve("app/vanteloq-app.tsx");
const styleEntry = resolve("app/workspace-styles.ts");
const source = (file: string) => readFileSync(file, "utf8");

function localImport(from: string, specifier: string) {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(from), specifier);
  return ["", ".ts", ".tsx", ".js", "/index.ts", "/index.tsx"]
    .map(suffix => base + suffix)
    .find(file => existsSync(file) && statSync(file).isFile()) ?? null;
}

function runtimeGraph(entries: string[], dynamic: boolean, skipWorkspace = false) {
  const seen = new Set<string>();
  function visitFile(file: string) {
    if (seen.has(file) || (skipWorkspace && file === workspace)) return;
    seen.add(file);
    if (file.endsWith(".css")) return;
    const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const typeOnly = ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly : node.isTypeOnly;
        if (!typeOnly) {
          const dependency = localImport(file, node.moduleSpecifier.text);
          if (dependency) visitFile(dependency);
        }
      }
      if (dynamic && ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        const dependency = localImport(file, node.arguments[0].text);
        if (dependency) visitFile(dependency);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  entries.forEach(visitFile);
  return seen;
}

const deferredStyles = [...runtimeGraph([styleEntry], false)].filter(file => file.endsWith(".css"));

test("workspace CSS is excluded from public, demo and authentication import graphs", () => {
  const publicEntries = readdirSync("app", { recursive: true })
    .map(String)
    .filter(file => /(?:^|[\\/])(?:page|layout)\.tsx$/.test(file))
    .map(file => resolve("app", file));
  const publicGraph = runtimeGraph(publicEntries, true, true);
  assert.ok(deferredStyles.length > 0);
  assert.ok(!publicGraph.has(styleEntry), "The deferred CSS entry must not load through a public or auth route.");
  for (const file of deferredStyles) assert.ok(!publicGraph.has(file), `Public import graph includes ${file}`);

  // This catches a future public/demo reuse that needs its sheet moved back.
  // Every deferred rule has a required, workspace-only class in its selector.
  const publicSource = [...publicGraph].filter(file => !file.endsWith(".css")).map(source).join("\n");
  for (const file of deferredStyles) {
    postcss.parse(source(file)).walkRules(rule => {
      for (const selector of rule.selectors) {
        const requiredClass = selector.trim().match(/^(?:body:has\()?\.([a-zA-Z_][\w-]*)/)?.[1];
        assert.ok(requiredClass, `Global selector cannot be deferred: ${selector}`);
        assert.doesNotMatch(publicSource, new RegExp(`(?<![\\w-])${requiredClass}(?![\\w-])`), `Public code references ${requiredClass} from ${file}`);
      }
    });
  }
});

test("the lazy workspace imports its CSS synchronously with the component", () => {
  const landingGraph = runtimeGraph([resolve("app/page.tsx")], false);
  assert.ok(!landingGraph.has(workspace), "The workspace must remain outside the eager homepage graph.");
  assert.ok(!landingGraph.has(styleEntry));
  const workspaceGraph = runtimeGraph([workspace], false);
  assert.ok(workspaceGraph.has(styleEntry));
  for (const file of deferredStyles) assert.ok(workspaceGraph.has(file), `Workspace CSS must be ready with the lazy chunk: ${file}`);
});
