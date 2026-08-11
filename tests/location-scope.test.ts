import assert from "node:assert/strict";
import test from "node:test";
import { filterRowsForLocation, parsePermittedLocationIds, resolveProviderLocationRefs } from "../domain/location-scope.ts";

const mappings = [
  { organizationLocationId: "north", provider: "lightspeed-r", connectionId: "r-north", providerLocationRef: "shop-1" },
  { organizationLocationId: "south", provider: "lightspeed-r", connectionId: "r-south", providerLocationRef: "shop-2" },
  { organizationLocationId: "north", provider: "shopify-pos", connectionId: "shopify-main", providerLocationRef: "gid://shopify/Location/3" },
];

test("one organization location resolves every mapped provider location", () => {
  assert.deepEqual(resolveProviderLocationRefs(mappings, "north"), [
    { provider: "lightspeed-r", connectionId: "r-north", providerLocationRef: "shop-1" },
    { provider: "shopify-pos", connectionId: "shopify-main", providerLocationRef: "gid://shopify/Location/3" },
  ]);
});

test("location filtering accepts only rows mapped to the selected store", () => {
  const rows = [
    { id: "a", provider: "lightspeed-r", connectionId: "r-north", locationRef: "shop-1" },
    { id: "b", provider: "lightspeed-r", connectionId: "r-south", locationRef: "shop-2" },
    { id: "c", provider: "shopify-pos", connectionId: "shopify-main", locationRef: "gid://shopify/Location/3" },
    { id: "d", provider: "shopify-pos", connectionId: "shopify-main", locationRef: null },
  ];

  assert.deepEqual(filterRowsForLocation(rows, resolveProviderLocationRefs(mappings, "north")).map((row) => row.id), ["a", "c"]);
});

test("same-provider accounts with the same raw location reference stay isolated by connection", () => {
  const duplicateRefMappings = [
    { organizationLocationId: "north", provider: "lightspeed-r", connectionId: "account-a", providerLocationRef: "1" },
    { organizationLocationId: "south", provider: "lightspeed-r", connectionId: "account-b", providerLocationRef: "1" },
  ];
  const rows = [
    { id: "north-row", provider: "lightspeed-r", connectionId: "account-a", locationRef: "1" },
    { id: "south-row", provider: "lightspeed-r", connectionId: "account-b", locationRef: "1" },
  ];

  assert.deepEqual(
    filterRowsForLocation(rows, resolveProviderLocationRefs(duplicateRefMappings, "north")).map((row) => row.id),
    ["north-row"],
  );
});

test("employee location permissions fail closed when the stored scope is absent or malformed", () => {
  assert.deepEqual(parsePermittedLocationIds('["north","north","south"]'), ["north", "south"]);
  assert.deepEqual(parsePermittedLocationIds("[]"), []);
  assert.deepEqual(parsePermittedLocationIds(null), []);
  assert.deepEqual(parsePermittedLocationIds("not-json"), []);
  assert.deepEqual(parsePermittedLocationIds('{"location":"north"}'), []);
});

test("an omitted location limits non-administrators to their accessible locations", async () => {
  const locationScope = await import("../domain/location-scope.ts") as Record<string, unknown>;
  assert.equal(typeof locationScope.resolveAuthorizedLocationScope, "function");
  const resolveAuthorizedLocationScope = locationScope.resolveAuthorizedLocationScope as (input: {
    organizationWide: boolean;
    accessibleLocationIds: string[];
    requestedLocationId: string | null;
  }) => { locationIds: string[] | null; selectedLocationId: string | null };

  assert.deepEqual(resolveAuthorizedLocationScope({
    organizationWide: false,
    accessibleLocationIds: ["north", "south"],
    requestedLocationId: null,
  }), {
    locationIds: ["north", "south"],
    selectedLocationId: null,
  });
  assert.deepEqual(resolveAuthorizedLocationScope({
    organizationWide: true,
    accessibleLocationIds: ["north", "south"],
    requestedLocationId: null,
  }), {
    locationIds: null,
    selectedLocationId: null,
  });
});

test("an explicit inaccessible location is rejected instead of broadening scope", async () => {
  const locationScope = await import("../domain/location-scope.ts") as Record<string, unknown>;
  assert.equal(typeof locationScope.resolveAuthorizedLocationScope, "function");
  const resolveAuthorizedLocationScope = locationScope.resolveAuthorizedLocationScope as (input: {
    organizationWide: boolean;
    accessibleLocationIds: string[];
    requestedLocationId: string | null;
  }) => unknown;

  assert.throws(() => resolveAuthorizedLocationScope({
    organizationWide: false,
    accessibleLocationIds: ["north"],
    requestedLocationId: "south",
  }), /not accessible/i);
});
