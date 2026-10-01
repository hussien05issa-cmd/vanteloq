import { handleApi } from "../../../../../../server/api";
import { finishCloudAuthorization } from "../../../../../../server/linked-files";
export async function GET(request: Request) { return handleApi(request, () => finishCloudAuthorization(request, "microsoft-files")); }
