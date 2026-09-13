import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";

function statements(sql) {
  return sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean);
}

async function applyMigration(database, file) {
  const sql = await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
  await database.batch(statements(sql).map((statement) => database.prepare(statement)));
}

test("Drizzle snapshots form one continuous journal chain", async () => {
  const metaUrl = new URL("../drizzle/meta/", import.meta.url);
  const journal = JSON.parse(await readFile(new URL("_journal.json", metaUrl), "utf8"));
  const snapshotFiles = new Set(
    (await readdir(metaUrl)).filter((file) => /^\d{4}_snapshot\.json$/.test(file)),
  );
  const snapshots = [];

  for (const entry of journal.entries) {
    const file = `${String(entry.idx).padStart(4, "0")}_snapshot.json`;
    if (!snapshotFiles.has(file)) continue;
    snapshots.push({ file, snapshot: JSON.parse(await readFile(new URL(file, metaUrl), "utf8")) });
  }

  assert.equal(
    snapshots.length,
    snapshotFiles.size,
    "every snapshot must correspond to an ordered migration journal entry",
  );
  for (let index = 1; index < snapshots.length; index += 1) {
    const previous = snapshots[index - 1];
    const current = snapshots[index];
    assert.equal(
      current.snapshot.prevId,
      previous.snapshot.id,
      `${current.file} must link to the preceding journal snapshot ${previous.file}`,
    );
  }
});

test("the founder migration preserves populated foreign-key relationships", async () => {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: `vanteloq-incremental-${crypto.randomUUID()}` },
  });
  try {
    const database = await miniflare.getD1Database("DB");
    const migrations = (await readdir(new URL("../drizzle/", import.meta.url)))
      .filter((file) => /^\d{4}.*\.sql$/.test(file))
      .sort();
    for (const migration of migrations.filter((file) => file < "0014")) await applyMigration(database, migration);

    const now = Date.now();
    await database.batch([
      database.prepare(`INSERT INTO users (id, email, display_name, status, created_at, updated_at)
        VALUES ('existing-user', 'existing@example.invalid', 'Existing Owner', 'active', ?, ?)`).bind(now, now),
      database.prepare(`INSERT INTO workspaces
        (id, owner_name, business_name, legal_name, business_email, phone, website, industry, country,
         province, city, address, postal_code, timezone, currency, fiscal_year_start, tax_number,
         hours_json, source_mode, selected_pos, setup_complete, created_at, updated_at)
        VALUES ('existing-workspace', 'Existing Owner', 'Existing Store', 'Existing Store Ltd.',
         'store@example.invalid', '', '', 'Retail', 'CA', 'AB', 'Edmonton', '1 Existing Avenue',
         'T5A 1A1', 'America/Edmonton', 'CAD', 'January', '', '[]', 'connect_later', '', 1, ?, ?)`).bind(now, now),
      database.prepare(`INSERT INTO memberships
        (id, user_id, organization_id, role, status, created_at, updated_at)
        VALUES ('existing-membership', 'existing-user', 'existing-workspace', 'owner', 'active', ?, ?)`).bind(now, now),
    ]);

    await applyMigration(database, migrations.find((file) => file.startsWith("0014_")));

    const membership = await database.prepare("SELECT user_id, organization_id FROM memberships WHERE id = 'existing-membership'").first();
    const user = await database.prepare("SELECT id, auth_subject, auth_provider FROM users WHERE id = 'existing-user'").first();
    assert.deepEqual(membership, { user_id: "existing-user", organization_id: "existing-workspace" });
    assert.deepEqual(user, { id: "existing-user", auth_subject: null, auth_provider: null });
    assert.equal((await database.prepare("PRAGMA foreign_key_check").all()).results.length, 0);
    for (const migration of migrations.filter(file => file >= "0015" && file < "0047")) await applyMigration(database, migration);
    await database.prepare(`INSERT INTO data_imports(id,organization_id,import_type,status,file_name,row_count,idempotency_key,imported_by_user_id,created_at)
      VALUES ('preserved-import','existing-workspace','manual_entry','completed','Existing import',1,'preserved-import','existing-user',?)`).bind(now).run();
    await database.prepare(`INSERT INTO daily_business_metrics(organization_id,business_date,location_ref,gross_sales_cents,net_sales_cents,cost_of_goods_cents,transaction_count,units_sold,source_import_id,created_by_user_id,created_at,updated_at)
      VALUES ('existing-workspace','2026-09-12','existing-outlet',10000,9500,4000,5,7,'preserved-import','existing-user',?,?)`).bind(now,now).run();
    const metricBefore = await database.prepare("SELECT * FROM daily_business_metrics").first();
    await applyMigration(database,migrations.find(file => file.startsWith('0047_')));
    assert.deepEqual(await database.prepare("SELECT * FROM daily_business_metrics").first(),metricBefore);
    await database.prepare("UPDATE daily_business_metrics SET net_sales_cents=-2000,cost_of_goods_cents=-800,refunds_cents=2000 WHERE id=?").bind(metricBefore.id).run();
    assert.equal((await database.prepare("SELECT net_sales_cents net FROM daily_business_metrics WHERE id=?").bind(metricBefore.id).first()).net,-2000);
    await assert.rejects(database.prepare("UPDATE daily_business_metrics SET refunds_cents=-1 WHERE id=?").bind(metricBefore.id).run(),/CHECK constraint/);
    assert.equal((await database.prepare("PRAGMA foreign_key_check").all()).results.length,0);
  } finally {
    await miniflare.dispose();
  }
});

