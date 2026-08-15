import { googleBusinessReviews } from "../../../../../../../server/integrations/marketing-routes";

export const runtime = "edge";

export function GET(request: Request) {
  return googleBusinessReviews(request);
}

export function POST(request: Request) {
  return googleBusinessReviews(request);
}
