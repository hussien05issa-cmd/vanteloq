import postcss from "postcss";
import workspaceAnchors from "./workspace-style-anchors.json" with { type: "json" };

const anchors = new Set(workspaceAnchors);
export const PUBLIC_STYLE_QUERY = "public-surface";

// These audited positive roots are absent from public/auth/demo components. Never
// infer a required class from :not(), :is(), :where() or a descendant selector.
export function requiresWorkspace(selector) {
  const value = selector.trim();
  if (/^body:has\(\.operating-shell\)/.test(value)) return true;
  const rootClass = value.match(/^\.([a-zA-Z_][\w-]*)/)?.[1];
  return Boolean(rootClass && anchors.has(rootClass));
}

export function publicSurfaceCss(css, from) {
  const root = postcss.parse(css, { from });
  root.walkRules(rule => {
    const selectors = rule.selectors.filter(selector => !requiresWorkspace(selector));
    if (!selectors.length) rule.remove();
    else if (selectors.length !== rule.selectors.length) rule.selectors = selectors;
  });
  root.walkAtRules(rule => {
    if (rule.nodes && rule.nodes.every(node => node.type === "comment")) rule.remove();
  });
  return root.toString();
}

// Keep every original stylesheet as the authority. The root layout requests a
// public projection; the lazy workspace loads the originals in their original
// order, retaining shared overrides and the appearance after signing out.
export function publicSurfaceStyles() {
  return {
    name: "vanteloq-public-surface-css",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes(`.css?${PUBLIC_STYLE_QUERY}`)) return null;
      return { code: publicSurfaceCss(code, id.split("?")[0]), map: null };
    },
  };
}
