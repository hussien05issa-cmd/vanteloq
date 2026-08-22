import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../server/api.ts";
import {
  addressCompleteReadiness,
  findAddressCompleteSuggestions,
  retrieveAddressCompleteAddress,
  createAddressVerificationToken,
  verifyAddressVerificationToken,
} from "../server/address/address-complete.ts";

test("AddressComplete remains disabled without a server-side key", () => {
  assert.deepEqual(addressCompleteReadiness({}), {
    configured: false,
    provider: "canada_post_addresscomplete",
  });
});

test("AddressComplete Find sends the secret only to Canada Post and sanitizes suggestions", async () => {
  const requests: URL[] = [];
  const suggestions = await findAddressCompleteSuggestions({
    search: "10155 102 street",
    country: "CA",
    key: "AA11-AA11-AA11-AA11",
    fetcher: async (input) => {
      requests.push(new URL(String(input)));
      return Response.json({ Items: [
        { Id: "CAN|CP|ENG|AB-Edmonton-10155-102", Text: "10155 102 St NW", Description: "Edmonton, AB, T5J 4G8", Next: "Retrieve" },
        { Id: "unsafe", Text: "Ignored", Description: "Ignored", Next: "Unexpected" },
      ] });
    },
  });

  assert.equal(requests[0]?.origin, "https://ws1.postescanada-canadapost.ca");
  assert.equal(requests[0]?.searchParams.get("Key"), "AA11-AA11-AA11-AA11");
  assert.deepEqual(suggestions, [{
    id: "CAN|CP|ENG|AB-Edmonton-10155-102",
    text: "10155 102 St NW",
    description: "Edmonton, AB, T5J 4G8",
    next: "Retrieve",
  }]);
});

test("AddressComplete Retrieve returns only a premise-level normalized address", async () => {
  const address = await retrieveAddressCompleteAddress({
    id: "CAN|CP|ENG|AB-Edmonton-10155-102",
    key: "AA11-AA11-AA11-AA11",
    fetcher: async () => Response.json({ Items: [{
      Id: "CAN|CP|ENG|AB-Edmonton-10155-102",
      Line1: "10155 102 St NW",
      Line2: "Suite 1200",
      City: "Edmonton",
      ProvinceCode: "AB",
      PostalCode: "T5J 4G8",
      CountryIso2: "CA",
      DataLevel: "Premise",
    }] }),
  });

  assert.deepEqual(address, {
    providerId: "CAN|CP|ENG|AB-Edmonton-10155-102",
    address: "10155 102 St NW, Suite 1200",
    city: "Edmonton",
    province: "AB",
    postalCode: "T5J 4G8",
    country: "CA",
    validationStatus: "validated",
  });
});

test("the browser receives a short-lived signed address proof that cannot be altered", async () => {
  const address = {
    providerId: "CAN|CP|ENG|AB-Edmonton-10155-102",
    address: "10155 102 St NW",
    city: "Edmonton",
    province: "AB",
    postalCode: "T5J 4G8",
    country: "CA",
    validationStatus: "validated" as const,
  };
  const key = "AA11-AA11-AA11-AA11";
  const now = 1_787_100_000_000;
  const token = await createAddressVerificationToken(address, key, now);
  assert.deepEqual(await verifyAddressVerificationToken(token, key, now + 60_000), address);
  await assert.rejects(
    verifyAddressVerificationToken(`${token.slice(0, -1)}x`, key, now + 60_000),
    (error: unknown) => error instanceof ApiError && error.code === "ADDRESS_VERIFICATION_REQUIRED",
  );
});

test("AddressComplete fails closed when the provider does not confirm a premise", async () => {
  await assert.rejects(
    retrieveAddressCompleteAddress({
      id: "CAN|CP|ENG|AB-Edmonton-102-Street",
      key: "AA11-AA11-AA11-AA11",
      fetcher: async () => Response.json({ Items: [{
        Id: "CAN|CP|ENG|AB-Edmonton-102-Street",
        Line1: "102 St NW",
        City: "Edmonton",
        ProvinceCode: "AB",
        PostalCode: "T5J 4G8",
        CountryIso2: "CA",
        DataLevel: "Street",
      }] }),
    }),
    (error: unknown) => error instanceof ApiError && error.code === "ADDRESS_NOT_PREMISE_VERIFIED",
  );
});
