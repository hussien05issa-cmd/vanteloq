import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ClientLoadBoundary, { ClientLoadRecovery, isClientModuleLoadError } from "../app/client-load-boundary";

test("browser module and stylesheet transport failures reach recovery", () => {
  for (const error of [
    new TypeError("Failed to fetch dynamically imported module: https://example.invalid/old-billing.js"),
    new TypeError("error loading dynamically imported module"),
    new TypeError("Importing a module script failed."),
    new Error("Loading chunk 129 failed. (missing: https://example.invalid/old.js)"),
    new Error("Loading CSS chunk onboarding failed."),
    new Error("Unable to preload CSS for /assets/old.css"),
    Object.assign(new Error("request failed"), { name: "ChunkLoadError" }),
  ]) {
    assert.equal(isClientModuleLoadError(error), true);
    assert.deepEqual(ClientLoadBoundary.getDerivedStateFromError(error), { failed: true });
  }
});

test("API, authentication, application and navigation errors are never presented as stale files", () => {
  for (const error of [
    new TypeError("Failed to fetch"),
    new Error("MFA_REQUIRED"),
    new Error("Payment was declined"),
    new Error("NEXT_REDIRECT;replace;/signin;307;"),
    Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" }),
    new TypeError("Cannot read properties of undefined (reading 'id')"),
    { message: 403 }, null, "Failed to fetch dynamically imported module",
  ]) {
    assert.equal(isClientModuleLoadError(error), false);
    assert.throws(() => ClientLoadBoundary.getDerivedStateFromError(error), thrown => thrown === error);
  }
});

test("healthy children retain their identity and the recovery state never exposes protected content", () => {
  const child = <section>Protected workspace fixture</section>;
  const boundary = new ClientLoadBoundary({ children: child });
  assert.equal(boundary.render(), child);
  boundary.state = ClientLoadBoundary.getDerivedStateFromError(new TypeError("Importing a module script failed."));
  const html = renderToStaticMarkup(boundary.render());
  assert.match(html, /Your Workspace Could Not Load/);
  assert.doesNotMatch(html, /Protected workspace fixture/);
});

test("recovery renders safely without a browser, requires an explicit reload and warns about unsaved entries", () => {
  const html = renderToStaticMarkup(<ClientLoadRecovery/>);
  assert.match(html, /<button type="button"/);
  assert.match(html, /Reload Vanteloq/);
  assert.match(html, /Unsaved entries may need to be entered again/);
  assert.match(html, /will not reload automatically/);
  assert.match(html, /aria-labelledby="client-load-title"/);
  assert.match(html, /tabindex="-1"/);
  assert.match(html, /href="\/contact" target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /opens in a new tab/);
  assert.doesNotMatch(html, /<form|<script|http-equiv|old-billing|example.invalid/);
});

test("a failed module URL or error payload is never exposed in the fallback", () => {
  const boundary = new ClientLoadBoundary({ children: <div/> });
  boundary.state = ClientLoadBoundary.getDerivedStateFromError(new TypeError("Failed to fetch dynamically imported module: https://private.invalid/chunk.js?secret=fixture-sensitive-value"));
  const html = renderToStaticMarkup(boundary.render());
  assert.doesNotMatch(html, /private.invalid|fixture-sensitive-value|chunk.js/);
});
