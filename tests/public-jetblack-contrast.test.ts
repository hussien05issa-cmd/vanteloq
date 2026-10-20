import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../app/public-jetblack.css", import.meta.url), "utf8");
const root = css.match(/\.public-site\.reference-home\[data-public-theme="dark"\]\s*\{([^}]+)\}/)?.[1];
assert.ok(root, "Homepage palette must be explicitly scoped");
const palette = Object.fromEntries([...root.matchAll(/--public-([\w-]+):\s*(#[\da-f]{6});/gi)].map(match => [match[1], match[2]]));
const luminance = (hex: string) => {
  const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  const linear = channels.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
};
const contrast = (foreground: string, background: string) => {
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
};

test("homepage midnight normal text, axes and financial feedback exceed 4.5:1", () => {
  for (const background of ["canvas", "panel", "raised", "selected"]) {
    for (const foreground of ["ink", "secondary", "muted", "link", "purple", "positive", "negative", "warning"]) {
      const ratio = contrast(palette[foreground], palette[background]);
      assert.ok(ratio >= 4.5, `${foreground}/${background}: ${ratio}`);
    }
  }
  for (const status of ["positive", "negative", "warning"]) {
    assert.ok(contrast(palette[status], palette[`${status}-bg`]) >= 4.5, status);
  }
});

test("homepage control boundaries, focus and primary button labels retain contrast", () => {
  for (const background of ["canvas", "panel", "raised"]) {
    assert.ok(contrast(palette.control, palette[background]) >= 3, `control/${background}`);
    assert.ok(contrast(palette.focus, palette[background]) >= 3, `focus/${background}`);
    assert.ok(contrast(palette.primary, palette[background]) >= 3, `primary/${background}`);
  }
  assert.ok(contrast(palette["on-primary"], palette.primary) >= 4.5);
  assert.ok(contrast(palette["on-primary"], palette["primary-hover"]) >= 4.5);
});

test("all homepage theme rules are opt-in and leave light and authenticated boundaries alone", () => {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...withoutComments.matchAll(/([^{}]+)\{/g)].map(match => match[1].trim()).filter(selector => !selector.startsWith("@"));
  assert.ok(rules.length > 70, "Known homepage surfaces are explicitly addressed");
  for (const rule of rules) {
    assert.ok(rule.startsWith('.public-site.reference-home[data-public-theme="dark"]')
      || rule.startsWith('.public-site.reference-home[data-public-theme="light"]')
      || rule.startsWith('.public-site.reference-home[data-public-theme] .public-appearance-control')
      || rule.startsWith('.analytics-consent.analytics-consent-compact[data-consent-theme="dark"]')
      || rule.startsWith('.analytics-settings-button[data-consent-theme="dark"]'), rule);
  }
  assert.doesNotMatch(css, /:root|\[data-workspace-theme|\.operating-shell|\.auth-panel/);
  assert.doesNotMatch(css, /filter:\s*(?:invert|brightness|grayscale)|animation:[^;]+infinite/);
});

test("borderline light labels receive colour-only contrast corrections", () => {
  const light = [...css.matchAll(/\.public-site\.reference-home\[data-public-theme="light"\]([^{}]+)\{([^}]+)\}/g)];
  assert.equal(light.length, 4);
  for (const [, , block] of light) assert.match(block.trim(), /^color:\s*#[\da-f]{6};$/i);
  for (const [foreground, background] of [["#245eae", "#f7f9fd"], ["#4b5b72", "#f7f9fc"], ["#53677e", "#fafcff"], ["#53677e", "#ffffff"]]) assert.ok(contrast(foreground, background) >= 4.5, `${foreground}/${background}`);
});

test("separate consent root retains readable copy and equally visible actions", () => {
  const consent = css.match(/\.analytics-consent\.analytics-consent-compact\[data-consent-theme="dark"\], \.analytics-settings-button\[data-consent-theme="dark"\]\s*\{([^}]+)\}/)?.[1];
  assert.ok(consent);
  const values = Object.fromEntries([...consent.matchAll(/--consent-([\w-]+):\s*(#[\da-f]{6});/gi)].map(match => [match[1], match[2]]));
  for (const background of ["panel", "raised"]) {
    for (const foreground of ["ink", "secondary", "link"]) assert.ok(contrast(values[foreground], values[background]) >= 4.5, `${foreground}/${background}`);
    for (const foreground of ["control", "focus"]) assert.ok(contrast(values[foreground], values[background]) >= 3, `${foreground}/${background}`);
  }
  assert.match(css, /\.analytics-consent\.analytics-consent-compact\[data-consent-theme="dark"\] \.analytics-consent-actions button\s*\{/);
  assert.doesNotMatch(css, /\.analytics-consent\[data-consent-theme="dark"\]/, "Dark compact consent must outrank a late base compact stylesheet");
  assert.doesNotMatch(css, /data-consent-theme="dark"[^{}]*button\.primary/);
  assert.match(css, /\.public-nav nav > a\.public-demo-link\s*\{\s*color: var\(--public-ink\); background: var\(--public-raised\)/);
  assert.match(css, /\.public-appearance-control select\s*\{\s*box-sizing: border-box; min-height: 44px; min-width: 92px/);
});

test("dark homepage covers functioning previews, providers, records and disclosures", () => {
  for (const selector of [".home-monitor-screen", ".executive-kpi-label", ".executive-customize", ".industry-record", ".provider-setup-details", ".connector-availability-sticker", ".financial-review-card", ".workspace-preview-table-wrap", ".finance-chart-axis", ".public-free-plan", ".home-faq-list", ".home-social-card", ".home-footer"]) assert.ok(css.includes(selector), selector);
  assert.match(css, /\.executive-change\.change-up\s*\{ color: var\(--public-positive\)/);
  assert.match(css, /\.executive-change\.change-down\s*\{ color: var\(--public-negative\)/);
  assert.match(css, /prefers-reduced-transparency:\s*reduce/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /forced-colors:\s*active/);
  assert.match(css, /--public-focus:\s*Highlight/);
});

test("late commerce styles have local dark overrides for source cards and selected goals", () => {
  for (const selector of [".executive-overview.commerce-reference .executive-chart-value", ".executive-overview.commerce-reference .operating-goal-list > button[aria-pressed=\"true\"]", ".executive-overview.commerce-reference .executive-insights details[open]", ".interactive-goal-rings .interactive-ring-readout small", ".revenue-source-detail > button", ".proof-studio-copy > a"]) assert.ok(css.includes(selector), selector);
});
