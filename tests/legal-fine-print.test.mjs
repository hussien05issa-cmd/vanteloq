import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { TERMS_OF_SERVICE_VERSION, PRIVACY_POLICY_VERSION, LEGAL_DOCUMENT_UPDATED_LABEL } from "../shared/legal-versions.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("privacy notice explains financial connections, document review, and consent controls", () => {
  const privacy = read("../app/privacy/page.tsx");

  for (const phrase of [
    "Plaid as a service provider",
    "read-only data products",
    "does not allow Vanteloq to move money",
    "provider access credentials",
    "uploaded source documents",
    "Processing outside Canada",
    "express or implied consent",
    "Document extraction can misread",
    "financial-data authorization",
    "TLS 1.2",
    "additional application-level AES-GCM encryption layer",
    "Vanteloq AI data-use acceptance",
    "the agreement starts unchecked",
    "Clearing a conversation",
    "full account numbers",
  ]) assert.match(privacy, new RegExp(phrase));
});

test("terms keep bookkeeping, extraction, and commercial messages within reviewed boundaries", () => {
  const terms = read("../app/terms/page.tsx");

  for (const phrase of [
    "approved read-only data categories",
    "does not automatically erase imported transactions",
    "an applicable CASL exception",
    "remain proposed values",
    "Vanteloq and BookLoQ do not replace",
    "does not move money",
  ]) assert.match(terms, new RegExp(phrase));
});

test("Advisory inquiries have named privacy purposes and do not create a paid or regulated engagement", () => {
  const privacy = read("../app/privacy/page.tsx");
  const terms = read("../app/terms/page.tsx");
  const providers = read("../app/subprocessors/page.tsx");
  const processing = read("../app/data-processing/page.tsx");
  const legal = read("../app/legal/page.tsx");

  assert.match(privacy, /Public inquiries and Vanteloq Advisory/);
  assert.match(privacy, /limited consent evidence/);
  assert.match(privacy, /does not enroll you in marketing, create a subscription or create a paid Advisory engagement/);
  assert.match(providers, /free demo and Vanteloq Advisory requests/);
  assert.match(terms, /does not create a paid engagement, professional retainer, subscription, payment obligation/);
  assert.match(terms, /does not provide legal, tax, audit, assurance, investment or other regulated professional advice/);
  assert.match(processing, /public Vanteloq Advisory inquiry is used by Vanteloq to manage its own prospective customer relationship/);
  assert.match(legal, /does not create a paid engagement or professional retainer/);
});

test("legal and retention documents identify the operator and retain deletion limits", () => {
  const legal = read("../app/legal/page.tsx");
  const retention = read("../docs/DATA_RETENTION.md");
  const shell = read("../app/legal-shell.tsx");
  const versions = read("../shared/legal-versions.ts");

  assert.match(legal, /Vanteloq Inc\./);
  assert.doesNotMatch(legal, /2855706|LexEdge/i);
  assert.match(legal, /does not guarantee sales, profit, legal compliance/);
  assert.match(retention, /Disconnection is not the same as deletion of lawfully retained accounting records/);
  assert.match(retention, /unsubscribe and suppression records/i);
  assert.match(retention, /six years from the end of the last tax year/);
  assert.match(retention, /DELETE PLAID DATA/);
  assert.match(retention, /quarterly operational review/);
  assert.match(shell, /LEGAL_DOCUMENT_UPDATED_LABEL/);
  const latestPolicy = [TERMS_OF_SERVICE_VERSION, PRIVACY_POLICY_VERSION].sort().at(-1);
  assert.equal(LEGAL_DOCUMENT_UPDATED_LABEL, new Intl.DateTimeFormat("en-US", {month:"long", day:"numeric", year:"numeric", timeZone:"UTC"}).format(new Date(latestPolicy+"T00:00:00Z")));

  for (const document of [legal, retention, shell, versions]) assert.doesNotMatch(document, /\u2014/);
});
