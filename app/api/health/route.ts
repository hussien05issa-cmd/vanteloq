import { handleApi, jsonResponse } from "../../../server/api";

export async function GET(request: Request) {
  return handleApi(request, async () => jsonResponse({ status: "ok", service: "vanteloq" }));
}

