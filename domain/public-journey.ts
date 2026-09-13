import { PLANS, type PlanKey } from "../server/entitlements/catalog.ts";
export function planForCapacity(locations: number, users: number): PlanKey | null {
  if (!Number.isInteger(locations) || !Number.isInteger(users) || locations < 1 || users < 1) return null;
  return (Object.keys(PLANS) as PlanKey[]).find(key => PLANS[key].limits.activeLocations >= locations && PLANS[key].limits.users >= users) ?? null;
}
export const DEMO_RETAIL_ROUTES = {
  "#retail": "Why it changed",
  "#products": "Products",
  "#baskets": "Baskets",
  "#inventory": "Inventory",
  "#customers": "Customers",
  "#operations": "Operations",
} as const;
export function demoRetailSection(hash: string) {
  return Object.prototype.hasOwnProperty.call(DEMO_RETAIL_ROUTES, hash)
    ? DEMO_RETAIL_ROUTES[hash as keyof typeof DEMO_RETAIL_ROUTES] : null;
}
