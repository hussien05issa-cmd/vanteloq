# Basic vehicle inventory

Inventory → Vehicles records user-reviewed stock. Dealership onboarding opens the vehicle view by default; other industries retain Products as their default. No provider feed, automated VIN lookup, title/ownership verification, vehicle financing, sales posting, ledger posting or forecast input is implied.

## Record contract

`inventory_vehicles` is owned by a workspace and an active, authorized organization location. Required fields are identifier type, identifier, model year, make, model, workspace-unique stock number, status and acquisition date. Currency must match the location. Optional acquisition and reconditioning costs use nonnegative integer cents; null means unknown and zero means a recorded zero. Each optional amount is capped at 1,000,000,000 cents (10,000,000.00 currency units).

VIN mode validates exactly 17 uppercase letters/digits excluding I, O and Q. It does not decode year, make or model, check ownership/history, or claim a VIN was independently verified. Legacy mode is explicitly labelled and available only for model years before 1981, with a 1–40 character identifier. Model years range from 1886 through the current year plus two. Make is at most 80 characters, model 120, stock number 40. Acquisition dates must be real calendar dates; future acquisitions are not planned-stock records. Statuses are available, reconditioning, reserved, sold and archived. Sold does not supply a disposal date, revenue or payment evidence.

Identifiers and stock numbers are unique within the workspace, including sold/archived records, so relocation and status changes use the existing record. Update requests include expectedVersion; conflicts return 409. Moving a vehicle requires access to both its old and new locations. Costs cannot silently change currency; recorded costs must first be cleared in the original currency before a transfer to a different currency.

## Permissions and endpoints

- All requests: fresh authenticated AAL2 workspace session, membership and active service, completed setup, the existing Inventory `inventory.lots` entitlement and `inventory.view` permission. Location scopes apply to lists, edits, previews, imports and exports. Plan availability follows the existing Inventory workspace; this feature does not widen Starter access.
- Create/update: `inventory.adjust`; cost entry and unredacted cost reads additionally require `inventory.value`. An editor without cost access can change stock metadata without erasing hidden costs.
- CSV preview/confirm: `data.import` plus the edit permissions. Exact template columns, at most 100 rows and 100 KB; no multiline fields. Optional amounts use decimals with at most two places and no grouping/currency symbols. Preview writes nothing. Confirm reparses and reauthorizes the payload and requires the preview fingerprint for the same user, workspace, location and normalized rows. All rows are inserted in one atomic batch. Imports only create; they never silently overwrite an existing VIN or stock number.
- `GET /api/v1/vehicles?locationId=...`: 100 rows per page, `after` cursor, authorized locations and capability flags. Returns cost fields as null without cost permission. No cross-tenant rows or inactive locations are returned.
- `POST /api/v1/vehicles`: `action=create` with a vehicle, or `action=preview/confirm` with CSV and locationId; confirmation also carries fingerprint.
- `PATCH /api/v1/vehicles`: id, locationId, expectedVersion and vehicle.
- `GET /api/v1/vehicles?format=csv&locationId=...`: requires `reports.export` and `reporting.exports` in addition to read access; at most 5,000 scoped rows. Export includes record/location identifiers, location name, source, version and creation/update timestamps. Restricted cost columns are omitted. The shared CSV encoder neutralizes spreadsheet formulas. Responses use no-store. The export is downloaded to the user, never sent to another service.
- Limits: reads 90/user/minute, writes/previews 40/user/hour; create bodies 120 KB maximum, updates 8 KB. Client reads time out after 15 seconds, writes/exports after 20 seconds. An uncertain save is resolved by reloading; unique constraints prevent duplicates, and versions prevent stale overwrites.

## Retention and evidence

Raw CSV files are not persisted. Normalized reviewed rows retain manual/CSV source, nullable creator/updater references, timestamps and version. Audit events contain counts, source and internal record IDs, not VINs, make/model strings or monetary values. Individual account deletion nulls creator/updater references while preserving shared workspace stock. Workspace deletion explicitly removes vehicle rows and also has foreign-key cascade protection; location deletion cascades its vehicle records. No vehicle details are added to advisor evidence or external provider payloads.

Migration: `0066_vehicle_inventory.sql`. The schema includes tenant/location integrity triggers, workspace-wide unique keys and cost constraints. Unit coverage lives in `tests/vehicles.test.ts`; built API coverage in `tests/vehicles-flow.test.mjs` covers tenant/location access, money redaction, revoked permissions, subscription and MFA checks, preview/confirm, duplicate protection, optimistic concurrency and deletion isolation. Runtime tests require the current stable build and must run serially with other Miniflare tests.
