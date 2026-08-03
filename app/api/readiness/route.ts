import { getD1 } from "../../../db";
import { handleApi, jsonResponse } from "../../../server/api";

export async function GET(request: Request) {
  return handleApi(request, async () => {
    await getD1().prepare("SELECT 1 AS ready").first();
    return jsonResponse({ status: "ready" });
  });
}