test("connector lineage, privacy metadata and both document quarantine layers survive the preserved 0023 through 0025 upgrade", async () => {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: `vanteloq-connectors-${crypto.randomUUID()}` },
  });
  try {
    const database = await miniflare.getD1Database("DB");
    const migrations = (await readdir(new URL("../drizzle/", import.meta.url)))
      .filter((file) => /^\d{4}.*\.sql$/.test(file))
      .sort();
    for (const migration of migrations.filter((file) => file < "0023")) await applyMigration(database, migration);

    const now = Date.now();
    await database.batch([
      database.prepare(`INSERT INTO users (id, email, display_name, status, created_at, updated_at)
        VALUES ('connector-user', 'connector@example.invalid', 'Connector Owner', 'active', ?, ?)`).bind(now, now),
      database.prepare(`INSERT INTO workspaces
        (id, owner_name, business_name, legal_name, business_email, phone, website, industry, country,
         province, city, address, postal_code, timezone, currency, fiscal_year_start, tax_number,
         hours_json, source_mode, selected_pos, setup_complete, created_at, updated_at)
        VALUES ('connector-workspace', 'Connector Owner', 'Connector Store', 'Connector Store Ltd.',
         'connector@example.invalid', '', '', 'Retail', 'CA', 'AB', 'Edmonton', '1 Connector Avenue',
         'T5A 1A1', 'America/Edmonton', 'CAD', 'January', '', '[]', 'connect_later', '', 1, ?, ?)`).bind(now, now),
      database.prepare(`INSERT INTO integration_connections
        (id, organization_id, provider, status, external_account_ref, data_promotion_status, created_at, updated_at)
        VALUES ('legacy-connection', 'connector-workspace', 'lightspeed-r', 'connected', 'account-1', 'staging', ?, ?)`).bind(now, now),
      database.prepare(`INSERT INTO integration_secrets
        (id, organization_id, provider, access_token_ciphertext, refresh_token_ciphertext, token_expires_at, created_at, updated_at)
        VALUES ('legacy-secret', 'connector-workspace', 'lightspeed-r', 'access', 'refresh', ?, ?, ?)`).bind(now + 60_000, now, now),
      database.prepare(`INSERT INTO integration_oauth_states
        (state_hash, organization_id, actor_user_id, provider, expires_at, created_at)
        VALUES ('legacy-state', 'connector-workspace', 'connector-user', 'lightspeed-r', ?, ?)`).bind(now + 60_000, now),
      database.prepare(`INSERT INTO integration_location_mappings
        (id, organization_id, provider, external_location_ref, external_name, status, last_seen_at, created_at, updated_at)
        VALUES ('legacy-mapping', 'connector-workspace', 'lightspeed-r', 'shop-1', 'Main shop', 'mapped', ?, ?, ?)`).bind(now, now, now),
      database.prepare(`INSERT INTO integration_sync_runs
        (id, organization_id, provider, mode, status, started_at, completed_at)
        VALUES ('legacy-run', 'connector-workspace', 'lightspeed-r', 'incremental', 'completed', ?, ?)`).bind(now, now),
      database.prepare(`INSERT INTO integration_staged_sales
        (id, organization_id, provider, external_sale_id, external_version, outlet_ref, sold_at, state,
         total_cents, source_payload_hash, sync_run_id, staged_at)
        VALUES ('legacy-stage-sale', 'connector-workspace', 'lightspeed-r', 'sale-1', 'v1', 'shop-1',
         '2026-08-10T12:00:00Z', 'completed', 1000, 'sale-hash', 'legacy-run', ?)`).bind(now),
      database.prepare(`INSERT INTO integration_staged_financial_records
        (id, organization_id, provider, external_record_id, record_type, category, occurred_at, currency,
         gross_cents, fee_cents, net_cents, state, source_payload_hash, sync_run_id, staged_at)
        VALUES ('legacy-stage-finance', 'connector-workspace', 'lightspeed-r', 'finance-1', 'balance_transaction',
         'charge', '2026-08-10T12:00:00Z', 'CAD', 1000, 100, 900, 'available', 'finance-hash', 'legacy-run', ?)`).bind(now),
      database.prepare(`INSERT INTO integration_webhook_events
        (id, organization_id, provider, payload_hash, signature_hash, event_type, external_object_ref, status, received_at)
        VALUES ('legacy-webhook', 'connector-workspace', 'lightspeed-r', 'payload-hash', 'signature-hash', 'sale.updated', 'sale-1', 'queued', ?)`).bind(now),
      database.prepare(`INSERT INTO commerce_products
        (id, organization_id, provider, external_product_id, sku, name, source_payload_hash, sync_run_id, updated_at)
        VALUES ('legacy-product', 'connector-workspace', 'lightspeed-r', 'product-1', 'SKU-1', 'Product 1', 'product-hash', 'legacy-run', ?)`).bind(now),
      database.prepare(`INSERT INTO commerce_customers
        (id, organization_id, provider, external_customer_id, display_name, source_payload_hash, sync_run_id, updated_at)
        VALUES ('legacy-customer', 'connector-workspace', 'lightspeed-r', 'customer-1', 'Customer 1', 'customer-hash', 'legacy-run', ?)`).bind(now),
      database.prepare(`INSERT INTO commerce_suppliers
        (id, organization_id, provider, external_supplier_id, name, source_payload_hash, sync_run_id, updated_at)
        VALUES ('legacy-supplier', 'connector-workspace', 'lightspeed-r', 'supplier-1', 'Supplier 1', 'supplier-hash', 'legacy-run', ?)`).bind(now),
      database.prepare(`INSERT INTO commerce_sale_lines
        (id, organization_id, provider, external_sale_id, external_line_id, product_ref, outlet_ref,
         sold_at, sku, product_name, quantity_milli, net_sales_cents, source_payload_hash, sync_run_id, updated_at)
        VALUES ('legacy-line', 'connector-workspace', 'lightspeed-r', 'sale-1', 'line-1', 'product-1', 'shop-1',
         '2026-08-10T12:00:00Z', 'SKU-1', 'Product 1', 1000, 1000, 'line-hash', 'legacy-run', ?)`).bind(now),
      database.prepare(`INSERT INTO commerce_payments
        (id, organization_id, provider, external_payment_id, external_sale_id, amount_cents,
         source_payload_hash, sync_run_id, updated_at)
        VALUES ('legacy-payment', 'connector-workspace', 'lightspeed-r', 'payment-1', 'sale-1', 1000,
         'payment-hash', 'legacy-run', ?)`).bind(now),
      database.prepare(`INSERT INTO workspace_documents
        (id, organization_id, document_type, file_name, object_key, content_type, size_bytes, sha256_hex,
         status, extraction_status, extracted_json, uploaded_by_user_id, created_at, updated_at)
        VALUES ('legacy-document', 'connector-workspace', 'invoice', 'invoice.pdf', 'quarantine/invoice.pdf',
         'application/pdf', 128, 'document-hash', 'review_required', 'not_configured', '{}', 'connector-user', ?, ?)`).bind(now, now),
    ]);

    const canonicalMigrations = [
      "0023_careless_shooting_star.sql",
      "0024_thick_mysterio.sql",
      "0025_talented_gateway.sql",
    ];
    for (const migration of canonicalMigrations) {
      assert.ok(migrations.includes(migration), `${migration} must remain in the deployed migration history`);
      await applyMigration(database, migration);
    }

    await database.batch([
      database.prepare(`INSERT INTO integration_connections
        (id, organization_id, provider, source_namespace, status, external_account_ref, data_promotion_status, created_at, updated_at)
        VALUES ('second-connection', 'connector-workspace', 'lightspeed-r', 'account-2', 'connected', 'account-2', 'staging', ?, ?)`).bind(now, now),
      database.prepare(`INSERT INTO integration_secrets
        (id, organization_id, provider, connection_id, access_token_ciphertext, refresh_token_ciphertext,
         token_expires_at, created_at, updated_at)
        VALUES ('second-secret', 'connector-workspace', 'lightspeed-r', 'second-connection', 'access', 'refresh', ?, ?, ?)`).bind(now + 60_000, now, now),
      database.prepare(`INSERT INTO integration_oauth_states
        (state_hash, organization_id, actor_user_id, provider, connection_id, expires_at, created_at)
        VALUES ('second-state', 'connector-workspace', 'connector-user', 'lightspeed-r', 'second-connection', ?, ?)`).bind(now + 60_000, now),
      database.prepare(`INSERT INTO integration_location_mappings
        (id, organization_id, provider, connection_id, external_location_ref, external_name, status,
         last_seen_at, created_at, updated_at)
        VALUES ('second-mapping', 'connector-workspace', 'lightspeed-r', 'second-connection', 'shop-1',
         'Main shop', 'mapped', ?, ?, ?)`).bind(now, now, now),
      database.prepare(`INSERT INTO integration_sync_runs
        (id, organization_id, provider, connection_id, mode, status, started_at, completed_at)
        VALUES ('second-run', 'connector-workspace', 'lightspeed-r', 'second-connection', 'incremental',
         'completed', ?, ?)`).bind(now, now),
      database.prepare(`INSERT INTO integration_staged_sales
        (id, organization_id, provider, connection_id, external_sale_id, external_version, outlet_ref, sold_at,
         state, total_cents, source_payload_hash, sync_run_id, staged_at)
        VALUES ('second-stage-sale', 'connector-workspace', 'lightspeed-r', 'second-connection', 'sale-1', 'v1',
         'shop-1', '2026-08-10T12:00:00Z', 'completed', 1000, 'sale-hash', 'second-run', ?)`).bind(now),
      database.prepare(`INSERT INTO integration_staged_financial_records
        (id, organization_id, provider, connection_id, external_record_id, record_type, category, occurred_at,
         currency, gross_cents, fee_cents, net_cents, state, source_payload_hash, sync_run_id, staged_at)
        VALUES ('second-stage-finance', 'connector-workspace', 'lightspeed-r', 'second-connection', 'finance-1',
         'balance_transaction', 'charge', '2026-08-10T12:00:00Z', 'CAD', 1000, 100, 900, 'available',
         'finance-hash', 'second-run', ?)`).bind(now),
      database.prepare(`INSERT INTO integration_webhook_events
        (id, organization_id, provider, connection_id, payload_hash, signature_hash, event_type,
         external_object_ref, status, received_at)
        VALUES ('second-webhook', 'connector-workspace', 'lightspeed-r', 'second-connection', 'payload-hash',
         'signature-hash', 'sale.updated', 'sale-1', 'queued', ?)`).bind(now),
      database.prepare(`INSERT INTO commerce_products
        (id, organization_id, provider, connection_id, external_product_id, sku, name, source_payload_hash,
         sync_run_id, updated_at)
        VALUES ('second-product', 'connector-workspace', 'lightspeed-r', 'second-connection', 'product-1',
         'SKU-1', 'Product 1', 'product-hash', 'second-run', ?)`).bind(now),
      database.prepare(`INSERT INTO commerce_customers
        (id, organization_id, provider, connection_id, external_customer_id, display_name, source_payload_hash,
         sync_run_id, updated_at)
        VALUES ('second-customer', 'connector-workspace', 'lightspeed-r', 'second-connection', 'customer-1',
         'Customer 1', 'customer-hash', 'second-run', ?)`).bind(now),
      database.prepare(`INSERT INTO commerce_suppliers
        (id, organization_id, provider, connection_id, external_supplier_id, name, source_payload_hash,
         sync_run_id, updated_at)
        VALUES ('second-supplier', 'connector-workspace', 'lightspeed-r', 'second-connection', 'supplier-1',
         'Supplier 1', 'supplier-hash', 'second-run', ?)`).bind(now),
      database.prepare(`INSERT INTO commerce_sale_lines
        (id, organization_id, provider, connection_id, external_sale_id, external_line_id, product_ref, outlet_ref,
         sold_at, sku, product_name, quantity_milli, net_sales_cents, source_payload_hash, sync_run_id, updated_at)
        VALUES ('second-line', 'connector-workspace', 'lightspeed-r', 'second-connection', 'sale-1', 'line-1',
         'product-1', 'shop-1', '2026-08-10T12:00:00Z', 'SKU-1', 'Product 1', 1000, 1000, 'line-hash',
         'second-run', ?)`).bind(now),
      database.prepare(`INSERT INTO commerce_payments
        (id, organization_id, provider, connection_id, external_payment_id, external_sale_id, amount_cents,
         source_payload_hash, sync_run_id, updated_at)
        VALUES ('second-payment', 'connector-workspace', 'lightspeed-r', 'second-connection', 'payment-1',
         'sale-1', 1000, 'payment-hash', 'second-run', ?)`).bind(now),
      database.prepare(`INSERT INTO integration_consents
        (id, organization_id, actor_user_id, provider, status, notice_version, privacy_policy_version,
         data_categories_json, purposes_json, consent_source, accepted_at, created_at, updated_at)
        VALUES ('plaid-consent', 'connector-workspace', 'connector-user', 'plaid', 'accepted', 'notice-v1',
         'privacy-v1', '["accounts","transactions"]', '["cash_intelligence"]', 'in_app', ?, ?, ?)`).bind(now, now, now),
      database.prepare(`UPDATE integration_connections SET privacy_data_deleted_at = ? WHERE id = 'legacy-connection'`).bind(now),
    ]);

    assert.deepEqual(
      await database.prepare(`SELECT source_namespace, sync_lease_owner, sync_lease_expires_at, sync_version,
        privacy_data_deleted_at
        FROM integration_connections WHERE id = 'legacy-connection'`).first(),
      {
        source_namespace: "legacy",
        sync_lease_owner: null,
        sync_lease_expires_at: null,
        sync_version: 0,
        privacy_data_deleted_at: now,
      },
    );
    for (const table of [
      "integration_secrets", "integration_location_mappings", "integration_sync_runs",
      "integration_staged_sales", "integration_staged_financial_records", "integration_webhook_events",
      "commerce_products", "commerce_customers", "commerce_suppliers", "commerce_sale_lines", "commerce_payments",
    ]) {
      const rows = await database.prepare(`SELECT connection_id AS connectionId FROM ${table} ORDER BY connection_id`).all();
      assert.deepEqual(
        rows.results,
        [{ connectionId: "legacy-connection" }, { connectionId: "second-connection" }],
        `${table} keeps its parent lineage and scopes duplicate provider identifiers by connection`,
      );
      assert.equal(
        rows.results.some((row) => row.connectionId === "legacy"),
        false,
        `${table} never retains the migration placeholder as lineage`,
      );
    }
    const oauthStates = await database.prepare(`SELECT state_hash stateHash, connection_id connectionId,
      consumed_at consumedAt FROM integration_oauth_states ORDER BY state_hash`).all();
    assert.equal(oauthStates.results.length, 2);
    const legacyState = oauthStates.results.find((row) => row.stateHash === "legacy-state");
    assert.deepEqual(legacyState, {
      stateHash: "legacy-state",
      connectionId: "legacy-connection",
      consumedAt: null,
    });
    assert.deepEqual(oauthStates.results.find((row) => row.stateHash === "second-state"), {
      stateHash: "second-state",
      connectionId: "second-connection",
      consumedAt: null,
    });
    assert.deepEqual(
      await database.prepare(`SELECT security_state, scan_status, scanned_at, scan_provider FROM workspace_documents
        WHERE id = 'legacy-document'`).first(),
      { security_state: "quarantined", scan_status: "pending", scanned_at: null, scan_provider: null },
    );
    const documentColumns = await database.prepare("PRAGMA table_info(workspace_documents)").all();
    const documentColumnNames = new Set(documentColumns.results.map((column) => column.name));
    assert.equal(documentColumnNames.has("scan_status"), true);
    assert.equal(documentColumnNames.has("scanned_at"), true);
    assert.equal(documentColumnNames.has("scan_provider"), true);
    assert.equal(documentColumnNames.has("security_state"), true, "the deployed quarantine layer remains available");
    assert.deepEqual(
      await database.prepare(`SELECT organization_id, actor_user_id, provider, status, notice_version,
        privacy_policy_version FROM integration_consents WHERE id = 'plaid-consent'`).first(),
      {
        organization_id: "connector-workspace",
        actor_user_id: "connector-user",
        provider: "plaid",
        status: "accepted",
        notice_version: "notice-v1",
        privacy_policy_version: "privacy-v1",
      },
    );
    assert.deepEqual(
      await database.prepare(`SELECT external_location_ref, connection_id FROM integration_location_mappings
        WHERE id = 'legacy-mapping'`).first(),
      { external_location_ref: "shop-1", connection_id: "legacy-connection" },
    );
    assert.equal((await database.prepare("PRAGMA foreign_key_check").all()).results.length, 0);
  } finally {
    await miniflare.dispose();
  }
});

