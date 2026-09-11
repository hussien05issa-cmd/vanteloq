import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getD1, getDb } from "../../../../db";
import {
  bankAccounts,
  bookloqSettings,
  commerceSuppliers,
  customerInvoices,
  goodsReceipts,
  integrationConnections,
  invoiceMatches,
  purchaseOrderLines,
  purchaseOrders,
  supplierBills,
  workspaceDocuments,
} from "../../../../db/schema";
import {
  allocatePurchasingCapacity,
  assessPurchasingProduct,
  calculateOpenPurchasingObligations,
  calculateVerifiedPurchasingCapacity,
  verifiedCashSourceEligible,
} from "../../../../domain/purchasing-intelligence";
import { recordAudit } from "../../../../server/audit";
import { requireAccess, type AccessContext } from "../../../../server/authorization";
import { requireFeature } from "../../../../server/entitlements/engine";
import {
  ApiError,
  enforceRateLimit,
  handleApi,
  jsonResponse,
  readJsonObject,
  requireSameOrigin,
} from "../../../../server/api";
import { effectivePermissions, requirePermission } from "../../../../server/permissions";
import { hasAddon } from "../../../../server/entitlements/engine";
import { authorizedLocationDataScope, requireAccessibleLocation } from "../../../../server/location-access";
import { plaidReadiness } from "../../../../server/integrations/plaid";
import { approvedBankSource, noActiveIntegrationLease } from "../../../../server/integrations/trusted-data";
import { buildPurchaseCommitmentBoard } from "../../../../domain/purchase-commitments";

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
  connectionId: string;
  externalProductId: string;
  sku: string;
  name: string;
  supplierId: string | null;
  supplierName: string | null;
  defaultCostCents: number | null;
  onHandQuantity: number | null;
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

function validIsoDate(value: string) {
  if (!DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validCurrencyCode(value: string) {
  if (!/^[A-Z]{3}$/.test(value)) return false;
  const supportedValuesOf = (Intl as typeof Intl & { supportedValuesOf?: (key: "currency") => string[] }).supportedValuesOf;
  if (supportedValuesOf) return value !== "XXX" && supportedValuesOf("currency").includes(value);
  return new Set(["CAD", "USD", "EUR", "GBP", "AUD", "NZD", "JPY", "CHF", "CNY", "HKD", "SGD", "MXN"]).has(value);
}

type ProcurementLocationScope = {
  ids: string[];
  selectedId: string | null;
  name: string;
  refs: string[];
  providerLocations: Array<{ provider: string; connectionId: string; externalLocationRef: string }>;
  providerByRef: Map<string, string>;
  connectionByRef: Map<string, string>;
};

type PurchasingVisibility = {
  cashDetails: boolean;
  financeCalendar: boolean;
  costDetails: boolean;
};

const sensitivePurchasingFields = new Set([
  "unitCostCents", "previousCostCents", "defaultCostCents", "subtotalCents", "taxCents", "discountCents", "totalCents",
  "amountCents", "openCommitmentsCents", "remainingMerchandiseCents", "totalRemainingMerchandiseCents", "remainingCostCents",
  "cashAllocatedCents", "recommendedCostCents", "detailsJson", "priceChangeRate", "cashConstrainedQuantity", "cashDecision",
]);

function redactPurchasingCosts(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactPurchasingCosts);
  if (value instanceof Date) return value;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !sensitivePurchasingFields.has(key) && !key.endsWith("Cents"))
      .map(([key, item]) => [key, redactPurchasingCosts(item)]),
  );
}

async function requestLocationScope(request: Request, context: AccessContext): Promise<ProcurementLocationScope | null> {
  const requested = new URL(request.url).searchParams.get("location");
  const access = await authorizedLocationDataScope(context, requested);
  if (access.locationIds === null) return null;
  const refs = new Set<string>(access.locationRefs ?? []);
  const connectionByRef = new Map<string, string>();
  for (const mapping of access.providerLocations ?? []) {
    connectionByRef.set(`${mapping.provider}:${mapping.externalLocationRef}`, mapping.connectionId);
  }
  return {
    ids: access.locationIds,
    selectedId: access.selectedLocationId,
    name: access.selectedLocation?.name ?? "Accessible locations",
    refs: [...refs],
    providerLocations: access.providerLocations ?? [],
    providerByRef: access.providerByRef,
    connectionByRef,
  };
}

async function verifiedCashContext(organizationId: string) {
  const database = getDb();
  const [settings, accounts, bills, orders] = await Promise.all([
    database.select({
      baseCurrency: bookloqSettings.baseCurrency,
      cashSafetyThresholdCents: bookloqSettings.cashSafetyThresholdCents,
      status: bookloqSettings.status,
      dataMode: bookloqSettings.dataMode,
    }).from(bookloqSettings).where(eq(bookloqSettings.organizationId, organizationId)).limit(1),
    database.select({
      accountType: bankAccounts.accountType,
      currency: bankAccounts.currency,
      connectionStatus: bankAccounts.connectionStatus,
      availableBalanceCents: bankAccounts.availableBalanceCents,
      liveBalanceCents: bankAccounts.liveBalanceCents,
      lastSyncAt: bankAccounts.lastSyncAt,
      demoRecord: bankAccounts.demoRecord,
    }).from(bankAccounts).where(and(
      eq(bankAccounts.organizationId, organizationId),
      eq(bankAccounts.provider, "plaid"),
      approvedBankSource(bankAccounts.organizationId, bankAccounts.provider, bankAccounts.externalItemRef),
    )),
    database.select({
      status: supplierBills.status,
      totalCents: supplierBills.totalCents,
      paidCents: supplierBills.paidCents,
      currency: supplierBills.currency,
      purchaseOrderRef: supplierBills.purchaseOrderRef,
      demoRecord: supplierBills.demoRecord,
    }).from(supplierBills).where(eq(supplierBills.organizationId, organizationId)),
    database.select({
      id: purchaseOrders.id,
      orderNumber: purchaseOrders.orderNumber,
      status: purchaseOrders.status,
      currency: purchaseOrders.currency,
      totalCents: purchaseOrders.totalCents,
    }).from(purchaseOrders).where(eq(purchaseOrders.organizationId, organizationId)),
  ]);
  const baseCurrency = (settings[0]?.baseCurrency || "CAD").toUpperCase();
  const obligations = calculateOpenPurchasingObligations({ baseCurrency, bills, orders });
  const bookloq = settings[0];
  const result = calculateVerifiedPurchasingCapacity({
    connectionVerified: verifiedCashSourceEligible({
      connectionStatus: accounts.length ? "connected" : "missing",
      promotionStatus: accounts.length ? "approved" : "blocked",
      liveDataEligible: plaidReadiness().liveDataEligible,
      bookloqAddonActive: true,
      bookloqStatus: bookloq?.status ?? null,
      bookloqDataMode: bookloq?.dataMode ?? null,
      hasDemoAccounts: accounts.some((account) => account.demoRecord),
    }),
    nowMs: Date.now(),
    maximumAgeMs: 48 * 60 * 60 * 1000,
    baseCurrency,
    cashSafetyReserveCents: settings[0]?.cashSafetyThresholdCents ?? 0,
    outstandingBillsCents: obligations.outstandingBillsCents,
    openPurchaseCommitmentsCents: obligations.openPurchaseCommitmentsCents,
    accounts: accounts.map((account) => ({
      ...account,
      lastSyncAtMs: account.lastSyncAt?.getTime() ?? null,
    })),
  });
  const currencyReviewRequired = obligations.excludedCurrencyObligations > 0;
  const guardedResult = currencyReviewRequired && result.status === "available"
    ? { ...result, status: "needs_currency_review" as const, verifiedPurchasingCapacityCents: null }
    : result;
  return {
    ...guardedResult,
    excludedCurrencyObligations: obligations.excludedCurrencyObligations,
    explanation: currencyReviewRequired
      ? "Open obligations in another currency require a verified conversion or finance review before cash can constrain reorder quantities."
      : guardedResult.status === "available"
      ? "Available cash from fresh, healthy Plaid depository accounts minus the BookLoQ reserve, open supplier bills and open approved purchase commitments. Credit availability and other currencies are excluded."
      : guardedResult.status === "stale_bank_data"
        ? "Connected bank balances are older than 48 hours. Recommendations remain demand-based until a fresh balance sync succeeds."
        : guardedResult.status === "needs_healthy_cash_account"
          ? `No fresh, healthy ${baseCurrency} cash account is available. Recommendations remain demand-based.`
          : "Connect and synchronize Plaid in BookLoQ before cash can constrain reorder quantities.",
  };
}

