import { metaCampaigns } from "../../../../../../server/integrations/marketing-routes";

export const runtime = "edge";

export async function GET(request: Request) {
  return metaCampaigns(request);
}

export async function POST(request: Request) {
  return metaCampaigns(request);
}
