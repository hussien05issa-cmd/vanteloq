import { marketingSync } from "../../../../../../server/integrations/marketing-routes";

export async function POST(request: Request) {
  return marketingSync(request, "google");
}