async function procurementCatalog(
  organizationId: string,
  locationScope: ProcurementLocationScope | null = null,
  exposeCashContext = false,
) {
  const database = getD1();
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDayStart = businessDateOffset(today, -29);
  const sixtyDayStart = businessDateOffset(today, -59);
  const ninetyDayStart = businessDateOffset(today, -89);
  const [supplierRows, productRows, coverage, cashContext] = await Promise.all([
    getDb()
      .select({
        id: commerceSuppliers.id,
        provider: commerceSuppliers.provider,
        externalSupplierId: commerceSuppliers.externalSupplierId,
        name: commerceSuppliers.name,
        accountNumber: commerceSuppliers.accountNumber,
      })
      .from(commerceSuppliers)
      .innerJoin(integrationConnections, and(
        eq(integrationConnections.id, commerceSuppliers.connectionId),
        eq(integrationConnections.organizationId, commerceSuppliers.organizationId),
      ))
      .where(
        and(
          eq(commerceSuppliers.organizationId, organizationId),
          eq(commerceSuppliers.archived, false),
          eq(integrationConnections.status, "connected"),
          eq(integrationConnections.dataPromotionStatus, "approved"),
          noActiveIntegrationLease(integrationConnections.syncLeaseOwner, integrationConnections.syncLeaseExpiresAt),
        ),
      )
      .orderBy(asc(commerceSuppliers.name))
      .limit(500),
    database
      .prepare(
        `SELECT p.id,
                p.provider,
                p.connection_id AS connectionId,
                p.external_product_id AS externalProductId,
                p.sku,
                p.name,
                s.id AS supplierId,
                s.name AS supplierName,
                p.default_cost_cents AS defaultCostCents,
                (SELECT SUM(b.on_hand_quantity)
                  FROM inventory_balances b
                  WHERE b.organization_id = p.organization_id
                    AND b.source_connection_id = p.connection_id
                    AND b.location_ref IN (
                      SELECT m.provider || ':' || CASE WHEN c.source_namespace = 'legacy' THEN m.external_location_ref ELSE c.source_namespace || ':' || m.external_location_ref END
                      FROM integration_location_mappings m
                      JOIN integration_connections c ON c.id = m.connection_id AND c.organization_id = m.organization_id
                      WHERE m.organization_id = p.organization_id AND m.connection_id = p.connection_id AND m.status = 'mapped'
                    )
                    AND b.sku = p.sku) AS onHandQuantity,
                COALESCE((SELECT SUM(b.reorder_point)
                  FROM inventory_balances b
                  WHERE b.organization_id = p.organization_id
                    AND b.source_connection_id = p.connection_id
                    AND b.location_ref IN (
                      SELECT m.provider || ':' || CASE WHEN c.source_namespace = 'legacy' THEN m.external_location_ref ELSE c.source_namespace || ':' || m.external_location_ref END
                      FROM integration_location_mappings m
                      JOIN integration_connections c ON c.id = m.connection_id AND c.organization_id = m.organization_id
                      WHERE m.organization_id = p.organization_id AND m.connection_id = p.connection_id AND m.status = 'mapped'
                    )
                    AND b.sku = p.sku), 0) AS reorderPoint,
                COALESCE((SELECT SUM(MAX(pol.quantity - pol.received_quantity, 0))
                  FROM purchase_order_lines pol
                  JOIN purchase_orders po ON po.id = pol.purchase_order_id
                  WHERE pol.organization_id = p.organization_id
                    AND ((pol.connection_id = p.connection_id
                          AND pol.provider = p.provider
                          AND pol.external_product_ref = p.external_product_id)
                      OR (pol.connection_id IS NULL AND pol.provider IS NULL AND pol.sku = p.sku AND NOT EXISTS (
                        SELECT 1 FROM commerce_products duplicate
                        WHERE duplicate.organization_id = p.organization_id
                          AND duplicate.sku = p.sku
                          AND duplicate.id <> p.id
                          AND duplicate.archived = 0
                          AND EXISTS (
                            SELECT 1 FROM integration_connections duplicate_connection
                            WHERE duplicate_connection.id = duplicate.connection_id
                              AND duplicate_connection.organization_id = duplicate.organization_id
                              AND duplicate_connection.status = 'connected'
                              AND duplicate_connection.data_promotion_status = 'approved'
                              AND (duplicate_connection.sync_lease_owner IS NULL OR duplicate_connection.sync_lease_expires_at IS NULL
                                OR duplicate_connection.sync_lease_expires_at <= CAST(strftime('%s', 'now') AS INTEGER))
                          ))))
                    AND po.status IN ('sent', 'acknowledged', 'partially_received', 'received', 'partially_invoiced', 'invoiced', 'disputed')), 0) AS incomingUnits,
                COALESCE((SELECT SUM(sl.quantity_milli)
                  FROM commerce_sale_lines sl
                  WHERE sl.organization_id = p.organization_id
                    AND sl.provider = p.provider
                    AND sl.connection_id = p.connection_id
                    AND sl.product_ref = p.external_product_id
                    AND substr(sl.sold_at, 1, 10) >= ?), 0) AS soldQuantityMilli30d,
                COALESCE((SELECT SUM(sl.quantity_milli)
                  FROM commerce_sale_lines sl
                  WHERE sl.organization_id = p.organization_id
                    AND sl.provider = p.provider
                    AND sl.connection_id = p.connection_id
                    AND sl.product_ref = p.external_product_id
                    AND substr(sl.sold_at, 1, 10) >= ?
                    AND substr(sl.sold_at, 1, 10) < ?), 0) AS soldQuantityMilliPrevious30d,
                COALESCE((SELECT SUM(sl.quantity_milli)
                  FROM commerce_sale_lines sl
                  WHERE sl.organization_id = p.organization_id
                    AND sl.provider = p.provider
                    AND sl.connection_id = p.connection_id
                    AND sl.product_ref = p.external_product_id
                    AND substr(sl.sold_at, 1, 10) >= ?), 0) AS soldQuantityMilli90d,
                (SELECT MAX(substr(sl.sold_at, 1, 10))
                  FROM commerce_sale_lines sl
                  WHERE sl.organization_id = p.organization_id
                    AND sl.provider = p.provider
                    AND sl.connection_id = p.connection_id
                    AND sl.product_ref = p.external_product_id) AS lastSoldDate,
                (SELECT MAX(po.order_date)
                  FROM purchase_order_lines pol
                  JOIN purchase_orders po ON po.id = pol.purchase_order_id
                  WHERE pol.organization_id = p.organization_id
                    AND ((pol.connection_id = p.connection_id
                          AND pol.provider = p.provider
                          AND pol.external_product_ref = p.external_product_id)
                      OR (pol.connection_id IS NULL AND pol.provider IS NULL AND pol.sku = p.sku AND NOT EXISTS (
                        SELECT 1 FROM commerce_products duplicate
                        WHERE duplicate.organization_id = p.organization_id
                          AND duplicate.sku = p.sku
                          AND duplicate.id <> p.id
                          AND duplicate.archived = 0
                          AND EXISTS (
                            SELECT 1 FROM integration_connections duplicate_connection
                            WHERE duplicate_connection.id = duplicate.connection_id
                              AND duplicate_connection.organization_id = duplicate.organization_id
                              AND duplicate_connection.status = 'connected'
                              AND duplicate_connection.data_promotion_status = 'approved'
                              AND (duplicate_connection.sync_lease_owner IS NULL OR duplicate_connection.sync_lease_expires_at IS NULL
                                OR duplicate_connection.sync_lease_expires_at <= CAST(strftime('%s', 'now') AS INTEGER))
                          ))))) AS lastOrderedDate
                ,(SELECT po.status
                  FROM purchase_order_lines pol
                  JOIN purchase_orders po ON po.id = pol.purchase_order_id
                  WHERE pol.organization_id = p.organization_id
                    AND ((pol.connection_id = p.connection_id
                          AND pol.provider = p.provider
                          AND pol.external_product_ref = p.external_product_id)
                      OR (pol.connection_id IS NULL AND pol.provider IS NULL AND pol.sku = p.sku AND NOT EXISTS (
                        SELECT 1 FROM commerce_products duplicate
                        WHERE duplicate.organization_id = p.organization_id
                          AND duplicate.sku = p.sku
                          AND duplicate.id <> p.id
                          AND duplicate.archived = 0
                          AND EXISTS (
                            SELECT 1 FROM integration_connections duplicate_connection
                            WHERE duplicate_connection.id = duplicate.connection_id
                              AND duplicate_connection.organization_id = duplicate.organization_id
                              AND duplicate_connection.status = 'connected'
                              AND duplicate_connection.data_promotion_status = 'approved'
                              AND (duplicate_connection.sync_lease_owner IS NULL OR duplicate_connection.sync_lease_expires_at IS NULL
                                OR duplicate_connection.sync_lease_expires_at <= CAST(strftime('%s', 'now') AS INTEGER))
                          ))))
                  ORDER BY po.order_date DESC, po.updated_at DESC LIMIT 1) AS lastOrderStatus
         FROM commerce_products p
         JOIN integration_connections pc
           ON pc.id = p.connection_id AND pc.organization_id = p.organization_id
         LEFT JOIN commerce_suppliers s
          ON s.organization_id = p.organization_id
          AND s.provider = p.provider
          AND s.connection_id = p.connection_id
          AND s.external_supplier_id = p.supplier_ref
         WHERE p.organization_id = ? AND p.archived = 0
           AND pc.status = 'connected' AND pc.data_promotion_status = 'approved'
           AND (pc.sync_lease_owner IS NULL OR pc.sync_lease_expires_at IS NULL
             OR pc.sync_lease_expires_at <= CAST(strftime('%s', 'now') AS INTEGER))
         ORDER BY p.name ASC
         LIMIT 1000`,
      )
      .bind(thirtyDayStart, sixtyDayStart, thirtyDayStart, ninetyDayStart, organizationId)
      .all<ProcurementProductRow>(),
    database
      .prepare(
        `SELECT MIN(substr(sl.sold_at, 1, 10)) AS earliestSaleDate
         FROM commerce_sale_lines sl
         JOIN integration_connections c
           ON c.id = sl.connection_id AND c.organization_id = sl.organization_id
         WHERE sl.organization_id = ? AND sl.sold_at IS NOT NULL
           AND c.status = 'connected' AND c.data_promotion_status = 'approved'
           AND (c.sync_lease_owner IS NULL OR c.sync_lease_expires_at IS NULL
             OR c.sync_lease_expires_at <= CAST(strftime('%s', 'now') AS INTEGER))`,
      )
      .bind(organizationId)
      .first<{ earliestSaleDate: string | null }>(),
    exposeCashContext ? verifiedCashContext(organizationId) : Promise.resolve(null),
  ]);

  let hasNinetyDaysOfHistory = Boolean(
    coverage?.earliestSaleDate && coverage.earliestSaleDate <= ninetyDayStart,
  );
  const scopedInventoryByProduct = new Map<string, { onHandQuantity: number; reorderPoint: number }>();
  const scopedSalesByProduct = new Map<string, {
    soldQuantityMilli30d: number;
    soldQuantityMilliPrevious30d: number;
    soldQuantityMilli90d: number;
    lastSoldDate: string | null;
  }>();
  const scopedOrdersByProduct = new Map<string, {
    incomingUnits: number;
    lastOrderedDate: string | null;
    lastOrderStatus: string | null;
  }>();
  if (locationScope) {
    const placeholders = locationScope.refs.map(() => "?").join(", ");
    const saleLocationClause = locationScope.providerLocations.length
      ? locationScope.providerLocations.map(() => "(provider = ? AND connection_id = ? AND outlet_ref = ?)").join(" OR ")
      : "0 = 1";
    const saleLocationBindings = locationScope.providerLocations.flatMap((location) => [
      location.provider,
      location.connectionId,
      location.externalLocationRef,
    ]);
    const orderLocationPlaceholders = locationScope.ids.map(() => "?").join(", ") || "NULL";
    const [inventoryRows, saleRows, orderRows] = await Promise.all([
      database.prepare(`
        SELECT location_ref AS locationRef, sku,
               SUM(on_hand_quantity) AS onHandQuantity,
               SUM(reorder_point) AS reorderPoint
        FROM inventory_balances
        WHERE organization_id = ? AND location_ref IN (${placeholders})
        GROUP BY location_ref, sku
      `).bind(organizationId, ...locationScope.refs).all<{
        locationRef: string;
        sku: string;
        onHandQuantity: number;
        reorderPoint: number;
      }>(),
      database.prepare(`
        SELECT provider, connection_id AS connectionId, product_ref AS productRef,
               SUM(CASE WHEN substr(sold_at, 1, 10) >= ? THEN quantity_milli ELSE 0 END) AS soldQuantityMilli30d,
               SUM(CASE WHEN substr(sold_at, 1, 10) >= ? AND substr(sold_at, 1, 10) < ? THEN quantity_milli ELSE 0 END) AS soldQuantityMilliPrevious30d,
               SUM(CASE WHEN substr(sold_at, 1, 10) >= ? THEN quantity_milli ELSE 0 END) AS soldQuantityMilli90d,
               MAX(substr(sold_at, 1, 10)) AS lastSoldDate,
               MIN(substr(sold_at, 1, 10)) AS earliestSaleDate
        FROM commerce_sale_lines
        WHERE organization_id = ? AND (${saleLocationClause})
          AND EXISTS (
            SELECT 1 FROM integration_connections approved
            WHERE approved.id = commerce_sale_lines.connection_id
              AND approved.organization_id = commerce_sale_lines.organization_id
              AND approved.status = 'connected'
              AND approved.data_promotion_status = 'approved'
              AND (approved.sync_lease_owner IS NULL OR approved.sync_lease_expires_at IS NULL
                OR approved.sync_lease_expires_at <= CAST(strftime('%s', 'now') AS INTEGER))
          )
        GROUP BY provider, connection_id, product_ref
      `).bind(thirtyDayStart, sixtyDayStart, thirtyDayStart, ninetyDayStart, organizationId, ...saleLocationBindings).all<{
        provider: string;
        connectionId: string;
        productRef: string;
        soldQuantityMilli30d: number;
        soldQuantityMilliPrevious30d: number;
        soldQuantityMilli90d: number;
        lastSoldDate: string | null;
        earliestSaleDate: string | null;
      }>(),
      database.prepare(`
        SELECT sku, provider, connectionId, externalProductRef, incomingUnits,
               orderDate AS lastOrderedDate, status AS lastOrderStatus
        FROM (
          SELECT pol.sku,
                 pol.provider,
                 pol.connection_id AS connectionId,
                 pol.external_product_ref AS externalProductRef,
                 SUM(CASE WHEN po.status IN ('sent', 'acknowledged', 'partially_received', 'received', 'partially_invoiced', 'invoiced', 'disputed')
                          THEN MAX(pol.quantity - pol.received_quantity, 0) ELSE 0 END)
                   OVER (PARTITION BY COALESCE(
                     pol.provider || ':' || pol.connection_id || ':' || pol.external_product_ref,
                     'legacy:' || pol.sku
                   )) AS incomingUnits,
                 po.order_date AS orderDate,
                 po.status,
                 ROW_NUMBER() OVER (
                   PARTITION BY COALESCE(
                     pol.provider || ':' || pol.connection_id || ':' || pol.external_product_ref,
                     'legacy:' || pol.sku
                   )
                   ORDER BY po.order_date DESC, po.updated_at DESC
                 ) AS rank
          FROM purchase_order_lines pol
          JOIN purchase_orders po ON po.id = pol.purchase_order_id
          WHERE pol.organization_id = ?
            AND (pol.connection_id IS NOT NULL OR pol.provider IS NULL)
            AND po.delivery_location_id IN (${orderLocationPlaceholders})
        )
        WHERE rank = 1
      `).bind(organizationId, ...locationScope.ids).all<{
        sku: string;
        provider: string | null;
        connectionId: string | null;
        externalProductRef: string | null;
        incomingUnits: number;
        lastOrderedDate: string | null;
        lastOrderStatus: string | null;
      }>(),
    ]);
    hasNinetyDaysOfHistory = (saleRows.results ?? []).some(
      (row) => Boolean(row.earliestSaleDate && row.earliestSaleDate <= ninetyDayStart),
    );
    for (const row of inventoryRows.results ?? []) {
      const connectionId = locationScope.connectionByRef.get(row.locationRef) ?? "*";
      const key = `${connectionId}:${row.sku}`;
      const current = scopedInventoryByProduct.get(key) ?? { onHandQuantity: 0, reorderPoint: 0 };
      current.onHandQuantity += Number(row.onHandQuantity ?? 0);
      current.reorderPoint += Number(row.reorderPoint ?? 0);
      scopedInventoryByProduct.set(key, current);
    }
    for (const row of saleRows.results ?? []) {
      scopedSalesByProduct.set(`${row.connectionId}:${row.productRef}`, {
        soldQuantityMilli30d: Number(row.soldQuantityMilli30d ?? 0),
        soldQuantityMilliPrevious30d: Number(row.soldQuantityMilliPrevious30d ?? 0),
        soldQuantityMilli90d: Number(row.soldQuantityMilli90d ?? 0),
        lastSoldDate: row.lastSoldDate,
      });
    }
    for (const row of orderRows.results ?? []) {
      const key = row.provider && row.connectionId && row.externalProductRef
        ? `${row.provider}:${row.connectionId}:${row.externalProductRef}`
        : row.provider === null
          ? `legacy:${row.sku}`
          : null;
      if (!key) continue;
      scopedOrdersByProduct.set(key, {
        incomingUnits: Number(row.incomingUnits ?? 0),
        lastOrderedDate: row.lastOrderedDate,
        lastOrderStatus: row.lastOrderStatus,
      });
    }
  }
  const assessmentByProductId = new Map<string, ReturnType<typeof assessPurchasingProduct>>();
  const demandProducts = (productRows.results ?? []).map((row) => {
    const scopedInventory = locationScope
      ? scopedInventoryByProduct.get(`${row.connectionId}:${row.sku}`)
      : null;
    const scopedSales = locationScope ? scopedSalesByProduct.get(`${row.connectionId}:${row.externalProductId}`) : null;
    const duplicateSku = (productRows.results ?? []).some((candidate) =>
      candidate.sku === row.sku && candidate.id !== row.id,
    );
    const scopedOrder = locationScope
      ? scopedOrdersByProduct.get(`${row.provider}:${row.connectionId}:${row.externalProductId}`)
        ?? (!duplicateSku ? scopedOrdersByProduct.get(`legacy:${row.sku}`) : undefined)
      : null;
    const onHandQuantity = locationScope ? scopedInventory?.onHandQuantity ?? null : row.onHandQuantity == null ? null : Number(row.onHandQuantity);
    const reorderPoint = Number(locationScope ? scopedInventory?.reorderPoint ?? 0 : row.reorderPoint ?? 0);
    const incomingUnits = Number(locationScope ? scopedOrder?.incomingUnits ?? 0 : row.incomingUnits ?? 0);
    const soldUnits30d = Math.max(
      0,
      Math.round(Number(locationScope ? scopedSales?.soldQuantityMilli30d ?? 0 : row.soldQuantityMilli30d ?? 0)) / 1000,
    );
    const soldUnitsPrevious30d = Math.max(0, Math.round(Number(locationScope ? scopedSales?.soldQuantityMilliPrevious30d ?? 0 : row.soldQuantityMilliPrevious30d ?? 0)) / 1000);
    const soldUnits90d = Math.max(0, Math.round(Number(locationScope ? scopedSales?.soldQuantityMilli90d ?? 0 : row.soldQuantityMilli90d ?? 0)) / 1000);
    const lastOrderedDate = locationScope ? scopedOrder?.lastOrderedDate ?? null : row.lastOrderedDate;
    const lastOrderStatus = locationScope ? scopedOrder?.lastOrderStatus ?? null : row.lastOrderStatus;
    const lastSoldDate = locationScope ? scopedSales?.lastSoldDate ?? null : row.lastSoldDate;
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
      lastOrderedAt: lastOrderedDate,
      lastOrderStatus,
      lastSaleAt: lastSoldDate,
    });
    assessmentByProductId.set(row.id, assessment);
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
      soldQuantityMilli30d: Math.round(soldUnits30d * 1000),
      soldQuantityMilliPrevious30d: Math.round(soldUnitsPrevious30d * 1000),
      soldQuantityMilli90d: Math.round(soldUnits90d * 1000),
      onHandQuantity,
      reorderPoint,
      incomingUnits,
      soldUnits30d,
      soldUnitsPrevious30d,
      soldUnits90d,
      averageDailyDemand,
      lastOrderedDate,
      lastOrderStatus,
      lastSoldDate,
      recommendedQuantity: onHandQuantity === null ? null : assessment.recommendedUnits,
      daysCover: assessment.daysCover,
      demandTrendRate: assessment.demandTrendRate,
      recommendationFactors: assessment.factors,
      health,
    };
  });
  const allocationByProductId = new Map(
    allocatePurchasingCapacity(
      [...assessmentByProductId].map(([productId, assessment]) => ({
        ...assessment,
        sku: productId,
      })),
      cashContext?.verifiedPurchasingCapacityCents ?? null,
    ).map((assessment) => [assessment.sku, assessment]),
  );
  const products = demandProducts.map((product) => {
    const allocation = allocationByProductId.get(product.id);
    return {
      ...product,
      cashConstrainedQuantity: cashContext ? allocation?.cashConstrainedUnits ?? null : null,
      cashAllocatedCents: cashContext ? allocation?.cashAllocatedCents ?? null : null,
      cashDecision: cashContext ? allocation?.cashDecision ?? "needs_verified_cash" : "restricted",
    };
  });

  return {
    suppliers: supplierRows,
    products,
    cashContext,
    locationScope: locationScope ? { id: locationScope.selectedId ?? "accessible", name: locationScope.name } : null,
    method: {
      periodStart: thirtyDayStart,
      periodEnd: today,
      reviewHorizonDays: 14,
      deadStockWindowDays: 90,
      deadStockHistoryAvailable: hasNinetyDaysOfHistory,
      description:
        "Demand quantities use verified 30-day performance, prior-period trend, 90-day movement, current stock, reorder points and open purchase orders. When fresh Plaid cash is available, the approved quantity also preserves the BookLoQ reserve and deducts open bills and uninvoiced purchase commitments. Lead time, case packs, shelf life and storage limits still require review before approval.",
    },
  };
}

