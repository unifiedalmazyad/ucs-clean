# Unified Contract System (العقد الموحد)

## Overview

A production-ready Arabic contract/work order management system with RTL (right-to-left) UI support. The system manages work orders through configurable stages, enforces role-based column-level permissions, and tracks KPI metrics with SLA tracking.

Key features:
- Work order lifecycle management with configurable stages
- Dynamic column permissions per role (read/write granularity)
- KPI/SLA tracking per work order with status indicators (OK/WARN/OVERDUE)
- Admin panel for managing users, regions, sectors, columns, column groups, and permissions
- Dual database support: SQLite (demo/dev) and PostgreSQL (production)
- Full bilingual Arabic/English UI — all pages support live switching via `useLang()` hook (LangContext), with `dir` toggling between `rtl`/`ltr`
- Import/Export: Excel-based bulk import with Preview→Commit flow, template download, and audit log (Admin only)
- Periodic KPI Report: role-scoped dashboard at `/reports/periodic-kpis` — full metrics engine with configurable averages (periodic_kpi_metrics table), date-basis filter (createdAt or any date column), hide-empty toggle, column picker per table (user_report_column_prefs), metrics mini-badges on region cards, expanded region panel with per-projectType averages, financial tab
- Reports (`/reports`): role-scoped work order export page — column selector, filters (region/sector/KPI status), Excel download, export history log. Respects each user's data scope and column-level read permissions. Separate from raw admin export (`/export-center`).
- Executive Dashboard (`/dashboard/executive`): financial KPI cards (estimated / invoiced / remaining / gap), drill-down paginated tables per card with Excel + PDF export (paginated batches of 100 rows), system settings with sidebar logo upload, dark mode toggle.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Fullstack Single-Server Design
The app runs as a single Express server that:
1. Serves the React SPA via Vite middleware (dev) or static files (prod)
2. Exposes all backend API routes under `/api`
3. The `dev` script runs `tsx backend/src/server.ts` which starts everything

**Entry point:** `backend/src/server.ts`  
**Frontend entry:** `src/main.tsx` → `src/App.tsx`

### Frontend Architecture
- **Framework:** React 19 with TypeScript
- **Routing:** React Router v7 (client-side SPA routing)
- **Styling:** Tailwind CSS v4 (via Vite plugin)
- **Animations:** Motion (Framer Motion successor)
- **HTTP client:** Axios with interceptors for JWT auth and 401 redirect
- **UI direction:** RTL (`dir="rtl"`) on the root layout container
- **State:** Local component state (useState/useEffect), no global state manager
- **Auth guard:** Token presence check in localStorage inside the `Layout` component

**Page structure (`src/pages/`):**
- `Login.tsx` — credential form, stores JWT + user in localStorage
- `Dashboard.tsx` — KPI summary stats
- `WorkOrders.tsx` — list view with column catalog
- `EditWorkOrder.tsx` — tabbed edit form (data + KPIs), uses `/work-orders/:id/edit-context`
- `Admin*` pages — CRUD for users, regions, sectors, columns, column groups, stages, KPIs, permissions

### Backend Architecture
- **Framework:** Express.js with TypeScript (dev: `tsx`; production: pre-compiled ESM via esbuild → `node dist/server/index.js`)
- **ORM:** Drizzle ORM with dual schema support
- **Security:** Helmet, CORS, JWT (jsonwebtoken), bcryptjs for password hashing
- **Route modules (`backend/src/routes/`):**
  - `auth.ts` — login endpoint, issues JWT, logs audit entry
  - `workOrders.ts` — CRUD, applies column permission filtering on output
  - `admin.ts` — all admin CRUD operations, column sync
  - `kpis.ts` — KPI computation per order and dashboard summary

