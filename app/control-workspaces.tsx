"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "./supabase-browser";
import { InventoryLifecycleWorkspace } from "./inventory-lifecycle-workspace";
import { BusinessTrendChart } from "./dashboard-charts";
import {
  calculateReorderRecommendation,
  type ReorderInputs,
} from "../domain/reorder-engine";

type TaskSeed = {
  title: string;
  detail: string;
  priority: "high" | "medium" | "low";
  expectedImpact?: string;
  sourceType?: "manual" | "insight" | "alert" | "decision";
  sourceRef?: string;
};
type SharedProps = {
  currency: string;
  showNotice: (message: string) => void;
  createTask: (seed: TaskSeed) => void;
};

const reportGroups: Record<string, string[]> = {
  "Sales & refunds": [
    "Sales totals",
    "Sales line items",
    "Sales over time",
    "Sales by hour",
    "Sales by day",
    "Sales by weekday",
    "Sales by location",
    "Sales by channel",
    "Sales by item",
    "Sales by category",
    "Sales by brand",
    "Sales by supplier",
    "Sales by employee",
    "Sales by customer",
    "Discounts",
    "Refunds",
    "Voids",
    "Taxes",
    "Units per transaction",
    "Average transaction value",
    "Gross-margin-per-line",
    "Payment-method performance",
  ],
  Inventory: [
    "Current inventory assets",
    "Inventory valuation",
    "Inventory received",
    "Inventory returned",
    "Reorder list",
    "Negative inventory",
    "Inventory movement history",
    "Inventory by location",
    "Inventory by category",
    "Inventory by brand",
    "Inventory by supplier",
    "Inventory age",
    "Inventory turnover",
    "Days of inventory remaining",
    "Stockout history",
    "Lost-sales estimate",
    "Shrinkage",
    "Expired inventory",
    "Dead stock",
    "Transfer history",
    "Count discrepancies",
    "Landed-cost analysis",
  ],
  "Payments & reconciliation": [
    "All payments received",
    "Partial payments",
    "Transactions and payouts",
    "Processor fees",
    "Chargebacks",
    "Deposits",
    "Withdrawals",
    "POS-to-bank reconciliation",
    "Bank-to-book reconciliation",
    "Sales-and-payments balance",
    "Cash-drawer reconciliation",
    "Closing counts",
  ],
  Customers: [
    "Customer sales",
    "Customer lifetime value",
    "Purchase frequency",
    "Average basket",
    "Retention",
    "Churn risk",
    "Customer cohorts",
    "Repeat-purchase rate",
    "Product affinities",
    "Customer credits",
    "Outstanding balances",
    "Special orders",
    "Reservations",
    "Layaways",
  ],
  "Suppliers & purchasing": [
    "Purchase-order history",
    "Purchase-order status",
    "Supplier purchases",
    "Supplier balances",
    "Supplier cost changes",
    "Supplier fill rate",
    "Supplier delivery performance",
    "Purchase-order discrepancies",
    "Received-versus-invoiced",
    "Supplier credits",
    "Supplier concentration",
    "Recommended orders",
    "Open commitments",
    "Inventory cash exposure",
  ],
  Employees: [
    "Total hours",
    "Clock entries",
    "Sales by employee",
    "Revenue per labour hour",
    "Gross profit per labour hour",
    "Average transaction value by employee",
    "Discount activity",
    "Refund activity",
    "Labour cost percentage",
    "Scheduling efficiency",
  ],
  "Accounting & BookLoQ": [
    "Profit and loss",
    "Balance sheet",
    "Cash-flow statement",
    "Trial balance",
    "General ledger",
    "Journal report",
    "Accounts receivable",
    "Accounts payable",
    "Tax audit trail",
    "GST/HST/PST/QST working reports",
    "Budget versus actual",
    "Fixed assets",
    "Loans",
    "Statement of changes in equity",
    "Bookkeeping health",
    "Month-end status",
  ],
};
const liveReports: Record<string, string> = {
  "Sales totals": "sales_totals",
  "Sales over time": "sales_over_time",
  "Average transaction value": "sales_totals",
  "Units per transaction": "sales_totals",
  Discounts: "discounts_refunds",
  Refunds: "discounts_refunds",
  "Labour cost percentage": "labour_summary",
};

function localIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function reportRange(days: number) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - Math.max(0, days - 1));
  return { start: localIsoDate(start), end: localIsoDate(end) };
}

function money(cents: number | null | undefined, currency: string) {
  return cents === null || cents === undefined
    ? "Not available"
    : new Intl.NumberFormat("en-CA", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(cents / 100);
}
function apiMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body) {
    const message = (body as { error?: { message?: unknown } }).error?.message;
    if (typeof message === "string" && message) return message;
  }
  return fallback;
}

