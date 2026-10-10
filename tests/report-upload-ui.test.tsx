import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { BookloqImportActions, ExpensesPanel, type BookLoQData } from "../app/bookloq-workspace";
import BookloqStatementImport from "../app/bookloq-statement-import";
import { ReportImportPrivacyNotice } from "../app/report-import-privacy";
import { appendImportPrivacyAcknowledgement, REPORT_IMPORT_PRIVACY_VERSION } from "../domain/report-import-privacy";

// Execute the production upload closures without mounting unrelated authenticated workspaces.
// Rendering uses the actual upload JSX, rather than a second implementation of its controls.
const documents = ts.createSourceFile("control-workspaces.tsx", readFileSync(new URL("../app/control-workspaces.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const bookloq = ts.createSourceFile("bookloq-workspace.tsx", readFileSync(new URL("../app/bookloq-workspace.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(node: ts.Node, predicate: (item: ts.Node) => boolean): ts.Node | undefined {
  if (predicate(node)) return node;
  return ts.forEachChild(node, child => find(child, predicate));
}
function expression(node: ts.Node, source: ts.SourceFile, bindings: Record<string, unknown>): unknown {
  const code = ts.transpileModule(`function bind(scope) { const {${Object.keys(bindings).join(",")}} = scope; return (${node.getText(source)}); }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
  return new Function("React", `${code};return bind;`)(React)(bindings);
}
function uploadClosure(source: ts.SourceFile, name: string, bindings: Record<string, unknown>) {
  const component = find(source, node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(component);
  const declaration = find(component, node => ts.isVariableDeclaration(node) && node.name.getText(source) === "upload") as ts.VariableDeclaration | undefined;
  assert.ok(declaration?.initializer);
  return expression(declaration.initializer, source, bindings) as (file: File | null) => Promise<void>;
}
const categoryDeclaration = find(documents, node => ts.isVariableDeclaration(node) && node.name.getText(documents) === "documentUploadCategories") as ts.VariableDeclaration;
const documentUploadCategories = expression(categoryDeclaration.initializer!, documents, {}) as { id: string; label: string; type: string }[];
const noop = () => {};
const file = new File(["fictional file"], "fixture.pdf", { type: "application/pdf" });
function harness(kind: "documents" | "receipt", overrides: Record<string, unknown> = {}) {
  const requests: { url: string; init: RequestInit }[] = [], accepted: boolean[] = [], errors: string[] = [];
  const base = {
    canUpload: true, canUploadDocuments: true, uploadAccepted: true, uploading: false,
    uploadCategory: "financial_statement", documentUploadCategories, appendImportPrivacyAcknowledgement,
    setUploading: noop, setUploadError: (value: string) => errors.push(value), setUploadAccepted: (value: boolean) => accepted.push(value),
    setData: noop, showNotice: noop, refresh: async () => {}, apiMessage: (_body: unknown, fallback: string) => fallback,
    apiFetch: async (url: string, init: RequestInit) => { requests.push({ url, init }); return Response.json({ documents: [] }); },
    bookloqRequest: async (_fetcher: unknown, url: string, init: RequestInit) => { requests.push({ url, init }); return {}; },
    ...overrides,
  };
  return { requests, accepted, errors, upload: uploadClosure(kind === "documents" ? documents : bookloq, kind === "documents" ? "DocumentsWorkspace" : "ExpensesPanel", base) };
}

test("both upload handlers refuse unchecked consent, revoked upload permission, busy state and absent files", async () => {
  for (const kind of ["documents", "receipt"] as const) {
    for (const change of [{ uploadAccepted: false }, { canUpload: false, canUploadDocuments: false }, { uploading: true }]) {
      const fixture = harness(kind, change); await fixture.upload(file); assert.equal(fixture.requests.length, 0, `${kind} must not send`);
    }
    const fixture = harness(kind); await fixture.upload(null); assert.equal(fixture.requests.length, 0);
  }
});

test("an accepted financial statement upload uses the existing evidence category and current multipart acknowledgement", async () => {
  const fixture = harness("documents"); await fixture.upload(file);
  assert.equal(fixture.requests.length, 1);
  const request = fixture.requests[0]; assert.equal(request.url, "/api/v1/documents"); assert.equal(request.init.method, "POST");
  const form = request.init.body as FormData;
  assert.equal(form.get("documentType"), "other"); assert.equal((form.get("file") as File).name, "fixture.pdf");
  assert.equal(form.get("importPrivacyVersion"), REPORT_IMPORT_PRIVACY_VERSION); assert.equal(form.get("importPrivacyAccepted"), "true");
  assert.deepEqual(fixture.accepted, [false], "a successful upload requires a fresh acknowledgement for the next file");
});

test("an accepted expense upload remains a receipt and resets its acknowledgement after success", async () => {
  const fixture = harness("receipt"); await fixture.upload(file);
  assert.equal(fixture.requests.length, 1); assert.equal(fixture.requests[0].url, "/api/v1/documents");
  const form = fixture.requests[0].init.body as FormData;
  assert.equal(form.get("documentType"), "receipt"); assert.equal(form.get("importPrivacyVersion"), REPORT_IMPORT_PRIVACY_VERSION);
  assert.equal(form.get("importPrivacyAccepted"), "true"); assert.deepEqual(fixture.accepted, [false]);
});

test("an unconfirmed receipt upload remains retryable and reports uncertainty", async () => {
  const fixture = harness("receipt", { bookloqRequest: async () => { throw new Error("The upload was not confirmed."); } });
  await fixture.upload(file); assert.deepEqual(fixture.accepted, []); assert.match(fixture.errors.at(-1)!, /not confirmed/);
});

test("Documents renders a clear category choice and disables its actual file input until acceptance", () => {
  const card = find(documents, node => ts.isJsxElement(node) && node.openingElement.tagName.getText(documents) === "section" && node.openingElement.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(documents) === "className" && attribute.initializer && ts.isStringLiteral(attribute.initializer) && attribute.initializer.text === "document-upload card"));
  assert.ok(card);
  const render = (uploadAccepted: boolean) => renderToStaticMarkup(expression(card, documents, {
    uploadHeading: { current: null }, uploading: false, uploadError: "", uploadCategory: "financial_statement", uploadAccepted,
    documentUploadCategories, setUploadCategory: noop, setUploadAccepted: noop, upload: noop, ReportImportPrivacyNotice,
    DOCUMENT_PROCESSING_NOTICE: "Separate permission is required for external processing.",
  }) as React.ReactElement);
  const unchecked = render(false), accepted = render(true);
  assert.match(unchecked, /Financial statement/); assert.match(unchecked, /Sales report/); assert.match(unchecked, /10 MB/);
  assert.match(unchecked, /does not update sales totals, post a journal or replace your financial statements/);
  assert.match(unchecked, /type="file"[^>]*disabled=""/); assert.doesNotMatch(accepted, /type="file"[^>]*disabled=""/);
  assert.doesNotMatch(unchecked, /type="checkbox"[^>]*checked=""/);
});

test("Expenses exposes neither a picker nor document navigation without their permissions", () => {
  const data = { statements: { accounts: [] }, summary: { totalExpensesCents: null }, organization: { currency: "CAD" }, documentSummary: { receipts: 0, needsReview: 0 } } as unknown as BookLoQData;
  const props = { data, navigate: noop, refresh: async () => {}, showNotice: noop };
  const restricted = renderToStaticMarkup(<ExpensesPanel {...props}/>);
  assert.doesNotMatch(restricted, /type="file"|Open receipt review|type="checkbox"/);
  const allowed = renderToStaticMarkup(<ExpensesPanel {...props} canUploadDocuments canViewDocuments/>);
  assert.match(allowed, /Choose receipt/); assert.match(allowed, /type="file"[^>]*disabled=""/);
  assert.doesNotMatch(allowed, /type="checkbox"[^>]*checked=""/); assert.match(allowed, /does not create an expense/);
});

test("BookLoQ import actions preserve document and bank review permissions and exact destinations", () => {
  const calls: string[] = [];
  const props = { canUploadDocuments: true, canViewDocuments: true, canImportStatement: true, navigate: (view: "Documents") => calls.push(view), openStatementImport: () => calls.push("Banking import") };
  assert.equal(BookloqImportActions({ ...props, canViewDocuments: false }), null);
  const restricted = renderToStaticMarkup(<BookloqImportActions {...props} canUploadDocuments={false} canImportStatement={false}/>);
  assert.match(restricted, /Review documents/); assert.doesNotMatch(restricted, /<button[^>]*>Upload documents|Import bank statement/);
  const tree = BookloqImportActions(props)!;
  const actionGroup = React.Children.toArray(tree.props.children)[1] as React.ReactElement<{ children: React.ReactNode }>;
  const buttons = React.Children.toArray(actionGroup.props.children) as React.ReactElement<{ onClick: () => void }>[];
  buttons.forEach(button => button.props.onClick()); assert.deepEqual(calls, ["Documents", "Banking import"]);
});

test("statement import opens only when its caller explicitly requests the expanded entry", () => {
  const props = { currency: "CAD", onComplete: async () => {} };
  const closed = renderToStaticMarkup(<BookloqStatementImport {...props}/>);
  const opened = renderToStaticMarkup(<BookloqStatementImport {...props} initialOpen/>);
  assert.match(closed, /aria-expanded="false"/); assert.doesNotMatch(closed, /Step 1 of 3/);
  assert.match(opened, /aria-expanded="true"/); assert.match(opened, /Step 1 of 3/);
});
