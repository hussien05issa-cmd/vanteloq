# Vanteloq source inventory, October 4, 2026

Static source appendix for the final release audit. No customer data, credential values or live database queries are included. The JSON contains the full column and method records.

Source root: `C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq`.

| Inventory | Exact source count |
| --- | ---: |
| SQLite table names, schema/migration union | 143 |
| SQLite schema declarations / declared columns | 141 / 1688 |
| Migration files / reconstructed current tables | 75 / 143 |
| API route files / explicit method exports | 157 / 219 |
| Feature keys / base plan entries / add-ons | 103 / 5 / 1 |
| Job entries / maintenance lanes / request workflows | 7 / 4 / 2 |
| Parser diagnostics | 0 |

## SQLite tables

Schema-only names: none. Migration-only names: `advisor_preferences`, `advisor_requests`.
Column discrepancy tables: none.

| Table | Columns | Declaration source |
| --- | ---: | --- |
| `access_roles` | 12 | [db/schema.ts:1417](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:1417) |
| `account_deletion_jobs` | 12 | [db/schema.ts:969](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:969) |
| `account_deletion_receipts` | 9 | [db/schema.ts:946](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:946) |
| `account_notifications` | 9 | [db/schema.ts:286](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:286) |
| `account_preferences` | 8 | [db/schema.ts:275](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:275) |
| `accounting_periods` | 10 | [db/schema.ts:1712](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:1712) |
| `advisor_preferences` | 4 | [drizzle/0064_advisor_experience.sql:1](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/drizzle/0064_advisor_experience.sql:1) (migration only) |
| `advisor_requests` | 8 | [drizzle/0064_advisor_experience.sql:8](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/drizzle/0064_advisor_experience.sql:8) (migration only) |
| `assistant_conversations` | 6 | [db/schema.ts:2192](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:2192) |
| `assistant_messages` | 9 | [db/schema.ts:2205](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:2205) |
| `audit_events` | 11 | [db/schema.ts:2152](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:2152) |
| `bank_accounts` | 21 | [db/schema.ts:1891](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:1891) |
| `bank_statement_imports` | 18 | [db/schema.ts:2221](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:2221) |
| `bank_statement_rows` | 3 | [db/schema.ts:2245](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:2245) |
| `billing_checkout_attempts` | 6 | [db/schema.ts:2183](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:2183) |
| `bookloq_alerts` | 17 | [db/schema.ts:2079](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:2079) |
| `bookloq_budgets` | 12 | [db/schema.ts:2108](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:2108) |
| `bookloq_category_rules` | 10 | [db/schema.ts:1869](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:1869) |
| `bookloq_contacts` | 14 | [db/schema.ts:1734](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:1734) |
| `bookloq_role_assignments` | 8 | [db/schema.ts:1663](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:1663) |
| `bookloq_settings` | 12 | [db/schema.ts:1638](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:1638) |
| `bookloq_transaction_matches` | 15 | [db/schema.ts:2047](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:2047) |
| `business_events` | 12 | [db/schema.ts:536](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:536) |
| `business_workflow_records` | 13 | [db/business-workflow-schema.ts:5](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/business-workflow-schema.ts:5) |
| `business_workflow_revisions` | 11 | [db/business-workflow-schema.ts:16](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/business-workflow-schema.ts:16) |
| `cloud_file_connections` | 13 | [db/schema.ts:2336](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:2336) |
| `collection_followup_events` | 7 | [server/workflow-followup-schema.ts:11](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/workflow-followup-schema.ts:11) |
| `collection_followups` | 12 | [server/workflow-followup-schema.ts:5](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/workflow-followup-schema.ts:5) |
| `commerce_customers` | 15 | [db/schema.ts:1152](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:1152) |
| `commerce_payments` | 15 | [db/schema.ts:1239](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:1239) |
| `commerce_products` | 21 | [db/schema.ts:1092](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:1092) |
| `commerce_sale_lines` | 20 | [db/schema.ts:1202](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:1202) |
| `commerce_suppliers` | 15 | [db/schema.ts:1177](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:1177) |
| `complimentary_access` | 6 | [db/schema.ts:266](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:266) |
| `customer_invoice_lines` | 12 | [db/schema.ts:2019](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:2019) |
| `customer_invoices` | 25 | [db/schema.ts:1982](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:1982) |
| `daily_business_metrics` | 22 | [db/schema.ts:391](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:391) |
| `data_imports` | 9 | [db/schema.ts:369](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:369) |
| `dealership_appointments` | 8 | [db/dealership-schema.ts:128](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/dealership-schema.ts:128) |
| `dealership_cost_lines` | 10 | [db/dealership-schema.ts:65](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/dealership-schema.ts:65) |
| `dealership_events` | 7 | [db/dealership-schema.ts:201](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/dealership-schema.ts:201) |
| `dealership_leads` | 11 | [db/dealership-schema.ts:85](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/dealership-schema.ts:85) |
| `dealership_mutations` | 5 | [db/dealership-schema.ts:213](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/dealership-schema.ts:213) |
| `dealership_reservations` | 8 | [db/dealership-schema.ts:145](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/dealership-schema.ts:145) |
| `dealership_sale_credits` | 8 | [db/dealership-schema.ts:186](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/dealership-schema.ts:186) |
| `dealership_sales` | 13 | [db/dealership-schema.ts:161](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/dealership-schema.ts:161) |
| `dealership_stock_episodes` | 22 | [db/dealership-schema.ts:22](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/dealership-schema.ts:22) |
| `dealership_tasks` | 12 | [db/dealership-schema.ts:104](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/dealership-schema.ts:104) |
| `dealership_vehicle_identities` | 8 | [db/dealership-schema.ts:7](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/dealership-schema.ts:7) |
| `dealership_write_guards` | 3 | [db/dealership-schema.ts:223](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/dealership-schema.ts:223) |
| `document_email_aliases` | 10 | [db/schema.ts:2311](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:2311) |
| `document_email_deliveries` | 9 | [db/schema.ts:2318](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:2318) |
| `document_email_sources` | 7 | [db/schema.ts:2323](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:2323) |
| `document_ingest_intents` | 8 | [db/schema.ts:2330](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:2330) |
| `employee_pin_credentials` | 12 | [db/schema.ts:1481](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:1481) |
| `financial_accounts` | 17 | [db/schema.ts:1682](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:1682) |
| `financial_transactions` | 28 | [db/schema.ts:1825](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:1825) |
| `foodservice_records` | 17 | [db/foodservice-schema.ts:5](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/foodservice-schema.ts:5) |
| `foodservice_revisions` | 7 | [db/foodservice-schema.ts:28](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/foodservice-schema.ts:28) |
| `forecasting_runs` | 9 | [db/schema.ts:2389](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:2389) |
| `forecasting_settings` | 5 | [db/schema.ts:2384](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:2384) |
| `forecasting_views` | 4 | [db/schema.ts:2392](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:2392) |
| `free_integration_selections` | 5 | [db/schema.ts:762](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:762) |
| `free_plan_enrollments` | 3 | [db/schema.ts:20](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:20) |
| `free_plan_usage` | 4 | [db/schema.ts:25](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:25) |
| `goods_receipts` | 8 | [db/schema.ts:1600](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:1600) |
| `growth_touchpoints` | 9 | [db/schema.ts:430](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:430) |
| `growth_transactions` | 9 | [db/schema.ts:450](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:450) |
| `integration_connections` | 24 | [db/schema.ts:723](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:723) |
| `integration_consents` | 14 | [db/schema.ts:890](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:890) |
| `integration_location_mappings` | 11 | [db/schema.ts:1008](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:1008) |
| `integration_oauth_states` | 11 | [db/schema.ts:990](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:990) |
| `integration_secrets` | 9 | [db/schema.ts:867](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:867) |
| `integration_source_authorities` | 12 | [db/schema.ts:1392](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:1392) |
| `integration_staged_financial_records` | 19 | [db/schema.ts:1269](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:1269) |
| `integration_staged_sales` | 17 | [db/schema.ts:1060](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:1060) |
| `integration_sync_runs` | 17 | [db/schema.ts:1032](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:1032) |
| `integration_sync_schedules` | 21 | [db/schema.ts:770](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:770) |
| `integration_sync_ticks` | 2 | [db/schema.ts:798](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:798) |
| `integration_webhook_events` | 11 | [db/schema.ts:1311](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:1311) |
| `internal_access` | 10 | [db/schema.ts:244](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:244) |
| `inventory_balances` | 11 | [db/schema.ts:584](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:584) |
| `inventory_lot_movements` | 10 | [db/schema.ts:675](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:675) |
| `inventory_lots` | 26 | [db/schema.ts:631](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:631) |
| `inventory_movements` | 9 | [db/schema.ts:607](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:607) |
| `inventory_vehicles` | 20 | [db/schema.ts:2396](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:2396) |
| `invoice_matches` | 10 | [db/schema.ts:1615](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:1615) |
| `journal_entries` | 21 | [db/schema.ts:1760](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:1760) |
| `journal_lines` | 15 | [db/schema.ts:1798](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:1798) |
| `legal_acceptances` | 12 | [db/schema.ts:920](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:920) |
| `linked_files` | 19 | [db/schema.ts:2356](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:2356) |
| `marketing_calendar_entries` | 13 | [db/schema.ts:513](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:513) |
| `marketing_daily_metrics` | 8 | [db/schema.ts:846](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:846) |
| `marketing_email_events` | 10 | [db/schema.ts:2286](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:2286) |
| `marketing_email_intents` | 8 | [db/schema.ts:2258](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:2258) |
| `marketing_email_preferences` | 6 | [db/schema.ts:2273](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:2273) |
| `marketing_email_unsubscribe_tokens` | 4 | [db/schema.ts:2303](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:2303) |
| `marketing_profiles` | 12 | [db/schema.ts:491](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:491) |
| `marketing_resource_selections` | 13 | [db/schema.ts:816](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:816) |
| `memberships` | 7 | [db/schema.ts:139](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:139) |
| `month_end_items` | 11 | [db/schema.ts:2130](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:2130) |
| `onboarding_drafts` | 5 | [db/schema.ts:2459](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:2459) |
| `operational_events` | 10 | [db/schema.ts:562](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:562) |
| `opportunity_review_events` | 8 | [db/schema.ts:355](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:355) |
| `opportunity_reviews` | 16 | [db/schema.ts:331](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:331) |
| `organization_locations` | 21 | [db/schema.ts:1355](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:1355) |
| `organization_profiles` | 13 | [db/schema.ts:1335](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:1335) |
| `organizations` | 24 | [db/schema.ts:59](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:59) |
| `outbound_messages` | 14 | [db/schema.ts:697](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:697) |
| `purchase_order_lines` | 20 | [db/schema.ts:1567](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:1567) |
| `purchase_orders` | 20 | [db/schema.ts:1536](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:1536) |
| `rate_limit_buckets` | 6 | [db/schema.ts:2174](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:2174) |
| `reconciliations` | 16 | [db/schema.ts:1924](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:1924) |
| `retail_measurements` | 14 | [db/schema.ts:1129](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:1129) |
| `search_visibility_observations` | 9 | [db/schema.ts:470](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:470) |
| `sector_operation_records` | 14 | [server/sector-operations-schema.ts:5](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/sector-operations-schema.ts:5) |
| `sector_operation_requests` | 9 | [server/sector-operations-schema.ts:32](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/sector-operations-schema.ts:32) |
| `sector_operation_revisions` | 11 | [server/sector-operations-schema.ts:24](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/sector-operations-schema.ts:24) |
| `sector_room_nights` | 5 | [server/sector-operations-schema.ts:40](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/sector-operations-schema.ts:40) |
| `shopify_privacy_requests` | 16 | [db/schema.ts:2426](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:2426) |
| `shopify_store_locks` | 4 | [db/schema.ts:803](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:803) |
| `stripe_billing_events` | 9 | [db/schema.ts:224](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:224) |
| `supplier_bills` | 19 | [db/schema.ts:1952](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:1952) |
| `tasks` | 11 | [db/schema.ts:45](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:45) |
| `team_members` | 29 | [db/schema.ts:1440](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:1440) |
| `tenant_addons` | 11 | [db/schema.ts:200](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:200) |
| `tenant_subscriptions` | 21 | [db/schema.ts:159](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:159) |
| `users` | 8 | [db/schema.ts:86](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:86) |
| `workflow_deliveries` | 21 | [server/workflow-followup-schema.ts:19](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/workflow-followup-schema.ts:19) |
| `workflow_delivery_preferences` | 12 | [server/workflow-followup-schema.ts:14](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/workflow-followup-schema.ts:14) |
| `workflow_inventory_guards` | 3 | [server/workflow-inventory-schema.ts:46](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/workflow-inventory-schema.ts:46) |
| `workflow_inventory_history` | 7 | [server/workflow-inventory-schema.ts:35](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/workflow-inventory-schema.ts:35) |
| `workflow_inventory_movements` | 9 | [server/workflow-inventory-schema.ts:14](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/workflow-inventory-schema.ts:14) |
| `workflow_inventory_mutations` | 6 | [server/workflow-inventory-schema.ts:41](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/workflow-inventory-schema.ts:41) |
| `workflow_inventory_positions` | 11 | [server/workflow-inventory-schema.ts:6](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/workflow-inventory-schema.ts:6) |
| `workflow_inventory_receipts` | 11 | [server/workflow-inventory-schema.ts:21](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/workflow-inventory-schema.ts:21) |
| `workflow_inventory_records` | 10 | [server/workflow-inventory-schema.ts:28](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/workflow-inventory-schema.ts:28) |
| `workspace_documents` | 18 | [db/schema.ts:1504](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:1504) |
| `workspace_industry_config` | 6 | [db/schema.ts:2449](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:2449) |
| `workspace_industry_history` | 7 | [db/schema.ts:2454](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:2454) |
| `workspace_sessions` | 7 | [db/schema.ts:33](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:33) |
| `workspace_tasks` | 15 | [db/schema.ts:301](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:301) |
| `workspaces` | 23 | [db/schema.ts:106](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/db/schema.ts:106) |

