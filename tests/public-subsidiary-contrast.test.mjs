import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";

const css = readFileSync(new URL("../app/public-surface.css", import.meta.url), "utf8");
const blocks = [...css.matchAll(/\.public-site\.public-surface(?:\[data-public-theme="light"\])?\s*\{([^}]+)\}/g)];
const properties = block => Object.fromEntries([...block.matchAll(/--surface-([\w-]+):\s*(#[\da-f]{6})\s*;/gi)].map(match => [match[1], match[2]]));
const dark = properties(blocks[0][1]);
const light = { ...dark, ...properties(blocks[1][1]) };
function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
}
function contrast(first, second) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}

for (const [theme, palette] of [["dark", dark], ["light", light]]) {
  test(`${theme} subsidiary surfaces retain readable copy, links, status and control boundaries`, () => {
    for (const background of ["canvas", "panel", "raised", "tint"]) {
      for (const foreground of ["ink", "muted", "subtle", "link"]) {
        assert.ok(contrast(palette[foreground], palette[background]) >= 4.5, `${theme}: ${foreground} on ${background}`);
      }
    }
    for (const status of ["success", "warning", "error"]) {
      assert.ok(contrast(palette[status], palette[`${status}-bg`]) >= 4.5, `${theme}: ${status}`);
    }
    assert.ok(contrast("#ffffff", palette.primary) >= 4.5, `${theme}: primary label`);
    assert.ok(contrast("#ffffff", palette["primary-hover"]) >= 4.5, `${theme}: hovered primary label`);
    assert.ok(contrast(palette.line, palette.panel) >= 3, `${theme}: field boundary`);
    assert.ok(contrast(palette.focus, palette.panel) >= 3, `${theme}: keyboard focus`);
  });
}

test("the public demo child surface wins over legacy light paint regardless of stylesheet order", () => {
  const legacy = readFileSync(new URL("../app/interface-polish.css", import.meta.url), "utf8");
  // Only direct rules for the known .product-demo child are relevant here.
  // The legacy :is() rule has two class selectors; the destination override
  // must have greater specificity so chunk loading order cannot restore white.
  const candidates = source => {
    const matches = [];
    postcss.parse(source).walkRules(rule => {
      for (const selector of rule.selectors) {
        if (!selector.includes(".public-site") || !selector.includes(".product-demo")) continue;
        if (selector.includes(".reference-home") || selector.includes(".operating-shell")) continue;
        const applicable = selector.includes(":is(") ? ".public-site .product-demo" : selector;
        if (!/^\.public-site(?:\.public-surface)? \.product-demo$/.test(applicable)) continue;
        rule.walkDecls(declaration => {
          if (!["background", "background-color"].includes(declaration.prop)) return;
          matches.push({ value: declaration.value, specificity: (applicable.match(/\./g) ?? []).length, important: declaration.important === true });
        });
      }
    });
    return matches;
  };
  for (const sources of [[legacy, css], [css, legacy]]) {
    const winner = sources.flatMap(candidates).reduce((current, rule) => !current || Number(rule.important) > Number(current.important) || (rule.important === current.important && rule.specificity >= current.specificity) ? rule : current, null);
    assert.equal(winner?.value, "var(--surface-canvas)");
  }
});

test("collapsed and expanded resource browsing retain themed paint regardless of stylesheet order", () => {
  const legacy = readFileSync(new URL("../app/bookloq-discovery.css", import.meta.url), "utf8");
  const cases = [
    [".resource-article-browser", "background", "var(--surface-panel)"],
    [".resource-article-browser > summary", "background", "var(--surface-panel)"],
    [".resource-article-browser > summary:hover", "background", "var(--surface-raised)"],
    [".resource-article-browser > summary strong", "color", "var(--surface-ink)"],
    [".resource-article-browser > summary small", "color", "var(--surface-muted)"],
    [".resource-article-list", "background", "var(--surface-panel)"],
    [".resource-article-list > article", "background", "var(--surface-panel)"],
    [".resource-article-list h3 a", "color", "var(--surface-ink)"],
    [".resource-article-list p", "color", "var(--surface-muted)"],
    [".resource-article-list .resource-article-link", "color", "var(--surface-link)"],
  ];
  for (const [target, property, expected] of cases) {
    for (const sources of [[legacy, css], [css, legacy]]) {
      let winner;
      for (const source of sources) postcss.parse(source).walkRules(rule => {
        for (const selector of rule.selectors) {
          const scoped = selector.startsWith(".public-site.public-surface ");
          const direct = scoped ? selector.slice(".public-site.public-surface ".length) : selector;
          if (direct !== target) continue;
          rule.walkDecls(property, declaration => {
            const candidate = { value: declaration.value, scoped };
            if (!winner || scoped || !winner.scoped) winner = candidate;
          });
        }
      });
      assert.equal(winner?.value, expected, `${target} ${property}`);
    }
  }
});
