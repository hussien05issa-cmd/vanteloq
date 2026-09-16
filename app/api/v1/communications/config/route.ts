import { handleApi, jsonResponse } from "../../../../../server/api";
import { marketingConfig } from "../../../../../server/communications";
export async function GET(request: Request) {
  return handleApi(request, async () => jsonResponse(await marketingConfig()));
}