Columns and their SQLite builder types are listed in the adjacent JSON. Column constraints and migration runtime state are outside this inventory.

## API routes and explicit methods

Method export counts: GET 84, POST 120, PUT 1, PATCH 6, DELETE 8, HEAD 0, OPTIONS 0.

| Route pattern | Methods | Source |
| --- | --- | --- |
| `/api/health` | GET | [app/api/health/route.ts:3](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/health/route.ts:3) |
| `/api/internal/pos-sync` | POST | [app/api/internal/pos-sync/route.ts:3](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/internal/pos-sync/route.ts:3) |
| `/api/readiness` | GET | [app/api/readiness/route.ts:4](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/readiness/route.ts:4) |
| `/api/v1/account/deletion/plan` | POST | [app/api/v1/account/deletion/plan/route.ts:6](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/account/deletion/plan/route.ts:6) |
| `/api/v1/account/deletion/resume` | POST | [app/api/v1/account/deletion/resume/route.ts:4](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/account/deletion/resume/route.ts:4) |
| `/api/v1/account/deletion` | GET, POST | [app/api/v1/account/deletion/route.ts:25](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/account/deletion/route.ts:25) |
| `/api/v1/address` | GET, POST | [app/api/v1/address/route.ts:13](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/address/route.ts:13) |
| `/api/v1/advisor/chat` | GET, POST, DELETE | [app/api/v1/advisor/chat/route.ts:159](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/advisor/chat/route.ts:159) |
| `/api/v1/advisor/consent` | GET, POST, DELETE | [app/api/v1/advisor/consent/route.ts:8](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/advisor/consent/route.ts:8) |
| `/api/v1/advisor/conversations` | GET, DELETE, PATCH | [app/api/v1/advisor/conversations/route.ts:23](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/advisor/conversations/route.ts:23) |
| `/api/v1/advisor/preferences` | GET, PUT, DELETE | [app/api/v1/advisor/preferences/route.ts:6](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/advisor/preferences/route.ts:6) |
| `/api/v1/auth/signin` | POST | [app/api/v1/auth/signin/route.ts:31](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/auth/signin/route.ts:31) |
| `/api/v1/auth/signup` | GET | [app/api/v1/auth/signup/route.ts:22](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/auth/signup/route.ts:22) |
| `/api/v1/backend` | GET | [app/api/v1/backend/route.ts:6](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/backend/route.ts:6) |
| `/api/v1/billing/checkout` | POST | [app/api/v1/billing/checkout/route.ts:11](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/billing/checkout/route.ts:11) |
| `/api/v1/billing/free` | POST | [app/api/v1/billing/free/route.ts:11](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/billing/free/route.ts:11) |
| `/api/v1/billing/portal` | POST | [app/api/v1/billing/portal/route.ts:9](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/billing/portal/route.ts:9) |
| `/api/v1/billing` | GET | [app/api/v1/billing/route.ts:15](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/billing/route.ts:15) |
| `/api/v1/billing/stripe/webhook` | POST | [app/api/v1/billing/stripe/webhook/route.ts:16](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/billing/stripe/webhook/route.ts:16) |
| `/api/v1/bookloq/actions` | POST | [app/api/v1/bookloq/actions/route.ts:28](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/bookloq/actions/route.ts:28) |
| `/api/v1/bookloq/collections` | GET | [app/api/v1/bookloq/collections/route.ts:11](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/bookloq/collections/route.ts:11) |
| `/api/v1/bookloq/demo` | POST | [app/api/v1/bookloq/demo/route.ts:36](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/bookloq/demo/route.ts:36) |
| `/api/v1/bookloq/invoices/email` | POST | [app/api/v1/bookloq/invoices/email/route.ts:28](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/bookloq/invoices/email/route.ts:28) |
| `/api/v1/bookloq/invoices` | POST | [app/api/v1/bookloq/invoices/route.ts:26](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/bookloq/invoices/route.ts:26) |
| `/api/v1/bookloq/journals` | POST, PATCH | [app/api/v1/bookloq/journals/route.ts:44](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/bookloq/journals/route.ts:44) |
| `/api/v1/bookloq` | GET | [app/api/v1/bookloq/route.ts:88](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/bookloq/route.ts:88) |
| `/api/v1/bookloq/setup` | POST | [app/api/v1/bookloq/setup/route.ts:12](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/bookloq/setup/route.ts:12) |
| `/api/v1/bookloq/statements` | GET, POST | [app/api/v1/bookloq/statements/route.ts:20](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/bookloq/statements/route.ts:20) |
| `/api/v1/business-workflows` | GET, POST | [app/api/v1/business-workflows/route.ts:4](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/business-workflows/route.ts:4) |
| `/api/v1/command-centre` | GET | [app/api/v1/command-centre/route.ts:605](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/command-centre/route.ts:605) |
| `/api/v1/commerce-intelligence` | GET | [app/api/v1/commerce-intelligence/route.ts:27](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/commerce-intelligence/route.ts:27) |
| `/api/v1/commerce` | GET | [app/api/v1/commerce/route.ts:9](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/commerce/route.ts:9) |
| `/api/v1/communications/config` | GET | [app/api/v1/communications/config/route.ts:3](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/communications/config/route.ts:3) |
| `/api/v1/communications/preferences` | GET, POST | [app/api/v1/communications/preferences/route.ts:3](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/communications/preferences/route.ts:3) |
| `/api/v1/communications/signup-intent` | POST | [app/api/v1/communications/signup-intent/route.ts:3](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/communications/signup-intent/route.ts:3) |
| `/api/v1/communications/unsubscribe` | POST | [app/api/v1/communications/unsubscribe/route.ts:5](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/communications/unsubscribe/route.ts:5) |
| `/api/v1/custom-plan` | GET, POST | [app/api/v1/custom-plan/route.ts:5](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/custom-plan/route.ts:5) |
| `/api/v1/daily-metrics` | GET, POST | [app/api/v1/daily-metrics/route.ts:17](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/daily-metrics/route.ts:17) |
| `/api/v1/data-quality` | GET | [app/api/v1/data-quality/route.ts:26](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/data-quality/route.ts:26) |
| `/api/v1/dealership` | GET, POST | [app/api/v1/dealership/route.ts:19](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/dealership/route.ts:19) |
| `/api/v1/documents/email/deliver` | POST | [app/api/v1/documents/email/deliver/route.ts:4](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/documents/email/deliver/route.ts:4) |
| `/api/v1/documents/email` | GET, POST | [app/api/v1/documents/email/route.ts:28](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/documents/email/route.ts:28) |
| `/api/v1/documents` | GET, POST, PATCH, DELETE | [app/api/v1/documents/route.ts:65](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/documents/route.ts:65) |
| `/api/v1/entitlements` | GET | [app/api/v1/entitlements/route.ts:7](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/entitlements/route.ts:7) |
| `/api/v1/events` | GET, POST | [app/api/v1/events/route.ts:16](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/events/route.ts:16) |
| `/api/v1/foodservice` | GET, POST | [app/api/v1/foodservice/route.ts:5](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/foodservice/route.ts:5) |
| `/api/v1/forecasting` | GET, POST | [app/api/v1/forecasting/route.ts:16](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/forecasting/route.ts:16) |
| `/api/v1/governance` | GET, POST | [app/api/v1/governance/route.ts:281](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/governance/route.ts:281) |
| `/api/v1/growth` | GET, POST | [app/api/v1/growth/route.ts:92](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/growth/route.ts:92) |
| `/api/v1/industry-configuration` | GET, POST | [app/api/v1/industry-configuration/route.ts:8](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/industry-configuration/route.ts:8) |
| `/api/v1/integrations/clover/authorize` | POST | [app/api/v1/integrations/clover/authorize/route.ts:18](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/clover/authorize/route.ts:18) |
| `/api/v1/integrations/clover/callback` | GET | [app/api/v1/integrations/clover/callback/route.ts:27](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/clover/callback/route.ts:27) |
| `/api/v1/integrations/clover/disconnect` | POST | [app/api/v1/integrations/clover/disconnect/route.ts:12](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/clover/disconnect/route.ts:12) |
| `/api/v1/integrations/clover/locations` | GET, POST | [app/api/v1/integrations/clover/locations/route.ts:28](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/clover/locations/route.ts:28) |
| `/api/v1/integrations/clover/sync` | POST | [app/api/v1/integrations/clover/sync/route.ts:7](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/clover/sync/route.ts:7) |
| `/api/v1/integrations/clover/webhook` | POST | [app/api/v1/integrations/clover/webhook/route.ts:13](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/clover/webhook/route.ts:13) |
| `/api/v1/integrations/deel/authorize` | POST | [app/api/v1/integrations/deel/authorize/route.ts:17](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/deel/authorize/route.ts:17) |
| `/api/v1/integrations/deel/callback` | GET | [app/api/v1/integrations/deel/callback/route.ts:57](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/deel/callback/route.ts:57) |
| `/api/v1/integrations/deel/disconnect` | POST | [app/api/v1/integrations/deel/disconnect/route.ts:15](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/deel/disconnect/route.ts:15) |
| `/api/v1/integrations/deel/status` | GET | [app/api/v1/integrations/deel/status/route.ts:10](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/deel/status/route.ts:10) |
| `/api/v1/integrations/deel/sync` | POST | [app/api/v1/integrations/deel/sync/route.ts:8](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/deel/sync/route.ts:8) |
| `/api/v1/integrations/google/authorize` | POST | [app/api/v1/integrations/google/authorize/route.ts:3](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/google/authorize/route.ts:3) |
| `/api/v1/integrations/google/business-profile/reviews` | GET, POST | [app/api/v1/integrations/google/business-profile/reviews/route.ts:5](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/google/business-profile/reviews/route.ts:5) |
| `/api/v1/integrations/google/callback` | GET | [app/api/v1/integrations/google/callback/route.ts:3](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/google/callback/route.ts:3) |
| `/api/v1/integrations/google/disconnect` | POST | [app/api/v1/integrations/google/disconnect/route.ts:3](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/google/disconnect/route.ts:3) |
| `/api/v1/integrations/google/resources` | POST | [app/api/v1/integrations/google/resources/route.ts:5](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/google/resources/route.ts:5) |
| `/api/v1/integrations/google/sync` | POST | [app/api/v1/integrations/google/sync/route.ts:3](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/google/sync/route.ts:3) |
| `/api/v1/integrations/lightspeed-r/authorize` | POST | [app/api/v1/integrations/lightspeed-r/authorize/route.ts:17](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/lightspeed-r/authorize/route.ts:17) |
| `/api/v1/integrations/lightspeed-r/callback` | GET | [app/api/v1/integrations/lightspeed-r/callback/route.ts:29](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/lightspeed-r/callback/route.ts:29) |
| `/api/v1/integrations/lightspeed-r/disconnect` | POST | [app/api/v1/integrations/lightspeed-r/disconnect/route.ts:12](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/lightspeed-r/disconnect/route.ts:12) |
| `/api/v1/integrations/lightspeed-r/shops` | GET, POST | [app/api/v1/integrations/lightspeed-r/shops/route.ts:72](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/lightspeed-r/shops/route.ts:72) |
| `/api/v1/integrations/lightspeed-r/sync` | POST | [app/api/v1/integrations/lightspeed-r/sync/route.ts:7](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/lightspeed-r/sync/route.ts:7) |
| `/api/v1/integrations/lightspeed/authorize` | POST | [app/api/v1/integrations/lightspeed/authorize/route.ts:24](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/lightspeed/authorize/route.ts:24) |
| `/api/v1/integrations/lightspeed/callback` | GET | [app/api/v1/integrations/lightspeed/callback/route.ts:47](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/lightspeed/callback/route.ts:47) |
| `/api/v1/integrations/lightspeed/disconnect` | POST | [app/api/v1/integrations/lightspeed/disconnect/route.ts:22](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/lightspeed/disconnect/route.ts:22) |
| `/api/v1/integrations/lightspeed/outlets` | GET, POST | [app/api/v1/integrations/lightspeed/outlets/route.ts:51](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/lightspeed/outlets/route.ts:51) |
| `/api/v1/integrations/lightspeed/sync` | POST | [app/api/v1/integrations/lightspeed/sync/route.ts:7](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/lightspeed/sync/route.ts:7) |
| `/api/v1/integrations/lightspeed/webhook` | POST | [app/api/v1/integrations/lightspeed/webhook/route.ts:17](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/lightspeed/webhook/route.ts:17) |
| `/api/v1/integrations/meta/authorize` | POST | [app/api/v1/integrations/meta/authorize/route.ts:3](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/meta/authorize/route.ts:3) |
| `/api/v1/integrations/meta/callback` | GET | [app/api/v1/integrations/meta/callback/route.ts:3](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/meta/callback/route.ts:3) |
| `/api/v1/integrations/meta/campaigns` | GET, POST | [app/api/v1/integrations/meta/campaigns/route.ts:5](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/meta/campaigns/route.ts:5) |
| `/api/v1/integrations/meta/disconnect` | POST | [app/api/v1/integrations/meta/disconnect/route.ts:3](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/meta/disconnect/route.ts:3) |
| `/api/v1/integrations/meta/resources` | POST | [app/api/v1/integrations/meta/resources/route.ts:5](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/meta/resources/route.ts:5) |
| `/api/v1/integrations/meta/sync` | POST | [app/api/v1/integrations/meta/sync/route.ts:3](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/meta/sync/route.ts:3) |
| `/api/v1/integrations/moneris/connect` | POST | [app/api/v1/integrations/moneris/connect/route.ts:13](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/moneris/connect/route.ts:13) |
| `/api/v1/integrations/moneris/disconnect` | POST | [app/api/v1/integrations/moneris/disconnect/route.ts:12](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/moneris/disconnect/route.ts:12) |
| `/api/v1/integrations/moneris/sync` | POST | [app/api/v1/integrations/moneris/sync/route.ts:7](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/moneris/sync/route.ts:7) |
| `/api/v1/integrations/plaid/delete-data` | POST | [app/api/v1/integrations/plaid/delete-data/route.ts:9](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/plaid/delete-data/route.ts:9) |
| `/api/v1/integrations/plaid/disconnect` | POST | [app/api/v1/integrations/plaid/disconnect/route.ts:10](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/plaid/disconnect/route.ts:10) |
| `/api/v1/integrations/plaid/exchange` | POST | [app/api/v1/integrations/plaid/exchange/route.ts:14](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/plaid/exchange/route.ts:14) |
| `/api/v1/integrations/plaid/link-token` | POST | [app/api/v1/integrations/plaid/link-token/route.ts:11](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/plaid/link-token/route.ts:11) |
| `/api/v1/integrations/plaid/sync` | POST | [app/api/v1/integrations/plaid/sync/route.ts:8](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/plaid/sync/route.ts:8) |
| `/api/v1/integrations/plaid/webhook` | POST | [app/api/v1/integrations/plaid/webhook/route.ts:16](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/plaid/webhook/route.ts:16) |
| `/api/v1/integrations/quickbooks/authorize` | POST | [app/api/v1/integrations/quickbooks/authorize/route.ts:22](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/quickbooks/authorize/route.ts:22) |
| `/api/v1/integrations/quickbooks/callback` | GET | [app/api/v1/integrations/quickbooks/callback/route.ts:77](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/quickbooks/callback/route.ts:77) |
| `/api/v1/integrations/quickbooks/disconnect` | POST | [app/api/v1/integrations/quickbooks/disconnect/route.ts:12](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/quickbooks/disconnect/route.ts:12) |
| `/api/v1/integrations` | GET, POST | [app/api/v1/integrations/route.ts:44](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/route.ts:44) |
| `/api/v1/integrations/schedule` | POST | [app/api/v1/integrations/schedule/route.ts:16](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/schedule/route.ts:16) |
| `/api/v1/integrations/shopify-pos/authorize` | POST | [app/api/v1/integrations/shopify-pos/authorize/route.ts:13](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/shopify-pos/authorize/route.ts:13) |
| `/api/v1/integrations/shopify-pos/callback` | GET | [app/api/v1/integrations/shopify-pos/callback/route.ts:14](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/shopify-pos/callback/route.ts:14) |
| `/api/v1/integrations/shopify-pos/disconnect` | POST | [app/api/v1/integrations/shopify-pos/disconnect/route.ts:12](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/shopify-pos/disconnect/route.ts:12) |
| `/api/v1/integrations/shopify-pos/locations` | GET, POST | [app/api/v1/integrations/shopify-pos/locations/route.ts:13](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/shopify-pos/locations/route.ts:13) |
| `/api/v1/integrations/shopify-pos/sync` | POST | [app/api/v1/integrations/shopify-pos/sync/route.ts:8](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/shopify-pos/sync/route.ts:8) |
| `/api/v1/integrations/shopify-pos/webhook` | POST | [app/api/v1/integrations/shopify-pos/webhook/route.ts:16](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/shopify-pos/webhook/route.ts:16) |
| `/api/v1/integrations/shopify/authorize` | POST* | [app/api/v1/integrations/shopify/authorize/route.ts:1](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/shopify/authorize/route.ts:1) |
| `/api/v1/integrations/shopify/callback` | GET* | [app/api/v1/integrations/shopify/callback/route.ts:1](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/shopify/callback/route.ts:1) |
| `/api/v1/integrations/shopify/disconnect` | POST* | [app/api/v1/integrations/shopify/disconnect/route.ts:1](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/shopify/disconnect/route.ts:1) |
| `/api/v1/integrations/shopify/locations` | GET*, POST* | [app/api/v1/integrations/shopify/locations/route.ts:1](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/shopify/locations/route.ts:1) |
| `/api/v1/integrations/shopify/privacy` | GET, POST | [app/api/v1/integrations/shopify/privacy/route.ts:16](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/shopify/privacy/route.ts:16) |
| `/api/v1/integrations/shopify/sync` | POST* | [app/api/v1/integrations/shopify/sync/route.ts:1](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/shopify/sync/route.ts:1) |
| `/api/v1/integrations/shopify/webhook` | POST* | [app/api/v1/integrations/shopify/webhook/route.ts:1](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/shopify/webhook/route.ts:1) |
| `/api/v1/integrations/slack/authorize` | POST | [app/api/v1/integrations/slack/authorize/route.ts:20](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/slack/authorize/route.ts:20) |
| `/api/v1/integrations/slack/callback` | GET | [app/api/v1/integrations/slack/callback/route.ts:103](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/slack/callback/route.ts:103) |
| `/api/v1/integrations/slack/disconnect` | POST | [app/api/v1/integrations/slack/disconnect/route.ts:12](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/slack/disconnect/route.ts:12) |
| `/api/v1/integrations/slack/share-workspace` | POST | [app/api/v1/integrations/slack/share-workspace/route.ts:11](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/slack/share-workspace/route.ts:11) |
| `/api/v1/integrations/slack/status` | GET | [app/api/v1/integrations/slack/status/route.ts:9](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/slack/status/route.ts:9) |
| `/api/v1/integrations/slack/test-notification` | POST | [app/api/v1/integrations/slack/test-notification/route.ts:11](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/slack/test-notification/route.ts:11) |
| `/api/v1/integrations/square/authorize` | POST | [app/api/v1/integrations/square/authorize/route.ts:11](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/square/authorize/route.ts:11) |
| `/api/v1/integrations/square/callback` | GET | [app/api/v1/integrations/square/callback/route.ts:15](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/square/callback/route.ts:15) |
| `/api/v1/integrations/square/disconnect` | POST | [app/api/v1/integrations/square/disconnect/route.ts:12](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/square/disconnect/route.ts:12) |
| `/api/v1/integrations/square/locations` | GET, POST | [app/api/v1/integrations/square/locations/route.ts:18](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/square/locations/route.ts:18) |
| `/api/v1/integrations/square/sync` | POST | [app/api/v1/integrations/square/sync/route.ts:7](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/square/sync/route.ts:7) |
| `/api/v1/integrations/square/webhook` | POST | [app/api/v1/integrations/square/webhook/route.ts:8](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/square/webhook/route.ts:8) |
| `/api/v1/integrations/stripe/authorize` | POST | [app/api/v1/integrations/stripe/authorize/route.ts:17](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/stripe/authorize/route.ts:17) |
| `/api/v1/integrations/stripe/callback` | GET | [app/api/v1/integrations/stripe/callback/route.ts:23](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/stripe/callback/route.ts:23) |
| `/api/v1/integrations/stripe/disconnect` | POST | [app/api/v1/integrations/stripe/disconnect/route.ts:12](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/stripe/disconnect/route.ts:12) |
| `/api/v1/integrations/stripe/sync` | POST | [app/api/v1/integrations/stripe/sync/route.ts:7](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/stripe/sync/route.ts:7) |
| `/api/v1/integrations/stripe/webhook` | POST | [app/api/v1/integrations/stripe/webhook/route.ts:9](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/stripe/webhook/route.ts:9) |
| `/api/v1/internal/team-access` | POST | [app/api/v1/internal/team-access/route.ts:11](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/internal/team-access/route.ts:11) |
| `/api/v1/internal/team-provisioning` | GET | [app/api/v1/internal/team-provisioning/route.ts:10](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/internal/team-provisioning/route.ts:10) |
| `/api/v1/inventory-costs` | POST | [app/api/v1/inventory-costs/route.ts:72](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/inventory-costs/route.ts:72) |
| `/api/v1/inventory-lifecycle` | GET, POST | [app/api/v1/inventory-lifecycle/route.ts:203](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/inventory-lifecycle/route.ts:203) |
| `/api/v1/inventory-workflows` | GET, POST | [app/api/v1/inventory-workflows/route.ts:6](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/inventory-workflows/route.ts:6) |
| `/api/v1/legal/acceptance` | GET, POST | [app/api/v1/legal/acceptance/route.ts:22](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/legal/acceptance/route.ts:22) |
| `/api/v1/linked-files/google-files/callback` | GET | [app/api/v1/linked-files/google-files/callback/route.ts:3](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/linked-files/google-files/callback/route.ts:3) |
| `/api/v1/linked-files/microsoft-files/callback` | GET | [app/api/v1/linked-files/microsoft-files/callback/route.ts:3](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/linked-files/microsoft-files/callback/route.ts:3) |
| `/api/v1/linked-files` | GET, POST | [app/api/v1/linked-files/route.ts:20](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/linked-files/route.ts:20) |
| `/api/v1/locations` | GET | [app/api/v1/locations/route.ts:13](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/locations/route.ts:13) |
| `/api/v1/marketing/reports` | GET | [app/api/v1/marketing/reports/route.ts:9](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/marketing/reports/route.ts:9) |
| `/api/v1/onboarding/draft` | GET, POST, DELETE | [app/api/v1/onboarding/draft/route.ts:7](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/onboarding/draft/route.ts:7) |
| `/api/v1/onboarding` | GET, POST | [app/api/v1/onboarding/route.ts:42](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/onboarding/route.ts:42) |
| `/api/v1/openapi` | GET | [app/api/v1/openapi/route.ts:196](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/openapi/route.ts:196) |
| `/api/v1/operations` | GET, POST | [app/api/v1/operations/route.ts:13](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/operations/route.ts:13) |
| `/api/v1/opportunities` | GET, POST, PATCH | [app/api/v1/opportunities/route.ts:16](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/opportunities/route.ts:16) |
| `/api/v1/organization-logo` | GET, POST, DELETE | [app/api/v1/organization-logo/route.ts:23](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/organization-logo/route.ts:23) |
| `/api/v1/preferences` | GET, POST | [app/api/v1/preferences/route.ts:61](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/preferences/route.ts:61) |
| `/api/v1/purchasing` | GET, POST | [app/api/v1/purchasing/route.ts:866](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/purchasing/route.ts:866) |
| `/api/v1/reports` | GET, POST | [app/api/v1/reports/route.ts:98](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/reports/route.ts:98) |
| `/api/v1/retail-intelligence` | GET | [app/api/v1/retail-intelligence/route.ts:6](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/retail-intelligence/route.ts:6) |
| `/api/v1/retail-measurements` | GET, POST | [app/api/v1/retail-measurements/route.ts:27](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/retail-measurements/route.ts:27) |
| `/api/v1/sector-operations` | GET, POST | [app/api/v1/sector-operations/route.ts:4](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/sector-operations/route.ts:4) |
| `/api/v1/session` | GET, POST, DELETE | [app/api/v1/session/route.ts:7](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/session/route.ts:7) |
| `/api/v1/tasks` | GET, POST, PATCH | [app/api/v1/tasks/route.ts:40](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/tasks/route.ts:40) |
| `/api/v1/team-invitations` | GET, POST | [app/api/v1/team-invitations/route.ts:12](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/team-invitations/route.ts:12) |
| `/api/v1/vehicles` | GET, POST, PATCH | [app/api/v1/vehicles/route.ts:61](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/vehicles/route.ts:61) |
| `/api/v1/workflow-followup` | GET, POST | [app/api/v1/workflow-followup/route.ts:5](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/workflow-followup/route.ts:5) |
| `/api/v1/workspaces` | GET | [app/api/v1/workspaces/route.ts:10](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/workspaces/route.ts:10) |

