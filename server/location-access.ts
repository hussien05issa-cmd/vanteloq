import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { organizationLocations, teamMembers } from "../db/schema";
import { ApiError } from "./api";
import type { AccessContext } from "./authorization";
import { parsePermittedLocationIds } from "../domain/location-scope";

export async function accessibleLocations(context: AccessContext) {
  const queryLocations = () => getDb()
    .select()
    .from(organizationLocations)
    .where(and(
      eq(organizationLocations.organizationId, context.organizationId),
      eq(organizationLocations.status, "active"),
    ))
    .orderBy(asc(organizationLocations.name));
  let locations = await queryLocations();
  if (!locations.length && (context.role === "owner" || context.role === "admin")) {
    const now = new Date();
    await getDb().insert(organizationLocations).values({
      id: `${context.organizationId}:location:primary`,
      organizationId: context.organizationId,
      name: "Primary location",
      status: "active",
      countryCode: context.organization.country,
      addressLine1: context.organization.address,
      addressLine2: "",
      addressLine3: "",
      locality: context.organization.city,
      district: "",
      administrativeArea: context.organization.province,
      postalCode: context.organization.postalCode,
      timezone: context.organization.timezone,
      currency: context.organization.currency,
      locale: context.organization.country === "US" ? "en-US" : "en-CA",
      taxJurisdiction: "",
      validationStatus: "entered",
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing();
    locations = await queryLocations();
  }
  if (context.role === "owner" || context.role === "admin") return locations;

  const [member] = await getDb()
    .select({ permittedLocationsJson: teamMembers.permittedLocationsJson })
    .from(teamMembers)
    .where(and(
      eq(teamMembers.organizationId, context.organizationId),
      eq(teamMembers.userId, context.userId),
    ))
    .limit(1);
  const permitted = new Set(parsePermittedLocationIds(member?.permittedLocationsJson));
  return locations.filter((location) => permitted.has(location.id));
}

export async function requireAccessibleLocation(context: AccessContext, locationId: string) {
  const locations = await accessibleLocations(context);
  const location = locations.find((candidate) => candidate.id === locationId);
  if (!location) throw new ApiError(403, "LOCATION_ACCESS_DENIED", "This location is not available to your account.");
  return location;
}
