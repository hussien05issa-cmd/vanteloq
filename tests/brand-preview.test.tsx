import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import AdvisorComposer, { canAskAdvisor } from "../app/advisor-composer";
import IntegrationBrandLogo from "../app/integration-brand-logo";
import PlatformPreview from "../app/platform-preview";

test("Google and Meta use local brand assets with accessible names", () => {
  for (const [name, file] of [["Google", "google-g-ui.webp"], ["Meta", "meta-mark.svg"]]) {
    const markup = renderToStaticMarkup(<IntegrationBrandLogo name={name} compact/>);
    assert.ok(markup.includes(`/brand/${file}`));
    assert.ok(markup.includes(`aria-label="${name} logo"`));
    assert.doesNotMatch(markup, /<svg|https?:/);
    assert.ok(readFileSync(`public/brand/${file}`).length > 1000);
  }
  const svg = readFileSync("public/brand/meta-mark.svg", "utf8");
  assert.doesNotMatch(svg, /<script|onload|href=|<foreignObject/i);
});

test("advisor readiness requires consent, a bounded question and no active request", () => {
  for (const [question, consent, loading] of [["Sales?", false, false], ["", true, false], ["  ", true, false], ["Sales?", true, true], ["x".repeat(801), true, false]] as const) {
    assert.equal(canAskAdvisor(question, consent, loading), false);
  }
  assert.equal(canAskAdvisor("Sales?", true, false), true);
  assert.equal(canAskAdvisor("x".repeat(800), true, false), true);
});

test("advisor visibly explains its disabled state and labels its controls", () => {
  const markup = renderToStaticMarkup(<AdvisorComposer question="Sales?" onQuestion={() => {}} dataUseAccepted={false} onConsent={() => {}} loading={false} onSubmit={() => {}} providers={{ openai: { ready: true } }}/>);
  assert.match(markup, /type="submit" disabled=""/);
  assert.match(markup, /Accept the data-use notice/);
  assert.match(markup, /for="advisor-question"/);
  assert.match(markup, /maxLength="800"/i);
  assert.match(markup, /Powered by OpenAI/);
  assert.match(markup, /href="\/privacy#automation"/);
  assert.doesNotMatch(markup, /type="checkbox" checked/);
  const route = readFileSync("app/api/v1/advisor/chat/route.ts", "utf8");
  assert.ok(route.indexOf('body.dataUseAccepted !== true') < route.indexOf('const result = await callAdvisor'));
  assert.match(route, /requireAccess\(request, readers, "ai.basic"\)/);
  assert.match(route, /requireSameOrigin\(request\)/);
});

test("the public platform preview renders real chart components, labelled fictional data and no account calls", () => {
  const markup = renderToStaticMarkup(<PlatformPreview/>);
  for (const text of ["Interactive preview", "Example data", "Sales pulse", "BookLoQ cash", "Running total", "Gross profit", "fictional CAD records"]) assert.ok(markup.includes(text), text);
  assert.match(markup, /<table/);
  assert.doesNotMatch(markup, /inventory-decision-visual|configuration_required|NaN|Infinity/);
  const source = readFileSync("app/platform-preview.tsx", "utf8");
  assert.doesNotMatch(source, /fetch\(|apiFetch|supabase|currentSession|localStorage/);
  assert.match(source, /CashPositionRing/);
  const styles = readFileSync("app/workspace-design.css", "utf8");
  assert.match(styles, /\.workspace-chart-data th \{ position: static; top: auto;/);
});

test("advisor colours maintain legibility in enabled and disabled states", () => {
  const luminance = (hex: string) => {
    const rgb = hex.match(/[a-f\d]{2}/gi)!.map((part) => parseInt(part, 16) / 255).map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  for (const [foreground, background] of [["ffffff", "1854c7"], ["edf3ff", "354f6f"], ["ffffff", "102c49"], ["c2d4e8", "102c49"]]) {
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    assert.ok((values[0] + .05) / (values[1] + .05) >= 4.5);
  }
});
