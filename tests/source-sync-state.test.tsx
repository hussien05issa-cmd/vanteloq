import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SourceSyncingState } from "../app/vanteloq-app";

test("source publication displays an accessible waiting state without zero totals or setup warnings", () => {
  const html = renderToStaticMarkup(<SourceSyncingState refresh={() => {}} />);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /Syncing source records/);
  assert.match(html, /Check again/);
  assert.doesNotMatch(html, /\$0|No data|Data source required|No verified exception/);
});
