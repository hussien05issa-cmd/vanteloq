export const DOCUMENT_PROCESSING_NOTICE_VERSION = "document-processing-microsoft-2026-09-15";
export const DOCUMENT_PROCESSING_NOTICE = "Scan and Read sends this file to Microsoft Azure for malware scanning and document extraction when enabled. Processing uses the configured Azure region. Extracted figures stay in review and do not change your accounts. This action does not send your file to Vanteloq AI. See service provider details for temporary-copy retention.";

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
