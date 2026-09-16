const labels: Record<string, string> = {
  upload: "Add Documents",
  tenantStorage: "Private File Storage",
  duplicateDetection: "Duplicate Checks",
  mimeVerification: "File Type Checks",
  malwareScanning: "File Safety Scan",
  ocrExtraction: "Read Document Text",
  emailForwarding: "Email Documents",
  cameraCapture: "Capture Receipts",
};

export function documentPipelineLabel(key: string, state: string) {
  const status = state === "live" || state === "configured" ? "Available"
    : state === "browser_supported" ? "On Supported Devices"
    : state === "not_configured" ? "Coming Soon" : "Check Status";
  return { label: labels[key] ?? "Document Service", status };
}
