import { marketingAuthorize } from "../../../../../../server/integrations/marketing-routes";

export async function POST(request: Request) {
  return marketingAuthorize(request, "google");
}