### Database Strategy (Dual Mode)
The system detects database mode at startup:
- **Demo/Dev mode:** `DEMO_MODE=true` or no `DATABASE_URL` → uses SQLite (`better-sqlite3`, file `demo.db`)
- **Production mode:** `DATABASE_URL` set → uses PostgreSQL (`pg`)

Both modes use Drizzle ORM with separate schema files:
- `backend/src/db/schema_pg.ts` — PostgreSQL schema (UUID PKs, timestamps, boolean)
- `backend/src/db/schema_sqlite.ts` — SQLite schema (text PKs with UUID generation, integer booleans)
- `backend/src/db/schema.ts` — re-exports the correct schema based on env
- `backend/src/db/index.ts` — initializes and exports the `db` instance

**Core tables:**
| Table | Purpose |
|-------|---------|
| `users` | App users with roles and region/sector assignments |
| `work_orders` | Main business entity with many typed columns |
| `column_catalog` | Registry of all available columns for work_orders |
| `column_groups` | Groups for organizing columns in UI |
| `column_options` | Dropdown options for select-type columns |
| `role_column_permissions` | Read/write permissions per role per column |
| `user_column_overrides` | Per-user permission overrides (beats role perms) |
| `stages` | Ordered workflow stages (EXEC/FIN categories) |
| `kpi_templates` | KPI definitions with default SLA days |
| `kpi_rules` | Specific KPI rules linking columns with SLA overrides |
| `work_order_kpi_cache` | Cached KPI computation results |
| `audit_logs` | Action audit trail |
| `regions` / `sectors` | Geographic hierarchy |
| `role_definitions` | Dynamic role registry with scope type, permissions, and status |

