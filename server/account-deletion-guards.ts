// Bind the organization twice. Keep provider cleanup references until the
// existing Documents workflows have disposed of them and released their claims.
export const WORKSPACE_DOCUMENTS_DISPOSED_SQL = `NOT EXISTS(
  SELECT 1 FROM workspace_documents WHERE organization_id=? AND (
    status='deletion_pending' OR NOT json_valid(extracted_json)
    OR json_extract(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.processing.lock') IS NOT NULL
    OR json_extract(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.processing.operation') IS NOT NULL
    OR json_extract(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.processing.azureScan') IS NOT NULL
    OR json_extract(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.processing.cleanupPending')=1
  )
) AND NOT EXISTS(SELECT 1 FROM document_ingest_intents WHERE organization_id=?)`;

// A processing claim and workspace confirmation serialize through D1: either
// the claim wins and deletion waits, or confirmation wins and no copy is sent.
export const DOCUMENT_PROCESSING_NOT_DELETING_SQL = `NOT EXISTS(
  SELECT 1 FROM account_deletion_jobs WHERE stage IN('confirmed','local_deleted')
    AND (user_id=? OR (scope='workspace' AND organization_id=?))
)`;
