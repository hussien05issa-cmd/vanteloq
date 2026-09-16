import assert from "node:assert/strict";
import test from "node:test";
import { createEnvironment, createReportWorkspace, dispatch, identityHeaders, origin, context } from "./helpers/retail-worker-fixture.mjs";

test("built document deletion preserves permission, origin, tenant and retry boundaries", { timeout: 120000 }, async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  try {
    const { organizationId, userId, owner } = await createReportWorkspace(worker, environment, database, "delete-files");
    let fail = true, deletes = 0;
    environment.BUCKET = { delete: async () => { deletes++; if (fail) throw new Error("private storage failure"); } };
    const documentId = crypto.randomUUID();
    await database.prepare(`INSERT INTO workspace_documents(id,organization_id,document_type,file_name,object_key,content_type,size_bytes,sha256_hex,security_state,status,scan_status,extraction_status,uploaded_by_user_id,created_at,updated_at)
      VALUES (?,?,'bank_statement','Fictional statement.pdf',?,'application/pdf',100,?,'quarantined','review_required','pending','not_configured',?,1,1)`)
      .bind(documentId, organizationId, `${organizationId}/private.pdf`, documentId, userId).run();
    const remove = (id = documentId) => dispatch(worker, environment, `/api/v1/documents?id=${id}`, { ...owner, method: "DELETE" });
    await database.prepare("UPDATE memberships SET role='manager' WHERE organization_id=? AND user_id=?").bind(organizationId,userId).run();
    assert.equal((await remove()).status, 403);
    await database.prepare("UPDATE memberships SET role='owner' WHERE organization_id=? AND user_id=?").bind(organizationId,userId).run();
    const crossHeaders = identityHeaders(owner.email, owner.name, true);
    crossHeaders.origin = "https://other.example.invalid"; crossHeaders["sec-fetch-site"] = "cross-site";
    const denied = await worker.fetch(new Request(`${origin}/api/v1/documents?id=${documentId}`, { method: "DELETE", headers: crossHeaders }), environment, context);
    assert.equal(denied.status,403); assert.equal(deletes,0);
    const pending = await remove(); assert.equal(pending.status,202,await pending.clone().text());
    assert.equal((await pending.json()).deleted,false);
    const inaccessible = await dispatch(worker,environment,`/api/v1/documents?id=${documentId}`,owner);
    assert.equal(inaccessible.status,409);
    const processing = await dispatch(worker,environment,"/api/v1/documents",{...owner,method:"PATCH",body:{id:documentId,noticeVersion:"test"}});
    assert.equal(processing.status,409);
    fail = false;
    const completed = await remove(); assert.equal(completed.status,200,await completed.clone().text()); assert.equal((await completed.json()).deleted,true);
    assert.equal((await remove()).status,200); assert.equal(deletes,2);
    assert.equal(await database.prepare("SELECT id FROM workspace_documents WHERE id=?").bind(documentId).first(),null);
  } finally { await dispose(); }
});
