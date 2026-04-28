import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { Pool } from 'pg';
import Database from 'better-sqlite3';
import * as schemaPg from './schema_pg';
import * as schemaSqlite from './schema_sqlite';

const isDemo = process.env.DEMO_MODE === 'true' || !process.env.DATABASE_URL;

export let db: any;
export let pool: any; // exported so routes can run raw SQL for dynamic columns

if (isDemo) {
  console.log("Initializing SQLite database (DEMO_MODE)...");
  const sqlite = new Database('demo.db');
  db = drizzleSqlite(sqlite, { schema: schemaSqlite });
  
  console.log("Ensuring tables exist in SQLite...");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS regions (
      id TEXT PRIMARY KEY,
      name_ar TEXT NOT NULL,
      name_en TEXT,
      sector_id TEXT REFERENCES sectors(id),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sectors (
      id TEXT PRIMARY KEY,
      name_ar TEXT NOT NULL,
      name_en TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS stages (
      id TEXT PRIMARY KEY,
      name_ar TEXT NOT NULL,
      category TEXT NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0,
      is_terminal INTEGER NOT NULL DEFAULT 0,
      is_cancelled INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      full_name TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'OPERATOR',
      region_id TEXT REFERENCES regions(id),
      sector_id TEXT REFERENCES sectors(id),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS work_orders (
      id TEXT PRIMARY KEY,
      work_type TEXT,
      order_number TEXT,
      client TEXT,
      assignment_date TEXT,
      location TEXT,
      project_type TEXT,
      station TEXT,
      length REAL,
      consultant TEXT,
      survey_date TEXT,
      coordination_date TEXT,
      coordination_cert_number TEXT,
      notes TEXT,
      drilling_team TEXT,
      drilling_date TEXT,
      shutdown_date TEXT,
      procedure TEXT,
      hold_reason TEXT,
      material_sheet_date TEXT,
      check_sheets_date TEXT,
      metering_sheet_date TEXT,
      gis_completion_date TEXT,
      proc_155_close_date TEXT,
      completion_cert_confirm INTEGER,
      estimated_value REAL,
      invoice_number TEXT,
      actual_invoice_value REAL,
      invoice_type TEXT,
      invoice_1 REAL,
      invoice_2 REAL,
      collected_amount REAL,
      remaining_amount REAL,
      custom_fields TEXT DEFAULT '{}',
      status TEXT DEFAULT 'PENDING',
      stage TEXT DEFAULT 'BASIC',
      stage_id TEXT REFERENCES stages(id),
      created_by TEXT REFERENCES users(id),
      updated_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS column_groups (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      name_ar TEXT NOT NULL,
      name_en TEXT,
      sort_order INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS column_catalog (
      id TEXT PRIMARY KEY,
      table_name TEXT NOT NULL,
      column_key TEXT NOT NULL,
      label_ar TEXT NOT NULL,
      label_en TEXT,
      group_key TEXT NOT NULL REFERENCES column_groups(key),
      category TEXT DEFAULT 'EXEC',
      data_type TEXT NOT NULL,
      is_sensitive INTEGER DEFAULT 0,
      is_custom INTEGER DEFAULT 0,
      is_enabled INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(table_name, column_key)
    );
    CREATE TABLE IF NOT EXISTS column_options (
      id TEXT PRIMARY KEY,
      column_key TEXT NOT NULL,
      value TEXT NOT NULL,
      label_ar TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS role_column_permissions (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      table_name TEXT NOT NULL,
      column_key TEXT NOT NULL,
      can_read INTEGER NOT NULL DEFAULT 0,
      can_write INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(role, table_name, column_key)
    );
    CREATE TABLE IF NOT EXISTS user_column_overrides (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      table_name TEXT NOT NULL,
      column_key TEXT NOT NULL,
      can_read INTEGER,
      can_write INTEGER,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, table_name, column_key)
    );
    CREATE TABLE IF NOT EXISTS kpi_templates (
      id TEXT PRIMARY KEY,
      name_ar TEXT NOT NULL,
      category TEXT NOT NULL,
      default_sla_days INTEGER NOT NULL DEFAULT 0,
      seq INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS kpi_rules (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL REFERENCES kpi_templates(id),
      name_override_ar TEXT,
      category TEXT NOT NULL,
      start_column_key TEXT NOT NULL,
      end_mode TEXT NOT NULL DEFAULT 'COLUMN_DATE',
      end_column_key TEXT,
      end_stage_id TEXT REFERENCES stages(id),
      sla_days_override INTEGER,
      calc_mode TEXT NOT NULL,
      work_type_filter TEXT,
      sector_id_filter TEXT REFERENCES sectors(id),
      region_id_filter TEXT REFERENCES regions(id),
      alert_enabled INTEGER DEFAULT 1,
      warn_threshold_percent INTEGER DEFAULT 80,
      show_on_dashboard INTEGER DEFAULT 1,
      active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS work_order_kpi_cache (
      id TEXT PRIMARY KEY,
      work_order_id TEXT NOT NULL REFERENCES work_orders(id),
      kpi_rule_id TEXT NOT NULL REFERENCES kpi_rules(id),
      computed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      elapsed_days INTEGER,
      remaining_days INTEGER,
      status TEXT NOT NULL,
      details TEXT,
      UNIQUE(work_order_id, kpi_rule_id)
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT REFERENCES users(id),
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      action TEXT NOT NULL,
      changes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migration for existing tables (if they were created in a previous version)
  try { sqlite.exec(`ALTER TABLE users ADD COLUMN full_name TEXT;`); } catch(e) {}
  try { sqlite.exec(`ALTER TABLE users ADD COLUMN region_id TEXT REFERENCES regions(id);`); } catch(e) {}
  try { sqlite.exec(`ALTER TABLE users ADD COLUMN sector_id TEXT REFERENCES sectors(id);`); } catch(e) {}
  try { sqlite.exec(`ALTER TABLE regions ADD COLUMN sector_id TEXT REFERENCES sectors(id);`); } catch(e) {}
  try { sqlite.exec(`ALTER TABLE work_orders ADD COLUMN custom_fields TEXT DEFAULT '{}';`); } catch(e) {}
  try { sqlite.exec(`ALTER TABLE work_orders ADD COLUMN exec_delay_justified INTEGER DEFAULT 0;`); } catch(e) {}
  try { sqlite.exec(`ALTER TABLE work_orders ADD COLUMN exec_delay_reason TEXT;`); } catch(e) {}
  try { sqlite.exec(`ALTER TABLE work_orders ADD COLUMN fin_delay_justified INTEGER DEFAULT 0;`); } catch(e) {}
  try { sqlite.exec(`ALTER TABLE work_orders ADD COLUMN fin_delay_reason TEXT;`); } catch(e) {}
  try { sqlite.exec(`ALTER TABLE column_catalog ADD COLUMN category TEXT DEFAULT 'EXEC';`); } catch(e) {}
  try { sqlite.exec(`ALTER TABLE column_catalog ADD COLUMN is_custom INTEGER DEFAULT 0;`); } catch(e) {}
  try { sqlite.exec(`ALTER TABLE column_catalog ADD COLUMN group_key TEXT;`); } catch(e) {}
  try { sqlite.exec(`ALTER TABLE stages ADD COLUMN name_en TEXT;`); } catch(e) {}
  
  try { sqlite.exec(`ALTER TABLE kpi_rules ADD COLUMN end_mode TEXT DEFAULT 'COLUMN_DATE';`); } catch(e) {}
  try { sqlite.exec(`ALTER TABLE kpi_rules ADD COLUMN work_type_filter TEXT;`); } catch(e) {}
  try { sqlite.exec(`ALTER TABLE kpi_rules ADD COLUMN sector_id_filter TEXT;`); } catch(e) {}
  try { sqlite.exec(`ALTER TABLE kpi_rules ADD COLUMN region_id_filter TEXT;`); } catch(e) {}

  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS column_groups (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        name_ar TEXT NOT NULL,
        name_en TEXT,
        sort_order INTEGER DEFAULT 0,
        active INTEGER DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch(e) {}

  // Periodic KPI tables (independent from existing KPI tables)
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS periodic_kpi_execution_rules (
        id TEXT PRIMARY KEY,
        project_type_value TEXT NOT NULL UNIQUE,
        project_type_label_ar TEXT NOT NULL,
        is_enabled INTEGER NOT NULL DEFAULT 1,
        sla_days INTEGER NOT NULL DEFAULT 30,
        warning_days INTEGER NOT NULL DEFAULT 5,
        start_mode TEXT NOT NULL DEFAULT 'COLUMN_DATE',
        start_column_key TEXT,
        start_stage_id TEXT,
        end_mode TEXT NOT NULL DEFAULT 'COLUMN_DATE',
        end_column_key TEXT,
        end_stage_id TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS periodic_kpi_financial_rule (
        id TEXT PRIMARY KEY,
        is_enabled INTEGER NOT NULL DEFAULT 1,
        sla_days INTEGER NOT NULL DEFAULT 20,
        warning_days INTEGER NOT NULL DEFAULT 3,
        start_mode TEXT NOT NULL DEFAULT 'COLUMN_DATE',
        start_column_key TEXT,
        start_stage_id TEXT,
        end_mode TEXT NOT NULL DEFAULT 'COLUMN_DATE',
        end_column_key TEXT,
        end_stage_id TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS periodic_kpi_report_settings (
        id TEXT PRIMARY KEY,
        default_date_range_mode TEXT NOT NULL DEFAULT 'week',
        avg_mode_default TEXT NOT NULL DEFAULT 'All',
        include_cancelled INTEGER NOT NULL DEFAULT 0,
        include_completed INTEGER NOT NULL DEFAULT 1,
        enable_focus_mode INTEGER NOT NULL DEFAULT 0,
        region_cards_per_row INTEGER NOT NULL DEFAULT 3,
        project_cards_per_row INTEGER NOT NULL DEFAULT 3,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch(e) {}

  // Migration: role_definitions table (added after initial schema)
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS role_definitions (
        id TEXT PRIMARY KEY,
        role_key TEXT NOT NULL UNIQUE,
        name_ar TEXT NOT NULL,
        name_en TEXT,
        scope_type TEXT NOT NULL DEFAULT 'ALL',
        can_create_order INTEGER DEFAULT 0,
        can_delete_order INTEGER DEFAULT 0,
        can_edit_execution INTEGER DEFAULT 1,
        can_view_excavation_permits INTEGER DEFAULT 1,
        can_edit_excavation_permits INTEGER DEFAULT 0,
        can_delete_excavation_permits INTEGER DEFAULT 0,
        can_view_executive_dashboard INTEGER DEFAULT 0,
        can_view_exec_kpi_cards INTEGER DEFAULT 1,
        can_view_fin_kpi_cards INTEGER DEFAULT 1,
        can_manage_targets INTEGER DEFAULT 0,
        can_view_contracts INTEGER DEFAULT 0,
        can_manage_contracts INTEGER DEFAULT 0,
        can_view_periodic_report INTEGER DEFAULT 0,
        can_manage_users INTEGER DEFAULT 0,
        is_system INTEGER DEFAULT 0,
        active INTEGER DEFAULT 1,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT OR IGNORE INTO role_definitions (id, role_key, name_ar, scope_type,
        can_create_order, can_delete_order, can_edit_execution,
        can_view_executive_dashboard, can_view_exec_kpi_cards, can_view_fin_kpi_cards,
        can_manage_targets, can_view_contracts, can_manage_contracts,
        can_view_periodic_report, can_manage_users, is_system, active, sort_order)
      VALUES
        ('role-admin',   'ADMIN',   'مدير النظام',     'ALL', 1,1,1,1,1,1,1,1,1,1,1,1,1,0),
        ('role-viewer',  'VIEWER',  'مستعرض',          'ALL', 0,0,0,0,1,1,0,0,0,0,0,1,1,1),
        ('role-editor',  'EDITOR',  'محرر',             'ALL', 1,0,1,0,1,1,0,0,0,0,0,1,1,2),
        ('role-manager', 'MANAGER', 'مدير',             'ALL', 1,1,1,1,1,1,1,1,1,1,0,1,1,3);
    `);
  } catch(e) {}

  console.log("SQLite database initialized.");
} else {
  console.log("Initializing PostgreSQL database...");
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });
  db = drizzlePg(pool, { schema: schemaPg });

  // Ensure system_settings table exists (key-value store for logos, settings, etc.)
  pool.query(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `).catch(() => {});

  // Run additive migrations (safe — column already exists errors are ignored)
  pool.query(`ALTER TABLE stages ADD COLUMN IF NOT EXISTS name_en TEXT;`)
    .catch(() => {});

  // Columns added in schema_pg.ts after initial deployment — guard for fresh DBs
  // and any host where these were not yet applied via manual ALTER.
  pool.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS completion_cert_date TIMESTAMPTZ;`).catch(() => {});
  pool.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS invoice_billing_date TIMESTAMPTZ;`).catch(() => {});
  pool.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS invoice_2_number TEXT;`).catch(() => {});
  pool.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS street_category TEXT;`).catch(() => {});
  pool.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS soil_type TEXT;`).catch(() => {});
  pool.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS expected_excavation_date TIMESTAMPTZ;`).catch(() => {});
  pool.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS classified TEXT;`).catch(() => {});
  pool.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS current_request_number TEXT;`).catch(() => {});
  pool.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS current_request_type TEXT;`).catch(() => {});

  // Create column_categories table if not exists + seed EXEC and FIN
  pool.query(`
    CREATE TABLE IF NOT EXISTS column_categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      key TEXT NOT NULL UNIQUE,
      name_ar TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `).then(() => {
    pool.query(`
      INSERT INTO column_categories (key, name_ar, sort_order)
      VALUES ('EXEC', 'تنفيذي', 1), ('FIN', 'مالي', 2)
      ON CONFLICT (key) DO NOTHING;
    `).catch(() => {});
  }).catch(() => {});

  // Add sort_order to column_catalog if missing
  pool.query(`ALTER TABLE column_catalog ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;`).catch(() => {});
  // Add show_in_create to column_catalog if missing
  pool.query(`ALTER TABLE column_catalog ADD COLUMN IF NOT EXISTS show_in_create BOOLEAN DEFAULT false;`).catch(() => {});
  // Add physical_key to column_catalog — stores original DB column name, never changes on rename
  // Backfill: set physical_key = column_key for rows where it's not yet set.
  // Note: for columns that were already renamed before this migration, physical_key must be
  // set manually via SQL or the rename-key endpoint (which locks it automatically going forward).
  pool.query(`ALTER TABLE column_catalog ADD COLUMN IF NOT EXISTS physical_key TEXT;`)
    .then(() => pool.query(`UPDATE column_catalog SET physical_key = column_key WHERE physical_key IS NULL;`))
    .catch(() => {});
  // Add display_scope to kpi_templates (ORDER | REPORT | DASHBOARD)
  pool.query(`ALTER TABLE kpi_templates ADD COLUMN IF NOT EXISTS display_scope TEXT NOT NULL DEFAULT 'ORDER';`).catch(() => {});
  // Add warn_threshold_days to kpi_rules — warning X days before SLA expiry
  pool.query(`ALTER TABLE kpi_rules ADD COLUMN IF NOT EXISTS warn_threshold_days INTEGER;`).catch(() => {});
  // Excavation permit feature permissions on role_definitions
  pool.query(`ALTER TABLE role_definitions ADD COLUMN IF NOT EXISTS can_view_excavation_permits BOOLEAN DEFAULT true;`).catch(() => {});
  pool.query(`ALTER TABLE role_definitions ADD COLUMN IF NOT EXISTS can_edit_excavation_permits BOOLEAN DEFAULT false;`).catch(() => {});
  pool.query(`ALTER TABLE role_definitions ADD COLUMN IF NOT EXISTS can_delete_excavation_permits BOOLEAN DEFAULT false;`).catch(() => {});
  // Executive dashboard access permission
  pool.query(`ALTER TABLE role_definitions ADD COLUMN IF NOT EXISTS can_view_executive_dashboard BOOLEAN DEFAULT false;`).catch(() => {});
  // Work order KPI cards visibility — separate toggles for Exec and Financial
  pool.query(`ALTER TABLE role_definitions ADD COLUMN IF NOT EXISTS can_view_exec_kpi_cards BOOLEAN DEFAULT true;`).catch(() => {});
  pool.query(`ALTER TABLE role_definitions ADD COLUMN IF NOT EXISTS can_view_fin_kpi_cards BOOLEAN DEFAULT true;`).catch(() => {});
  // Periodic KPI report access permission
  pool.query(`ALTER TABLE role_definitions ADD COLUMN IF NOT EXISTS can_view_periodic_report BOOLEAN DEFAULT false;`).catch(() => {});
  // Manage annual targets permission
  pool.query(`ALTER TABLE role_definitions ADD COLUMN IF NOT EXISTS can_manage_targets BOOLEAN DEFAULT false;`).catch(() => {});
  // Custom annual target items
  pool.query(`
    CREATE TABLE IF NOT EXISTS annual_target_items (
      id SERIAL PRIMARY KEY,
      year INTEGER NOT NULL,
      name_ar TEXT NOT NULL,
      name_en TEXT,
      category TEXT NOT NULL DEFAULT 'EXEC',
      unit TEXT NOT NULL DEFAULT 'COUNT',
      target_value NUMERIC,
      sort_order INTEGER NOT NULL DEFAULT 0,
      enabled BOOLEAN NOT NULL DEFAULT true
    )
  `).catch(() => {});
  pool.query(`ALTER TABLE annual_target_items ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true`).catch(() => {});
  // User contact & identity fields
  pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_id TEXT;`).catch(() => {});
  pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number TEXT;`).catch(() => {});
  pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;`).catch(() => {});
  pool.query(`ALTER TABLE column_options ADD COLUMN IF NOT EXISTS label_en TEXT;`).catch(() => {});
  // Delay classification columns — تصنيف التأخير
  pool.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS exec_delay_justified BOOLEAN DEFAULT false;`).catch(() => {});
  pool.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS exec_delay_reason TEXT;`).catch(() => {});
  pool.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS fin_delay_justified BOOLEAN DEFAULT false;`).catch(() => {});
  pool.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS fin_delay_reason TEXT;`).catch(() => {});
  pool.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS work_status_classification TEXT;`).catch(() => {});
  // Seed work_status_classification options (only if none exist yet)
  pool.query(`
    INSERT INTO column_options (id, column_key, value, label_ar, sort_order, active)
    SELECT gen_random_uuid(), v.col_key, v.val, v.lbl, v.ord, true
    FROM (VALUES
      ('work_status_classification', 'قائم',      'قائم',      1),
      ('work_status_classification', 'تم التنفيذ', 'تم التنفيذ', 2)
    ) AS v(col_key, val, lbl, ord)
    WHERE NOT EXISTS (
      SELECT 1 FROM column_options WHERE column_key = 'work_status_classification'
    );
  `).catch(() => {});
  // Register delay + classification columns in column_catalog
  pool.query(`
    INSERT INTO column_catalog (id, table_name, column_key, physical_key, label_ar, label_en, group_key, category, data_type, is_sensitive, is_custom, is_enabled, show_in_create, sort_order)
    VALUES
      (gen_random_uuid(), 'work_orders', 'exec_delay_justified', 'exec_delay_justified', 'مسبب تنفيذي؟',      'Exec Delay Justified?',  'OPS',     'EXEC', 'boolean', false, false, true, false, 990),
      (gen_random_uuid(), 'work_orders', 'exec_delay_reason',    'exec_delay_reason',    'سبب التأخير التنفيذي', 'Exec Delay Reason',   'OPS',     'EXEC', 'text',    false, false, true, false, 991),
      (gen_random_uuid(), 'work_orders', 'fin_delay_justified',  'fin_delay_justified',  'مسبب مالي؟',          'Fin Delay Justified?',   'FINANCE', 'FIN',  'boolean', false, false, true, false, 992),
      (gen_random_uuid(), 'work_orders', 'fin_delay_reason',               'fin_delay_reason',               'سبب التأخير المالي',  'Fin Delay Reason',          'FINANCE', 'FIN',  'text',    false, false, true, false, 993),
      (gen_random_uuid(), 'work_orders', 'work_status_classification',     'work_status_classification',     'حالة التنفيذ',         'Execution Status',          'OPS',     'EXEC', 'select',  false, false, true, true,  994)
    ON CONFLICT (table_name, column_key) DO UPDATE
      SET label_ar    = EXCLUDED.label_ar,
          label_en    = EXCLUDED.label_en,
          physical_key = EXCLUDED.physical_key,
          sort_order  = EXCLUDED.sort_order;
  `).catch(e => console.warn('[MIGRATION] delay cols catalog:', e?.message ?? e));

  // Register financial_close_date in column_catalog (FINANCE group, sort_order 900)
  pool.query(`
    INSERT INTO column_catalog (id, table_name, column_key, physical_key, label_ar, label_en, group_key, category, data_type, is_sensitive, is_custom, is_enabled, show_in_create, sort_order)
    VALUES (gen_random_uuid(), 'work_orders', 'financial_close_date', 'financial_close_date',
            'تاريخ الإغلاق المالي', 'Financial Close Date',
            'FINANCE', 'FIN', 'date', false, false, true, false, 900)
    ON CONFLICT (table_name, column_key) DO UPDATE
      SET label_ar     = EXCLUDED.label_ar,
          label_en     = EXCLUDED.label_en,
          group_key    = EXCLUDED.group_key,
          category     = EXCLUDED.category,
          data_type    = EXCLUDED.data_type,
          physical_key = EXCLUDED.physical_key,
          is_custom    = false,
          is_enabled   = true,
          sort_order   = EXCLUDED.sort_order;
  `).catch(e => console.warn('[MIGRATION] financial_close_date catalog:', e?.message ?? e));

  // Register permissions for financial_close_date — ADMIN/MANAGER/FINANCE can write, others read-only
  pool.query(`
    INSERT INTO role_column_permissions (role, table_name, column_key, can_read, can_write)
    VALUES
      ('ADMIN',       'work_orders', 'financial_close_date', true, true),
      ('MANAGER',     'work_orders', 'financial_close_date', true, true),
      ('OPERATOR',    'work_orders', 'financial_close_date', true, false),
      ('COORDINATOR', 'work_orders', 'financial_close_date', true, false),
      ('GIS',         'work_orders', 'financial_close_date', true, false),
      ('FINANCE',     'work_orders', 'financial_close_date', true, true),
      ('VIEWER',      'work_orders', 'financial_close_date', true, false)
    ON CONFLICT (role, table_name, column_key) DO UPDATE
      SET can_read = EXCLUDED.can_read, can_write = EXCLUDED.can_write;
  `).catch(e => console.warn('[MIGRATION] financial_close_date perms:', e?.message ?? e));

  // Register invoice_billing_date in column_catalog (FINANCE group, sort_order 900)
  // The physical column was added earlier (line ~299) but catalog/perms were never created.
  pool.query(`
    INSERT INTO column_catalog (id, table_name, column_key, physical_key, label_ar, label_en, group_key, category, data_type, is_sensitive, is_custom, is_enabled, show_in_create, sort_order)
    VALUES (gen_random_uuid(), 'work_orders', 'invoice_billing_date', 'invoice_billing_date',
            'تاريخ الفوترة 1', 'Invoice 1 Billing Date',
            'FINANCE', 'FIN', 'date', false, false, true, false, 900)
    ON CONFLICT (table_name, column_key) DO UPDATE
      SET label_ar     = EXCLUDED.label_ar,
          label_en     = EXCLUDED.label_en,
          group_key    = EXCLUDED.group_key,
          category     = EXCLUDED.category,
          data_type    = EXCLUDED.data_type,
          physical_key = EXCLUDED.physical_key,
          is_custom    = false,
          is_enabled   = true,
          sort_order   = EXCLUDED.sort_order;
  `).catch(e => console.warn('[MIGRATION] invoice_billing_date catalog:', e?.message ?? e));

  // Permissions for invoice_billing_date — same policy as invoice_2_billing_date
  pool.query(`
    INSERT INTO role_column_permissions (role, table_name, column_key, can_read, can_write)
    VALUES
      ('ADMIN',       'work_orders', 'invoice_billing_date', true, true),
      ('MANAGER',     'work_orders', 'invoice_billing_date', true, true),
      ('OPERATOR',    'work_orders', 'invoice_billing_date', true, false),
      ('COORDINATOR', 'work_orders', 'invoice_billing_date', true, false),
      ('GIS',         'work_orders', 'invoice_billing_date', true, false),
      ('FINANCE',     'work_orders', 'invoice_billing_date', true, true),
      ('VIEWER',      'work_orders', 'invoice_billing_date', true, false)
    ON CONFLICT (role, table_name, column_key) DO UPDATE
      SET can_read = EXCLUDED.can_read, can_write = EXCLUDED.can_write;
  `).catch(e => console.warn('[MIGRATION] invoice_billing_date perms:', e?.message ?? e));

  // Add physical column invoice_2_billing_date
  pool.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS invoice_2_billing_date TIMESTAMPTZ;`)
    .catch(e => console.warn('[MIGRATION] invoice_2_billing_date column:', e?.message ?? e));

  // Register invoice_2_billing_date in column_catalog (FINANCE group, sort_order 901)
  pool.query(`
    INSERT INTO column_catalog (id, table_name, column_key, physical_key, label_ar, label_en, group_key, category, data_type, is_sensitive, is_custom, is_enabled, show_in_create, sort_order)
    VALUES (gen_random_uuid(), 'work_orders', 'invoice_2_billing_date', 'invoice_2_billing_date',
            'تاريخ الفوترة 2', 'Invoice 2 Billing Date',
            'FINANCE', 'FIN', 'date', false, false, true, false, 901)
    ON CONFLICT (table_name, column_key) DO UPDATE
      SET label_ar     = EXCLUDED.label_ar,
          label_en     = EXCLUDED.label_en,
          group_key    = EXCLUDED.group_key,
          category     = EXCLUDED.category,
          data_type    = EXCLUDED.data_type,
          physical_key = EXCLUDED.physical_key,
          is_custom    = false,
          is_enabled   = true,
          sort_order   = EXCLUDED.sort_order;
  `).catch(e => console.warn('[MIGRATION] invoice_2_billing_date catalog:', e?.message ?? e));

  // Register permissions for invoice_2_billing_date — ADMIN/MANAGER/FINANCE can write, others read-only
  pool.query(`
    INSERT INTO role_column_permissions (role, table_name, column_key, can_read, can_write)
    VALUES
      ('ADMIN',       'work_orders', 'invoice_2_billing_date', true, true),
      ('MANAGER',     'work_orders', 'invoice_2_billing_date', true, true),
      ('OPERATOR',    'work_orders', 'invoice_2_billing_date', true, false),
      ('COORDINATOR', 'work_orders', 'invoice_2_billing_date', true, false),
      ('GIS',         'work_orders', 'invoice_2_billing_date', true, false),
      ('FINANCE',     'work_orders', 'invoice_2_billing_date', true, true),
      ('VIEWER',      'work_orders', 'invoice_2_billing_date', true, false)
    ON CONFLICT (role, table_name, column_key) DO UPDATE
      SET can_read = EXCLUDED.can_read, can_write = EXCLUDED.can_write;
  `).catch(e => console.warn('[MIGRATION] invoice_2_billing_date perms:', e?.message ?? e));

  // Register invoice_2_number in column_catalog (FINANCE group, sort_order 900)
  pool.query(`
    INSERT INTO column_catalog (id, table_name, column_key, physical_key, label_ar, label_en, group_key, category, data_type, is_sensitive, is_custom, is_enabled, show_in_create, sort_order)
    VALUES (gen_random_uuid(), 'work_orders', 'invoice_2_number', 'invoice_2_number',
            'رقم المستخلص 2', 'Invoice 2 No.',
            'FINANCE', 'FIN', 'text', false, false, true, false, 900)
    ON CONFLICT (table_name, column_key) DO UPDATE
      SET label_ar     = EXCLUDED.label_ar,
          label_en     = EXCLUDED.label_en,
          group_key    = EXCLUDED.group_key,
          category     = EXCLUDED.category,
          data_type    = EXCLUDED.data_type,
          physical_key = EXCLUDED.physical_key,
          is_custom    = false,
          is_enabled   = true,
          sort_order   = EXCLUDED.sort_order;
  `).catch(e => console.warn('[MIGRATION] invoice_2_number catalog:', e?.message ?? e));

  // Register permissions for invoice_2_number — ADMIN/MANAGER/FINANCE can write, others read-only
  pool.query(`
    INSERT INTO role_column_permissions (role, table_name, column_key, can_read, can_write)
    VALUES
      ('ADMIN',       'work_orders', 'invoice_2_number', true, true),
      ('MANAGER',     'work_orders', 'invoice_2_number', true, true),
      ('OPERATOR',    'work_orders', 'invoice_2_number', true, false),
      ('COORDINATOR', 'work_orders', 'invoice_2_number', true, false),
      ('GIS',         'work_orders', 'invoice_2_number', true, false),
      ('FINANCE',     'work_orders', 'invoice_2_number', true, true),
      ('VIEWER',      'work_orders', 'invoice_2_number', true, false)
    ON CONFLICT (role, table_name, column_key) DO UPDATE
      SET can_read = EXCLUDED.can_read, can_write = EXCLUDED.can_write;
  `).catch(e => console.warn('[MIGRATION] invoice_2_number perms:', e?.message ?? e));

  // Register completion_cert_date in column_catalog (PROCEDURE_155 group, sort_order 408)
  pool.query(`
    INSERT INTO column_catalog (id, table_name, column_key, physical_key, label_ar, label_en, group_key, category, data_type, is_sensitive, is_custom, is_enabled, show_in_create, sort_order)
    VALUES (gen_random_uuid(), 'work_orders', 'completion_cert_date', 'completion_cert_date',
            'تاريخ شهادة الإنجاز', 'Completion Certificate Date',
            'PROCEDURE_155', 'procedure', 'date', false, false, true, false, 408)
    ON CONFLICT (table_name, column_key) DO UPDATE
      SET label_ar     = EXCLUDED.label_ar,
          label_en     = EXCLUDED.label_en,
          group_key    = EXCLUDED.group_key,
          data_type    = EXCLUDED.data_type,
          is_enabled   = true,
          sort_order   = EXCLUDED.sort_order;
  `).catch(e => console.warn('[MIGRATION] completion_cert_date catalog:', e?.message ?? e));

  // Register permissions for completion_cert_date — ADMIN/MANAGER/OPERATOR can write, others read-only
  pool.query(`
    INSERT INTO role_column_permissions (role, table_name, column_key, can_read, can_write)
    VALUES
      ('ADMIN',       'work_orders', 'completion_cert_date', true, true),
      ('MANAGER',     'work_orders', 'completion_cert_date', true, true),
      ('OPERATOR',    'work_orders', 'completion_cert_date', true, true),
      ('COORDINATOR', 'work_orders', 'completion_cert_date', true, false),
      ('GIS',         'work_orders', 'completion_cert_date', true, false),
      ('FINANCE',     'work_orders', 'completion_cert_date', true, true),
      ('VIEWER',      'work_orders', 'completion_cert_date', true, false)
    ON CONFLICT (role, table_name, column_key) DO UPDATE
      SET can_read = EXCLUDED.can_read, can_write = EXCLUDED.can_write;
  `).catch(e => console.warn('[MIGRATION] completion_cert_date perms:', e?.message ?? e));

  // Register permissions for work_status_classification — all roles get read, most get write
  pool.query(`
    INSERT INTO role_column_permissions (role, table_name, column_key, can_read, can_write)
    VALUES
      ('ADMIN',       'work_orders', 'work_status_classification', true, true),
      ('MANAGER',     'work_orders', 'work_status_classification', true, true),
      ('OPERATOR',    'work_orders', 'work_status_classification', true, true),
      ('COORDINATOR', 'work_orders', 'work_status_classification', true, true),
      ('GIS',         'work_orders', 'work_status_classification', true, false),
      ('FINANCE',     'work_orders', 'work_status_classification', true, false),
      ('VIEWER',      'work_orders', 'work_status_classification', true, false)
    ON CONFLICT (role, table_name, column_key) DO UPDATE
      SET can_read = EXCLUDED.can_read, can_write = EXCLUDED.can_write;
  `).catch(e => console.warn('[MIGRATION] work_status_classification perms:', e?.message ?? e));

  // ── Migrate existing isCustom=true catalog columns → real physical columns ──
  // DISABLED for first production deployment — enable after verifying JSONB data
  // on prod server and taking a DB backup. See DEV_SETUP.md for instructions.
  // (async () => { ... })();

  // Backfill stage_id for orders imported before stageId mapping was added
  (async () => {
    try {
      const r = await pool.query(`
        UPDATE work_orders wo
        SET stage_id = s.id
        FROM stages s
        WHERE wo.stage_id IS NULL
          AND wo.procedure IS NOT NULL
          AND LOWER(TRIM(wo.procedure)) = LOWER(TRIM(s.name_ar))
      `);
      if (r.rowCount && r.rowCount > 0) {
        console.log(`[MIGRATION] Backfilled stage_id for ${r.rowCount} work orders.`);
      }
    } catch (err: any) {
      console.warn('[MIGRATION] stageId backfill failed:', err?.message ?? err);
    }
  })();

  // Periodic KPI tables (independent from existing KPI tables)
  pool.query(`
    CREATE TABLE IF NOT EXISTS periodic_kpi_execution_rules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_type_value TEXT NOT NULL UNIQUE,
      project_type_label_ar TEXT NOT NULL,
      is_enabled BOOLEAN NOT NULL DEFAULT true,
      sla_days INTEGER NOT NULL DEFAULT 30,
      warning_days INTEGER NOT NULL DEFAULT 5,
      start_mode TEXT NOT NULL DEFAULT 'COLUMN_DATE',
      start_column_key TEXT,
      start_stage_id UUID,
      end_mode TEXT NOT NULL DEFAULT 'COLUMN_DATE',
      end_column_key TEXT,
      end_stage_id UUID,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS periodic_kpi_financial_rule (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      is_enabled BOOLEAN NOT NULL DEFAULT true,
      sla_days INTEGER NOT NULL DEFAULT 20,
      warning_days INTEGER NOT NULL DEFAULT 3,
      start_mode TEXT NOT NULL DEFAULT 'COLUMN_DATE',
      start_column_key TEXT,
      start_stage_id UUID,
      end_mode TEXT NOT NULL DEFAULT 'COLUMN_DATE',
      end_column_key TEXT,
      end_stage_id UUID,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS periodic_kpi_report_settings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      default_date_range_mode TEXT NOT NULL DEFAULT 'week',
      avg_mode_default TEXT NOT NULL DEFAULT 'All',
      include_cancelled BOOLEAN NOT NULL DEFAULT false,
      include_completed BOOLEAN NOT NULL DEFAULT true,
      enable_focus_mode BOOLEAN NOT NULL DEFAULT false,
      region_cards_per_row INTEGER NOT NULL DEFAULT 3,
      project_cards_per_row INTEGER NOT NULL DEFAULT 3,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `).catch(() => {});

  // Add use_exec_sla and name_en columns to periodic_kpi_metrics if not exist
  pool.query(`ALTER TABLE periodic_kpi_metrics ADD COLUMN IF NOT EXISTS use_exec_sla BOOLEAN NOT NULL DEFAULT false`).catch(() => {});
  pool.query(`ALTER TABLE periodic_kpi_metrics ADD COLUMN IF NOT EXISTS name_en TEXT`).catch(() => {});
  pool.query(`ALTER TABLE periodic_kpi_metrics ADD COLUMN IF NOT EXISTS excluded_project_types TEXT DEFAULT '[]'`).catch(() => {});

  // Integrations table + seed default rows
  pool.query(`
    CREATE TABLE IF NOT EXISTS integrations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT false,
      base_url TEXT,
      auth_type TEXT DEFAULT 'api_key',
      sync_mode TEXT DEFAULT 'manual',
      api_key TEXT,
      username TEXT,
      password TEXT,
      client_id TEXT,
      client_secret TEXT,
      access_token TEXT,
      refresh_token TEXT,
      webhook_secret TEXT,
      last_sync_at TIMESTAMPTZ,
      last_status TEXT DEFAULT 'never_run',
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `).then(async () => {
    const existing = await pool.query(`SELECT code FROM integrations`).catch(() => ({ rows: [] }));
    const existingCodes = new Set(existing.rows.map((r: any) => r.code));
    const defaults = [
      { code: 'n8n',    name: 'n8n Automation',  auth_type: 'api_key' },
      { code: 'jisr',   name: 'Jisr HR',          auth_type: 'api_key' },
      { code: 'odoo',   name: 'Odoo ERP',         auth_type: 'odoo_jsonrpc' },
      { code: 'custom', name: 'Custom API',       auth_type: 'api_key' },
    ];
    for (const d of defaults) {
      if (!existingCodes.has(d.code)) {
        await pool.query(
          `INSERT INTO integrations (code, name, auth_type, enabled) VALUES ($1, $2, $3, false) ON CONFLICT (code) DO NOTHING`,
          [d.code, d.name, d.auth_type]
        ).catch(() => {});
      }
    }
  }).catch(() => {});

  // Executive Targets table
  pool.query(`
    CREATE TABLE IF NOT EXISTS executive_targets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      year INTEGER NOT NULL,
      exec_closure_target INTEGER,
      financial_collection_target NUMERIC,
      financial_invoicing_target NUMERIC,
      note_ar TEXT,
      note_en TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT,
      UNIQUE(year)
    );
  `).catch(() => {});

  // Executive Sector Targets table
  pool.query(`
    CREATE TABLE IF NOT EXISTS executive_sector_targets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      year INTEGER NOT NULL,
      sector_id TEXT NOT NULL,
      exec_closure_target INTEGER,
      financial_collection_target NUMERIC,
      financial_invoicing_target NUMERIC,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT,
      UNIQUE(year, sector_id)
    );
  `).catch(() => {});

  // Sector Annual Targets (percentage-based, new system)
  pool.query(`
    CREATE TABLE IF NOT EXISTS sector_annual_targets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      year INTEGER NOT NULL,
      sector_id UUID NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
      closure_rate_target NUMERIC DEFAULT 80,
      sales_rate_target NUMERIC DEFAULT 90,
      collection_rate_target NUMERIC DEFAULT 75,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT,
      UNIQUE(year, sector_id)
    );
  `).catch(() => {});

  // Add new target columns (amount + exec compliance)
  pool.query(`ALTER TABLE sector_annual_targets ADD COLUMN IF NOT EXISTS sales_amount_target NUMERIC;`).catch(() => {});
  pool.query(`ALTER TABLE sector_annual_targets ADD COLUMN IF NOT EXISTS exec_compliance_target NUMERIC DEFAULT 90;`).catch(() => {});
  pool.query(`ALTER TABLE sector_annual_targets ADD COLUMN IF NOT EXISTS closure_rate_target NUMERIC DEFAULT 80;`).catch(() => {});
  pool.query(`ALTER TABLE sector_annual_targets ADD COLUMN IF NOT EXISTS fin_compliance_target NUMERIC DEFAULT 85;`).catch(() => {});

  // Report Templates table
  pool.query(`
    CREATE TABLE IF NOT EXISTS report_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      columns JSONB NOT NULL DEFAULT '[]',
      filters JSONB NOT NULL DEFAULT '{}',
      is_shared BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `).catch(() => {});

  // Contracts system migration
  (async () => {
    try {
      // Extension for overlap exclusion constraint
      await pool.query(`CREATE EXTENSION IF NOT EXISTS btree_gist`);

      // Contracts table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS contracts (
          id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          sector_id    UUID NOT NULL REFERENCES sectors(id) ON DELETE RESTRICT,
          contract_number TEXT NOT NULL,
          start_date   DATE NOT NULL,
          end_date     DATE NOT NULL,
          notes        TEXT,
          archived_at  TIMESTAMPTZ,
          created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT contracts_dates_check CHECK (end_date >= start_date)
        )
      `);

      // Overlap exclusion constraint (only for active contracts)
      await pool.query(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'contracts_no_overlap'
          ) THEN
            ALTER TABLE contracts ADD CONSTRAINT contracts_no_overlap
              EXCLUDE USING gist (sector_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
              WHERE (archived_at IS NULL);
          END IF;
        END $$
      `);

      // Contract attachments table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS contract_attachments (
          id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
          user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
          name        TEXT NOT NULL,
          url         TEXT NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      // contract_id column on work_orders
      await pool.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS contract_id UUID REFERENCES contracts(id) ON DELETE SET NULL`);

      // Permission columns on role_definitions
      await pool.query(`ALTER TABLE role_definitions ADD COLUMN IF NOT EXISTS can_view_contracts BOOLEAN NOT NULL DEFAULT FALSE`);
      await pool.query(`ALTER TABLE role_definitions ADD COLUMN IF NOT EXISTS can_manage_contracts BOOLEAN NOT NULL DEFAULT FALSE`);
      await pool.query(`UPDATE role_definitions SET can_view_contracts = TRUE, can_manage_contracts = TRUE WHERE role_key = 'ADMIN'`);

      console.log('[MIGRATION] contracts tables ready.');
    } catch (err: any) {
      console.warn('[MIGRATION] contracts setup:', err?.message ?? err);
    }
  })();

  console.log("PostgreSQL database initialized.");
}
