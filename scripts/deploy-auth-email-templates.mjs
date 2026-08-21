import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const projectRef = "wqiwmpqnthshgyxpettl";
const root = resolve(import.meta.dirname, "..");
const templatesDirectory = resolve(root, "supabase/templates");

const templates = [
  ["confirmation", "Verify your email for Vanteloq", "confirmation.html"],
  ["recovery", "Reset your Vanteloq password", "recovery.html"],
  ["magic_link", "Your secure Vanteloq sign-in link", "magic-link.html"],
  ["invite", "You’ve been invited to Vanteloq", "invite.html"],
  ["email_change", "Confirm your new Vanteloq email address", "email-change.html"],
  ["reauthentication", "Your Vanteloq security code", "reauthentication.html"],
];

const notifications = [
  ["password_changed", "Your Vanteloq password was changed", "password-changed.html"],
  ["email_changed", "Your Vanteloq email address was changed", "email-changed.html"],
  ["phone_changed", "Your Vanteloq phone number was changed", "phone-changed.html"],
  ["identity_linked", "A sign-in method was added to your Vanteloq account", "identity-linked.html"],
  ["identity_unlinked", "A sign-in method was removed from your Vanteloq account", "identity-unlinked.html"],
  ["mfa_factor_enrolled", "A verification method was added to your Vanteloq account", "mfa-enrolled.html"],
  ["mfa_factor_unenrolled", "A verification method was removed from your Vanteloq account", "mfa-unenrolled.html"],
];

async function readTemplate(file) {
  const content = await readFile(resolve(templatesDirectory, file), "utf8");
  if (!content.includes("Vanteloq")) throw new Error(`${file} is missing the Vanteloq brand`);
  if (!content.includes("support@vanteloq.com") && !content.includes("security@vanteloq.com")) {
    throw new Error(`${file} is missing a support or security contact`);
  }
  if (!content.includes("<!doctype html>")) throw new Error(`${file} is not a complete HTML email`);
  return content;
}

const payload = {};
let confirmationUsesCode = false;
for (const [key, subject, file] of templates) {
  const content = await readTemplate(file);
  if (key === "confirmation") {
    confirmationUsesCode = content.includes("{{ .Token }}") && !content.includes("{{ .ConfirmationURL }}");
    if (!confirmationUsesCode) throw new Error("confirmation.html must use a numeric verification code without a consumable email link");
  }
  payload[`mailer_subjects_${key}`] = subject;
  payload[`mailer_templates_${key}_content`] = content;
}
for (const [key, subject, file] of notifications) {
  payload[`mailer_notifications_${key}_enabled`] = true;
  payload[`mailer_subjects_${key}_notification`] = subject;
  payload[`mailer_templates_${key}_notification_content`] = await readTemplate(file);
}

const summary = {
  projectRef,
  authenticationTemplates: templates.length,
  securityNotifications: notifications.length,
  sender: "Vanteloq <noreply@vanteloq.com>",
  replyTo: "support@vanteloq.com",
  confirmationDelivery: confirmationUsesCode ? "numeric_code" : "invalid",
};

if (process.argv.includes("--dry-run")) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
if (!accessToken) {
  throw new Error("SUPABASE_ACCESS_TOKEN is required. Create a personal access token in Supabase Account Settings, then run npm run email:deploy.");
}

const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/config/auth`, {
  method: "PATCH",
  headers: {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});

if (!response.ok) {
  const problem = await response.text();
  throw new Error(`Supabase rejected the template update (${response.status}): ${problem.slice(0, 400)}`);
}

console.log(JSON.stringify({ ...summary, deployed: true }, null, 2));