test("the composite schema stores explicit purchase-order lineage and leaves ambiguous or manual lines unbound", async () => {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: `vanteloq-purchase-lineage-${crypto.randomUUID()}` },
  });
  try {
    const database = await miniflare.getD1Database("DB");
    const migrations = (await readdir(new URL("../drizzle/", import.meta.url)))
      .filter((file) => /^\d{4}.*\.sql$/.test(file))
      .sort();
    const compositeMigration = "0025_talented_gateway.sql";
    assert.ok(migrations.includes(compositeMigration), "the composite migration must add exact purchase-order connection lineage");
    for (const migration of migrations.filter((file) => file <= compositeMigration)) {
      await applyMigration(database, migration);
    }

    const now = Date.now();
    await database.batch([
      database.prepare(`INSERT INTO users (id, email, display_name, status, created_at, updated_at)
        VALUES ('lineage-user', 'lineage@example.invalid', 'Lineage Owner', 'active', ?, ?)`).bind(now, now),
      database.prepare(`INSERT INTO workspaces
        (id, owner_name, business_name, legal_name, business_email, phone, website, industry, country,
         province, city, address, postal_code, timezone, currency, fiscal_year_start, tax_number,
         hours_json, source_mode, selected_pos, setup_complete, created_at, updated_at)
        VALUES ('lineage-workspace', 'Lineage Owner', 'Lineage Store', 'Lineage Store Ltd.',
         'lineage@example.invalid', '', '', 'Retail', 'CA', 'AB', 'Edmonton', '1 Lineage Avenue',
         'T5A 1A1', 'America/Edmonton', 'CAD', 'January', '', '[]', 'connect_later', '', 1, ?, ?)`).bind(now, now),
      database.prepare(`INSERT INTO integration_connections
        (id, organization_id, provider, source_namespace, status, external_account_ref,
         data_promotion_status, created_at, updated_at)
        VALUES ('lineage-account-a', 'lineage-workspace', 'lightspeed-r', 'account-a', 'connected',
          'account-a', 'approved', ?, ?)`).bind(now, now),
      database.prepare(`INSERT INTO integration_connections
        (id, organization_id, provider, source_namespace, status, external_account_ref,
         data_promotion_status, created_at, updated_at)
        VALUES ('lineage-account-b', 'lineage-workspace', 'lightspeed-r', 'account-b', 'connected',
          'account-b', 'approved', ?, ?)`).bind(now, now),
      database.prepare(`INSERT INTO integration_sync_runs
        (id, organization_id, provider, connection_id, mode, status, started_at, completed_at)
        VALUES ('lineage-run-a', 'lineage-workspace', 'lightspeed-r', 'lineage-account-a',
          'incremental', 'completed', ?, ?)`).bind(now, now),
      database.prepare(`INSERT INTO integration_sync_runs
        (id, organization_id, provider, connection_id, mode, status, started_at, completed_at)
        VALUES ('lineage-run-b', 'lineage-workspace', 'lightspeed-r', 'lineage-account-b',
          'incremental', 'completed', ?, ?)`).bind(now, now),
      database.prepare(`INSERT INTO commerce_products
        (id, organization_id, provider, connection_id, external_product_id, sku, name,
         source_payload_hash, sync_run_id, updated_at)
        VALUES ('unique-product-a', 'lineage-workspace', 'lightspeed-r', 'lineage-account-a',
          'unique-ref', 'UNIQUE-A', 'Unique product', 'unique-hash', 'lineage-run-a', ?)`).bind(now),
      database.prepare(`INSERT INTO commerce_products
        (id, organization_id, provider, connection_id, external_product_id, sku, name,
         source_payload_hash, sync_run_id, updated_at)
        VALUES ('shared-product-a', 'lineage-workspace', 'lightspeed-r', 'lineage-account-a',
          'shared-ref', 'SHARED-A', 'Shared product A', 'shared-hash-a', 'lineage-run-a', ?)`).bind(now),
      database.prepare(`INSERT INTO commerce_products
        (id, organization_id, provider, connection_id, external_product_id, sku, name,
         source_payload_hash, sync_run_id, updated_at)
        VALUES ('shared-product-b', 'lineage-workspace', 'lightspeed-r', 'lineage-account-b',
          'shared-ref', 'SHARED-B', 'Shared product B', 'shared-hash-b', 'lineage-run-b', ?)`).bind(now),
      database.prepare(`INSERT INTO purchase_orders
        (id, organization_id, order_number, supplier_name, order_date, currency, status,
         subtotal_cents, tax_cents, discount_cents, total_cents, created_by_user_id, created_at, updated_at)
        VALUES ('legacy-po', 'lineage-workspace', 'PO-LEGACY', 'Legacy Supplier', '2026-08-11',
          'CAD', 'draft', 300, 0, 0, 300, 'lineage-user', ?, ?)`).bind(now, now),
      database.prepare(`INSERT INTO purchase_order_lines
        (id, organization_id, purchase_order_id, line_number, provider, connection_id, external_product_ref,
         sku, description, quantity, unit_cost_cents, created_at, updated_at)
        VALUES ('unique-line', 'lineage-workspace', 'legacy-po', 1, 'lightspeed-r', 'lineage-account-a', 'unique-ref',
          'UNIQUE-A', 'Unique product', 1, 100, ?, ?)`).bind(now, now),
      database.prepare(`INSERT INTO purchase_order_lines
        (id, organization_id, purchase_order_id, line_number, provider, connection_id, external_product_ref,
         sku, description, quantity, unit_cost_cents, created_at, updated_at)
        VALUES ('ambiguous-line', 'lineage-workspace', 'legacy-po', 2, 'lightspeed-r', NULL, 'shared-ref',
          'SHARED-A', 'Ambiguous shared product', 1, 100, ?, ?)`).bind(now, now),
      database.prepare(`INSERT INTO purchase_order_lines
        (id, organization_id, purchase_order_id, line_number, sku, description, quantity,
         unit_cost_cents, created_at, updated_at)
        VALUES ('manual-line', 'lineage-workspace', 'legacy-po', 3, 'MANUAL', 'Manual product',
          1, 100, ?, ?)`).bind(now, now),
    ]);

    const rows = await database.prepare(`SELECT id, connection_id AS connectionId
      FROM purchase_order_lines ORDER BY id`).all();
    assert.deepEqual(rows.results, [
      { id: "ambiguous-line", connectionId: null },
      { id: "manual-line", connectionId: null },
      { id: "unique-line", connectionId: "lineage-account-a" },
    ]);
    assert.equal((await database.prepare("PRAGMA foreign_key_check").all()).results.length, 0);
  } finally {
    await miniflare.dispose();
  }
});

