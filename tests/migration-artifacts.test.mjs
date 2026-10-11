import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalMigrationSql, canonicalizeMigrationArtifacts } from "../build/migration-artifacts.mjs";

test("packaged SQL preserves a complete trigger and restores the committed LF contract", () => {
  const sql = "CREATE TRIGGER history AFTER INSERT ON records BEGIN\n UPDATE totals SET count=count+1;\n INSERT INTO history VALUES (NEW.id);\nEND;\n--> statement-breakpoint\n";
  assert.equal(canonicalMigrationSql(sql.replace(/\n/g, "\r\n")), sql);
  assert.equal(canonicalMigrationSql(sql), sql);
  assert.throws(() => canonicalMigrationSql("SELECT 1;\rSELECT 2;"), /standalone CR/);
});

test("packaging normalizes SQL only, leaving migration ledger and snapshots byte-identical", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vanteloq-migration-artifact-"));
  try {
    await mkdir(join(directory, "meta"));
    const metadata = '{"entries":[{"idx":69,"when":123}]}\r\n';
    await writeFile(join(directory, "meta", "_journal.json"), metadata);
    await writeFile(join(directory, "0069_example.sql"), "SELECT 1;\r\n");
    await canonicalizeMigrationArtifacts(directory);
    assert.equal(await readFile(join(directory, "0069_example.sql"), "utf8"), "SELECT 1;\n");
    assert.equal(await readFile(join(directory, "meta", "_journal.json"), "utf8"), metadata);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
