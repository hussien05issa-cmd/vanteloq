import { and, asc, desc, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../db";
import {
  commerceSuppliers,
  customerInvoices,
  goodsReceipts,
  invoiceMatches,
  purchaseOrderLines,
  purchaseOrders,
  supplierBills,
  workspaceDocuments,
} from "../../../../db/schema";
import { assessPurchasingProduct } from "../../../../domain/purchasing-intelligence";
import { recordAudit } from "../../../../server/audit";
import { requireAccess } from "../../../../server/authorization";
import {
  ApiError,
  enforceRateLimit,
  handleApi,
  jsonResponse,
  readJsonObject,
  requireSameOrigin,
} from "../../../../server/api";
import { requirePermission } from "../../../../server/permissions";

const users = ["owner", "admin", "manager", "employee", "read_only"] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function text(value: unknown, label: string, maximum: number, required = true) {
  if (value === undefined || value === null || value === "") {
    if (!required) return "";
    throw new ApiError(400, "INVALID_FIELD", `Enter a valid ${label}.`);
  }
  if (typeof value !== "string")
    throw new ApiError(400, "INVALID_FIELD", `Enter a valid ${label}.`);
  const normalized = value.trim().normalize("NFC");
  if (
    (required && !normalized) ||
    normalized.length > maximum ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  )
    throw new ApiError(400, "INVALID_FIELD", `Enter a valid ${label}.`);
  return normalized;
}
function integer(
  value: unknown,
  label: string,
  minimum = 0,
  maximum = 1_000_000_000_000,
) {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < minimum ||
    Number(value) > maximum
  )
    throw new ApiError(400, "INVALID_FIELD", `Enter a valid ${label}.`);
  return Number(value);
}

type ProcurementProductRow = {
  id: string;
  provider: string;
  externalProductId: string;
  sku: string;
  name: string;
  supplierId: string | null;
  supplierName: string | null;
  defaultCostCents: number | null;
  onHandQuantity: number;
  reorderPoint: number;
  incomingUnits: number;
  soldQuantityMilli30d: number;
  soldQuantityMilliPrevious30d: number;
  soldQuantityMilli90d: number;
  lastSoldDate: string | null;
  lastOrderedDate: string | null;
  lastOrderStatus: string | null;
};

