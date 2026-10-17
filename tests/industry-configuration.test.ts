import test from "node:test";
import assert from "node:assert/strict";
import {defaultIndustryConfiguration,validateIndustryConfiguration,industryChangePreview,resolveIndustryTemplate} from "../domain/industry-templates.ts";
import {validateOnboardingDraft} from "../domain/onboarding-draft.ts";
import {dashboardPreferencePreset} from "../domain/dashboard-preferences.ts";

test("industry templates preserve legacy meaning without exposing vehicle fields to retail",()=>{
 for(const value of ["Retail","Health & wellness","Food & beverage","Café & coffee shop","Restaurant"]){const t=resolveIndustryTemplate(value);assert.ok(!t.capabilities.includes("vehicles"));assert.ok(!t.fieldLabels.some(s=>s.includes("VIN")));}
 assert.equal(resolveIndustryTemplate("Health & wellness").id,"health");assert.equal(resolveIndustryTemplate("Food & beverage").id,"grocery");
 assert.equal(resolveIndustryTemplate("Dealership").id,"dealership");assert.ok(resolveIndustryTemplate("Dealership").fieldLabels.some(s=>s.includes("VIN")));
});
test("unsupported tools and contradictory industry declarations cannot become capabilities",()=>{
 const retail=defaultIndustryConfiguration("Retail");assert.throws(()=>validateIndustryConfiguration({...retail,capabilities:["products","vehicles"]}));
 assert.throws(()=>validateIndustryConfiguration(defaultIndustryConfiguration("dealership"),"Retail"));
 assert.throws(()=>validateIndustryConfiguration({...retail,templateVersion:99}));
 assert.throws(()=>validateIndustryConfiguration({...retail,subtype:"unreviewed"}));
 const preview=industryChangePreview(defaultIndustryConfiguration("dealership"),retail);assert.ok(preview.hidden.includes("vehicles"));assert.ok(preview.preserved.includes("All historical records"));
});
test("resumable drafts strip tax identifiers, legal acceptance and untrusted credentials",()=>{
 const form=Object.fromEntries(["ownerName","businessName","legalName","businessEmail","phone","website","country","province","city","address","postalCode","timezone","currency","fiscalYearStart","sourceMode","selectedPos"].map(k=>[k,""]));
 const draft={step:3,form:{...form,password:"must not persist",taxNumber:"must not persist",legalAccepted:true},industryConfiguration:defaultIndustryConfiguration("cafe"),overview:dashboardPreferencePreset("finance"),hours:["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].map(day=>({day,open:"09:00",close:"17:00",closed:false}))};
 const saved=validateOnboardingDraft(draft);assert.equal(saved.form.industry,"Café & coffee shop");assert.equal(saved.form.password,undefined);assert.equal(saved.form.taxNumber,undefined);assert.equal(saved.form.legalAccepted,undefined);
 assert.throws(()=>validateOnboardingDraft({...draft,hours:draft.hours.map(h=>({...h,day:"Monday"}))}));
});