*An asterisk identifies a method reexport. Its delegate source and method are recorded in the JSON. Access requirements are not inferred from method availability.*

## Feature and plan availability

Entitlement catalogue `origin-1`, source [server/entitlements/catalog.ts:1](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/entitlements/catalog.ts:1). New purchases use the month interval.

| Plan entry | Features | Active locations | Users | AI allowance metadata |
| --- | ---: | ---: | ---: | --- |
| Free (`free`) | 9 | 1 | 1 | basic; 10 replies/month |
| Starter (`starter`) | 19 | 1 | 3 | basic; monthly metering not launched |
| Growth (`growth`) | 69 | 3 | 10 | advanced; monthly metering not launched |
| Pro (`pro`) | 89 | 10 | 25 | pro; monthly metering not launched |
| BookLoQ (`bookloq`) | 23 | 1 | 3 | basic; monthly metering not launched |
| BookLoQ add-on | 14 | Uses workspace plan | Uses workspace plan | Uses workspace plan |

Free additionally declares two integration providers and 100 imported rows per month. Catalogue grants still require runtime permission, provider and subscription checks. B means standalone BookLoQ; BA means the BookLoQ add-on.

| Feature key | Free | Starter | Growth | Pro | B | BA |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| `dashboard.core` | Yes | Yes | Yes | Yes | Yes |  |
| `business.profile` | Yes | Yes | Yes | Yes | Yes |  |
| `business.settings` | Yes | Yes | Yes | Yes | Yes |  |
| `business.brief.basic` |  | Yes | Yes | Yes |  |  |
| `operations.basic` |  | Yes | Yes | Yes |  |  |
| `communications.basic` |  | Yes | Yes | Yes |  |  |
| `pos.reporting.core` |  | Yes | Yes | Yes | Yes |  |
| `analytics.sales.basic` | Yes | Yes | Yes | Yes |  |  |
| `analytics.sales.advanced` |  |  | Yes | Yes |  |  |
| `products.basic` | Yes | Yes | Yes | Yes |  |  |
| `products.margin` | Yes | Yes | Yes | Yes |  |  |
| `products.location_performance` |  |  |  | Yes |  |  |
| `inventory.basic` |  | Yes | Yes | Yes |  |  |
| `inventory.lots` |  |  | Yes | Yes |  |  |
| `inventory.expiry` |  |  | Yes | Yes |  |  |
| `inventory.shelf_life` |  |  | Yes | Yes |  |  |
| `inventory.fefo` |  |  | Yes | Yes |  |  |
| `inventory.turnover` |  |  | Yes | Yes |  |  |
| `inventory.sell_through` |  |  | Yes | Yes |  |  |
| `inventory.velocity` |  |  | Yes | Yes |  |  |
| `inventory.days_on_hand` |  |  | Yes | Yes |  |  |
| `inventory.dead_stock` |  |  | Yes | Yes |  |  |
| `inventory.stockout_risk` |  |  | Yes | Yes |  |  |
| `inventory.reorder_ai` |  |  | Yes | Yes |  |  |
| `inventory.bring_back` |  |  | Yes | Yes |  |  |
| `inventory.assortment` |  |  | Yes | Yes |  |  |
| `inventory.opportunity` |  |  | Yes | Yes |  |  |
| `inventory.transfers` |  |  |  | Yes |  |  |
| `supplier.analytics` |  |  | Yes | Yes |  |  |
| `supplier.cost_trends` |  |  | Yes | Yes |  |  |
| `supplier.lead_time` |  |  | Yes | Yes |  |  |
| `supplier.fill_rate` |  |  | Yes | Yes |  |  |
| `supplier.reliability` |  |  | Yes | Yes |  |  |
| `invoice.basic` |  | Yes | Yes | Yes | Yes |  |
| `invoice.extraction` |  |  | Yes | Yes |  |  |
| `invoice.matching` |  |  | Yes | Yes |  |  |
| `invoice.discrepancy` |  |  | Yes | Yes |  |  |
| `invoice.credit_opportunities` |  |  | Yes | Yes |  |  |
| `calendar.basic` |  | Yes | Yes | Yes |  |  |
| `calendar.automation` |  |  | Yes | Yes |  |  |
| `marketing.overview` |  | Yes | Yes | Yes |  |  |
| `marketing.google_business` |  | Yes | Yes | Yes |  |  |
| `marketing.google_ads` |  |  | Yes | Yes |  |  |
| `marketing.google_analytics` |  |  | Yes | Yes |  |  |
| `marketing.meta_ads` |  |  | Yes | Yes |  |  |
| `marketing.search_intelligence` |  |  | Yes | Yes |  |  |
| `marketing.profit_attribution` |  |  | Yes | Yes |  |  |
| `marketing.inventory_aware` |  |  | Yes | Yes |  |  |
| `marketing.optimization` |  |  |  | Yes |  |  |
| `marketing.advanced_attribution` |  |  |  | Yes |  |  |
| `marketing.channel_allocation` |  |  |  | Yes |  |  |
| `growth.strategy` |  |  | Yes | Yes |  |  |
| `growth.strategy_graph` |  |  | Yes | Yes |  |  |
| `growth.goals` |  |  | Yes | Yes |  |  |
| `growth.opportunities` |  |  | Yes | Yes |  |  |
| `pulse` |  |  | Yes | Yes |  |  |
| `exceptions` |  |  | Yes | Yes |  |  |
| `forecasting.revenue` |  |  | Yes | Yes |  |  |
| `forecasting.demand` |  |  | Yes | Yes |  |  |
| `forecasting.inventory` |  |  | Yes | Yes |  |  |
| `forecasting.cash_basic` |  |  | Yes | Yes |  |  |
| `forecasting.advanced` |  |  |  | Yes |  |  |
| `forecasting.scenarios` |  |  |  | Yes |  |  |
| `forecasting.future_obligations` |  |  |  | Yes |  |  |
| `ai.basic` | Yes | Yes | Yes | Yes | Yes |  |
| `ai.advanced` |  |  | Yes | Yes |  |  |
| `ai.pro` |  |  |  | Yes |  |  |
| `ai.tools.sales` |  |  | Yes | Yes |  |  |
| `ai.tools.inventory` |  |  | Yes | Yes |  |  |
| `ai.tools.products` |  |  | Yes | Yes |  |  |
| `ai.tools.marketing` |  |  | Yes | Yes |  |  |
| `ai.tools.suppliers` |  |  | Yes | Yes |  |  |
| `ai.tools.invoices` |  |  | Yes | Yes |  |  |
| `ai.tools.customers` |  |  | Yes | Yes |  |  |
| `ai.tools.strategy` |  |  | Yes | Yes |  |  |
| `multi_location.basic` | Yes | Yes | Yes | Yes | Yes |  |
| `multi_location.advanced` |  |  |  | Yes |  |  |
| `multi_location.benchmarking` |  |  |  | Yes |  |  |
| `multi_location.forecasting` |  |  |  | Yes |  |  |
| `multi_location.marketing` |  |  |  | Yes |  |  |
| `reporting.basic` | Yes | Yes | Yes | Yes | Yes |  |
| `reporting.advanced` |  |  |  | Yes |  |  |
| `reporting.exports` |  |  |  | Yes |  |  |
| `reporting.custom_dashboards` |  |  |  | Yes |  |  |
| `workflow.advanced` |  |  |  | Yes |  |  |
| `workflow.rules` |  |  |  | Yes |  |  |
| `permissions.standard` |  | Yes | Yes | Yes | Yes |  |
| `permissions.advanced` |  |  |  | Yes |  |  |
| `support.priority` |  |  |  | Yes |  |  |
| `bookloq` |  |  |  |  | Yes | Yes |
| `bookloq.dashboard` |  |  |  |  | Yes | Yes |
| `bookloq.chart_of_accounts` |  |  |  |  | Yes | Yes |
| `bookloq.transactions` |  |  |  |  | Yes | Yes |
| `bookloq.expenses` |  |  |  |  | Yes | Yes |
| `bookloq.documents` |  |  |  |  | Yes | Yes |
| `bookloq.ap` |  |  |  |  | Yes | Yes |
| `bookloq.ar` |  |  |  |  | Yes | Yes |
| `bookloq.reconciliation` |  |  |  |  | Yes | Yes |
| `bookloq.financial_statements` |  |  |  |  | Yes | Yes |
| `bookloq.cash_intelligence` |  |  |  |  | Yes | Yes |
| `bookloq.anomaly_detection` |  |  |  |  | Yes | Yes |
| `bookloq.accountant_access` |  |  |  |  | Yes | Yes |
| `bookloq.ai` |  |  |  |  | Yes | Yes |

