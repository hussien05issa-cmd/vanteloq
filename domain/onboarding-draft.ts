import { normalizeDashboardPreferences } from "./dashboard-preferences";
import { validateIndustryConfiguration, resolveIndustryTemplate } from "./industry-templates";
const fields = ["ownerName","businessName","legalName","businessEmail","phone","website","country","province","city","address","postalCode","timezone","currency","fiscalYearStart","sourceMode","selectedPos"] as const;
/** Drafts deliberately exclude tax identifiers, passwords, legal acceptance and payment details. */
export function validateOnboardingDraft(value:unknown) {
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Save a valid setup draft.");
  const input=value as Record<string,unknown>,form=input.form as Record<string,unknown>;
  if(!form||typeof form!=="object"||Array.isArray(form))throw new Error("Save a valid business profile.");
  if(!Number.isInteger(input.step)||Number(input.step)<1||Number(input.step)>7)throw new Error("Choose a valid setup step.");
  const clean:Record<string,string|boolean>={};
  for(const key of fields){const raw=form[key];if(typeof raw!=="string"||raw.length>512||/[\u0000-\u001f\u007f]/.test(raw))throw new Error("Review the saved business profile.");clean[key]=raw;}
  const configuration=validateIndustryConfiguration(input.industryConfiguration);
  clean.industry=resolveIndustryTemplate(configuration.templateId).label;clean.emailNotifications=form.emailNotifications!==false;
  if(!Array.isArray(input.hours)||input.hours.length!==7)throw new Error("Include all seven operating days.");
  const days=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
  const hours=input.hours.map((v:unknown)=>{if(!v||typeof v!=="object")throw new Error("Review operating hours.");const h=v as Record<string,unknown>;if(!days.includes(String(h.day))||typeof h.open!=="string"||typeof h.close!=="string"||![h.open,h.close].every(t=>t===""||/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t)))throw new Error("Review operating hours.");return{day:String(h.day),open:h.open,close:h.close,closed:h.closed===true};});
  if(new Set(hours.map(h=>h.day)).size!==7)throw new Error("Include each day once.");
  return{form:clean,step:Number(input.step),hours,industryConfiguration:configuration,overview:normalizeDashboardPreferences(input.overview)};
}
