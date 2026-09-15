export const DOCUMENT_PROCESSING_NOTICE_VERSION = "document-processing-2026-09-15";
export const DOCUMENT_PROCESSING_NOTICE = "Scan and read sends this file to Cloudmersive for malware checks and Microsoft Azure for document extraction when enabled. Processing may occur outside Canada. Extracted figures stay in review and do not change your accounts. Your file is not sent to Vanteloq AI by this action.";

export type ExtractedField = { value: string | number | null; confidenceBasisPoints: number | null; page: number | null; currency?: string };
export type DocumentExtraction = {
  provider: "azure-document-intelligence";
  model: string;
  pages: number;
  text: string;
  fields: Record<string, ExtractedField>;
  lines: Record<string, ExtractedField>[];
  tables: { page: number | null; rows: string[][] }[];
  checks: { label: string; state: "passed" | "review"; detail: string }[];
  truncated: boolean;
};