## Background jobs and event handlers

- `signed_maintenance_tick` (http_orchestrator), [server/integrations/sync-scheduler.ts:121](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/integrations/sync-scheduler.ts:121). Trigger: POST /api/internal/pos-sync with timestamp, HMAC signature, nonce and exact {} body. Rejects replayed nonces; expires tick receipts after 24 hours; starts four independently bounded maintenance lanes.
- `due_pos_sync` (maintenance_lane), [server/integrations/sync-scheduler.ts:150](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/integrations/sync-scheduler.ts:150). Trigger: Accepted signed maintenance tick. Processes at most three due enabled connection schedules per tick, with leases, oldest-due ordering and current authorization checks. Per-connection default next interval is 900 seconds; unfinished backfill defaults to 60 seconds. Retry timing and pause rules are defined in sync-policy.ts. Provider keys: `lightspeed-r`, `lightspeed`, `square`, `clover`, `shopify-pos`, `shopify`, `moneris`, `stripe`.
- `document_disposal_cleanup` (maintenance_lane), [server/document-cleanup-scheduler.ts:52](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/document-cleanup-scheduler.ts:52). Trigger: Accepted signed maintenance tick. Resumes previously authorized document disposal with leases and tenant fairness. Shares a three-job ceiling with cleanup of known disposable failed ingestion writes.
- `expired_rate_limit_cleanup` (maintenance_lane), [server/rate-limit-maintenance.ts:2](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/rate-limit-maintenance.ts:2). Trigger: Accepted signed maintenance tick. Deletes at most 500 expired rate-limit rows per tick.
- `workflow_followup_delivery` (maintenance_lane), [server/workflow-followup.ts:209](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/workflow-followup.ts:209). Trigger: Accepted signed maintenance tick. Checks at most three enabled preferences that were last checked more than 60 seconds ago; processes at most two due deliveries, with leases, current authority, quiet hours and a four-attempt ceiling.
- `external_signed_tick_dispatch` (documented_external_dispatch), [docs/pos-scheduler-function.sql:1](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/docs/pos-scheduler-function.sql:1). Trigger: External database scheduler must call the documented SQL function; schedule activation is not proven by source. SQL dispatch function signs a nonce-bound {} request to /api/internal/pos-sync. This source defines no cron schedule or invocation interval.
- `incoming_document_email` (email_event_worker), [email-worker/worker.ts:14](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/email-worker/worker.ts:14). Trigger: Cloudflare incoming email event. Parses bounded inbound MIME and signs a constrained document ingestion request. An event handler, not periodic maintenance; deployment activation is not proven by source.

