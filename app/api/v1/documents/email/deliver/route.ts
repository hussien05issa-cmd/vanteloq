import { handleApi, jsonResponse } from "../../../../../../server/api";
import { receiveDocumentEmail } from "../../../../../../server/document-email";

export async function POST(request:Request) {
  // This server-to-server route uses a body-bound, timestamped signature instead of browser CSRF/session credentials.
  return handleApi(request,async()=>jsonResponse(await receiveDocumentEmail(request)));
}
