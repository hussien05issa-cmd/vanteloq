import { permanentRedirect } from "next/navigation";

type LegacySearchParams = Record<string, string | string[] | undefined>;
const SAFE_CAMPAIGN_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;

export default async function LegacyWorkspaceRedirect({ searchParams }: { searchParams: Promise<LegacySearchParams> }) {
  const params = await searchParams;
  const query = new URLSearchParams();

  for (const key of SAFE_CAMPAIGN_PARAMS) {
    const value = params[key];
    if (Array.isArray(value)) {
      for (const item of value) query.append(key, item);
    } else if (value !== undefined) {
      query.set(key, value);
    }
  }

  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  permanentRedirect(`/workspace${suffix}`);
}
