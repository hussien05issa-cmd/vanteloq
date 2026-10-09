import { DatabaseSync } from "node:sqlite";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

/** Disposable real SQLite with the prepared/batch contract used by D1. */
export async function posSqliteFixture() {
  const sqlite = new DatabaseSync(":memory:");
  let beforeBatch: ((items: Prepared[]) => void) | undefined;
  class Prepared {
    values: unknown[] = [];
    constructor(readonly sql: string) {}
    bind(...values: unknown[]) { const result = new Prepared(this.sql); result.values = values; return result; }
    query() { return sqlite.prepare(this.sql); }
    async all() { return { success: true, results: this.query().all(...this.values as never[]).map(row => ({...row})), meta: {} }; }
    async first(column?: string) { const row = this.query().get(...this.values as never[]); return row ? column ? row[column] : {...row} : null; }
    async raw() { const query = this.query(); query.setReturnArrays(true); return query.all(...this.values as never[]); }
    async run() { const result = this.query().run(...this.values as never[]); return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }; }
  }
  const database = { prepare: (sql: string) => new Prepared(sql), batch: async(items: Prepared[]) => {
    beforeBatch?.(items);
    sqlite.exec("BEGIN IMMEDIATE");
    try { const results = []; for (const item of items) results.push(await item.run()); sqlite.exec("COMMIT"); return results; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } } as unknown as D1Database;
  const migrationDir = resolve(process.env.POS_PATCH_SOURCE_REPO ?? process.cwd(), "drizzle");
  for (const name of (await readdir(migrationDir)).filter(name => /^\d{4}.*\.sql$/.test(name)).sort()) {
    sqlite.exec((await readFile(resolve(migrationDir, name), "utf8")).replaceAll("--> statement-breakpoint", ""));
  }
  // This fallback only supports reviewing copied source before patch integration.
  // After integration the regular migration pass already owns this column.
  const columns = await database.prepare("PRAGMA table_info(integration_staged_sales)").all<{name: string}>();
  if (!columns.results?.some(column => column.name === "units_milli")) {
    sqlite.exec((await readFile(new URL("../../drizzle/0075_pos_quantity_evidence.sql", import.meta.url), "utf8")).replaceAll("--> statement-breakpoint", ""));
  }
  sqlite.exec("PRAGMA foreign_keys=ON");
  return { sqlite, database, beforeBatch(hook: ((items: Prepared[]) => void) | undefined) { beforeBatch = hook; }, close() { sqlite.close(); } };
}
