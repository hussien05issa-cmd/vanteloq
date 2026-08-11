import { marketingDisconnect } from "../../../../../../server/integrations/marketing-routes";

export async function POST(request: Request) {
  return marketingDisconnect(request, "google");
}