function businessDateOffset(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function procurementCatalog(organizationId: string) {
  const database = getD1();
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDayStart = businessDateOffset(today, -29);
  const sixtyDayStart = businessDateOffset(today, -59);
  const ninetyDayStart = businessDateOffset(today, -89);
  const [supplierRows, productRows, coverage] = await Promise.all([
    getDb()
      .select({
        id: commerceSuppliers.id,
        provider: commerceSuppliers.provider,
        externalSupplierId: commerceSuppliers.externalSupplierId,
        name: commerceSuppliers.name,
        accountNumber: commerceSuppliers.accountNumber,
      })
      .from(commerceSuppliers)
      .where(
        and(
          eq(commerceSuppliers.organizationId, organizationId),
          eq(commerceSuppliers.archived, false),
        ),
      )
      .orderBy(asc(commerceSuppliers.name))
      .limit(500),
    database
      .prepare(
        `SELECT p.id,
                p.provider,
                p.external_product_id AS externalProductId,
                p.sku,
                p.name,
                s.id AS supplierId,
                s.name AS supplierName,
                p.default_cost_cents AS defaultCostCents,
                COALESCE((SELECT SUM(b.on_hand_quantity)
                  FROM inventory_balances b
                  WHERE b.organization_id = p.organization_id AND b.sku = p.sku), 0) AS onHandQuantity,
                COALESCE((SELECT SUM(b.reorder_point)
                  FROM inventory_balances b
                  WHERE b.organization_id = p.organization_id AND b.sku = p.sku), 0) AS reorderPoint,
                COALESCE((SELECT SUM(pol.quantity - pol.received_quantity)
                  FROM purchase_order_lines pol
                  JOIN purchase_orders po ON po.id = pol.purchase_order_id
                  WHERE pol.organization_id = p.organization_id
                    AND pol.sku = p.sku
                    AND po.status NOT IN ('closed', 'cancelled', 'received', 'invoiced')), 0) AS incomingUnits,
                COALESCE((SELECT SUM(sl.quantity_milli)
                  FROM commerce_sale_lines sl
                  WHERE sl.organization_id = p.organization_id
                    AND sl.provider = p.provider
                    AND sl.product_ref = p.external_product_id
                    AND substr(sl.sold_at, 1, 10) >= ?), 0) AS soldQuantityMilli30d,
                COALESCE((SELECT SUM(sl.quantity_milli)
                  FROM commerce_sale_lines sl
                  WHERE sl.organization_id = p.organization_id
                    AND sl.provider = p.provider
                    AND sl.product_ref = p.external_product_id
                    AND substr(sl.sold_at, 1, 10) >= ?
                    AND substr(sl.sold_at, 1, 10) < ?), 0) AS soldQuantityMilliPrevious30d,
                COALESCE((SELECT SUM(sl.quantity_milli)
                  FROM commerce_sale_lines sl
                  WHERE sl.organization_id = p.organization_id
                    AND sl.provider = p.provider
                    AND sl.product_ref = p.external_product_id
                    AND substr(sl.sold_at, 1, 10) >= ?), 0) AS soldQuantityMilli90d,
                (SELECT MAX(substr(sl.sold_at, 1, 10))
                  FROM commerce_sale_lines sl
                  WHERE sl.organization_id = p.organization_id
                    AND sl.provider = p.provider
                    AND sl.product_ref = p.external_product_id) AS lastSoldDate,
                (SELECT MAX(po.order_date)
                  FROM purchase_order_lines pol
                  JOIN purchase_orders po ON po.id = pol.purchase_order_id
                  WHERE pol.organization_id = p.organization_id AND pol.sku = p.sku) AS lastOrderedDate
                ,(SELECT po.status
                  FROM purchase_order_lines pol
                  JOIN purchase_orders po ON po.id = pol.purchase_order_id
                  WHERE pol.organization_id = p.organization_id AND pol.sku = p.sku
                  ORDER BY po.order_date DESC, po.updated_at DESC LIMIT 1) AS lastOrderStatus
         FROM commerce_products p
         LEFT JOIN commerce_suppliers s
           ON s.organization_id = p.organization_id
          AND s.provider = p.provider
          AND s.external_supplier_id = p.supplier_ref
         WHERE p.organization_id = ? AND p.archived = 0
         ORDER BY p.name ASC
         LIMIT 1000`,
      )
      .bind(thirtyDayStart, sixtyDayStart, thirtyDayStart, ninetyDayStart, organizationId)
      .all<ProcurementProductRow>(),
    database
      .prepare(
        `SELECT MIN(substr(sold_at, 1, 10)) AS earliestSaleDate
         FROM commerce_sale_lines
         WHERE organization_id = ? AND sold_at IS NOT NULL`,
      )
      .bind(organizationId)
      .first<{ earliestSaleDate: string | null }>(),
  ]);

  const hasNinetyDaysOfHistory = Boolean(
    coverage?.earliestSaleDate && coverage.earliestSaleDate <= ninetyDayStart,
  );
  const products = (productRows.results ?? []).map((row) => {
    const onHandQuantity = Number(row.onHandQuantity ?? 0);
    const reorderPoint = Number(row.reorderPoint ?? 0);
    const incomingUnits = Number(row.incomingUnits ?? 0);
    const soldUnits30d = Math.max(
      0,
      Math.round(Number(row.soldQuantityMilli30d ?? 0)) / 1000,
    );
    const soldUnitsPrevious30d = Math.max(0, Math.round(Number(row.soldQuantityMilliPrevious30d ?? 0)) / 1000);
    const soldUnits90d = Math.max(0, Math.round(Number(row.soldQuantityMilli90d ?? 0)) / 1000);
    const assessment = assessPurchasingProduct({
      sku: row.sku,
      name: row.name,
      supplierName: row.supplierName,
      onHandUnits: onHandQuantity,
      reorderPointUnits: reorderPoint,
      incomingUnits,
      unitsSold30: soldUnits30d,
      unitsSoldPrevious30: soldUnitsPrevious30d,
      unitsSold90: hasNinetyDaysOfHistory ? soldUnits90d : Math.max(1, soldUnits90d),
      unitCostCents: row.defaultCostCents,
      lastOrderedAt: row.lastOrderedDate,
      lastOrderStatus: row.lastOrderStatus,
      lastSaleAt: row.lastSoldDate,
    });
    const averageDailyDemand = soldUnits30d / 30;
    const health = assessment.health === "healthy"
      ? { tone: "green" as const, label: "Healthy movement", detail: assessment.summary }
      : assessment.health === "dead_stock"
        ? { tone: "red" as const, label: "Dead stock", detail: assessment.summary }
        : assessment.health === "issue"
          ? { tone: "red" as const, label: "Reorder attention", detail: assessment.summary }
          : { tone: "amber" as const, label: "Review inputs", detail: assessment.summary };
    return {
      ...row,
      onHandQuantity,
      reorderPoint,
      incomingUnits,
      soldUnits30d,
      soldUnitsPrevious30d,
      soldUnits90d,
      averageDailyDemand,
      recommendedQuantity: assessment.recommendedUnits,
      daysCover: assessment.daysCover,
      demandTrendRate: assessment.demandTrendRate,
      recommendationFactors: assessment.factors,
      health,
    };
  });

  return {
    suppliers: supplierRows,
    products,
    method: {
      periodStart: thirtyDayStart,
      periodEnd: today,
      reviewHorizonDays: 14,
      deadStockWindowDays: 90,
      deadStockHistoryAvailable: hasNinetyDaysOfHistory,
      description:
        "Recommendations use verified 30-day performance, prior-period trend, 90-day movement, current stock, reorder points and open purchase orders. Lead time, case packs, shelf life and cash capacity still require review before approval.",
    },
  };
}

async function list(organizationId: string) {
  const [orders, lines, receipts, matches, catalog, bills, invoices] = await Promise.all([
    getDb()
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.organizationId, organizationId))
      .orderBy(desc(purchaseOrders.updatedAt))
      .limit(200),
    getDb()
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.organizationId, organizationId))
      .orderBy(asc(purchaseOrderLines.lineNumber)),
    getDb()
      .select()
      .from(goodsReceipts)
      .where(eq(goodsReceipts.organizationId, organizationId))
      .orderBy(desc(goodsReceipts.createdAt)),
    getDb()
      .select()
      .from(invoiceMatches)
      .where(eq(invoiceMatches.organizationId, organizationId))
      .orderBy(desc(invoiceMatches.createdAt)),
    procurementCatalog(organizationId),
    getDb().select({
      id: supplierBills.id,
      reference: supplierBills.billNumber,
      dueDate: supplierBills.dueDate,
      status: supplierBills.status,
      totalCents: supplierBills.totalCents,
      currency: supplierBills.currency,
    }).from(supplierBills).where(eq(supplierBills.organizationId, organizationId)).orderBy(asc(supplierBills.dueDate)).limit(200),
    getDb().select({
      id: customerInvoices.id,
      reference: customerInvoices.invoiceNumber,
      dueDate: customerInvoices.dueDate,
      status: customerInvoices.status,
      totalCents: customerInvoices.totalCents,
      currency: customerInvoices.currency,
    }).from(customerInvoices).where(eq(customerInvoices.organizationId, organizationId)).orderBy(asc(customerInvoices.dueDate)).limit(200),
  ]);
  const commitments = orders
    .filter((order) => !["closed", "cancelled"].includes(order.status))
    .reduce((sum, order) => sum + order.totalCents, 0);
  return {
    orders: orders.map((order) => ({
      ...order,
      lines: lines.filter((line) => line.purchaseOrderId === order.id),
      receipts: receipts.filter(
        (receipt) => receipt.purchaseOrderId === order.id,
      ),
      matches: matches.filter((match) => match.purchaseOrderId === order.id),
    })),
    summary: {
      openOrders: orders.filter(
        (order) => !["closed", "cancelled"].includes(order.status),
      ).length,
      awaitingApproval: orders.filter(
        (order) => order.status === "awaiting_approval",
      ).length,
      openCommitmentsCents: commitments,
      discrepancies:
        receipts.filter((receipt) => receipt.discrepancyStatus !== "matched")
          .length +
        matches.filter((match) => match.status !== "matched").length,
      redAlerts: catalog.products.filter((product) => product.health.tone === "red").length,
      healthyProducts: catalog.products.filter((product) => product.health.tone === "green").length,
      deadStockProducts: catalog.products.filter((product) => product.health.label === "Dead stock").length,
    },
    catalog,
    calendar: [
      ...orders.flatMap((order) => [
        { id: `ordered:${order.id}`, kind: "purchase_ordered", date: order.orderDate, title: `${order.orderNumber} ordered`, detail: order.supplierName, status: order.status, amountCents: order.totalCents, currency: order.currency },
        ...(order.expectedDeliveryDate ? [{ id: `expected:${order.id}`, kind: "purchase_expected", date: order.expectedDeliveryDate, title: `${order.orderNumber} expected`, detail: order.supplierName, status: order.status, amountCents: order.totalCents, currency: order.currency }] : []),
        ...(order.committedCashDate ? [{ id: `cash:${order.id}`, kind: "purchase_cash_due", date: order.committedCashDate, title: `${order.orderNumber} cash commitment`, detail: order.supplierName, status: order.status, amountCents: order.totalCents, currency: order.currency }] : []),
      ]),
      ...bills.filter((bill) => !["paid", "reconciled", "void"].includes(bill.status)).map((bill) => ({ id: `bill:${bill.id}`, kind: "supplier_bill_due", date: bill.dueDate, title: `${bill.reference} due`, detail: "Supplier bill", status: bill.status, amountCents: bill.totalCents, currency: bill.currency })),
      ...invoices.filter((invoice) => !["paid", "written_off", "void"].includes(invoice.status)).map((invoice) => ({ id: `invoice:${invoice.id}`, kind: "customer_invoice_due", date: invoice.dueDate, title: `${invoice.reference} due`, detail: "Customer invoice", status: invoice.status, amountCents: invoice.totalCents, currency: invoice.currency })),
    ].sort((left, right) => left.date.localeCompare(right.date)),
  };
}

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, users);
    await requirePermission(context, "purchasing.view");
    await enforceRateLimit("purchasing:read", context.userId, 90, 60);
    return jsonResponse(await list(context.organizationId));
  });
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, users);
    await enforceRateLimit("purchasing:write", context.userId, 40, 3_600);
    const input = await readJsonObject(request, 256_000);
    const action = text(input.action, "action", 50);
    const database = getD1();
    const now = Date.now();
    let resourceId = "";
    let auditAction = "";
    let details: Record<string, string | number | boolean | null> = { action };

    if (action === "create") {
      await requirePermission(context, "purchasing.create");
      if (
        !Array.isArray(input.lines) ||
        !input.lines.length ||
        input.lines.length > 100
      )
        throw new ApiError(
          400,
          "INVALID_LINES",
          "Add between one and 100 purchase-order lines.",
        );
      const catalog = await procurementCatalog(context.organizationId);
      const productById = new Map(
        catalog.products.map((product) => [product.id, product]),
      );
      const supplierById = new Map(
        catalog.suppliers.map((supplier) => [supplier.id, supplier]),
      );
      const supplierId = text(input.supplierId, "supplier", 200, false);
      const selectedSupplier = supplierId ? supplierById.get(supplierId) : null;
      if (supplierId && !selectedSupplier)
        throw new ApiError(
          404,
          "SUPPLIER_NOT_FOUND",
          "Select a supplier from this organization.",
        );
      const supplierName = selectedSupplier
        ? selectedSupplier.name
        : text(input.supplierName, "supplier", 160);
      const lines = input.lines.map((entry, index) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry))
          throw new ApiError(
            400,
            "INVALID_LINE",
            `Line ${index + 1} is invalid.`,
          );
        const row = entry as Record<string, unknown>;
        const productId = text(row.productId, "product", 200, false);
        const selectedProduct = productId ? productById.get(productId) : null;
        if (productId && !selectedProduct)
          throw new ApiError(
            404,
            "PRODUCT_NOT_FOUND",
            `Select a valid product for line ${index + 1}.`,
          );
        if (
          selectedSupplier &&
          selectedProduct?.supplierId &&
          selectedProduct.supplierId !== selectedSupplier.id
        )
          throw new ApiError(
            409,
            "PRODUCT_SUPPLIER_MISMATCH",
            `${selectedProduct.name} is assigned to a different supplier in the imported product database.`,
          );
        const quantity = integer(
          row.quantity,
          `quantity for line ${index + 1}`,
          1,
          1_000_000,
        );
        const unitCostCents = integer(
          row.unitCostCents ?? selectedProduct?.defaultCostCents,
          `unit cost for line ${index + 1}`,
        );
        return {
          id: crypto.randomUUID(),
          lineNumber: index + 1,
          sku: selectedProduct?.sku ?? text(row.sku, "SKU", 80, false),
          description:
            selectedProduct?.name ??
            text(row.description, "product description", 200),
          quantity,
          unitCostCents,
          previousCostCents: selectedProduct?.defaultCostCents ?? null,
          currentInventory: selectedProduct?.onHandQuantity ?? null,
          reorderPoint: selectedProduct?.reorderPoint ?? null,
          forecastDemand: selectedProduct?.recommendedQuantity ?? null,
        };
      });
      const orderDate = text(input.orderDate, "order date", 10);
      if (!DATE.test(orderDate))
        throw new ApiError(400, "INVALID_FIELD", "Enter a valid order date.");
      const expected = text(
        input.expectedDeliveryDate,
        "expected delivery date",
        10,
        false,
      );
      if (expected && !DATE.test(expected))
        throw new ApiError(
          400,
          "INVALID_FIELD",
          "Enter a valid expected delivery date.",
        );
      const taxCents = integer(input.taxCents ?? 0, "tax amount");
      const discountCents = integer(
        input.discountCents ?? 0,
        "discount amount",
      );
      const subtotalCents = lines.reduce(
        (sum, line) => sum + line.quantity * line.unitCostCents,
        0,
      );
      if (discountCents > subtotalCents + taxCents)
        throw new ApiError(
          400,
          "INVALID_FIELD",
          "Discount cannot exceed the order value.",
        );
      const id = crypto.randomUUID();
      const status =
        input.submitForApproval === true ? "awaiting_approval" : "draft";
      const totalCents = subtotalCents + taxCents - discountCents;
      const statements = [
        database
          .prepare(
            `INSERT INTO purchase_orders
        (id, organization_id, order_number, supplier_name, delivery_location_id, order_date, expected_delivery_date, currency, payment_terms, status, subtotal_cents, tax_cents, discount_cents, total_cents, committed_cash_date, notes, created_by_user_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            id,
            context.organizationId,
            text(input.orderNumber, "order number", 80),
            supplierName,
            text(input.deliveryLocationId, "delivery location", 200, false) ||
              null,
            orderDate,
            expected || null,
            text(input.currency, "currency", 3).toUpperCase(),
            text(input.paymentTerms, "payment terms", 100, false),
            status,
            subtotalCents,
            taxCents,
            discountCents,
            totalCents,
            text(input.committedCashDate, "committed cash date", 10, false) ||
              null,
            text(input.notes, "notes", 2000, false),
            context.userId,
            now,
            now,
          ),
      ];
      for (const line of lines)
        statements.push(
          database
            .prepare(
              `INSERT INTO purchase_order_lines
        (id, organization_id, purchase_order_id, line_number, sku, description, quantity, received_quantity, invoiced_quantity, unit_cost_cents, previous_cost_cents, current_inventory, reorder_point, forecast_demand, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              line.id,
              context.organizationId,
              id,
              line.lineNumber,
              line.sku,
              line.description,
              line.quantity,
              line.unitCostCents,
              line.previousCostCents,
              line.currentInventory,
              line.reorderPoint,
              line.forecastDemand,
              now,
              now,
            ),
        );
      await database.batch(statements);
      resourceId = id;
      auditAction = "purchase_order.created";
      details = {
        action,
        status,
        lineCount: lines.length,
        totalCents,
        supplierSource: selectedSupplier ? "imported_catalog" : "manual",
      };
    } else if (action === "approve") {
      await requirePermission(context, "purchasing.approve");
      const id = text(input.purchaseOrderId, "purchase order", 200);
      const result = await database
        .prepare(
          "UPDATE purchase_orders SET status = 'approved', approved_by_user_id = ?, updated_at = ? WHERE id = ? AND organization_id = ? AND status = 'awaiting_approval'",
        )
        .bind(context.userId, now, id, context.organizationId)
        .run();
      if (!result.success)
        throw new ApiError(
          409,
          "INVALID_TRANSITION",
          "Only purchase orders awaiting approval can be approved.",
        );
      resourceId = id;
      auditAction = "purchase_order.approved";
    } else if (action === "mark_sent") {
      await requirePermission(context, "purchasing.send");
      const id = text(input.purchaseOrderId, "purchase order", 200);
      if (input.confirmExternalSend !== true)
        throw new ApiError(
          400,
          "CONFIRMATION_REQUIRED",
          "Confirm that an authorized person sent the purchase order outside Vanteloq. No email provider is connected.",
        );
      await database
        .prepare(
          "UPDATE purchase_orders SET status = 'sent', updated_at = ? WHERE id = ? AND organization_id = ? AND status = 'approved'",
        )
        .bind(now, id, context.organizationId)
        .run();
      resourceId = id;
      auditAction = "purchase_order.external_send_confirmed";
      details = { action, provider: "manual_external_confirmation" };
    } else if (action === "receive") {
      await requirePermission(context, "purchasing.receive");
      const id = text(input.purchaseOrderId, "purchase order", 200);
      const lines = await getDb()
        .select()
        .from(purchaseOrderLines)
        .where(
          and(
            eq(purchaseOrderLines.organizationId, context.organizationId),
            eq(purchaseOrderLines.purchaseOrderId, id),
          ),
        );
      if (!lines.length || !Array.isArray(input.lines))
        throw new ApiError(
          400,
          "INVALID_RECEIPT",
          "Add received quantities for this purchase order.",
        );
      const received = new Map<string, number>();
      for (const entry of input.lines) {
        if (!entry || typeof entry !== "object") continue;
        const row = entry as Record<string, unknown>;
        received.set(
          text(row.lineId, "line", 200),
          integer(row.quantity, "received quantity", 0, 1_000_000),
        );
      }
      let discrepancy: "matched" | "short" | "over" = "matched";
      const statements = [] as D1PreparedStatement[];
      for (const line of lines) {
        const add = received.get(line.id) ?? 0;
        const total = line.receivedQuantity + add;
        if (total < line.quantity) discrepancy = "short";
        if (total > line.quantity) discrepancy = "over";
        statements.push(
          database
            .prepare(
              "UPDATE purchase_order_lines SET received_quantity = ?, updated_at = ? WHERE id = ? AND organization_id = ?",
            )
            .bind(total, now, line.id, context.organizationId),
        );
      }
      const allReceived = lines.every(
        (line) =>
          line.receivedQuantity + (received.get(line.id) ?? 0) >= line.quantity,
      );
      const receiptId = crypto.randomUUID();
      statements.push(
        database
          .prepare(
            "INSERT INTO goods_receipts (id, organization_id, purchase_order_id, received_date, received_by_user_id, lines_json, discrepancy_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(
            receiptId,
            context.organizationId,
            id,
            text(input.receivedDate, "received date", 10),
            context.userId,
            JSON.stringify(
              [...received.entries()].map(([lineId, quantity]) => ({
                lineId,
                quantity,
              })),
            ),
            discrepancy,
            now,
          ),
      );
      statements.push(
        database
          .prepare(
            "UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ? AND organization_id = ? AND status NOT IN ('cancelled','closed')",
          )
          .bind(
            allReceived ? "received" : "partially_received",
            now,
            id,
            context.organizationId,
          ),
      );
      await database.batch(statements);
      resourceId = id;
      auditAction = "purchase_order.received";
      details = { action, receiptId, discrepancy, completed: allReceived };
    } else if (action === "match_invoice") {
      await requirePermission(context, "purchasing.match");
      const id = text(input.purchaseOrderId, "purchase order", 200);
      const documentId = text(input.documentId, "invoice document", 200);
      const [order] = await getDb()
        .select()
        .from(purchaseOrders)
        .where(
          and(
            eq(purchaseOrders.id, id),
            eq(purchaseOrders.organizationId, context.organizationId),
          ),
        )
        .limit(1);
      const [document] = await getDb()
        .select()
        .from(workspaceDocuments)
        .where(
          and(
            eq(workspaceDocuments.id, documentId),
            eq(workspaceDocuments.organizationId, context.organizationId),
          ),
        )
        .limit(1);
      if (!order || !document || document.documentType !== "invoice")
        throw new ApiError(
          404,
          "NOT_FOUND",
          "Select an invoice and purchase order from this organization.",
        );
      const invoiceTotalCents = integer(
        input.invoiceTotalCents,
        "invoice total",
      );
      const difference = invoiceTotalCents - order.totalCents;
      const status = difference === 0 ? "matched" : "price_mismatch";
      const matchId = crypto.randomUUID();
      await database.batch([
        database
          .prepare(
            "INSERT INTO invoice_matches (id, organization_id, purchase_order_id, document_id, status, difference_cents, details_json, reviewed_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(
            matchId,
            context.organizationId,
            id,
            documentId,
            status,
            difference,
            JSON.stringify({
              invoiceTotalCents,
              orderTotalCents: order.totalCents,
              extractionStatus: document.extractionStatus,
            }),
            context.userId,
            now,
            now,
          ),
        database
          .prepare(
            "UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ? AND organization_id = ?",
          )
          .bind(
            status === "matched" ? "invoiced" : "partially_invoiced",
            now,
            id,
            context.organizationId,
          ),
        database
          .prepare(
            "UPDATE workspace_documents SET status = ?, updated_at = ? WHERE id = ? AND organization_id = ?",
          )
          .bind(
            status === "matched" ? "approved" : "review_required",
            now,
            documentId,
            context.organizationId,
          ),
      ]);
      resourceId = id;
      auditAction = "purchase_order.invoice_matched";
      details = { action, matchId, status, differenceCents: difference };
    } else
      throw new ApiError(
        400,
        "UNKNOWN_ACTION",
        "Select a supported purchase-order action.",
      );

    await recordAudit({
      request,
      requestId,
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: auditAction,
      resourceType: "purchase_order",
      resourceId,
      details,
    });
    return jsonResponse(await list(context.organizationId), {
      status: action === "create" ? 201 : 200,
    });
  });
}
