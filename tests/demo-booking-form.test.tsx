import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import CustomPlanForm from "../app/custom-plan-form";

test("demo collection presents required contact fields, optional interests and unchecked scheduling consent", () => {
 const html = renderToStaticMarkup(<CustomPlanForm purpose="demo"/>);
 const input = (name: string) => html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0] ?? "";
 for (const name of ["name", "email", "consent"]) assert.match(input(name), /required=""/);
 for (const name of ["company", "phone"]) assert.doesNotMatch(input(name), /required=/);
 assert.doesNotMatch(input("consent"), /checked=/);
 const interests = html.match(/<textarea[^>]*name="needs"[^>]*>/)?.[0] ?? "";
 assert.match(interests, /maxLength="3000"/i);
 assert.doesNotMatch(interests, /required=|minLength=/i);
 assert.match(html, /Work Email/);
 assert.match(html, /Vanteloq Inc\./);
 assert.doesNotMatch(html, /2855706|LexEdge/i);
 assert.match(html, /respond to my request and schedule a Vanteloq demo/);
 assert.match(html, /does not subscribe me to marketing/);
 assert.match(html, /through Resend, which may process them in the United States/);
 for (const href of ["/privacy", "/subprocessors", "/contact"]) assert.ok(html.includes(`href="${href}"`));
 assert.match(html, /\$0, no obligation and no card required/);
 assert.match(html, /contact you to arrange a time/);
 assert.doesNotMatch(html, /appointment is booked|demo is booked|private-owner@example\.com|consentSubmittedAt/);
});

test("custom plan and contact forms preserve their description requirement and original contact purposes", () => {
 for (const purpose of ["custom_plan", "contact"] as const) {
  const html = renderToStaticMarkup(<CustomPlanForm purpose={purpose}/>);
  const description = html.match(/<textarea[^>]*name="needs"[^>]*>/)?.[0] ?? "";
  assert.match(description, /required=""/);
  assert.match(description, /minLength="20"/i);
  assert.match(html, /may use these details to respond to this inquiry/);
  assert.doesNotMatch(html, /schedule a Vanteloq demo/);
 }
});

test("advisory collection asks for one business priority with clear consent and a focused action", () => {
 const html = renderToStaticMarkup(<CustomPlanForm purpose="advisory"/>);
 assert.match(html, /<form aria-label="Vanteloq Advisory inquiry"/);
 const input = (name: string) => html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0] ?? "";
 assert.match(input("name"), /required=""/);
 assert.match(input("email"), /required=""/);
 assert.doesNotMatch(input("company"), /required=/);
 assert.doesNotMatch(input("phone"), /required=/);
 assert.doesNotMatch(input("consent"), /checked=/);
 const priority = html.match(/<textarea[^>]*name="needs"[^>]*>/)?.[0] ?? "";
 assert.match(priority, /required=""/);
 assert.match(priority, /minLength="20"/i);
 assert.match(html, /What Would You Like to Improve\?/);
 assert.match(html, /respond to my Vanteloq Advisory inquiry/);
 assert.match(html, /does not subscribe me to marketing/);
 assert.match(html, /through Resend, which may process them in the United States/);
 assert.match(html, /Contact our Privacy Officer/);
 assert.match(html, />Start the Conversation<\/button>/);
 assert.match(html, /Share the business context needed to understand your priority/);
 assert.doesNotMatch(html, /schedule a Vanteloq demo|Send Custom Plan Request/);
});
