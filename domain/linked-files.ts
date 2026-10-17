export const LINKED_FILE_NOTICE_VERSION = "linked-files-2026-10-04";
export type FileProvider = "google-files" | "microsoft-files";
export const fileProviderName = (provider: FileProvider) => provider === "google-files" ? "Google Drive & Sheets" : "Microsoft OneDrive";
export function fileProvider(value: unknown): FileProvider {
  if (value !== "google-files" && value !== "microsoft-files") throw new Error("Choose Google or Microsoft.");
  return value;
}
export function remoteFileId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_!-]{1,220}$/.test(value)) throw new Error("Choose a valid file from your connected account.");
  return value;
}
export function selectedSheetRange(name: string) {
  if (!name || name.length > 100 || /[\x00-\x1f]/.test(name)) throw new Error("Choose a valid sheet tab.");
  return `'${name.replaceAll("'", "''")}'`; 
}
export type LinkedSheetSnapshot = { headers: string[]; rows: string[][]; truncated: boolean };
export function sheetSnapshot(value: unknown): LinkedSheetSnapshot {
  if (!Array.isArray(value)) throw new Error("The sheet did not return a table.");
  if (value.length > 1001 || value.some(row => !Array.isArray(row) || row.length > 52)) throw new Error("Choose a table up to 1,000 rows and 52 columns.");
  const rows = value.map(row => (row as unknown[]).map(cell => {
    if (!["string", "number", "boolean"].includes(typeof cell) && cell !== null) throw new Error("The sheet contains an unsupported value.");
    if (typeof cell === "number" && !Number.isFinite(cell)) throw new Error("The sheet contains an invalid number.");
    const text = cell === null ? "" : String(cell);
    if (text.length > 4000) throw new Error("A cell is too long for the table preview.");
    return text;
  }));
  if (JSON.stringify(rows).length > 240_000) throw new Error("This table is too large. Choose a smaller sheet tab.");
  const width = Math.max(0, ...rows.map(row => row.length));
  const headers = Array.from({ length: width }, (_, index) => rows[0]?.[index]?.trim() || `Column ${index + 1}`);
  return { headers, rows: rows.slice(1).map(row => headers.map((_, index) => row[index] ?? "")), truncated: false };
}
export function snapshotCsv(snapshot: LinkedSheetSnapshot) {
  if (snapshot.truncated) throw new Error("The preview reaches its size limit. Use a smaller table before importing.");
  return [snapshot.headers, ...snapshot.rows].map(row => row.map(cell => /[,"\r\n]/.test(cell) ? `"${cell.replaceAll('"','""')}"` : cell).join(",")).join("\n");
}
