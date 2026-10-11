import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Match the repository's drizzle/*.sql eol=lf contract even when an editor
// writes CRLF into a Windows checkout. SQL and migration metadata stay intact.
export function canonicalMigrationSql(sql) {
  const canonical = sql.replace(/\r\n/g, "\n");
  if (canonical.includes("\r")) throw new Error("Unexpected standalone CR in migration SQL.");
  return canonical;
}

export async function canonicalizeMigrationArtifacts(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !/^\d{4}.*\.sql$/.test(entry.name)) continue;
    const file = join(directory, entry.name);
    const original = await readFile(file, "utf8");
    const canonical = canonicalMigrationSql(original);
    if (canonical !== original) await writeFile(file, canonical, "utf8");
  }
}
