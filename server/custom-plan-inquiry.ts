import type { VanteloqRuntimeEnv } from "../db/index.ts";
import { ApiError } from "./api.ts";

const emailPattern = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Z0-9](?:[A-Z0-9.-]{0,188}[A-Z0-9])?\.[A-Z]{2,63}$/i;
export const CUSTOM_PLAN_NOTICE_VERSION = "custom-plan-contact-v1";

function field(value: unknown, name: string, max: number, required = true, multiline = false) {
  if (value === undefined && !required) return "";
  if (typeof value !== "string") throw new ApiError(400, "INQUIRY_INVALID", `Enter a valid ${name}.`);
  const text = value.trim().normalize("NFC");
  if ((required && !text) || text.length > max || (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(text)) throw new ApiError(400, "INQUIRY_INVALID", `Enter a valid ${name}.`);
  return text;
}

export function inquiryConfiguration(env: VanteloqRuntimeEnv, hostname: string) {
  const allowed = (env.TURNSTILE_ALLOWED_HOSTNAMES ?? "").split(",").map(value => value.trim().toLowerCase());
  const configured = Boolean(env.RESEND_API_KEY?.trim() && emailPattern.test(env.CUSTOM_PLAN_INQUIRY_TO?.trim() ?? "") && env.TURNSTILE_SITE_KEY?.trim() && env.TURNSTILE_SECRET_KEY?.trim() && allowed.includes(hostname.toLowerCase()));
  return { configured, ...(configured ? { siteKey: env.TURNSTILE_SITE_KEY!.trim(), action: "custom-plan" } : {}) };
}

export function validateInquiry(body: Record<string, unknown>) {
  if (Object.keys(body).some(key => !["purpose", "name", "email", "company", "phone", "needs", "website", "consent", "noticeVersion", "submissionId", "token"].includes(key))) throw new ApiError(400, "INQUIRY_INVALID", "The inquiry contains an unsupported field.");
  const purpose = body.purpose ?? "custom_plan";
  if (purpose !== "custom_plan" && purpose !== "contact") throw new ApiError(400, "INQUIRY_INVALID", "Choose a valid inquiry type.");
  if (body.consent !== true || body.noticeVersion !== CUSTOM_PLAN_NOTICE_VERSION) throw new ApiError(400, "INQUIRY_CONSENT_REQUIRED", "Confirm that we may contact you about this request.");
  if (body.website !== undefined && body.website !== "") throw new ApiError(400, "INQUIRY_INVALID", "The inquiry could not be verified.");
  const email = field(body.email, "email address", 254).toLowerCase();
  if (!emailPattern.test(email)) throw new ApiError(400, "INQUIRY_INVALID", "Enter a valid email address.");
  const submissionId = field(body.submissionId, "submission reference", 36);
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(submissionId)) throw new ApiError(400, "INQUIRY_INVALID", "Refresh the form and try again.");
  const needs = field(body.needs, "description of your needs", 3000, true, true);
  if (needs.length < 20) throw new ApiError(400, "INQUIRY_INVALID", "Describe your needs in at least 20 characters.");
  return { purpose, name: field(body.name, "name", 100), company: field(body.company, "business name", 160, purpose === "custom_plan"), email, phone: field(body.phone, "phone number", 60, false), needs, submissionId, token: field(body.token, "security verification", 2048) };
}

export async function deliverCustomPlanInquiry(body: Record<string, unknown>, env: VanteloqRuntimeEnv, hostname: string, request: typeof fetch = fetch) {
  if (!inquiryConfiguration(env, hostname).configured) throw new ApiError(503, "INQUIRY_UNAVAILABLE", "The inquiry form is temporarily unavailable. Please try again later.");
  const inquiry = validateInquiry(body);
  let verification: { success?: boolean; hostname?: string; action?: string };
  try {
    const response = await request("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", redirect: "manual", signal: AbortSignal.timeout(10_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: inquiry.token }) });
    if (!response.ok) throw new Error("Verification unavailable");
    verification = await response.json();
  } catch { throw new ApiError(503, "INQUIRY_VERIFICATION_UNAVAILABLE", "Security verification could not finish. Please retry."); }
  if (verification.success !== true || verification.hostname?.toLowerCase() !== hostname.toLowerCase() || verification.action !== "custom-plan") throw new ApiError(400, "INQUIRY_VERIFICATION_FAILED", "Complete a fresh security check and try again.");
  const contact = { purpose: inquiry.purpose, name: inquiry.name, company: inquiry.company, email: inquiry.email, phone: inquiry.phone, needs: inquiry.needs, submissionId: inquiry.submissionId };
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(contact))))).map(byte => byte.toString(16).padStart(2, "0")).join("");
  let result: { id?: unknown };
  try {
    const response = await request("https://api.resend.com/emails", { method: "POST", redirect: "manual", signal: AbortSignal.timeout(12_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.RESEND_API_KEY!.trim()}`, "Idempotency-Key": `vanteloq-inquiry-${digest}` },
      body: JSON.stringify({ from: "Vanteloq <noreply@vanteloq.com>", to: [env.CUSTOM_PLAN_INQUIRY_TO!.trim()], reply_to: inquiry.email,
        subject: inquiry.purpose === "custom_plan" ? "Vanteloq custom plan inquiry" : "Vanteloq privacy or support inquiry", text: `A visitor submitted a ${inquiry.purpose === "custom_plan" ? "custom plan request" : "privacy or support inquiry"}.\n\nName: ${inquiry.name}\nBusiness: ${inquiry.company || "Not provided"}\nEmail: ${inquiry.email}\nPhone: ${inquiry.phone || "Not provided"}\n\nMessage:\n${inquiry.needs}\n\nReference: ${inquiry.submissionId}\nContact consent: ${CUSTOM_PLAN_NOTICE_VERSION}\nThe visitor authorized a response about this inquiry, not marketing enrollment. No subscription or payment was created.` }),
    });
    if (!response.ok) throw new Error("Delivery rejected");
    result = await response.json();
    if (typeof result.id !== "string" || !result.id) throw new Error("No delivery receipt");
  } catch { throw new ApiError(502, "INQUIRY_DELIVERY_UNCONFIRMED", "We could not confirm delivery. Your details are still in the form. Please retry."); }
  return { sent: true, reference: inquiry.submissionId };
}