Request-started resumable workflows are separate from scheduled work:

- `account_deletion`, [server/account-deletion.ts:165](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/account-deletion.ts:165). Authorized deletion/resume HTTP requests. Resumes an authorized deletion plan under a lease and rechecks current ownership. Uses an on-demand identity cleanup bridge. Not invoked by the maintenance tick.
- `document_processing`, [server/document-processing.ts:116](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/document-processing.ts:116). Authorized document processing HTTP request. Resumable scan/OCR processing initiated by an authorized request. Cleanup retries are included in the maintenance lane above.

## Parser boundaries and verification limits

- This is a static source inventory taken during the final implementation audit. It does not query SQLite, customer records, providers, billing, worker deployments or hosting configuration.
- SQLite declarations are found with TypeScript AST inspection of db and server. Columns include literal text/integer/real/blob/numeric builders. SQL migration replay recognizes CREATE TABLE, DROP TABLE, ALTER TABLE ADD/DROP COLUMN and RENAME TABLE/COLUMN, in migration journal order where available. It does not execute SQL or validate indexes, triggers, defaults, constraints, data migrations or migration application state.
- Migration-only names and schema/migration column discrepancies are reported explicitly. Legacy tables retained by source are included. Transient migration rebuild names that are subsequently dropped or renamed are excluded from current table counts.
- API counts include explicit HTTP method exports in app/api route files, including reexports. They exclude implicit framework HEAD/OPTIONS methods, generated routes, middleware and pages. Bracket segments are source route patterns. Exported methods do not establish public accessibility or successful authorization.
- Plan availability comes from the self-contained entitlement catalogue. It identifies catalogue grants, not proof that a feature is implemented, enabled for a provider, permitted by a role, provisioned or covered by an active subscription. Standalone BookLoQ and the BookLoQ add-on are separate entries. Special access and runtime entitlement overrides are outside this matrix.
- Background job entries count the orchestrator, its four maintenance lanes, the documented external dispatch function and the incoming email worker. Request-started resumable workflows are listed separately. No active external scheduler, actual cadence or email-worker activation was verified.

