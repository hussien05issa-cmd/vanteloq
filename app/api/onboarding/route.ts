import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { getDb } from "../../../db";
import { organizations } from "../../../db/schema";

async function identity() {
  return (await headers()).get("oai-authenticated-user-email") ?? "owner@vanteloq.local";
}

export async function GET() {
  try {
    const email = await identity();
    const [organization] = await getDb().select().from(organizations).where(eq(organizations.ownerEmail, email)).limit(1);
    return Response.json({ organization: organization ?? null });
  } catch {
    return Response.json({ organization: null });
  }
}

export async function POST(request: Request) {
  try {
    const ownerEmail = await identity();
    const p = await request.json() as Record<string, unknown>;
    const required = ["ownerName", "businessName", "legalName", "businessEmail", "industry", "city", "address", "postalCode", "hoursJson"];
    for (const key of required) if (!String(p[key] ?? "").trim()) return Response.json({ error: `Complete the ${key} field.` }, { status: 400 });
    const values = {
      ownerEmail, ownerName: String(p.ownerName).trim(), businessName: String(p.businessName).trim(), legalName: String(p.legalName).trim(),
      businessEmail: String(p.businessEmail).trim(), phone: String(p.phone ?? "").trim(), website: String(p.website ?? "").trim(), industry: String(p.industry).trim(),
      country: String(p.country ?? "Canada"), province: String(p.province ?? ""), city: String(p.city).trim(), address: String(p.address).trim(), postalCode: String(p.postalCode).trim().toUpperCase(),
      timezone: String(p.timezone ?? "America/Toronto"), currency: String(p.currency ?? "CAD"), fiscalYearStart: String(p.fiscalYearStart ?? "January"), taxNumber: String(p.taxNumber ?? "").trim(),
      hoursJson: String(p.hoursJson), sourceMode: (p.sourceMode === "csv" || p.sourceMode === "live" ? p.sourceMode : "connect_later") as "csv" | "live" | "connect_later", selectedPos: String(p.selectedPos ?? ""), updatedAt: new Date(),
    };
    const existing = await getDb().select({ id: organizations.id }).from(organizations).where(eq(organizations.ownerEmail, ownerEmail)).limit(1);
    if (existing.length) await getDb().update(organizations).set(values).where(eq(organizations.ownerEmail, ownerEmail));
    else await getDb().insert(organizations).values(values);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "We could not save your workspace. Please try again." }, { status: 500 });
  }
}
