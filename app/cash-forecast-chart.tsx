"use client";
import type { ThirteenWeekCashFlow } from "../domain/thirteen-week-cash-flow";
import FinanceChart from "./finance-chart";

const date = (value: string) => new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
export default function CashForecastChart({ flow, currency, allowExport = false }: { flow: ThirteenWeekCashFlow; currency: string; allowExport?: boolean }) {
  const points = flow.openingCashCents === null ? [] : [
    { label: "Now", detail: `Opening cash · ${flow.asOf}`, values: [flow.openingCashCents, flow.openingCashCents] },
    ...flow.weeks.map(week => ({ label: date(week.weekEnd), detail: `Week ${week.index} · ${week.weekStart} to ${week.weekEnd}`, values: [week.conservativeClosingCashCents, week.planningClosingCashCents] })),
  ];
  return <FinanceChart title="Cash Flow Forecast" description="13 weeks from available opening cash. Confirmed commitments and expected receipts stay separate." points={points} series={[
    { label: "Confirmed commitments", color: "blue", kind: "line", dashed: true },
    { label: "Including expected receipts", color: "violet", kind: "line", dashed: true },
  ]} currency={currency} forecast allowExport={allowExport} emptyMessage="Connect a verified cash source to see your forecast."/>;
}
