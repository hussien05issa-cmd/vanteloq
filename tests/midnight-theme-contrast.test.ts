import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Check the palette that wins in the authenticated cascade, not a superseded
// base palette. Normal text uses the strict 4.5 threshold without rounding.
const css = readFileSync(new URL("../app/premium-workspace.css", import.meta.url), "utf8");
const declarations = (selector: string, prefix: string) => {
  const start = css.indexOf(selector);
  assert.ok(start >= 0, `Missing palette ${selector}`);
  const block = css.slice(start).match(/\{([^}]+)\}/)?.[1];
  assert.ok(block);
  return Object.fromEntries([...block.matchAll(new RegExp(`--${prefix}-([\\w-]+):\\s*(#[\\da-f]{6})`, "gi"))].map(match => [match[1], match[2]]));
};
const luminance = (hex: string) => {
  const rgb = [1, 3, 5].map(start => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const linear = rgb.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
};
const contrast = (a: string, b: string) => {
  const first = luminance(a), second = luminance(b);
  return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
};

for (const mode of ["dark", "light"]) {
  test(`${mode}: effective workspace text and meaningful controls retain contrast`, () => {
    const palette = declarations(`[data-workspace-theme="${mode}"]`, "ws");
    for (const background of ["canvas", "panel", "raised", "input", "navigation", "selected"]) {
      for (const foreground of ["ink", "muted", "subtle", "blue", "purple", "positive", "negative", "warning"]) {
        const ratio = contrast(palette[foreground], palette[background]);
        assert.ok(ratio >= 4.5, `${mode}: ${foreground}/${background} ${ratio}`);
      }
    }
    for (const background of ["canvas", "panel", "raised", "input", "navigation"]) {
      for (const foreground of ["control", "focus"]) {
        assert.ok(contrast(palette[foreground], palette[background]) >= 3, `${mode}: ${foreground}/${background}`);
      }
    }
    for (const background of ["primary", "primary-hover"]) {
      assert.ok(contrast(palette["on-primary"], palette[background]) >= 4.5, `${mode}: white on ${background}`);
      for (const surface of ["canvas", "panel", "raised", "input"]) assert.ok(contrast(palette[background], palette[surface]) >= 3, `${mode}: ${background} boundary/${surface}`);
    }
    for (const status of ["positive", "negative", "warning"]) {
      assert.ok(contrast(palette[status], palette[`${status}-bg`]) >= 4.5, `${mode}: ${status} feedback`);
    }
  });
  test(`${mode}: independently selected AI theme retains readable answers and controls`, () => {
    const palette = declarations(`.ai-studio[data-ai-theme="${mode}"]`, "ai");
    for (const background of ["canvas", "panel", "raised"]) {
      for (const foreground of ["ink", "muted", "purple", "blue", "error"]) {
        assert.ok(contrast(palette[foreground], palette[background]) >= 4.5, `${mode} AI: ${foreground}/${background}`);
      }
      for (const foreground of ["control", "focus"]) {
        assert.ok(contrast(palette[foreground], palette[background]) >= 3, `${mode} AI: ${foreground}/${background}`);
      }
    }
  });
}

test("the effective theme does not repaint provider images or add continuous decorative animation", () => {
  assert.doesNotMatch(css, /filter:\s*(?:invert|brightness|grayscale)|animation:[^;]+infinite/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /forced-colors:\s*active/);
  assert.match(css, /--ws-focus:\s*Highlight/);
});