export function ReportsWorkspace({
  currency,
  showNotice,
  createTask,
}: SharedProps) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("All reports");
  const [selected, setSelected] = useState("Sales totals");
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [preset, setPreset] = useState("all");
  const visible = Object.entries(reportGroups)
    .flatMap(([category, reports]) =>
      reports.map((name) => ({ category, name })),
    )
    .filter(
      (item) =>
        (group === "All reports" || item.category === group) &&
        item.name.toLowerCase().includes(query.toLowerCase()),
    );
  const load = useCallback(async (name: string) => {
    setReport(null);
    const id = liveReports[name];
    if (!id) return;
    setLoading(true);
    const params = new URLSearchParams({ report: id });
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    const response = await apiFetch(`/api/v1/reports?${params.toString()}`);
    const body: unknown = await response.json();
    if (response.ok) setReport(body as Record<string, unknown>);
    else showNotice(apiMessage(body, "Unable to load report."));
    setLoading(false);
  }, [end, showNotice, start]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(selected), 0);
    return () => window.clearTimeout(timer);
  }, [load, selected]);
  const applyPreset = (days: number) => {
    const next = reportRange(days);
    setPreset(String(days));
    setStart(next.start);
    setEnd(next.end);
  };
  const totals = report?.totals as Record<string, number | null> | undefined;
  const explain = report?.explainAndAct as Record<string, unknown> | undefined;
  const source = report?.source as Record<string, unknown> | undefined;
  const rows = (report?.rows as Array<{ businessDate: string; netSalesCents: number; costOfGoodsCents: number }> | undefined) ?? [];
  const trendRows = useMemo(() => {
    const daily = new Map<string, { date: string; netSalesCents: number; grossProfitCents: number }>();
    for (const row of rows) {
      const current = daily.get(row.businessDate) ?? { date: row.businessDate, netSalesCents: 0, grossProfitCents: 0 };
      current.netSalesCents += row.netSalesCents;
      current.grossProfitCents += row.netSalesCents - row.costOfGoodsCents;
      daily.set(row.businessDate, current);
    }
    return [...daily.values()].sort((left, right) => left.date.localeCompare(right.date));
  }, [rows]);
  const canExport = report?.canExport === true;
  return (
    <div className="content control-page reports-centre">
      <section className="page-intro">
        <div>
          <p>REPORTS CENTRE</p>
          <h2>Find the answer, inspect its source, then act.</h2>
          <span>
            Five aggregate reports are live from verified daily summaries.
            Deeper reports remain gated until their exact line-item, customer,
            supplier, hourly, banking or payroll source exists.
          </span>
        </div>
        <button className="secondary" disabled title="Scheduled delivery requires an approved email provider, queue, export permission checks and retry handling.">
          Schedule delivery · provider required
        </button>
      </section>
      <section className="report-period-control" aria-label="Report time frame">
        <div className="report-period-presets" aria-label="Time frame presets">
          {[
            [0, "All data"],
            [1, "Today"],
            [7, "7 days"],
            [30, "30 days"],
            [90, "90 days"],
          ].map(([days, label]) => (
            <button
              type="button"
              className={preset === (Number(days) === 0 ? "all" : String(days)) ? "active" : ""}
              key={days}
              onClick={() => {
                if (Number(days) === 0) {
                  setPreset("all");
                  setStart("");
                  setEnd("");
                } else applyPreset(Number(days));
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="report-date-fields">
          <label>
            <span>From</span>
            <input
              type="date"
              value={start}
              max={end || localIsoDate(new Date())}
              onChange={(event) => {
                setPreset("custom");
                setStart(event.target.value);
              }}
            />
          </label>
          <span aria-hidden="true">to</span>
          <label>
            <span>To</span>
            <input
              type="date"
              value={end}
              min={start || undefined}
              max={localIsoDate(new Date())}
              onChange={(event) => {
                setPreset("custom");
                setEnd(event.target.value);
              }}
            />
          </label>
        </div>
        <p>
          {start || end ? <><b>{start || "Earliest"}</b> through <b>{end || "Today"}</b></> : <><b>{String(source?.earliestBusinessDate || "All")}</b> through <b>{String(source?.latestBusinessDate || "imported dates")}</b></>}
        </p>
      </section>
      <div className="report-toolbar">
        <label>
          ⌕
          <input
            placeholder="Search the complete report catalogue"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <select
          value={group}
          onChange={(event) => setGroup(event.target.value)}
        >
          <option>All reports</option>
          {Object.keys(reportGroups).map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </div>
      <div className="reports-layout">
        <section className="report-catalogue">
          {Object.keys(reportGroups)
            .filter((category) => group === "All reports" || category === group)
            .map((category) => {
              const rows = visible.filter((item) => item.category === category);
              return rows.length ? (
                <article className="card" key={category}>
                  <header>
                    <h3>{category}</h3>
                    <span>{rows.length} reports</span>
                  </header>
                  {rows.map((item) => (
                    <button
                      className={selected === item.name ? "selected" : ""}
                      key={item.name}
                      onClick={() => setSelected(item.name)}
                    >
                      <span>{item.name}</span>
                      <em className={liveReports[item.name] ? "live" : "gated"}>
                        {liveReports[item.name]
                          ? "Imported · live"
                          : "Source required"}
                      </em>
                    </button>
                  ))}
                </article>
              ) : null;
            })}
        </section>
        <aside className="card report-inspector">
          <header>
            <div>
              <p>REPORT DEFINITION</p>
              <h2>{selected}</h2>
            </div>
            <span className={liveReports[selected] ? "live" : "gated"}>
              {liveReports[selected] ? "Available" : "Gated"}
            </span>
          </header>
          {loading ? (
            <div className="control-empty">Calculating verified records…</div>
          ) : liveReports[selected] && report ? (
            <>
              <div className="report-metrics">
                <article>
                  <small>NET SALES</small>
                  <b>{money(totals?.netSalesCents, currency)}</b>
                </article>
                <article>
                  <small>TRANSACTIONS</small>
                  <b>{totals?.transactionCount?.toLocaleString() || "0"}</b>
                </article>
                <article>
                  <small>AVERAGE TRANSACTION</small>
                  <b>{money(totals?.averageTransactionCents, currency)}</b>
                </article>
                <article>
                  <small>DISCOUNTS & REFUNDS</small>
                  <b>
                    {money(
                      (totals?.discountsCents || 0) +
                        (totals?.refundsCents || 0),
                      currency,
                    )}
                  </b>
                </article>
              </div>
              <section className="report-period-chart" aria-label="Sales over the selected time frame">
                <header>
                  <div>
                    <p>SELECTED TIME FRAME</p>
                    <h3>Net sales and gross profit</h3>
                  </div>
                  <span>{rows.length} daily records</span>
                </header>
                {trendRows.length ? (
                  <BusinessTrendChart
                    currency={currency}
                    data={trendRows}
                  />
                ) : (
                  <div className="report-chart-empty">No verified sales records match this time frame.</div>
                )}
              </section>
              <section className="explain-act">
                <p>EXPLAIN & ACT</p>
                <h3>
                  {String(explain?.executiveSummary || "Verified report ready")}
                </h3>
                <dl>
                  <div>
                    <dt>Likely drivers</dt>
                    <dd>
                      {String(
                        explain?.likelyDrivers || "No driver model available.",
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Confidence</dt>
                    <dd>{String(explain?.confidence || "low")}</dd>
                  </div>
                  <div>
                    <dt>Source & freshness</dt>
                    <dd>
                      {String(source?.type)} · Data through{" "}
                      {String(source?.latestBusinessDate || "no records")} ·
                      {" "}{start || end
                        ? `${start || "earliest"} to ${end || "today"}`
                        : `${String(source?.earliestBusinessDate || "earliest")} to ${String(source?.latestBusinessDate || "latest")}`} · generated {String(source?.generatedAt)}
                    </dd>
                  </div>
                </dl>
                <button
                  onClick={() =>
                    createTask({
                      title: `Review ${selected}`,
                      detail: String(
                        explain?.recommendedAction ||
                          "Review the report and its supporting records.",
                      ),
                      priority: "medium",
                      sourceType: "insight",
                      sourceRef: `report:${liveReports[selected]}`,
                    })
                  }
                >
                  Create assigned action →
                </button>
              </section>
              <footer>
                {canExport ? (
                  <a
                    className="report-export"
                    href={`/api/v1/reports?report=${liveReports[selected]}${start ? `&start=${start}` : ""}${end ? `&end=${end}` : ""}&format=csv`}
                  >
                    Export CSV
                  </a>
                ) : (
                  <button disabled title="This role cannot export reports">
                    CSV · restricted
                  </button>
                )}
                <button
                  disabled
                  title="XLSX generation provider is not configured"
                >
                  XLSX · gated
                </button>
                <button
                  disabled
                  title="PDF rendering provider is not configured"
                >
                  PDF · gated
                </button>
              </footer>
            </>
          ) : (
            <div className="gated-report">
              <i>○</i>
              <h3>This report needs a connected source.</h3>
              <p>{reportRequirement(selected)}</p>
              <span>
                Once connected, it will support filters, comparisons,
                transaction drill-down, annotations, generation timestamps and
                source freshness.
              </span>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function reportRequirement(name: string) {
  const category = Object.entries(reportGroups).find(([, items]) =>
    items.includes(name),
  )?.[0];
  const requirements: Record<string, string> = {
    Inventory:
      "SKU-level on-hand balances, movements, costs, purchase orders, receipts, expiry and location facts are required.",
    Customers:
      "Customer-linked transactions, consent, loyalty and contact records are required.",
    "Payments & reconciliation":
      "Tender, payout, bank-transaction and reconciliation records from verified adapters are required.",
    "Suppliers & purchasing":
      "Supplier, purchase-order, receiving, invoice and credit records are required.",
    Employees:
      "Schedules, time clock, role and hourly transaction facts are required.",
    "Accounting & BookLoQ":
      "Open BookLoQ for its implemented ledger reports. Provider-dependent reports remain gated there.",
  };
  return (
    requirements[category || ""] ||
    "Line-item POS transactions with product, employee, location, payment and timestamp dimensions are required."
  );
}

type OrderLine = {
  id: string;
  description: string;
  sku: string;
  quantity: number;
  receivedQuantity: number;
  invoicedQuantity: number;
  unitCostCents: number;
  currentInventory: number | null;
  reorderPoint: number | null;
  forecastDemand: number | null;
};
type Order = {
  id: string;
  orderNumber: string;
  supplierName: string;
  orderDate: string;
  expectedDeliveryDate: string | null;
  currency: string;
  status: string;
  totalCents: number;
  subtotalCents: number;
  taxCents: number;
  discountCents: number;
  paymentTerms: string;
  lines: OrderLine[];
  receipts: { id: string; discrepancyStatus: string }[];
  matches: { id: string; status: string; differenceCents: number }[];
};
type PurchasingData = {
  orders: Order[];
  summary: {
    openOrders: number;
    awaitingApproval: number;
    openCommitmentsCents: number;
    discrepancies: number;
  };
};

export function PurchaseOrdersWorkspace({
  currency,
  showNotice,
  createTask,
}: SharedProps) {
  const [data, setData] = useState<PurchasingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"orders" | "recommendations">("orders");
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Order | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    const response = await apiFetch("/api/v1/purchasing");
    const body: unknown = await response.json();
    if (response.ok) setData(body as PurchasingData);
    else showNotice(apiMessage(body, "Unable to load purchase orders."));
    setLoading(false);
  }, [showNotice]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const action = async (body: Record<string, unknown>) => {
    const response = await apiFetch("/api/v1/purchasing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const raw: unknown = await response.json();
    if (!response.ok)
      return showNotice(apiMessage(raw, "Purchase-order action failed."));
    const next = raw as PurchasingData;
    setData(next);
    setSelected(
      next.orders.find((order: Order) => order.id === selected?.id) || null,
    );
    showNotice("Purchase-order workflow updated and audited");
  };
  if (loading || !data)
    return (
      <div className="content control-empty">
        Loading purchase-order centre…
      </div>
    );
  return (
    <div className="content control-page po-centre">
      <section className="page-intro">
        <div>
          <p>PURCHASE-ORDER CENTRE</p>
          <h2>
            Order, approve, receive and match—without losing the cash picture.
          </h2>
          <span>
            Amounts use integer minor units. Sending and payment never happen
            automatically; every commitment requires an authorized approval.
          </span>
        </div>
        <button className="primary" onClick={() => setCreating(true)}>
          + New purchase order
        </button>
      </section>
      <div className="control-tabs">
        <button
          className={tab === "orders" ? "active" : ""}
          onClick={() => setTab("orders")}
        >
          Orders
        </button>
        <button
          className={tab === "recommendations" ? "active" : ""}
          onClick={() => setTab("recommendations")}
        >
          Recommendation lab
        </button>
      </div>
      {tab === "orders" ? (
        <>
          <div className="po-summary">
            <article>
              <small>OPEN ORDERS</small>
              <b>{data.summary.openOrders}</b>
            </article>
            <article>
              <small>AWAITING APPROVAL</small>
              <b>{data.summary.awaitingApproval}</b>
            </article>
            <article>
              <small>OPEN COMMITMENTS</small>
              <b>{money(data.summary.openCommitmentsCents, currency)}</b>
            </article>
            <article>
              <small>DISCREPANCIES</small>
              <b>{data.summary.discrepancies}</b>
            </article>
          </div>
          <section className="po-layout">
            <article className="card po-table">
              <header>
                <span>Order</span>
                <span>Supplier</span>
                <span>Expected</span>
                <span>Status</span>
                <span>Total</span>
              </header>
              {data.orders.map((order) => (
                <button
                  className={selected?.id === order.id ? "selected" : ""}
                  key={order.id}
                  onClick={() => setSelected(order)}
                >
                  <span>
                    <b>{order.orderNumber}</b>
                    <small>{order.orderDate}</small>
                  </span>
                  <span>{order.supplierName}</span>
                  <span>{order.expectedDeliveryDate || "Not set"}</span>
                  <span>
                    <em className={`po-status ${order.status}`}>
                      {order.status.replaceAll("_", " ")}
                    </em>
                  </span>
                  <span>{money(order.totalCents, order.currency)}</span>
                </button>
              ))}
              {!data.orders.length && (
                <div className="control-empty">
                  <b>No purchase orders yet.</b>
                  <span>Create a draft or use the recommendation lab.</span>
                </div>
              )}
            </article>
            <OrderInspector order={selected} action={action} />
          </section>
        </>
      ) : (
        <RecommendationLab currency={currency} createTask={createTask} />
      )}{" "}
      {creating && (
        <PurchaseOrderModal
          currency={currency}
          close={() => setCreating(false)}
          created={(next) => {
            setData(next);
            setCreating(false);
            showNotice("Draft purchase order created");
          }}
        />
      )}
    </div>
  );
}

function OrderInspector({
  order,
  action,
}: {
  order: Order | null;
  action: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [receiving, setReceiving] = useState(false);
  if (!order)
    return (
      <aside className="card order-inspector control-empty">
        <b>Select a purchase order.</b>
        <span>Review lines, approvals, receipts and invoice matching.</span>
      </aside>
    );
  return (
    <aside className="card order-inspector">
      <header>
        <div>
          <p>{order.orderNumber}</p>
          <h3>{order.supplierName}</h3>
        </div>
        <span className={`po-status ${order.status}`}>
          {order.status.replaceAll("_", " ")}
        </span>
      </header>
      <div className="order-facts">
        <span>
          <small>ORDERED</small>
          <b>{order.orderDate}</b>
        </span>
        <span>
          <small>EXPECTED</small>
          <b>{order.expectedDeliveryDate || "Not set"}</b>
        </span>
        <span>
          <small>PAYMENT</small>
          <b>{order.paymentTerms || "Not set"}</b>
        </span>
      </div>
      <div className="order-lines">
        {order.lines.map((line) => (
          <article key={line.id}>
            <div>
              <b>{line.description}</b>
              <small>{line.sku || "No SKU"}</small>
            </div>
            <span>
              {line.quantity} ordered
              <br />
              {line.receivedQuantity} received
            </span>
            <strong>
              {money(line.quantity * line.unitCostCents, order.currency)}
            </strong>
          </article>
        ))}
      </div>
      <div className="order-total">
        <span>
          Subtotal<b>{money(order.subtotalCents, order.currency)}</b>
        </span>
        <span>
          Tax<b>{money(order.taxCents, order.currency)}</b>
        </span>
        <span>
          Total<b>{money(order.totalCents, order.currency)}</b>
        </span>
      </div>
      <div className="order-actions">
        {order.status === "awaiting_approval" && (
          <button
            className="primary"
            onClick={() =>
              void action({ action: "approve", purchaseOrderId: order.id })
            }
          >
            Approve order
          </button>
        )}
        {order.status === "approved" && (
          <button
            onClick={() =>
              void action({
                action: "mark_sent",
                purchaseOrderId: order.id,
                confirmExternalSend: true,
              })
            }
          >
            Confirm sent externally
          </button>
        )}
        {["approved", "sent", "acknowledged", "partially_received"].includes(
          order.status,
        ) && <button onClick={() => setReceiving(true)}>Receive goods</button>}
      </div>
      <p className="workflow-boundary">
        Vanteloq does not email this order or initiate payment until verified
        provider adapters are connected.
      </p>
      {receiving && (
        <ReceiveModal
          order={order}
          close={() => setReceiving(false)}
          receive={async (lines) => {
            await action({
              action: "receive",
              purchaseOrderId: order.id,
              receivedDate: new Date().toISOString().slice(0, 10),
              lines,
            });
            setReceiving(false);
          }}
        />
      )}
    </aside>
  );
}

function PurchaseOrderModal({
  currency,
  close,
  created,
}: {
  currency: string;
  close: () => void;
  created: (data: PurchasingData) => void;
}) {
  const [lines, setLines] = useState([
    {
      sku: "",
      description: "",
      quantity: 1,
      unitCost: 0,
      currentInventory: 0,
      reorderPoint: 0,
      forecastDemand: 0,
    },
  ]);
  const [error, setError] = useState("");
  const update = (
    index: number,
    key: keyof (typeof lines)[number],
    value: string | number,
  ) =>
    setLines((current) =>
      current.map((line, position) =>
        position === index ? { ...line, [key]: value } : line,
      ),
    );
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await apiFetch("/api/v1/purchasing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        orderNumber: form.get("orderNumber"),
        supplierName: form.get("supplierName"),
        orderDate: form.get("orderDate"),
        expectedDeliveryDate: form.get("expectedDeliveryDate"),
        currency,
        paymentTerms: form.get("paymentTerms"),
        taxCents: Math.round(Number(form.get("tax") || 0) * 100),
        discountCents: Math.round(Number(form.get("discount") || 0) * 100),
        submitForApproval: form.get("submitForApproval") === "on",
        lines: lines.map((line) => ({
          sku: line.sku,
          description: line.description,
          quantity: Number(line.quantity),
          unitCostCents: Math.round(Number(line.unitCost) * 100),
          currentInventory: Number(line.currentInventory),
          reorderPoint: Number(line.reorderPoint),
          forecastDemand: Number(line.forecastDemand),
        })),
      }),
    });
    const body: unknown = await response.json();
    if (!response.ok)
      return setError(apiMessage(body, "Unable to create purchase order."));
    created(body as PurchasingData);
  };
  return (
    <div className="modal-backdrop">
      <form className="po-modal" onSubmit={submit}>
        <header>
          <div>
            <p>NEW PURCHASE ORDER</p>
            <h2>Build a deterministic commitment</h2>
          </div>
          <button type="button" onClick={close}>
            ×
          </button>
        </header>
        <div className="po-form-grid">
          <label>
            Order number
            <input name="orderNumber" placeholder="PO-0001" required />
          </label>
          <label>
            Supplier
            <input name="supplierName" required />
          </label>
          <label>
            Order date
            <input
              name="orderDate"
              type="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
              required
            />
          </label>
          <label>
            Expected delivery
            <input name="expectedDeliveryDate" type="date" />
          </label>
          <label>
            Payment terms
            <input name="paymentTerms" placeholder="Net 30" />
          </label>
          <label>
            Currency
            <input value={currency} readOnly />
          </label>
        </div>
        <div className="po-line-editor">
          <header>
            <b>Products</b>
            <button
              type="button"
              onClick={() =>
                setLines((current) => [
                  ...current,
                  {
                    sku: "",
                    description: "",
                    quantity: 1,
                    unitCost: 0,
                    currentInventory: 0,
                    reorderPoint: 0,
                    forecastDemand: 0,
                  },
                ])
              }
            >
              + Add line
            </button>
          </header>
          {lines.map((line, index) => (
            <div key={index}>
              <input
                aria-label="SKU"
                placeholder="SKU"
                value={line.sku}
                onChange={(event) => update(index, "sku", event.target.value)}
              />
              <input
                aria-label="Product description"
                placeholder="Product description"
                value={line.description}
                onChange={(event) =>
                  update(index, "description", event.target.value)
                }
                required
              />
              <input
                aria-label="Quantity"
                type="number"
                min="1"
                value={line.quantity}
                onChange={(event) =>
                  update(index, "quantity", Number(event.target.value))
                }
              />
              <input
                aria-label="Unit cost"
                type="number"
                min="0"
                step="0.01"
                value={line.unitCost}
                onChange={(event) =>
                  update(index, "unitCost", Number(event.target.value))
                }
              />
              <button
                type="button"
                disabled={lines.length === 1}
                onClick={() =>
                  setLines((current) =>
                    current.filter((_, position) => position !== index),
                  )
                }
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="po-form-grid">
          <label>
            Tax
            <input
              name="tax"
              type="number"
              min="0"
              step="0.01"
              defaultValue="0"
            />
          </label>
          <label>
            Discount
            <input
              name="discount"
              type="number"
              min="0"
              step="0.01"
              defaultValue="0"
            />
          </label>
          <label className="toggle full">
            <input name="submitForApproval" type="checkbox" />
            <span>Submit for approval after creating</span>
          </label>
        </div>
        {error && <p className="form-error">{error}</p>}
        <footer>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary">Create purchase order</button>
        </footer>
      </form>
    </div>
  );
}

function ReceiveModal({
  order,
  close,
  receive,
}: {
  order: Order;
  close: () => void;
  receive: (lines: { lineId: string; quantity: number }[]) => Promise<void>;
}) {
  const [values, setValues] = useState(
    Object.fromEntries(
      order.lines.map((line) => [
        line.id,
        Math.max(0, line.quantity - line.receivedQuantity),
      ]),
    ),
  );
  return (
    <div className="modal-backdrop">
      <section className="receive-modal">
        <header>
          <div>
            <p>GOODS RECEIPT</p>
            <h2>Receive {order.orderNumber}</h2>
          </div>
          <button onClick={close}>×</button>
        </header>
        {order.lines.map((line) => (
          <label key={line.id}>
            <span>
              <b>{line.description}</b>
              <small>{line.quantity - line.receivedQuantity} remaining</small>
            </span>
            <input
              type="number"
              min="0"
              value={values[line.id]}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  [line.id]: Number(event.target.value),
                }))
              }
            />
          </label>
        ))}
        <p>
          Short or over receipts are accepted as discrepancies and remain
          visible for review.
        </p>
        <footer>
          <button onClick={close}>Cancel</button>
          <button
            className="primary"
            onClick={() =>
              void receive(
                order.lines.map((line) => ({
                  lineId: line.id,
                  quantity: values[line.id] || 0,
                })),
              )
            }
          >
            Record receipt
          </button>
        </footer>
      </section>
    </div>
  );
}

export function InventoryWorkspace({
  currency,
  showNotice,
  createTask,
  sourceCashCents,
  sourceAccountsPayableCents,
  sourceDataAgeHours,
  sourceHistoryDays,
}: SharedProps & {
  sourceCashCents: number | null;
  sourceAccountsPayableCents: number | null;
  sourceDataAgeHours: number;
  sourceHistoryDays: number;
}) {
  return (
    <div className="content control-page inventory-brain-page">
      <section className="page-intro">
        <div>
          <p>INVENTORY REORDER BRAIN</p>
          <h2>Protect availability without spending past the cash line.</h2>
          <span>
            Demand, lead time, variability, incoming stock, case packs, supplier
            minimums, shelf life, capacity and committed cash are evaluated
            together. Every recommendation remains a human-reviewed decision.
          </span>
        </div>
        <div className="reorder-source-state">
          <small>OPERATING SOURCE</small>
          <b>{sourceCashCents === null ? "Scenario mode" : "Latest verified balance"}</b>
          <span>
            {sourceCashCents === null
              ? "Connect normalized inventory and cash sources to automate inputs."
              : `${sourceHistoryDays} days of history · ${sourceDataAgeHours}h old`}
          </span>
        </div>
      </section>
      <InventoryLifecycleWorkspace currency={currency} showNotice={showNotice} createTask={createTask} />
      <RecommendationLab
        currency={currency}
        createTask={createTask}
        sourceCashCents={sourceCashCents}
        sourceAccountsPayableCents={sourceAccountsPayableCents}
        sourceDataAgeHours={sourceDataAgeHours}
        sourceHistoryDays={sourceHistoryDays}
      />
    </div>
  );
}

function RecommendationLab({
  currency,
  createTask,
  sourceCashCents = null,
  sourceAccountsPayableCents = null,
  sourceDataAgeHours = 0,
  sourceHistoryDays = 0,
}: {
  currency: string;
  createTask: (seed: TaskSeed) => void;
  sourceCashCents?: number | null;
  sourceAccountsPayableCents?: number | null;
  sourceDataAgeHours?: number;
  sourceHistoryDays?: number;
}) {
  const [inputs, setInputs] = useState({
    onHand: 0,
    incoming: 0,
    dailyDemand: 0,
    demandStdDev: 0,
    leadTime: 0,
    reviewPeriod: 7,
    serviceLevelZ: 1.65,
    seasonality: 1,
    promotion: 1,
    casePack: 1,
    supplierMinimum: 0,
    supplierMinimumSpend: 0,
    unitCost: 0,
    grossMargin: 0,
    weather: 1,
    expiringUnits: 0,
    availableCash: Math.round((sourceCashCents ?? 0) / 100),
    cashThreshold: 0,
    accountsPayable: Math.round((sourceAccountsPayableCents ?? 0) / 100),
    payroll: 0,
    tax: 0,
    debt: 0,
    otherCommitments: 0,
    shelfLife: 0,
    storageCapacity: 0,
    demandHistoryDays: sourceHistoryDays,
    dataAgeHours: sourceDataAgeHours,
  });
  const set = (key: keyof typeof inputs, value: number) =>
    setInputs((current) => ({ ...current, [key]: value }));
  const calculation = useMemo(() => {
    if (inputs.dailyDemand <= 0 || inputs.leadTime <= 0 || inputs.unitCost <= 0 || sourceCashCents === null) return { result: null, error: "Verified cash plus SKU demand, lead time and unit cost are required before a recommendation is calculated." };
    const engineInputs: ReorderInputs = {
      onHandUnits: inputs.onHand,
      incomingUnits: inputs.incoming,
      averageDailyDemand: inputs.dailyDemand,
      demandStdDevDaily: inputs.demandStdDev || null,
      leadTimeDays: inputs.leadTime,
      reviewPeriodDays: inputs.reviewPeriod,
      serviceLevelZ: inputs.serviceLevelZ,
      seasonalityFactor: inputs.seasonality,
      promotionFactor: inputs.promotion,
      casePackUnits: inputs.casePack,
      minimumOrderUnits: inputs.supplierMinimum,
      supplierMinimumSpendCents: Math.round(inputs.supplierMinimumSpend * 100),
      unitCostCents: Math.round(inputs.unitCost * 100),
      grossMarginBasisPoints: inputs.grossMargin > 0 ? Math.round(inputs.grossMargin * 100) : null,
      weatherFactor: inputs.weather,
      expiringUnits: inputs.expiringUnits,
      availableCashCents: Math.round(inputs.availableCash * 100),
      cashSafetyThresholdCents: Math.round(inputs.cashThreshold * 100),
      accountsPayableCents: Math.round(inputs.accountsPayable * 100),
      payrollCommitmentsCents: Math.round(inputs.payroll * 100),
      taxCommitmentsCents: Math.round(inputs.tax * 100),
      debtCommitmentsCents: Math.round(inputs.debt * 100),
      otherCommitmentsCents: Math.round(inputs.otherCommitments * 100),
      shelfLifeDays: inputs.shelfLife || null,
      storageCapacityUnits: inputs.storageCapacity || null,
      demandHistoryDays: inputs.demandHistoryDays,
      dataAgeHours: inputs.dataAgeHours,
    };
    try {
      return { result: calculateReorderRecommendation(engineInputs), error: "" };
    } catch (error) {
      return {
        result: null,
        error: error instanceof Error ? error.message : "Check the scenario inputs.",
      };
    }
  }, [inputs, sourceCashCents]);
  const result = calculation.result;
  const scenarioMaximum = result
    ? Math.max(...result.scenarios.map((scenario) => scenario.orderUnits), 1)
    : 1;
  const fields: { key: keyof typeof inputs; label: string; suffix?: string }[] = [
    { key: "onHand", label: "On hand", suffix: "units" },
    { key: "incoming", label: "Incoming", suffix: "units" },
    { key: "dailyDemand", label: "Average daily demand", suffix: "units" },
    { key: "demandStdDev", label: "Daily demand variability", suffix: "σ" },
    { key: "leadTime", label: "Supplier lead time", suffix: "days" },
    { key: "reviewPeriod", label: "Review period", suffix: "days" },
    { key: "serviceLevelZ", label: "Service level factor", suffix: "z" },
    { key: "seasonality", label: "Seasonality factor", suffix: "×" },
    { key: "promotion", label: "Promotion factor", suffix: "×" },
    { key: "casePack", label: "Case pack", suffix: "units" },
    { key: "supplierMinimum", label: "Supplier minimum", suffix: "units" },
    { key: "supplierMinimumSpend", label: "Supplier minimum spend", suffix: currency },
    { key: "unitCost", label: "Unit cost", suffix: currency },
    { key: "grossMargin", label: "Gross margin", suffix: "%" },
    { key: "weather", label: "Weather demand factor", suffix: "×" },
    { key: "expiringUnits", label: "Expiring before horizon", suffix: "units" },
    { key: "availableCash", label: "Available cash", suffix: currency },
    { key: "cashThreshold", label: "Cash safety threshold", suffix: currency },
    { key: "accountsPayable", label: "Accounts payable", suffix: currency },
    { key: "payroll", label: "Payroll commitments", suffix: currency },
    { key: "tax", label: "Tax commitments", suffix: currency },
    { key: "debt", label: "Debt commitments", suffix: currency },
    { key: "otherCommitments", label: "Upcoming bills and rent", suffix: currency },
    { key: "shelfLife", label: "Shelf life", suffix: "days" },
    { key: "storageCapacity", label: "Storage capacity", suffix: "units" },
    { key: "demandHistoryDays", label: "Demand history", suffix: "days" },
    { key: "dataAgeHours", label: "Data age", suffix: "hours" },
  ];
  return (
    <section className="recommendation-lab">
      <article className="card rec-inputs">
        <p>TRACEABLE INPUTS</p>
        <h3>Demand and cash constraints</h3>
        <div>
          {fields.map((field) => (
            <label key={field.key}>
              <span>{field.label}<small>{field.suffix}</small></span>
              <input
                type="number"
                min="0"
                step={field.key === "seasonality" || field.key === "promotion" || field.key === "serviceLevelZ" || field.key === "demandStdDev" ? "0.05" : "1"}
                value={inputs[field.key]}
                onChange={(event) =>
                  set(field.key, Number(event.target.value))
                }
              />
            </label>
          ))}
        </div>
      </article>
      <article className="card rec-output">
        {calculation.error || !result ? <p className="form-error">{calculation.error}</p> : <>
          <div className="reorder-verdict">
            <span className={result.status === "blocked" ? "breach" : "safe"}>
              {result.status.replaceAll("_", " ")}
            </span>
            <small>{result.confidence} confidence</small>
          </div>
          <h2>{result.recommendedUnits} units</h2>
          <p><b>{result.urgency.toUpperCase()}</b>{result.marginBasisPoints === null ? " · Margin unavailable" : ` · ${(result.marginBasisPoints / 100).toFixed(1)}% margin`}</p>
          <p>{result.formula}</p>
          <div className="reorder-scenarios" aria-label="Recommended order scenarios">
            {result.scenarios.map((scenario) => <span key={scenario.label}>
              <small>{scenario.label.toUpperCase()}</small>
              <b>{scenario.orderUnits}</b>
              <em>{money(scenario.orderCostCents, currency)}</em>
              <i aria-hidden="true"><b style={{ width: `${Math.max(4, (scenario.orderUnits / scenarioMaximum) * 100)}%` }} /></i>
            </span>)}
          </div>
          <dl>
            <div><dt>Forecast demand</dt><dd>{result.forecastDemandUnits} units</dd></div>
            <div><dt>Safety stock</dt><dd>{result.safetyStockUnits} units</dd></div>
            <div><dt>Expected stockout</dt><dd>{result.expectedStockoutDays === null ? "No velocity" : `${result.expectedStockoutDays} days`}</dd></div>
            <div><dt>Expected cost</dt><dd>{money(result.orderCostCents, currency)}</dd></div>
            <div><dt>Committed cash</dt><dd>{money(result.committedCashCents, currency)}</dd></div>
            <div><dt>Cash after order</dt><dd>{money(result.cashAfterOrderCents, currency)}</dd></div>
            <div><dt>Cash safety threshold</dt><dd>{money(Math.round(inputs.cashThreshold * 100), currency)}</dd></div>
            <div><dt>Human approval</dt><dd>Always required</dd></div>
          </dl>
          {!!result.constrainedBy.length && <div className="reorder-explain"><b>Constraints applied</b>{result.constrainedBy.map(item => <span key={item}>{item}</span>)}</div>}
          {!!result.missingInputs.length && <div className="reorder-explain missing"><b>Confidence gaps</b>{result.missingInputs.map(item => <span key={item}>{item}</span>)}</div>}
          {!!result.assumptions.length && <p className="rec-boundary">{result.assumptions.join(" ")}</p>}
        </>}
        <button
          disabled={!result || result.status === "no_order"}
          title={!result || result.status === "no_order" ? "No reorder action is needed for this scenario." : "Create a review action; this does not place an order."}
          onClick={() =>
            result && createTask({
              title: "Review purchase-order scenario",
              detail: `Review ${result.recommendedUnits} units at an expected cost of ${money(result.orderCostCents, currency)}. Cash after order: ${money(result.cashAfterOrderCents, currency)}. Constraints: ${result.constrainedBy.join(", ") || "none"}.`,
              priority: result.status === "blocked" ? "high" : "medium",
              sourceType: "decision",
              sourceRef: "inventory-reorder-brain",
              expectedImpact: result.status === "blocked"
                ? "Resolve the limiting constraint before committing cash."
                : "Protect availability while preserving cash.",
            })
          }
        >
          Create review action →
        </button>
      </article>
    </section>
  );
}

type DocumentData = {
  documents: {
    id: string;
    documentType: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    status: string;
    extractionStatus: string;
    createdAt: string;
  }[];
  pipeline: Record<string, string>;
};
export function DocumentsWorkspace({ showNotice }: SharedProps) {
  const [data, setData] = useState<DocumentData | null>(null);
  const [uploading, setUploading] = useState(false);
  const load = useCallback(async () => {
    const response = await apiFetch("/api/v1/documents");
    const body: unknown = await response.json();
    if (response.ok) setData(body as DocumentData);
    else showNotice(apiMessage(body, "Unable to load documents."));
  }, [showNotice]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const upload = async (file: File | null, documentType: string) => {
    if (!file) return;
    setUploading(true);
    const form = new FormData();
    form.set("file", file);
    form.set("documentType", documentType);
    const response = await apiFetch("/api/v1/documents", {
      method: "POST",
      body: form,
    });
    const body: unknown = await response.json();
    if (response.ok) {
      setData(body as DocumentData);
      showNotice("Document added to the secure review queue");
    } else showNotice(apiMessage(body, "Upload failed."));
    setUploading(false);
  };
  if (!data)
    return (
      <div className="content control-empty">Loading document centre…</div>
    );
  return (
    <div className="content control-page documents-centre">
      <section className="page-intro">
        <div>
          <p>INVOICES & RECEIPTS</p>
          <h2>Capture the original. Trust only verified fields.</h2>
          <span>
            File storage, MIME verification and duplicate detection are live.
            Malware scanning and OCR are not configured, so uploads remain
            review-required and no extraction is claimed.
          </span>
        </div>
      </section>
      <section className="document-pipeline">
        {Object.entries(data.pipeline).map(([key, state]) => (
          <article key={key}>
            <span className={state}>{state.replaceAll("_", " ")}</span>
            <b>{key.replaceAll(/([A-Z_])/g, " $1").replaceAll("_", " ")}</b>
          </article>
        ))}
      </section>
      <section className="document-upload card">
        <div>
          <i>↑</i>
          <h3>
            {uploading
              ? "Uploading securely…"
              : "Add an invoice, receipt or supplier document"}
          </h3>
          <p>
            PDF, JPEG, PNG or WEBP · up to 10 MB · camera capture supported on
            mobile
          </p>
        </div>
        <div>
          {["invoice", "receipt", "supplier_statement", "packing_slip"].map(
            (type) => (
              <label key={type}>
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  capture={type === "receipt" ? "environment" : undefined}
                  disabled={uploading}
                  onChange={(event) =>
                    void upload(event.target.files?.[0] || null, type)
                  }
                />
                {type.replaceAll("_", " ")}
              </label>
            ),
          )}
        </div>
      </section>
      <article className="card document-table">
        <header>
          <span>Document</span>
          <span>Type</span>
          <span>Security state</span>
          <span>Extraction</span>
          <span>Added</span>
        </header>
        {data.documents.map((document) => (
          <div key={document.id}>
            <span>
              <b>{document.fileName}</b>
              <small>
                {Math.ceil(document.sizeBytes / 1024)} KB ·{" "}
                {document.contentType}
              </small>
            </span>
            <span>{document.documentType.replaceAll("_", " ")}</span>
            <span>
              <em>{document.status.replaceAll("_", " ")}</em>
            </span>
            <span>
              <em className="gated">
                {document.extractionStatus.replaceAll("_", " ")}
              </em>
            </span>
            <span>
              <a href={`/api/v1/documents?id=${document.id}`}>
                Download original
              </a>
            </span>
          </div>
        ))}
        {!data.documents.length && (
          <div className="control-empty">
            <b>No documents uploaded.</b>
            <span>
              The document centre begins empty—no sample invoices are created.
            </span>
          </div>
        )}
      </article>
    </div>
  );
}

type QualityData = {
  summary: {
    completeness: number;
    costCoverage: number;
    lastSuccessfulSynchronization: string | null;
    failedSynchronizationCount: number;
    missingPeriodCount: number;
    affectedMetricCount: number;
    status: string;
  };
  issues: {
    severity: string;
    type: string;
    title: string;
    affectedMetrics: string[];
    correction: string;
  }[];
  missingPeriods: string[];
  sources: {
    dailyRows: number;
    imports: number;
    documents: number;
    connections: {
      provider: string;
      status: string;
      lastSuccessfulSyncAt: string | null;
    }[];
  };
};
export function DataQualityWorkspace({ showNotice, createTask }: SharedProps) {
  const [data, setData] = useState<QualityData | null>(null);
  const load = useCallback(async () => {
    const response = await apiFetch("/api/v1/data-quality");
    const body: unknown = await response.json();
    if (response.ok) setData(body as QualityData);
    else showNotice(apiMessage(body, "Unable to load data quality."));
  }, [showNotice]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  if (!data)
    return (
      <div className="content control-empty">Checking source completeness…</div>
    );
  return (
    <div className="content control-page quality-centre">
      <section className="page-intro">
        <div>
          <p>DATA QUALITY CENTRE</p>
          <h2>Know when the numbers are safe to use.</h2>
          <span>
            Metrics lose authority when a required source is stale, missing,
            incomplete or unreconciled.
          </span>
        </div>
        <span className={`quality-state ${data.summary.status}`}>
          {data.summary.status}
        </span>
      </section>
      <section className="quality-scoreboard">
        <article>
          <small>COMPLETENESS</small>
          <b>{data.summary.completeness}%</b>
          <i>
            <span style={{ width: `${data.summary.completeness}%` }} />
          </i>
        </article>
        <article>
          <small>COST COVERAGE</small>
          <b>{data.summary.costCoverage}%</b>
          <span>Gross-margin input coverage</span>
        </article>
        <article>
          <small>LAST VERIFIED DATE</small>
          <b>{data.summary.lastSuccessfulSynchronization || "No source"}</b>
          <span>{data.sources.dailyRows} daily records</span>
        </article>
        <article>
          <small>AFFECTED METRICS</small>
          <b>{data.summary.affectedMetricCount}</b>
          <span>
            {data.summary.failedSynchronizationCount} failed sources/imports
          </span>
        </article>
      </section>
      <div className="quality-layout">
        <article className="card quality-issues">
          <header>
            <h3>Issues and corrections</h3>
            <span>{data.issues.length}</span>
          </header>
          {data.issues.map((issue, index) => (
            <div key={`${issue.type}-${index}`}>
              <i className={issue.severity}>!</i>
              <span>
                <b>{issue.title}</b>
                <small>Affects: {issue.affectedMetrics.join(", ")}</small>
                <p>{issue.correction}</p>
              </span>
              <button
                onClick={() =>
                  createTask({
                    title: issue.title,
                    detail: issue.correction,
                    priority: issue.severity === "critical" ? "high" : "medium",
                    sourceType: "alert",
                    sourceRef: `quality:${issue.type}`,
                  })
                }
              >
                Create task
              </button>
            </div>
          ))}
          {!data.issues.length && (
            <div className="control-empty">
              <b>No material quality issue detected.</b>
              <span>Continue monitoring freshness and reconciliation.</span>
            </div>
          )}
        </article>
        <aside className="card source-health">
          <h3>Source health</h3>
          <div>
            <span>
              Daily operating rows<b>{data.sources.dailyRows}</b>
            </span>
            <span>
              Import runs<b>{data.sources.imports}</b>
            </span>
            <span>
              Stored documents<b>{data.sources.documents}</b>
            </span>
            <span>
              Missing date gaps<b>{data.summary.missingPeriodCount}</b>
            </span>
          </div>
          <h4>Provider connections</h4>
          {data.sources.connections.length ? (
            data.sources.connections.map((source) => (
              <p key={source.provider}>
                <b>{source.provider}</b>
                <span>{source.status}</span>
              </p>
            ))
          ) : (
            <p>
              <b>No live provider</b>
              <span>Imported/manual only</span>
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
