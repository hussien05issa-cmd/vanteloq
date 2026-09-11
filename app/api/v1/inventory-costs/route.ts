import { getD1 } from "../../../../db";
import { recordAudit } from "../../../../server/audit";
import { requireAccess } from "../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../server/api";
import { requirePermission } from "../../../../server/permissions";
import { applyOwnerInventoryCosts } from "../../../../server/inventory-costs";

const roles = ["owner", "admin", "manager", "employee", "read_only"] as const;
const MAX_ENTRIES = 500;

type ProductRow = {
  id: string;
  provider: string;
  connectionId: string;
  externalProductId: string;
  sku: string;
  name: string;
};

type CostEntry = {
  provider: string | null;
  connectionId: string | null;
  externalProductId: string | null;
  sku: string | null;
  unitCostCents: number;
  row: number;
};

function optionalText(value: unknown, label: string, maximum: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new ApiError(400, "INVENTORY_COST_INVALID", `Enter a valid ${label}.`);
  const cleaned = value.trim().normalize("NFC");
  if (!cleaned || cleaned.length > maximum || /[\u0000-\u001f\u007f]/.test(cleaned)) {
    throw new ApiError(400, "INVENTORY_COST_INVALID", `Enter a valid ${label}.`);
  }
  return cleaned;
}

function parseEntries(value: unknown): CostEntry[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ENTRIES) {
    throw new ApiError(400, "INVENTORY_COST_ROWS_INVALID", `Submit between 1 and ${MAX_ENTRIES} inventory cost rows.`);
  }
  return value.map((raw, index) => {
    if (!raw || Array.isArray(raw) || typeof raw !== "object") {
      throw new ApiError(400, "INVENTORY_COST_INVALID", `Row ${index + 1} is not valid.`);
    }
    const input = raw as Record<string, unknown>;
    const externalProductId = optionalText(input.externalProductId, "product reference", 240);
    const sku = optionalText(input.sku, "SKU", 120)?.toUpperCase() ?? null;
    const provider = optionalText(input.provider, "provider", 80)?.toLowerCase() ?? null;
    const connectionId = optionalText(input.connectionId, "connection", 120);
    if (!externalProductId && !sku) {
      throw new ApiError(400, "INVENTORY_COST_INVALID", `Row ${index + 1} needs a SKU or product reference.`);
    }
    if (externalProductId && (!provider || !connectionId)) {
      throw new ApiError(400, "INVENTORY_COST_INVALID", `Row ${index + 1} needs its provider and connection with the product reference.`);
    }
    if (!Number.isSafeInteger(input.unitCostCents) || Number(input.unitCostCents) < 0 || Number(input.unitCostCents) > 100_000_000) {
      throw new ApiError(400, "INVENTORY_COST_INVALID", `Row ${index + 1} needs a unit cost from 0.00 to 1,000,000.00.`);
    }
    return { provider, connectionId, externalProductId, sku, unitCostCents: Number(input.unitCostCents), row: index + 1 };
  });
}

async function runBatches(statements: D1PreparedStatement[], size = 50): Promise<void> {
  const database = getD1();
  for (let index = 0; index < statements.length; index += size) {
    await database.batch(statements.slice(index, index + size));
  }
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, roles, "products.margin");
    await requirePermission(context, "inventory.adjust");
    await enforceRateLimit("inventory-costs:write", context.userId, 30, 3_600);
    const body = await readJsonObject(request, 128_000);
    const source = body.source === "csv" ? "csv" as const : body.source === "manual" ? "manual" as const : null;
    if (!source) throw new ApiError(400, "INVENTORY_COST_SOURCE_INVALID", "Choose manual entry or CSV upload.");
    if (source === "csv") await requirePermission(context, "data.import");
    const entries = parseEntries(body.entries);
    const database = getD1();
    const productResult = await database.prepare(`
      SELECT p.id, p.provider, p.connection_id AS connectionId,
             p.external_product_id AS externalProductId, p.sku, p.name
      FROM commerce_products p
      WHERE p.organization_id = ? AND p.archived = 0
        AND EXISTS (
          SELECT 1 FROM integration_connections approved
          WHERE approved.id = p.connection_id
            AND approved.organization_id = p.organization_id
            AND approved.status = 'connected'
            AND approved.data_promotion_status = 'approved'
        )
      ORDER BY p.name COLLATE NOCASE
      LIMIT 10000
    `).bind(context.organizationId).all<ProductRow>();
    const products = productResult.results ?? [];
    const resolved: Array<{ input: CostEntry; product: ProductRow }> = [];
    const errors: Array<{ row: number; code: "not_found" | "ambiguous" | "duplicate"; message: string }> = [];
    const seen = new Set<string>();

    for (const input of entries) {
      const candidates = input.externalProductId
        ? products.filter((product) => product.provider === input.provider && product.connectionId === input.connectionId && product.externalProductId === input.externalProductId)
        : products.filter((product) => product.sku.trim().toUpperCase() === input.sku && (!input.provider || product.provider === input.provider));
      if (candidates.length === 0) {
        errors.push({ row: input.row, code: "not_found", message: `No approved inventory item matches ${input.sku || input.externalProductId}.` });
        continue;
      }
      if (candidates.length > 1) {
        errors.push({ row: input.row, code: "ambiguous", message: `${input.sku} matches more than one connected product. Add the Provider column or edit the item directly.` });
        continue;
      }
      const product = candidates[0];
      if (seen.has(product.id)) {
        errors.push({ row: input.row, code: "duplicate", message: `${product.sku || product.name} appears more than once in this import.` });
        continue;
      }
      seen.add(product.id);
      resolved.push({ input, product });
    }

    if (errors.length) {
      return jsonResponse({ error: { code: "INVENTORY_COST_REVIEW_REQUIRED", message: "Review the unmatched or duplicate rows before saving." }, errors }, { status: 422 });
    }

    const now = new Date();
    const statements: D1PreparedStatement[] = [];
    for (const { input, product } of resolved) {
      statements.push(database.prepare(`
        UPDATE commerce_products
        SET owner_cost_cents = ?, owner_cost_source = ?, owner_cost_updated_by_user_id = ?, owner_cost_updated_at = ?
        WHERE id = ? AND organization_id = ?
      `).bind(input.unitCostCents, source, context.userId, now.getTime(), product.id, context.organizationId));
    }
    await runBatches(statements);

    const affectedConnections = [...new Map(resolved.map(({ product }) => [product.connectionId, product])).values()];
    for (const product of affectedConnections) {
      const costCoverage = await applyOwnerInventoryCosts(context.organizationId, product.connectionId, now.getTime());
      if (product.provider === "square") {
        if (costCoverage.missingCostLines === 0) {
          await database.prepare(`
            UPDATE integration_connections SET last_error_code = NULL, updated_at = ?
            WHERE organization_id = ? AND id = ? AND provider = 'square'
              AND last_error_code = 'SQUARE_PRODUCT_COST_UNAVAILABLE'
          `).bind(now.getTime(), context.organizationId, product.connectionId).run();
        }
      }
    }

    await recordAudit({
      request,
      requestId,
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: source === "csv" ? "inventory.costs_imported" : "inventory.cost_updated",
      resourceType: "inventory_product_cost",
      details: { source, rows: resolved.length, connections: affectedConnections.length },
    });
    return jsonResponse({
      saved: resolved.length,
      source,
      products: resolved.map(({ input, product }) => ({
        provider: product.provider,
        connectionId: product.connectionId,
        externalProductId: product.externalProductId,
        sku: product.sku,
        name: product.name,
        unitCostCents: input.unitCostCents,
      })),
    });
  });
}