async function requirePurchaseOrderInScope(
  organizationId: string,
  purchaseOrderId: string,
  locationScope: ProcurementLocationScope | null,
) {
  const [order] = await getDb().select().from(purchaseOrders).where(and(
    eq(purchaseOrders.organizationId, organizationId),
    eq(purchaseOrders.id, purchaseOrderId),
  )).limit(1);
  if (!order) throw new ApiError(404, "PURCHASE_ORDER_NOT_FOUND", "Purchase order not found.");
  if (locationScope && (!order.deliveryLocationId || !locationScope.ids.includes(order.deliveryLocationId))) {
    throw new ApiError(403, "LOCATION_ACCESS_DENIED", "This purchase order belongs to a location that is not available to your account.");
  }
  return order;
}

async function list(
  organizationId: string,
  locationScope: ProcurementLocationScope | null = null,
  visibility: PurchasingVisibility = { cashDetails: false, financeCalendar: false, costDetails: false },
) {
  const orders = await getDb()
    .select()
    .from(purchaseOrders)
    .where(locationScope
      ? and(eq(purchaseOrders.organizationId, organizationId), inArray(purchaseOrders.deliveryLocationId, locationScope.ids))
      : eq(purchaseOrders.organizationId, organizationId))
    .orderBy(desc(purchaseOrders.updatedAt))
    .limit(200);
  const orderIds = orders.map((order) => order.id);
  const [lines, receipts, matches, catalog, bills, invoices] = await Promise.all([
    orderIds.length ? getDb()
      .select()
      .from(purchaseOrderLines)
      .where(and(eq(purchaseOrderLines.organizationId, organizationId), inArray(purchaseOrderLines.purchaseOrderId, orderIds)))
      .orderBy(asc(purchaseOrderLines.lineNumber)) : Promise.resolve([]),
    orderIds.length ? getDb()
      .select()
      .from(goodsReceipts)
      .where(and(eq(goodsReceipts.organizationId, organizationId), inArray(goodsReceipts.purchaseOrderId, orderIds)))
      .orderBy(desc(goodsReceipts.createdAt)) : Promise.resolve([]),
    orderIds.length ? getDb()
      .select()
      .from(invoiceMatches)
      .where(and(eq(invoiceMatches.organizationId, organizationId), inArray(invoiceMatches.purchaseOrderId, orderIds)))
      .orderBy(desc(invoiceMatches.createdAt)) : Promise.resolve([]),
    procurementCatalog(organizationId, locationScope, visibility.cashDetails),
    locationScope || !visibility.financeCalendar ? Promise.resolve([]) : getDb().select({
      id: supplierBills.id,
      reference: supplierBills.billNumber,
      dueDate: supplierBills.dueDate,
      status: supplierBills.status,
      totalCents: supplierBills.totalCents,
      currency: supplierBills.currency,
      locationRef: supplierBills.locationRef,
    }).from(supplierBills).where(eq(supplierBills.organizationId, organizationId)).orderBy(asc(supplierBills.dueDate)).limit(200),
    locationScope || !visibility.financeCalendar ? Promise.resolve([]) : getDb().select({
      id: customerInvoices.id,
      reference: customerInvoices.invoiceNumber,
      dueDate: customerInvoices.dueDate,
      status: customerInvoices.status,
      totalCents: customerInvoices.totalCents,
      currency: customerInvoices.currency,
      locationRef: customerInvoices.locationRef,
    }).from(customerInvoices).where(eq(customerInvoices.organizationId, organizationId)).orderBy(asc(customerInvoices.dueDate)).limit(200),
  ]);
  const scopedOrders = locationScope
    ? orders.filter((order) => order.deliveryLocationId !== null && locationScope.ids.includes(order.deliveryLocationId))
    : orders;
  const scopedOrderIds = new Set(scopedOrders.map((order) => order.id));
  const scopedBills = locationScope
    ? bills.filter((bill) => locationScope.refs.includes(bill.locationRef))
    : bills;
  const scopedInvoices = locationScope
    ? invoices.filter((invoice) => locationScope.refs.includes(invoice.locationRef))
    : invoices;
  const commitmentBoard = buildPurchaseCommitmentBoard(scopedOrders.map((order) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    supplierName: order.supplierName,
    status: order.status,
    orderDate: order.orderDate,
    expectedDeliveryDate: order.expectedDeliveryDate,
    committedCashDate: order.committedCashDate,
    currency: order.currency,
    totalCents: order.totalCents,
    lines: lines.filter((line) => line.purchaseOrderId === order.id).map((line) => ({
      sku: line.sku,
      description: line.description,
      quantity: line.quantity,
      receivedQuantity: line.receivedQuantity,
      unitCostCents: line.unitCostCents,
      previousCostCents: line.previousCostCents,
      })),
  })));
  const commitmentsByCurrency = [...commitmentBoard.vendors.reduce(
    (totals, vendor) => totals.set(
      vendor.currency,
      (totals.get(vendor.currency) ?? 0) + vendor.remainingMerchandiseCents,
    ),
    new Map<string, number>(),
  )].map(([currency, amountCents]) => ({ currency, amountCents }));
  const commitments = commitmentsByCurrency.length === 1 ? commitmentsByCurrency[0].amountCents : null;
  const response = {
    orders: scopedOrders.map((order) => ({
      ...order,
      lines: lines.filter((line) => line.purchaseOrderId === order.id),
      receipts: receipts.filter(
        (receipt) => receipt.purchaseOrderId === order.id,
      ),
      matches: matches.filter((match) => match.purchaseOrderId === order.id),
    })),
    summary: {
      openOrders: scopedOrders.filter(
        (order) => !["closed", "cancelled"].includes(order.status),
      ).length,
      awaitingApproval: scopedOrders.filter(
        (order) => order.status === "awaiting_approval",
      ).length,
      openCommitmentsCents: commitments,
      commitmentsByCurrency,
      commitmentsLabel: "Unreceived merchandise still incoming",
      discrepancies:
        receipts.filter((receipt) => scopedOrderIds.has(receipt.purchaseOrderId) && receipt.discrepancyStatus !== "matched")
          .length +
        matches.filter((match) => scopedOrderIds.has(match.purchaseOrderId) && match.status !== "matched").length,
      redAlerts: catalog.products.filter((product) => product.health.tone === "red").length,
      healthyProducts: catalog.products.filter((product) => product.health.tone === "green").length,
      deadStockProducts: catalog.products.filter((product) => product.health.label === "Dead stock").length,
    },
    commitmentBoard,
    catalog,
    calendar: [
      ...scopedOrders.flatMap((order) => [
        { id: `ordered:${order.id}`, kind: "purchase_ordered", date: order.orderDate, title: `${order.orderNumber} ordered`, detail: order.supplierName, status: order.status, amountCents: order.totalCents, currency: order.currency },
        ...(order.expectedDeliveryDate ? [{ id: `expected:${order.id}`, kind: "purchase_expected", date: order.expectedDeliveryDate, title: `${order.orderNumber} expected`, detail: order.supplierName, status: order.status, amountCents: order.totalCents, currency: order.currency }] : []),
        ...(order.committedCashDate ? [{ id: `cash:${order.id}`, kind: "purchase_cash_due", date: order.committedCashDate, title: `${order.orderNumber} cash commitment`, detail: order.supplierName, status: order.status, amountCents: order.totalCents, currency: order.currency }] : []),
      ]),
      ...scopedBills.filter((bill) => !["paid", "reconciled", "void"].includes(bill.status)).map((bill) => ({ id: `bill:${bill.id}`, kind: "supplier_bill_due", date: bill.dueDate, title: `${bill.reference} due`, detail: "Supplier bill", status: bill.status, amountCents: bill.totalCents, currency: bill.currency })),
      ...scopedInvoices.filter((invoice) => !["paid", "written_off", "void"].includes(invoice.status)).map((invoice) => ({ id: `invoice:${invoice.id}`, kind: "customer_invoice_due", date: invoice.dueDate, title: `${invoice.reference} due`, detail: "Customer invoice", status: invoice.status, amountCents: invoice.totalCents, currency: invoice.currency })),
    ].sort((left, right) => left.date.localeCompare(right.date)),
  };
  if (visibility.costDetails) return response;
  const redacted = redactPurchasingCosts(response) as Record<string, unknown>;
  const redactedCatalog = redacted.catalog as Record<string, unknown> | undefined;
  if (redactedCatalog) {
    redactedCatalog.cashContext = null;
    const redactedProducts = Array.isArray(redactedCatalog.products) ? redactedCatalog.products : [];
    for (const product of redactedProducts) {
      if (!product || typeof product !== "object") continue;
      (product as Record<string, unknown>).cashDecision = "restricted";
      (product as Record<string, unknown>).cashConstrainedQuantity = null;
    }
  }
  return redacted;
}

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, users, "inventory.reorder_ai");
    await requirePermission(context, "purchasing.view");
    await enforceRateLimit("purchasing:read", context.userId, 90, 60);
    const locationScope = await requestLocationScope(request, context);
    const [permissions, bookloqAddonActive] = await Promise.all([
      effectivePermissions(context),
      hasAddon(context, "bookloq"),
    ]);
    const organizationWide = locationScope === null;
    const visibility = {
      cashDetails: organizationWide && bookloqAddonActive && permissions.includes("finance.bank_balances") && permissions.includes("finance.ap_ar"),
      financeCalendar: organizationWide && permissions.includes("finance.ap_ar"),
      costDetails: permissions.includes("finance.costs"),
    };
    return jsonResponse(await list(context.organizationId, locationScope, visibility));
  });
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, users, "inventory.reorder_ai");
    const locationScope = await requestLocationScope(request, context);
    const [permissions, bookloqAddonActive] = await Promise.all([
      effectivePermissions(context),
      hasAddon(context, "bookloq"),
    ]);
    const organizationWide = locationScope === null;
    const visibility = {
      cashDetails: organizationWide && bookloqAddonActive && permissions.includes("finance.bank_balances") && permissions.includes("finance.ap_ar"),
      financeCalendar: organizationWide && permissions.includes("finance.ap_ar"),
      costDetails: permissions.includes("finance.costs"),
    };
    await enforceRateLimit("purchasing:write", context.userId, 40, 3_600);
    const input = await readJsonObject(request, 256_000);
    const action = text(input.action, "action", 50);
    if (action === "match_invoice") await requireFeature(context, "invoice.matching");
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
      const catalog = await procurementCatalog(context.organizationId, locationScope, visibility.cashDetails);
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
          row.unitCostCents ?? (visibility.costDetails ? selectedProduct?.defaultCostCents : undefined),
          `unit cost for line ${index + 1}`,
        );
        if (!Number.isSafeInteger(quantity * unitCostCents)) {
          throw new ApiError(400, "INVALID_FIELD", `The value for line ${index + 1} is too large.`);
        }
        return {
          id: crypto.randomUUID(),
          lineNumber: index + 1,
          provider: selectedProduct?.provider ?? null,
          connectionId: selectedProduct?.connectionId ?? null,
          externalProductRef: selectedProduct?.externalProductId ?? null,
          sku: selectedProduct?.sku ?? text(row.sku, "SKU", 80, false),
          description:
            selectedProduct?.name ??
            text(row.description, "product description", 200),
          quantity,
          unitCostCents,
          previousCostCents: visibility.costDetails ? selectedProduct?.defaultCostCents ?? null : null,
          currentInventory: selectedProduct?.onHandQuantity ?? null,
          reorderPoint: selectedProduct?.reorderPoint ?? null,
          forecastDemand: selectedProduct?.recommendedQuantity ?? null,
        };
      });
      const orderDate = text(input.orderDate, "order date", 10);
      if (!validIsoDate(orderDate))
        throw new ApiError(400, "INVALID_FIELD", "Enter a valid order date.");
      const expected = text(
        input.expectedDeliveryDate,
        "expected delivery date",
        10,
        false,
      );
      if (expected && !validIsoDate(expected))
        throw new ApiError(
          400,
          "INVALID_FIELD",
          "Enter a valid expected delivery date.",
        );
      const committedCashDate = text(input.committedCashDate, "committed cash date", 10, false);
      if (committedCashDate && !validIsoDate(committedCashDate)) {
        throw new ApiError(400, "INVALID_FIELD", "Enter a valid committed cash date.");
      }
      const taxCents = integer(input.taxCents ?? 0, "tax amount");
      const discountCents = integer(
        input.discountCents ?? 0,
        "discount amount",
      );
      const subtotalCents = lines.reduce((sum, line, index) => {
        const next = sum + line.quantity * line.unitCostCents;
        if (!Number.isSafeInteger(next)) {
          throw new ApiError(400, "INVALID_FIELD", `The combined order value is too large after line ${index + 1}.`);
        }
        return next;
      }, 0);
      const grossCents = subtotalCents + taxCents;
      if (!Number.isSafeInteger(grossCents)) {
        throw new ApiError(400, "INVALID_FIELD", "The combined order value is too large.");
      }
      if (discountCents > grossCents)
        throw new ApiError(
          400,
          "INVALID_FIELD",
          "Discount cannot exceed the order value.",
        );
      const id = crypto.randomUUID();
      const status =
        input.submitForApproval === true ? "awaiting_approval" : "draft";
      const totalCents = grossCents - discountCents;
      if (!Number.isSafeInteger(totalCents)) {
        throw new ApiError(400, "INVALID_FIELD", "The combined order value is too large.");
      }
      const currency = text(input.currency, "currency", 3).toUpperCase();
      if (!validCurrencyCode(currency)) {
        throw new ApiError(400, "INVALID_FIELD", "Enter a valid three-letter currency code.");
      }
      const requestedDeliveryLocationId = text(input.deliveryLocationId, "delivery location", 200, false) || null;
      let deliveryLocationId: string;
      if (locationScope?.selectedId) {
        if (requestedDeliveryLocationId && requestedDeliveryLocationId !== locationScope.selectedId) {
          throw new ApiError(403, "LOCATION_ACCESS_DENIED", "The delivery location must match the selected location.");
        }
        deliveryLocationId = locationScope.selectedId;
      } else if (requestedDeliveryLocationId) {
        const deliveryLocation = await requireAccessibleLocation(context, requestedDeliveryLocationId);
        if (locationScope && !locationScope.ids.includes(deliveryLocation.id)) {
          throw new ApiError(403, "LOCATION_ACCESS_DENIED", "This delivery location is not available to your account.");
        }
        deliveryLocationId = deliveryLocation.id;
      } else if (locationScope?.ids.length === 1) {
        deliveryLocationId = locationScope.ids[0];
      } else {
        throw new ApiError(400, "DELIVERY_LOCATION_REQUIRED", "Select one accessible location before creating a purchase order.");
      }
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
            deliveryLocationId,
            orderDate,
            expected || null,
            currency,
            text(input.paymentTerms, "payment terms", 100, false),
            status,
            subtotalCents,
            taxCents,
            discountCents,
            totalCents,
            committedCashDate || null,
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
        (id, organization_id, purchase_order_id, line_number, provider, connection_id, external_product_ref, sku, description, quantity, received_quantity, invoiced_quantity, unit_cost_cents, previous_cost_cents, current_inventory, reorder_point, forecast_demand, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              line.id,
              context.organizationId,
              id,
              line.lineNumber,
              line.provider,
              line.connectionId,
              line.externalProductRef,
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
      await requirePurchaseOrderInScope(context.organizationId, id, locationScope);
      const result = await database
        .prepare(
          "UPDATE purchase_orders SET status = 'approved', approved_by_user_id = ?, updated_at = ? WHERE id = ? AND organization_id = ? AND status = 'awaiting_approval' AND created_by_user_id != ?",
        )
        .bind(context.userId, now, id, context.organizationId, context.userId)
        .run();
      if (!result.success || Number(result.meta.changes ?? 0) !== 1)
        throw new ApiError(
          409,
          "INVALID_TRANSITION",
          "Only a different authorized reviewer can approve a purchase order that is awaiting approval.",
        );
      resourceId = id;
      auditAction = "purchase_order.approved";
    } else if (action === "set_commitment_date") {
      await requirePermission(context, "purchasing.send");
      const id = text(input.purchaseOrderId, "purchase order", 200);
      await requirePurchaseOrderInScope(context.organizationId, id, locationScope);
      const committedCashDate = text(input.committedCashDate, "committed cash date", 10);
      if (!validIsoDate(committedCashDate)) {
        throw new ApiError(400, "INVALID_FIELD", "Enter a valid committed cash date.");
      }
      const result = await database
        .prepare("UPDATE purchase_orders SET committed_cash_date = ?, updated_at = ? WHERE id = ? AND organization_id = ? AND status NOT IN ('cancelled','closed')")
        .bind(committedCashDate, now, id, context.organizationId)
        .run();
      if (!result.success || Number(result.meta.changes ?? 0) !== 1) {
        throw new ApiError(409, "INVALID_TRANSITION", "A commitment date cannot be changed for this purchase order.");
      }
      resourceId = id;
      auditAction = "purchase_order.commitment_date_set";
      details = { action, committedCashDate };
    } else if (action === "mark_sent") {
      await requirePermission(context, "purchasing.send");
      const id = text(input.purchaseOrderId, "purchase order", 200);
      const order = await requirePurchaseOrderInScope(context.organizationId, id, locationScope);
      if (input.confirmExternalSend !== true)
        throw new ApiError(
          400,
          "CONFIRMATION_REQUIRED",
          "Confirm that an authorized person sent the purchase order outside Vanteloq. No email provider is connected.",
        );
      if (!order.committedCashDate || !validIsoDate(order.committedCashDate)) {
        throw new ApiError(409, "COMMITMENT_DATE_REQUIRED", "Record the expected cash date before confirming that this order was sent.");
      }
      const result = await database
        .prepare(
          "UPDATE purchase_orders SET status = 'sent', updated_at = ? WHERE id = ? AND organization_id = ? AND status = 'approved'",
        )
        .bind(now, id, context.organizationId)
        .run();
      if (!result.success || Number(result.meta.changes ?? 0) !== 1) {
        throw new ApiError(409, "INVALID_TRANSITION", "Only an approved purchase order can be confirmed as sent.");
      }
      resourceId = id;
      auditAction = "purchase_order.external_send_confirmed";
      details = { action, provider: "manual_external_confirmation" };
    } else if (action === "receive") {
      await requirePermission(context, "purchasing.receive");
      const id = text(input.purchaseOrderId, "purchase order", 200);
      const order = await requirePurchaseOrderInScope(context.organizationId, id, locationScope);
      if (!["sent", "acknowledged", "partially_received"].includes(order.status)) {
        throw new ApiError(409, "INVALID_TRANSITION", "Goods can be received only after the purchase order is sent to the vendor.");
      }
      const receivedDate = text(input.receivedDate, "received date", 10);
      if (!validIsoDate(receivedDate)) {
        throw new ApiError(400, "INVALID_FIELD", "Enter a valid received date.");
      }
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
      const lineIds = new Set(lines.map((line) => line.id));
      for (const entry of input.lines) {
        if (!entry || typeof entry !== "object") continue;
        const row = entry as Record<string, unknown>;
        const lineId = text(row.lineId, "line", 200);
        if (!lineIds.has(lineId)) {
          throw new ApiError(400, "INVALID_RECEIPT", "Every received line must belong to this purchase order.");
        }
        received.set(lineId, integer(row.quantity, "received quantity", 0, 1_000_000));
      }
      if (![...received.values()].some((quantity) => quantity > 0)) {
        throw new ApiError(400, "INVALID_RECEIPT", "Record at least one received unit.");
      }
      let discrepancy: "matched" | "short" | "over" = "matched";
      const statements = [] as D1PreparedStatement[];
      for (const line of lines) {
        const add = received.get(line.id) ?? 0;
        const total = line.receivedQuantity + add;
        if (!Number.isSafeInteger(total)) {
          throw new ApiError(400, "INVALID_RECEIPT", "The cumulative received quantity is too large.");
        }
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
            receivedDate,
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
            "UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ? AND organization_id = ? AND status IN ('sent','acknowledged','partially_received')",
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
      const order = await requirePurchaseOrderInScope(context.organizationId, id, locationScope);
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
      if (
        document.securityState !== "clean"
        || document.scanStatus !== "clean" || !document.scannedAt || !document.scanProvider
      ) {
        throw new ApiError(
          423,
          "DOCUMENT_SCAN_REQUIRED",
          "This invoice cannot be matched until its independent security scan is complete.",
        );
      }
      if (!["received", "partially_invoiced"].includes(order.status)) {
        throw new ApiError(409, "INVALID_TRANSITION", "An invoice can be matched only after goods have been received.");
      }
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
            "UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ? AND organization_id = ? AND status IN ('received','partially_invoiced')",
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
    return jsonResponse(await list(context.organizationId, locationScope, visibility), {
      status: action === "create" ? 201 : 200,
    });
  });
}
