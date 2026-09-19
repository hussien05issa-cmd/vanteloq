export const ADVISOR_ATTACHMENT_NOTICE_VERSION = "ai-attachments-2026-09-18";
export const ADVISOR_ATTACHMENT_MAX_FILES = 4;
export const ADVISOR_ATTACHMENT_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const ADVISOR_ATTACHMENT_MAX_TOTAL_BYTES = 8 * 1024 * 1024;
export const ADVISOR_ATTACHMENT_MAX_TEXT_BYTES = 64 * 1024;
export const ADVISOR_ATTACHMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.txt,.csv";
export const ADVISOR_ATTACHMENT_TYPES: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", txt: "text/plain", csv: "text/csv",
};
export function advisorAttachmentType(name: string) {
  return ADVISOR_ATTACHMENT_TYPES[name.split(".").at(-1)?.toLowerCase() ?? ""] ?? null;
}
export function advisorAttachmentSelectionError(files: readonly { name: string; size: number }[]): string | null {
  if (files.length > ADVISOR_ATTACHMENT_MAX_FILES) return "Attach up to 4 files per message.";
  if (files.some(file => !advisorAttachmentType(file.name))) return "Choose a PDF, JPEG, PNG, WEBP, TXT or CSV file.";
  if (files.some(file => file.size <= 0 || file.size > ADVISOR_ATTACHMENT_MAX_FILE_BYTES)) return "Each file must contain data and be 5 MB or smaller.";
  if (files.some(file => advisorAttachmentType(file.name)?.startsWith("text/") && file.size > ADVISOR_ATTACHMENT_MAX_TEXT_BYTES)) return "Text and CSV files must be 64 KB or smaller. Split a larger file into smaller parts.";
  if (files.reduce((sum, file) => sum + file.size, 0) > ADVISOR_ATTACHMENT_MAX_TOTAL_BYTES) return "Keep the combined attachments under 8 MB.";
  return null;
}
