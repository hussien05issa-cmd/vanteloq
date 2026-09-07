import type { ReactNode } from "react";

/** Interface symbols accompany visible labels; they never replace accessible names. */
export default function WorkspaceIcon({ name, className = "" }: { name: string; className?: string }) {
  const paths: Record<string, ReactNode> = {
    Dashboard: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    Intelligence: <path d="M3 18 8 12l4 3 8-10M15 5h5v5M3 22h18"/>,
    "Action Centre": <><rect x="4" y="4" width="16" height="17" rx="2"/><path d="M9 4V2h6v2M8 12l3 3 5-6"/></>,
    "Business Brief": <path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h5"/>,
    Advisor: <><path d="M20 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 18 0Z"/><path d="M7 9h8M7 13h5"/></>,
    Sales: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3ZM9 7h6M9 11h6M9 15h3"/>,
    Customers: <><circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v3"/></>,
    Inventory: <path d="m12 3 9 5-9 5-9-5 9-5ZM3 8v9l9 5 9-5V8M12 13v9M7.5 5.5l9 5"/>,
    Suppliers: <><path d="M3 5h11v12H3zM14 9h4l3 4v4h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></>,
    "Purchase Orders": <><path d="M3 3h2l2 13h12l2-9H6M9 3v4M15 3v4"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/></>,
    Reports: <path d="M4 3v18h17M8 17v-5M13 17V8M18 17V4"/>,
    Marketing: <path d="m3 10 16-6v16L3 14v-4ZM7 15l2 6h4l-2-5M19 8l3-1M19 16l3 1"/>,
    Communications: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></>,
    Operations: <path d="M14 6a5 5 0 0 0-6 6l-5 5a2 2 0 0 0 4 4l5-5a5 5 0 0 0 6-6l-3 3-4-4 3-3Z"/>,
    Documents: <path d="M3 6h7l2 3h9v12H3V6ZM3 6V3h7l2 3h9v3"/>,
    "Data Quality": <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3ZM8 12l3 3 5-6"/>,
    Locations: <><path d="M19 10c0 5-7 12-7 12S5 15 5 10a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2"/></>,
    "Decision Journal": <path d="M5 3h15v18H5zM9 3v18M3 7h4M3 12h4M3 17h4M12 8h5M12 12h5"/>,
    "Scenario Planner": <><path d="M4 6h5M13 6h7M4 12h10M18 12h2M4 18h2M10 18h10"/><circle cx="11" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/></>,
    Integrations: <path d="M8 3v5M16 3v5M5 8h14v3a7 7 0 0 1-14 0V8ZM12 18v4"/>,
    Settings: <><path d="m9 3-1 3-3 1v3l-2 2 2 2v3l3 1 1 3h6l1-3 3-1v-3l2-2-2-2V7l-3-1-1-3H9Z"/><circle cx="12" cy="12" r="3"/></>,
    Banking: <path d="m3 8 9-5 9 5H3ZM5 10v8M10 10v8M14 10v8M19 10v8M3 21h18"/>,
    Transactions: <path d="M3 7h17l-4-4M21 17H4l4 4M20 7l-4 4M4 17l4-4"/>,
    Reconciliation: <path d="M4 8a8 8 0 0 1 14-3l3 3M21 3v5h-5M20 16a8 8 0 0 1-14 3l-3-3M3 21v-5h5"/>,
    Payroll: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3M14 15h3"/></>,
    Search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    Menu: <path d="M4 6h16M4 12h16M4 18h16"/>,
    Alerts: <path d="M6 9a6 6 0 0 1 12 0v6l2 3H4l2-3V9ZM10 21h4"/>,
    Chevron: <path d="m14 6-6 6 6 6"/>,
  };
  const aliases: Record<string, string> = { Team: "Customers", Overview: "Dashboard", "BookLoQ Assistant": "Advisor", "Chart of Accounts": "Decision Journal", "Journal Entries": "Business Brief", "Audit Trail": "Decision Journal", "Cash Flow": "Intelligence", Invoicing: "Sales", Bills: "Sales", Expenses: "Payroll", "Sales Tax": "Payroll", "Inventory Accounting": "Inventory", "Assets and Loans": "Banking", Budgets: "Scenario Planner", "Month-End": "Action Centre", "Accountant Portal": "Customers" };
  return <svg className={`workspace-icon ${className}`} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[aliases[name] ?? name] ?? paths.Documents}</svg>;
}
