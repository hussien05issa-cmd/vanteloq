import type {FeatureKey,PlanKey} from "./catalog";

/** Shared purchase copy, describing implemented workflows rather than every reserved feature flag. */
export const PLAN_HIGHLIGHTS: Record<PlanKey,readonly string[]>={
  starter:["Sales, margins and inventory basics","Vanteloq AI with response preferences","Source records and core reports"],
  growth:["Everything in Starter","Lots, expiry and supplier analytics","Revenue, demand and inventory forecasts"],
  pro:["Everything in Growth","Forecast scenarios and commitments","Advanced location comparisons and exports"],
  bookloq:["Invoices, bills and document review","Reconciliation and posted financial statements","13-week cash planning and Vanteloq AI"],
};

export const PLAN_COMPARISON:readonly {label:string;feature:FeatureKey;detail:string}[]=[
 {label:"Sales and gross margin",feature:"products.margin",detail:"Open totals to source records. Missing costs remain visible."},
 {label:"Vanteloq AI and personalisation",feature:"ai.basic",detail:"Permitted records, file questions and app help. Memory starts off."},
 {label:"Core reports and operations",feature:"reporting.basic",detail:"Review recorded sales, inventory and operating tasks."},
 {label:"Lots and expiry",feature:"inventory.expiry",detail:"Track dated stock and review expiry risk."},
 {label:"Inventory velocity and stock cover",feature:"inventory.velocity",detail:"Requires reviewed sales and inventory inputs."},
 {label:"Supplier analytics",feature:"supplier.analytics",detail:"Review supported purchasing and supplier records."},
 {label:"Revenue and demand forecasting",feature:"forecasting.revenue",detail:"History-based estimates with coverage checks and backtests."},
 {label:"Forecast scenarios",feature:"forecasting.scenarios",detail:"Compare explicit assumptions and review future commitments."},
 {label:"Advanced location comparisons",feature:"multi_location.advanced",detail:"Compare permitted locations with equivalent source coverage."},
 {label:"Advanced reporting and exports",feature:"reporting.exports",detail:"Available records and role permissions determine each export."},
];