test("marketing migrations purge legacy provider content before requiring selected-resource lineage", async () => {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: `vanteloq-marketing-lineage-${crypto.randomUUID()}` },
  });
  try {
    const database = await miniflare.getD1Database("DB");
    const migrations = (await readdir(new URL("../drizzle/", import.meta.url)))
      .filter((file) => /^\d{4}.*\.sql$/.test(file))
      .sort();
    for (const migration of migrations.filter((file) => file < "0027")) await applyMigration(database, migration);

    const now = Date.now();
    await database.batch([
      database.prepare(`INSERT INTO users (id, email, display_name, status, created_at, updated_at)
        VALUES ('marketing-owner', 'marketing@example.invalid', 'Marketing Owner', 'active', ?, ?)`).bind(now, now),
      database.prepare(`INSERT INTO workspaces
        (id, owner_name, business_name, legal_name, business_email, phone, website, industry, country,
         province, city, address, postal_code, timezone, currency, fiscal_year_start, tax_number,
         hours_json, source_mode, selected_pos, setup_complete, created_at, updated_at)
        VALUES ('marketing-workspace', 'Marketing Owner', 'Marketing Store', 'Marketing Store Ltd.',
         'marketing@example.invalid', '', '', 'Retail', 'CA', 'AB', 'Edmonton', '1 Marketing Avenue',
         'T5A 1A1', 'America/Edmonton', 'CAD', 'January', '', '[]', 'connect_later', '', 1, ?, ?)`).bind(now, now),
      database.prepare(`INSERT INTO integration_connections
        (id, organization_id, provider, source_namespace, status, external_account_ref,
         data_promotion_status, last_successful_sync_at, created_at, updated_at)
        VALUES ('google-connection', 'marketing-workspace', 'google', 'google-account', 'connected',
          'google-account', 'approved', ?, ?, ?)`).bind(now, now, now),
      database.prepare(`INSERT INTO marketing_daily_metrics
        (id, organization_id, connection_id, provider, resource_ref, metric_date, metric_key,
         value_milli, source_event_id, created_at, updated_at)
        VALUES ('legacy-metric', 'marketing-workspace', 'google-connection', 'google', 'properties/1',
          '2026-08-10', 'analytics_sessions', 1000, 'legacy-event', ?, ?)`).bind(now, now),
      database.prepare(`INSERT INTO marketing_reviews
        (id, organization_id, connection_id, provider, external_location_ref, external_review_ref,
         rating_milli, comment, reviewed_at, created_at, updated_at)
        VALUES ('legacy-review', 'marketing-workspace', 'google-connection', 'google', 'locations/1',
          'review-1', 5000, 'legacy content', '2026-08-10', ?, ?)`).bind(now, now),
    ]);

    await applyMigration(database, migrations.find((file) => file.startsWith("0027_")));
    await applyMigration(database, migrations.find((file) => file.startsWith("0028_")));

    assert.deepEqual(
      await database.prepare(`SELECT data_promotion_status AS dataPromotionStatus,
        last_successful_sync_at AS lastSuccessfulSyncAt, resource_selection_version AS selectionVersion
        FROM integration_connections WHERE id = 'google-connection'`).first(),
      { dataPromotionStatus: "staging", lastSuccessfulSyncAt: null, selectionVersion: 0 },
    );
    assert.equal((await database.prepare("SELECT COUNT(*) AS count FROM marketing_daily_metrics").first()).count, 0);
    assert.equal(await database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'marketing_reviews'").first(), null);
    assert.ok(await database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'marketing_resource_selections'").first());
    const metricColumns = await database.prepare("PRAGMA table_info(marketing_daily_metrics)").all();
    assert.ok(metricColumns.results.some((column) => column.name === "resource_selection_id"));
    assert.equal(metricColumns.results.some((column) => column.name === "organization_id"), false);
    assert.equal((await database.prepare("PRAGMA foreign_key_check").all()).results.length, 0);
  } finally {
    await miniflare.dispose();
  }
});
