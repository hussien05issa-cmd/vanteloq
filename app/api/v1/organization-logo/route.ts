import { eq } from "drizzle-orm";
import { getD1, getDb, getR2 } from "../../../../db";
import { organizationProfiles } from "../../../../db/schema";
import { recordAudit } from "../../../../server/audit";
import { requireAccess } from "../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, requireSameOrigin } from "../../../../server/api";

const readers = ["owner", "admin", "manager", "employee", "read_only"] as const;
const writers = ["owner", "admin"] as const;
const maximumBytes = 2 * 1024 * 1024;

function extensionAndType(bytes: Uint8Array, declared: string): { extension: string; contentType: string } {
  const png = bytes.length > 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  const jpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp = bytes.length > 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
  if (png && declared === "image/png") return { extension: "png", contentType: "image/png" };
  if (jpeg && ["image/jpeg", "image/jpg"].includes(declared)) return { extension: "jpg", contentType: "image/jpeg" };
  if (webp && declared === "image/webp") return { extension: "webp", contentType: "image/webp" };
  throw new ApiError(400, "UNSUPPORTED_IMAGE", "Upload a verified PNG, JPEG or WEBP image. SVG remains disabled until secure sanitization is configured.");
}

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, readers, "business.profile");
    const [profile] = await getDb().select({ objectKey: organizationProfiles.logoObjectKey, contentType: organizationProfiles.logoContentType, version: organizationProfiles.logoVersion })
      .from(organizationProfiles).where(eq(organizationProfiles.organizationId, context.organizationId)).limit(1);
    if (!profile?.objectKey) throw new ApiError(404, "NO_LOGO", "This organization has not uploaded a logo.");
    const object = await getR2().get(profile.objectKey);
    if (!object) throw new ApiError(404, "NO_LOGO", "The organization logo could not be found.");
    return new Response(object.body, { headers: { "Content-Type": profile.contentType || object.httpMetadata?.contentType || "application/octet-stream", "Cache-Control": "private, max-age=300", ETag: object.httpEtag, "X-Logo-Version": String(profile.version) } });
  });
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, writers, "business.profile");
    await enforceRateLimit("organization-logo:write", context.userId, 10, 3_600);
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > maximumBytes + 64_000) throw new ApiError(413, "FILE_TOO_LARGE", "Organization logos must be 2 MB or smaller.");
    const form = await request.formData();
    const file = form.get("logo");
    if (!(file instanceof File) || file.size <= 0 || file.size > maximumBytes) throw new ApiError(400, "INVALID_FILE", "Choose a logo file up to 2 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const verified = extensionAndType(bytes, file.type);
    const altText = typeof form.get("altText") === "string" ? String(form.get("altText")).trim().slice(0, 160) : "Organization logo";
    const objectKey = `${context.organizationId}/branding/${crypto.randomUUID()}.${verified.extension}`;
    const [current] = await getDb().select({ objectKey: organizationProfiles.logoObjectKey, version: organizationProfiles.logoVersion }).from(organizationProfiles).where(eq(organizationProfiles.organizationId, context.organizationId)).limit(1);
    await getR2().put(objectKey, bytes.buffer, { httpMetadata: { contentType: verified.contentType, cacheControl: "private, max-age=300" }, customMetadata: { organizationId: context.organizationId, uploadedBy: context.userId } });
    try {
      await getD1().prepare(`UPDATE organization_profiles SET logo_object_key = ?, logo_content_type = ?, logo_alt_text = ?, logo_version = logo_version + 1, updated_at = ? WHERE organization_id = ?`)
        .bind(objectKey, verified.contentType, altText || "Organization logo", Date.now(), context.organizationId).run();
    } catch (error) {
      await getR2().delete(objectKey);
      throw error;
    }
    if (current?.objectKey) await getR2().delete(current.objectKey);
    await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "organization.logo.updated", resourceType: "organization_profile", resourceId: context.organizationId, details: { contentType: verified.contentType, sizeBytes: file.size, previousVersion: current?.version ?? 0 } });
    return Response.json({ ok: true, logoUrl: `/api/v1/organization-logo?v=${(current?.version ?? 0) + 1}` }, { status: 201 });
  });
}

export async function DELETE(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, writers, "business.profile");
    const [current] = await getDb().select({ objectKey: organizationProfiles.logoObjectKey }).from(organizationProfiles).where(eq(organizationProfiles.organizationId, context.organizationId)).limit(1);
    await getD1().prepare("UPDATE organization_profiles SET logo_object_key = NULL, logo_content_type = NULL, logo_version = logo_version + 1, updated_at = ? WHERE organization_id = ?").bind(Date.now(), context.organizationId).run();
    if (current?.objectKey) await getR2().delete(current.objectKey);
    await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "organization.logo.removed", resourceType: "organization_profile", resourceId: context.organizationId });
    return Response.json({ ok: true });
  });
}
