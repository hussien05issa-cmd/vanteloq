import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const resourcesSource = await readFile(new URL("../app/resources/page.tsx", import.meta.url), "utf8");

test("resource sequence labels do not use leading zeroes", () => {
  assert.match(resourcesSource, /<span>1<\/span>/);
  assert.match(resourcesSource, /<span>2<\/span>/);
  assert.match(resourcesSource, /<span>3<\/span>/);
  assert.doesNotMatch(resourcesSource, /<span>0[1-9]<\/span>/);
});
