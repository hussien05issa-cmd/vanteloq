import { marketingResources } from "../../../../../../server/integrations/marketing-routes";

export const runtime = "edge";

export function POST(request: Request) {
  return marketingResources(request, "google");
}
