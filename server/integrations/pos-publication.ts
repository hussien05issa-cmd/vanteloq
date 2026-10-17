export const POS_FINANCIAL_CONTRACT = "pos-financial-v2";

/** The proof describes a complete canonical cohort, not a claim that an empty
 * business day was open, closed, or had zero sales. */
export function withPosPublicationProof(cursor: string, importId: string, metricRowCount: number, syncVersion: number) {
  if (!importId || !Number.isSafeInteger(metricRowCount) || metricRowCount < 0 || !Number.isSafeInteger(syncVersion) || syncVersion < 1) throw new Error("Invalid POS publication proof.");
  return JSON.stringify({ ...JSON.parse(cursor), publication: { contract: POS_FINANCIAL_CONTRACT, importId, metricRowCount, syncVersion } });
}

/** Only constant, code-owned SQL aliases are accepted. Current rows must all
 * belong to the attested import. This also rejects an old worker's partial
 * rewrite or deletion after its lease expires, even if it retained a new cursor. */
export function verifiedPosPublicationSql(alias: string) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error("Invalid SQL alias.");
  const cursor = `(CASE WHEN json_valid(${alias}.last_sync_cursor) THEN ${alias}.last_sync_cursor ELSE '{}' END)`;
  const imported = `json_extract(${cursor}, '$.publication.importId')`;
  return `(${alias}.provider NOT IN ('shopify','shopify-pos','lightspeed-r') OR (
    json_extract(${cursor}, '$.version') = CASE WHEN ${alias}.provider = 'lightspeed-r' THEN 6 ELSE 2 END
    AND json_type(${cursor}, '$.publication.syncVersion') = 'integer'
    AND json_extract(${cursor}, '$.publication.syncVersion') = ${alias}.sync_version
    AND json_extract(${cursor}, '$.publication.contract') = '${POS_FINANCIAL_CONTRACT}'
    AND json_type(${cursor}, '$.publication.importId') = 'text' AND length(${imported}) > 0
    AND json_type(${cursor}, '$.publication.metricRowCount') = 'integer'
    AND json_extract(${cursor}, '$.publication.metricRowCount') >= 0
    AND EXISTS (SELECT 1 FROM data_imports publication_import WHERE publication_import.id = ${imported}
      AND publication_import.organization_id = ${alias}.organization_id AND publication_import.status = 'completed')
    AND (SELECT count(*) FROM daily_business_metrics publication_metric
      WHERE publication_metric.organization_id = ${alias}.organization_id AND publication_metric.source_connection_id = ${alias}.id)
      = json_extract(${cursor}, '$.publication.metricRowCount')
    AND NOT EXISTS (SELECT 1 FROM daily_business_metrics publication_metric
      WHERE publication_metric.organization_id = ${alias}.organization_id AND publication_metric.source_connection_id = ${alias}.id
        AND (publication_metric.source_provider IS NOT ${alias}.provider OR publication_metric.source_import_id IS NOT ${imported}))
  ))`;
}
