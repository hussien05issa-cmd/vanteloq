import type { DashboardWidgetId } from "./dashboard-preferences";

export type IndustryId = "retail" | "health" | "grocery" | "clothing" | "furniture" | "dealership" | "cafe" | "restaurant" | "ecommerce" | "services" | "hospitality" | "other";
export type IndustryCapability = "products" | "variants" | "lots" | "vehicles" | "dealership_operations" | "food_costing";
export type IndustryTemplate = {
  id: IndustryId; version: 1; label: string; description: string; inventoryLabel: string;
  subtypes: readonly string[]; capabilities: readonly IndustryCapability[]; optionalCapabilities: readonly IndustryCapability[];
  metrics: readonly DashboardWidgetId[]; questions: readonly string[]; fieldLabels: readonly string[];
  dataNeeds: readonly string[]; workflows: readonly string[];
};
const retailMetrics = ["net_revenue", "gross_profit", "gross_margin", "inventory_value", "average_order_value", "transactions"] as const;
const foodMetrics = ["net_revenue", "transactions", "average_order_value", "gross_margin", "operating_profit", "cash_flow"] as const;
const basic = {
  version: 1 as const, inventoryLabel: "Products", subtypes: ["Single store", "Multiple stores", "Store and online"],
  capabilities: ["products"] as readonly IndustryCapability[], optionalCapabilities: ["variants", "lots"] as readonly IndustryCapability[],
  metrics: retailMetrics, questions: ["Which products earn their shelf space?", "What needs reordering?"],
  fieldLabels: ["Product", "SKU", "Quantity", "Unit cost"], dataNeeds: ["Dated sales and returns", "Matched product costs", "Inventory quantities by location"],
  workflows: ["Sales and returns", "Inventory review", "Purchasing", "Cash and invoice review"],
};
/** Versioned product configuration, never an entitlement or evidence of connected data. */
export const INDUSTRY_TEMPLATES: readonly IndustryTemplate[] = [
  { ...basic, id: "retail", label: "General retail", description: "Products, sales, stock and purchasing." },
  { ...basic, id: "health", label: "Supplement & health retail", description: "Product margin, replenishment and batch expiry.", capabilities: ["products", "lots"], fieldLabels: [...basic.fieldLabels, "Lot number", "Expiry date"], dataNeeds: [...basic.dataNeeds, "Lot-level quantities and expiry dates"] },
  { ...basic, id: "grocery", label: "Grocery & specialty food", description: "Perishable stock, product costs and expiry.", capabilities: ["products", "lots"], fieldLabels: [...basic.fieldLabels, "Lot number", "Expiry date"], dataNeeds: [...basic.dataNeeds, "Lot-level quantities and expiry dates"] },
  { ...basic, id: "clothing", label: "Clothing & accessories", description: "Variants, returns and seasonal stock.", capabilities: ["products", "variants"], fieldLabels: [...basic.fieldLabels, "Size", "Colour"] },
  { ...basic, id: "furniture", label: "Furniture & appliances", description: "Product inventory, purchasing and outstanding balances.", dataNeeds: [...basic.dataNeeds, "Reviewed invoices and payment allocations"] },
  { ...basic, id: "dealership", label: "Car dealership", description: "Individual vehicles, preparation, delivered sales and sales credit.", inventoryLabel: "Vehicles", subtypes: ["Independent used", "Franchised new and used", "Dealership group"], capabilities: ["vehicles", "dealership_operations"], optionalCapabilities: ["products"], metrics: ["net_revenue", "gross_profit", "gross_margin", "cash_balance", "cash_flow"], fieldLabels: ["VIN / legacy identifier", "Stock number", "Model year", "Make", "Model"], questions: ["Which vehicles are tying up capital?", "What is blocking preparation or delivery?", "Which opportunities need follow-up?"], dataNeeds: ["Dated stock episodes and ownership", "Delivered vehicle sale records", "Matched posted costs", "Reviewed salesperson credit"], workflows: ["Vehicle stock", "Preparation tasks", "Opportunities and appointments", "Delivered sales and team credit"] },
  { ...basic, id: "cafe", label: "Café & coffee shop", description: "Checks, recipe costs, waste and daily cash.", inventoryLabel: "Menu & ingredients", subtypes: ["Coffee shop", "Bakery and café", "Counter service", "Multiple cafés"], capabilities: ["products", "food_costing"], optionalCapabilities: ["lots"], metrics: foodMetrics, fieldLabels: ["Menu item", "Ingredient", "Purchase unit", "Recipe yield", "Portions"], questions: ["What does each serving cost?", "Where are food costs and waste changing?"], dataNeeds: ["Net food and beverage sales", "Opening, purchases and closing inventory at cost", "Recipe quantities and yields", "Recorded labour and waste"], workflows: ["Recipe costing", "Period food-cost review", "Sales and average check", "Stock and cash review"] },
  { ...basic, id: "restaurant", label: "Restaurant", description: "Menu economics, food costs, labour and service activity.", inventoryLabel: "Menu & ingredients", subtypes: ["Full service", "Quick service", "Takeaway and delivery", "Multiple restaurants"], capabilities: ["products", "food_costing"], optionalCapabilities: ["lots"], metrics: foodMetrics, fieldLabels: ["Menu item", "Ingredient", "Purchase unit", "Recipe yield", "Portions"], questions: ["What is left after food and labour?", "Which menu items warrant review?"], dataNeeds: ["Net food and beverage sales", "Matched inventory movement at cost", "Recipe quantities and yields", "Labour, waste and service counts"], workflows: ["Recipe costing", "Period food-cost review", "Sales and average check", "Stock and cash review"] },
  { ...basic, id: "ecommerce", label: "E-commerce", description: "Orders, product margin and settlement timing." },
  { ...basic, id: "services", label: "Professional services", description: "Revenue, invoices, expenses and cash.", capabilities: [], optionalCapabilities: ["products"], inventoryLabel: "Products", metrics: ["net_revenue", "operating_profit", "net_margin", "cash_balance", "cash_flow"], fieldLabels: ["Invoice", "Customer", "Amount due"], dataNeeds: ["Reviewed invoices and payments", "Posted ledger records"], workflows: ["Invoice review", "Expenses", "Cash review"] },
  { ...basic, id: "hospitality", label: "Hospitality", description: "Recorded revenue, operating costs and cash.", metrics: foodMetrics },
  { ...basic, id: "other", label: "Other / custom", description: "A flexible starting view with supported commerce tools." },
];
const aliases: Record<string, IndustryId> = { "retail": "retail", "dealership": "dealership", "health & wellness": "health", "food & beverage": "grocery", "cafe": "cafe", "café": "cafe", "restaurants": "restaurant", "other": "other" };
export function resolveIndustryTemplate(value: string | null | undefined): IndustryTemplate {
  const key = (value ?? "").trim().toLowerCase();
  return INDUSTRY_TEMPLATES.find(t => t.id === key || t.label.toLowerCase() === key || t.id === aliases[key]) ?? INDUSTRY_TEMPLATES[INDUSTRY_TEMPLATES.length - 1];
}
export const INDUSTRY_LABELS = [...new Set([...INDUSTRY_TEMPLATES.map(t => t.label), "Retail", "Dealership", "Food & beverage", "Health & wellness", "Other"])] as readonly string[];
export type IndustryConfiguration = { templateId: IndustryId; templateVersion: 1; subtype: string; capabilities: IndustryCapability[]; agingReviewDays: number; goals: string[] };
export const INDUSTRY_GOALS = ["sales", "profit", "cash", "collect", "bills", "stock", "preparation", "follow_up", "waste"] as const;
export function defaultIndustryConfiguration(industry: string | null | undefined): IndustryConfiguration {
  const t = resolveIndustryTemplate(industry);
  return { templateId: t.id, templateVersion: 1, subtype: t.subtypes[0] ?? "", capabilities: [...t.capabilities], agingReviewDays: 60, goals: [] };
}
export function validateIndustryConfiguration(value: unknown, industry?: string): IndustryConfiguration {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Choose a business configuration.");
  const p = value as Record<string, unknown>;
  if (typeof p.templateId !== "string" || !INDUSTRY_TEMPLATES.some(t => t.id === p.templateId) || p.templateVersion !== 1) throw new Error("Choose a supported business type and template version.");
  const t = resolveIndustryTemplate(p.templateId);
  if (industry && resolveIndustryTemplate(industry).id !== t.id) throw new Error("The business type and workspace configuration must match.");
  if (typeof p.subtype !== "string" || !t.subtypes.includes(p.subtype)) throw new Error("Choose a business subtype from this template.");
  const capabilities=p.capabilities;
  if (!Array.isArray(capabilities) || capabilities.length > 10 || capabilities.some(c => ![...t.capabilities, ...t.optionalCapabilities].includes(c as IndustryCapability)) || t.capabilities.some(c => !capabilities.includes(c))) throw new Error("Choose only supported tools for this business type.");
  if (!Number.isInteger(p.agingReviewDays) || Number(p.agingReviewDays) < 1 || Number(p.agingReviewDays) > 730) throw new Error("Choose a stock review age between 1 and 730 days.");
  if (!Array.isArray(p.goals) || p.goals.length > 9 || p.goals.some(g => !INDUSTRY_GOALS.includes(g as typeof INDUSTRY_GOALS[number]))) throw new Error("Choose supported business priorities.");
  return { templateId: t.id, templateVersion: 1, subtype: p.subtype, capabilities: [...new Set(capabilities)] as IndustryCapability[], agingReviewDays: Number(p.agingReviewDays), goals: [...new Set(p.goals)] as string[] };
}
export function industryChangePreview(previous: IndustryConfiguration, next: IndustryConfiguration) {
  const before = resolveIndustryTemplate(previous.templateId), after = resolveIndustryTemplate(next.templateId);
  return { previous: before.label, next: after.label, added: next.capabilities.filter(c => !previous.capabilities.includes(c)), hidden: previous.capabilities.filter(c => !next.capabilities.includes(c)), fields: after.fieldLabels, recommendations: after.metrics, preserved: ["All historical records", "Accounting entries and invoices", "Subscriptions and permissions", "Personal dashboard layouts"], note: "This changes the tools and recommendations you see. It does not convert or delete records, change accounting figures, or unlock paid features." };
}
export const CAPABILITY_LABELS: Record<IndustryCapability, string> = { products: "Product inventory", variants: "Product variants", lots: "Lots and expiry", vehicles: "Vehicle inventory", dealership_operations: "Dealership operations", food_costing: "Recipe and food costs" };
