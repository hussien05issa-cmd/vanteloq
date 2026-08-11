import assert from "node:assert/strict";
import test from "node:test";
import { filterRowsForLocation, parsePermittedLocationIds, resolveProviderLocationRefs } from "../domain/location-scope.ts";

const mappings = [
  { organizationLocationId: "north", provider: "lightspeed-r", providerLocationRef: "shop-1" },
  { organizationLocationId: "south", provider: "lightspeed-r", providerLocationRef: "shop-2" },
  { organizationLocationId: "north", provider: "shopify-pos", providerLocationRef: "gid://shopify/Location/3" },
];

test("one organization location resolves every mapped provider location", () => {
  assert.deepEqual(resolveProviderLocationRefs(mappings, "north"), [
    { provider: "lightspeed-r", providerLocationRef: "shop-1" },
    { provider: "shopify-pos", providerLocationRef: "gid://shopify/Location/3" },
  ]);
});

test("location filtering accepts only rows mapped to the selected store", () => {
  const rows = [
    { id: "a", provider: "lightspeed-r", locationRef: "shop-1" },
    { id: "b", provider: "lightspeed-r", locationRef: "shop-2" },
    { id: "c", provider: "shopify-pos", locationRef: "gid://shopify/Location/3" },
    { id: "d", provider: "shopify-pos", locationRef: null },
  ];

  assert.deepEqual(filterRowsForLocation(rows, resolveProviderLocationRefs(mappings, "north")).map((row) => row.id), ["a", "c"]);
});

test("employee location permissions fail closed when the stored scope is absent or malformed", () => {
  assert.deepEqual(parsePermittedLocationIds('["north","north","south"]'), ["north", "south"]);
  assert.deepEqual(parsePermittedLocationIds("[]"), []);
  assert.deepEqual(parsePermittedLocationIds(null), []);
  assert.deepEqual(parsePermittedLocationIds("not-json"), []);
  assert.deepEqual(parsePermittedLocationIds('{"location":"north"}'), []);
});
