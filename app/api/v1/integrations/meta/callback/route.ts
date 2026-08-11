import { marketingCallback } from "../../../../../../server/integrations/marketing-routes";

export async function GET(request: Request) {
  return marketingCallback(request, "meta");
}