### Role Management System
Dynamic role creation and management via `/admin/roles`:
- 10 built-in roles: 8 system roles (ADMIN, MANAGER, OPERATOR, COORDINATOR, GIS, FINANCE, ASSISTANT, VIEWER) + 2 hierarchical (SECTOR_MANAGER, REGION_MANAGER)
- `scopeType`: ALL (sees all sectors), OWN_SECTOR (sees own sector's regions), OWN_REGION (sees own region only)
- `canCreateOrder`, `canDeleteOrder`, `canEditExecution` per-role flags
- Custom roles can be created/deleted; system roles are protected
- Role detail page: 3 tabs (الخلاصة/summary, الصلاحيات/column perms, المستخدمون/users)

### Dynamic Column Architecture (Physical Columns)
Admin-added columns are created as **real physical columns** in `work_orders` via `ALTER TABLE`. No more `customFields` JSONB for new data.

**How it works:**
1. Admin adds column → `ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS col_name TYPE` + `is_custom = FALSE` in catalog
2. `filterInput()` splits payload into:
   - `coreFiltered`: keys in `DRIZZLE_WO_COLS` → written via Drizzle ORM
   - `dynamicFiltered`: keys NOT in `DRIZZLE_WO_COLS` → written via raw pool.query UPDATE
3. `dynamicFiltered` is ALSO written to `customFields` JSONB for backward-compatible reads (filterOutput merges customFields)
4. Import/Export/Reports all include all catalog columns automatically

**`DRIZZLE_WO_COLS`** (in `permissionService.ts`): Set of camelCase column names known to Drizzle schema. Anything outside this set that's in the catalog is a "dynamic physical column".

**Startup migration** (`db/index.ts`): Automatically migrates existing `isCustom=true` seed columns (`survey_notes`, `excavation_completion_date`, `electrical_team`, `d9_no`, `execution_notes`, `financial_close_date`) to real physical columns + updates catalog `is_custom = FALSE`.

### Permission System
Two-layer column-level access control:
1. **Role permissions** (`role_column_permissions`): default read/write per role
2. **User overrides** (`user_column_overrides`): individual exceptions that win over role permissions
3. ADMIN role always gets full access regardless of permission records

Permission filtering happens server-side in `backend/src/services/permissionService.ts`:
- `filterOutput()` — strips unreadable columns from query results
- `filterInput()` — strips non-writable columns, returns `{ coreFiltered, dynamicFiltered }`

### KPI Service
`backend/src/services/kpiService.ts` computes KPI status per work order:
- Loads active KPI rules joined with templates
- Reads start/end date column values from work order data (handles Drizzle camelCase mapping via snake→camel conversion)
- Supports three calcModes: `DATES` (day diff), `RATIO` (percentage), `DIFF` (financial difference)
- Returns `nameAr`, `status`, `elapsedDays`, `remainingDays`, `percentValue`
- Respects column read permissions (skips KPIs for columns user can't read); ADMIN always sees all

### camelCase/snake_case Handling
Drizzle ORM returns camelCase keys (e.g., `orderNumber`). All permission filtering and frontend code must handle both:
- `permissionService.ts`: `filterOutput()` builds allow-sets for both snake and camel variants
- `kpiService.ts`: `getWoField()` tries snake then camelCase
- Frontend (`EditWorkOrder.tsx`): `getField()` and `fieldExists()` helpers try both variants

### Seeded Reference Data (PostgreSQL)

**Production Baseline Seed** (exact export from live dev DB, generated 2026-03-08):
- File: `backend/src/db/seed.sql` (72 KB, 554 lines, 465 rows, fully idempotent)
- Runner: `backend/src/scripts/run-seed.ts`
- Run: `npx tsx backend/src/scripts/run-seed.ts`  (requires DATABASE_URL)
- Or:  `psql "$DATABASE_URL" -f backend/src/db/seed.sql`
- Contents:
  - 5 sectors, 9 regions
  - 16 stages (EXEC + FIN categories, seq ordered)
  - 6 column_groups, 40 column_catalog entries
  - 9 KPI templates, 14 KPI rules
  - 12 role_definitions, 342 role_column_permissions
  - 4 integrations (n8n, jisr, odoo, custom)
  - 8 users (admin/admin123 + staff accounts)

Legacy seed script (`backend/src/db/seed_all.ts`) is superseded by the SQL file above.

### Authentication Flow
1. POST `/api/auth/login` → validates credentials, returns JWT (24h expiry)
2. JWT stored in localStorage
3. Axios interceptor attaches `Authorization: Bearer <token>` to all requests
4. Server middleware `authenticate` verifies JWT on all protected routes
5. `authorize(roles[])` middleware guards admin-only routes
6. 401 response → Axios interceptor clears token and redirects to `/login`

### User Roles
`ADMIN`, `MANAGER`, `OPERATOR`, `COORDINATOR`, `GIS`, `FINANCE`

Admin-only sidebar items appear conditionally based on `user.role === 'ADMIN'` from localStorage.

## External Dependencies

### Runtime Services
- **PostgreSQL** (production) — primary database via `pg` driver + Drizzle ORM
- **SQLite** (demo/dev) — local file database via `better-sqlite3` + Drizzle ORM
- **Google Gemini AI** — `@google/genai` package present, API key loaded as `GEMINI_API_KEY` env var (currently scaffolded but not visibly used in reviewed pages)

### Key NPM Dependencies
| Package | Role |
|---------|------|
| `express` | HTTP server |
| `drizzle-orm` + `drizzle-kit` | ORM + migrations |
| `better-sqlite3` | SQLite driver |
| `pg` | PostgreSQL driver |
| `jsonwebtoken` | JWT issuance/verification |
| `bcryptjs` | Password hashing |
| `helmet` | HTTP security headers |
| `cors` | Cross-origin request handling |
| `react-router-dom` v7 | Client-side routing |
| `axios` | HTTP client with interceptors |
| `tailwindcss` v4 | Utility CSS via Vite plugin |
| `motion` | Animation library |
| `lucide-react` | Icon set |
| `date-fns` | Date math for KPI calculations |
| `zod` | Schema validation |
| `tsx` | TypeScript execution for **dev only** (devDependency — not in production image) |
| `esbuild` | Backend bundler for production (transitive via vite; bundles TS → `dist/server/index.js`) |
| `vite` | Frontend bundler + dev server middleware |

### Internal Event System
Lightweight event dispatcher at `backend/src/events/`:
- `eventTypes.ts` — centralized constants: `work_order.created`, `work_order.updated`, `work_order.stage_changed`, `project.completed`, `kpi.alert`, `comment.created`
- `dispatcher.ts` — `emitEvent(type, entityId, user, data)` — logs to console, stores in capped in-memory array (200 events, non-persistent), forwards to bridge
- `integrationBridge.ts` — placeholder for future outbound delivery (n8n, Odoo, custom webhook)
- Hook points: work order POST (created), work order PUT (updated + stage changed), note POST (comment created)
- Non-blocking: wrapped in try/catch, never breaks original request flow

### Integrations Feature
- DB table `integrations` with 4 seed rows: n8n, jisr, odoo, custom
- Backend API at `/api/integrations` (ADMIN only): GET all, GET by id, PUT (with secret masking), POST /:id/test, POST /:id/sync
- Secret masking: apiKey, password, clientSecret, accessToken, refreshToken, webhookSecret shown as `••••••` on read; masked value ignored on write
- Connector stubs at `backend/src/connectors/`: n8n.ts (GET /healthz), jisr.ts (GET /ping), odoo.ts (JSON-RPC), custom.ts (GET base URL)
- Frontend settings page at `/admin/integrations` — 4 expandable cards with full config forms, test/sync buttons, inline notices

### Audit Log Page (`/audit-log`)
- Admin-only page at `/audit-log` accessible from sidebar
- Backend: `backend/src/routes/auditLog.ts` — three endpoints:
  - `GET /api/audit-logs` — paginated list (page, limit, entityType, action, actorUserId, from, to)
  - `GET /api/audit-logs/actors` — distinct actors for filter dropdown
  - `GET /api/audit-logs/meta` — distinct entityTypes and actions for filter dropdowns
  - `GET /api/audit-logs/export` — XLSX export with same filters
- Frontend: `src/pages/AuditLog.tsx` — horizontal filter bar (date range, entity type, action, user), paginated table (50/page), expandable diff rows
- Diff display: for UPDATE shows field-level before→after table; for CREATE shows new fields; for DELETE shows deleted fields
- Action badges colored: CREATE (green), UPDATE (blue), DELETE (red), LOGIN (gray)
- Entity type badges colored: WORK_ORDER (violet), USER (sky), STAGE (teal), etc.
- WORK_ORDER rows show order number (extracted from changes.before/after) with link to work order edit page
- XLSX export: Arabic column headers, human-readable action/entity labels, changed fields summary

### Environment Variables
| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string (absence triggers SQLite demo mode) |
| `DEMO_MODE` | Explicitly force SQLite demo mode (`true`/`false`) |
| `JWT_SECRET` | JWT signing secret (falls back to `fallback_secret`) |
| `GEMINI_API_KEY` | Google Gemini AI API key |
| `PORT` | Server port (default: 3000) |
| `NODE_ENV` | `production` serves static files; otherwise uses Vite middleware |

## Executive Dashboard (`/dashboard/executive`)

### Overview
Financial summary dashboard with 4 KPI cards and drill-down tables.

**Route file:** `backend/src/routes/executiveDashboard.ts`  
**Frontend:** `src/pages/DashboardExecutive.tsx`  
**Sidebar entry:** requires role with `canViewExecutive` permission (or ADMIN)

### KPI Cards
| Card | Arabic | Description |
|------|--------|-------------|
| `estimated` | التقديري | Sum of `contract_value` for all active work orders |
| `invoiced` | المستخلص | Sum of `invoice_1` + `invoice_2` where issued |
| `remaining` | المتبقي المتوقع | Per-row remaining balance (see business logic note below) |
| `gap` | الفجوة | Orders where contract value > invoiced amount |

### API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/dashboard/executive/summary` | Returns all 4 card totals + change % vs prior period |
| `GET` | `/api/dashboard/executive/financial-detail` | Paginated drill-down rows for a specific card |

**financial-detail query params:**
- `card` — `estimated | invoiced | remaining | gap`
- `page` — page number (default 1)
- `limit` — max 100 per page
- `sectors` — comma-separated sector names (optional filter)
- `regionIds` — comma-separated region UUIDs (optional filter)
- `projectType` — single project type string (optional filter)

### Export (Excel / PDF)
Export buttons appear in the drill-down table header once data is loaded.
- Fetches ALL pages (limit=100 per batch) before exporting
- Uses shared `src/utils/reportExporter.ts` (ExcelJS + jsPDF)
- Filename: `تنفيذي_{cardName}_{date}.xlsx|pdf`
- Columns and alignment from `DETAIL_COLS` constant in `DashboardExecutive.tsx`
- Numeric columns → `text-center`; text columns → `text-right` (UI + Excel + PDF)

### reportExporter.ts — Per-Column Alignment
`ReportColumn` interface extended with optional `align?: 'right' | 'center' | 'left'`.  
Used in: Excel data cells, Excel totals row, PDF table body, PDF totals row.  
Default (if `align` omitted): `isAr ? 'right' : 'left'`.

### ⚠️ Known Business Logic Issue — Remaining vs Gap Cards
**Status: Analysis complete, fix NOT yet approved.**

6 rows in the DB have `invoice_type = 'نهائي'` AND `invoice_1 > 0` AND `invoice_2 > 0`.

- The **gap** card logic treats `(invType === 'نهائي' && inv1 > 0)` as "fully invoiced" → these rows do NOT appear in gap.
- The **remaining** card logic uses `perRowRemaining = inv1 > 0 ? inv1 : est` for all "نهائي" rows → these rows DO appear in remaining with `expectedRemaining = inv1`.
- **Contradiction:** the same rows are "fully invoiced" by gap logic but still "have remaining balance" by remaining logic.
- The display/export is correct — it shows exactly what the backend computes.
- Root cause is in `executiveDashboard.ts` remaining-card business logic.
- Do NOT change until business intent is confirmed with user.

## System Settings Updates (2026-04-25)

### Sidebar Logo
- New setting key: `sidebar_logo_url` (stored in `system_settings`)
- Upload endpoint: `POST /api/admin/upload-logo?side=sidebar`
- Read via `GET /api/admin/report-header` → `sidebarLogoUrl` field
- Separate from report logo keys (`logo_right_url`, `logo_left_url`) to avoid collisions

### Design System
- Tailwind CSS v4 with `@theme` overrides — maps `indigo-*` → slate palette, `amber-*` → subtle gold
- Dark mode: toggle `.dark` on `<html>` element; all semantic `var(--*)` variables flip automatically
- Arabic font: `'Segoe UI', 'Tahoma', 'Arial'` fallback chain for Arabic text shaping

## Security Notes

### SQL Injection Fix (2026-04-25)
Two SQL injection vulnerabilities fixed in `backend/src/routes/admin.ts`:

1. **Group key rename** (was line 487): `req.params.id`, `newKey`, `oldKey` were interpolated into `sql.raw()` strings. Fixed by replacing with Drizzle `sql\`...\`` template tag which creates parameterized queries.

2. **Category key rename** (was line 560): Same pattern — `newKey`, `oldKey`, `req.params.id` all raw-interpolated with NO sanitization. Fixed with same approach.

**Rule:** Never use `sql.raw()` with user-controlled values. Use Drizzle's `sql\`...\`` template tag for parameterized binding, or ORM methods (`.update().set().where()`).  
`sql.raw()` is safe ONLY for static strings like DDL constraint names.