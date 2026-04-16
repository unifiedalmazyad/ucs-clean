-- Migration: Fix column group assignments + add 5 coordination fields
-- Run: psql $DATABASE_URL -f backend/src/db/migrations/fix_column_groups_and_coord_fields.sql

-- ─── 1. Add 5 new columns to work_orders ───────────────────────────────────────
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS soil_type               TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS expected_excavation_date TIMESTAMP;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS classified              TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS current_request_number  TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS current_request_type    TEXT;

-- ─── 2. Fix column group assignments ──────────────────────────────────────────

-- Move procedure + hold_reason from OPS → BASE (they are base info)
UPDATE column_catalog SET group_key = 'BASE' WHERE column_key IN ('procedure', 'hold_reason');

-- Move length from BASE → COORD
UPDATE column_catalog SET group_key = 'COORD' WHERE column_key = 'length';

-- Move survey_date from OPS → COORD
UPDATE column_catalog SET group_key = 'COORD' WHERE column_key = 'survey_date';

-- Move 155 fields from COORD → PROCEDURE_155
UPDATE column_catalog SET group_key = 'PROCEDURE_155'
  WHERE column_key IN ('material_sheet_date', 'check_sheets_date', 'completion_cert_confirm');

-- Move GIS fields from GIS_155 → PROCEDURE_155
UPDATE column_catalog SET group_key = 'PROCEDURE_155'
  WHERE column_key IN ('metering_sheet_date', 'gis_completion_date', 'proc_155_close_date');

-- ─── 3. Fix sort orders — BASE (101–112) ───────────────────────────────────────
UPDATE column_catalog SET sort_order = 101 WHERE column_key = 'sector_id';
UPDATE column_catalog SET sort_order = 102 WHERE column_key = 'region_id';
UPDATE column_catalog SET sort_order = 103 WHERE column_key = 'order_number';
UPDATE column_catalog SET sort_order = 104 WHERE column_key = 'work_type';
UPDATE column_catalog SET sort_order = 105 WHERE column_key = 'project_type';
UPDATE column_catalog SET sort_order = 106 WHERE column_key = 'district';
UPDATE column_catalog SET sort_order = 107 WHERE column_key = 'client';
UPDATE column_catalog SET sort_order = 108 WHERE column_key = 'station';
UPDATE column_catalog SET sort_order = 109 WHERE column_key = 'assignment_date';
UPDATE column_catalog SET sort_order = 110 WHERE column_key = 'consultant';
UPDATE column_catalog SET sort_order = 111 WHERE column_key = 'procedure';
UPDATE column_catalog SET sort_order = 112 WHERE column_key = 'hold_reason';

-- ─── 4. Fix sort orders — COORD (201–215) ──────────────────────────────────────
UPDATE column_catalog SET sort_order = 201 WHERE column_key = 'length';
UPDATE column_catalog SET sort_order = 202 WHERE column_key = 'survey_date';
UPDATE column_catalog SET sort_order = 203 WHERE column_key = 'survey_notes';
UPDATE column_catalog SET sort_order = 204 WHERE column_key = 'coordination_date';
UPDATE column_catalog SET sort_order = 205 WHERE column_key = 'coordination_cert_number';
-- new fields will be 206–210 (inserted below)

-- ─── 5. Fix sort orders — OPS (301–310) ────────────────────────────────────────
UPDATE column_catalog SET sort_order = 301 WHERE column_key = 'drilling_team';
UPDATE column_catalog SET sort_order = 302 WHERE column_key = 'drilling_date';
UPDATE column_catalog SET sort_order = 303 WHERE column_key = 'excavation_completion_date';
UPDATE column_catalog SET sort_order = 304 WHERE column_key = 'electrical_team';
UPDATE column_catalog SET sort_order = 305 WHERE column_key = 'd9_no';
UPDATE column_catalog SET sort_order = 306 WHERE column_key = 'shutdown_date';
UPDATE column_catalog SET sort_order = 307 WHERE column_key = 'execution_notes';
UPDATE column_catalog SET sort_order = 308 WHERE column_key = 'work_status_classification';
UPDATE column_catalog SET sort_order = 309 WHERE column_key = 'street_category';

-- ─── 6. Fix sort orders — PROCEDURE_155 (401–406) ──────────────────────────────
UPDATE column_catalog SET sort_order = 401 WHERE column_key = 'material_sheet_date';
UPDATE column_catalog SET sort_order = 402 WHERE column_key = 'check_sheets_date';
UPDATE column_catalog SET sort_order = 403 WHERE column_key = 'metering_sheet_date';
UPDATE column_catalog SET sort_order = 404 WHERE column_key = 'gis_completion_date';
UPDATE column_catalog SET sort_order = 405 WHERE column_key = 'proc_155_date';
UPDATE column_catalog SET sort_order = 406 WHERE column_key = 'proc_155_close_date';
UPDATE column_catalog SET sort_order = 407 WHERE column_key = 'completion_cert_confirm';

-- ─── 7. Fix sort orders — FINANCE (501–510) ────────────────────────────────────
UPDATE column_catalog SET sort_order = 501 WHERE column_key = 'invoice_number';
UPDATE column_catalog SET sort_order = 502 WHERE column_key = 'estimated_value';
UPDATE column_catalog SET sort_order = 503 WHERE column_key = 'invoice_type';
UPDATE column_catalog SET sort_order = 504 WHERE column_key = 'actual_invoice_value';
UPDATE column_catalog SET sort_order = 505 WHERE column_key = 'invoice_1';
UPDATE column_catalog SET sort_order = 506 WHERE column_key = 'invoice_2';
UPDATE column_catalog SET sort_order = 507 WHERE column_key = 'collected_amount';
UPDATE column_catalog SET sort_order = 508 WHERE column_key = 'remaining_amount';
UPDATE column_catalog SET sort_order = 509 WHERE column_key = 'financial_close_date';
UPDATE column_catalog SET sort_order = 510 WHERE column_key = 'finance_remarks';

-- ─── 8. Add 5 new coordination fields to column_catalog ────────────────────────
INSERT INTO column_catalog
  (id, table_name, column_key, label_ar, label_en, group_key, category, data_type,
   is_sensitive, is_custom, is_enabled, show_in_create, sort_order, physical_key, created_at)
VALUES
  (gen_random_uuid(), 'work_orders', 'soil_type',
   'نوع التربة', 'Soil Type',
   'COORD', 'EXEC', 'text', FALSE, FALSE, TRUE, FALSE, 206, 'soil_type', NOW()),

  (gen_random_uuid(), 'work_orders', 'expected_excavation_date',
   'التاريخ المتوقع للحفر', 'Expected Excavation Date',
   'COORD', 'EXEC', 'date', FALSE, FALSE, TRUE, FALSE, 207, 'expected_excavation_date', NOW()),

  (gen_random_uuid(), 'work_orders', 'classified',
   'مصنف', 'Classified',
   'COORD', 'EXEC', 'text', FALSE, FALSE, TRUE, FALSE, 208, 'classified', NOW()),

  (gen_random_uuid(), 'work_orders', 'current_request_number',
   'رقم الطلب الحالي', 'Current Request No.',
   'COORD', 'EXEC', 'text', FALSE, FALSE, TRUE, FALSE, 209, 'current_request_number', NOW()),

  (gen_random_uuid(), 'work_orders', 'current_request_type',
   'نوع الطلب الحالي', 'Current Request Type',
   'COORD', 'EXEC', 'text', FALSE, FALSE, TRUE, FALSE, 210, 'current_request_type', NOW())
ON CONFLICT (table_name, column_key) DO NOTHING;

-- ─── 9. Add ADMIN permissions for the 5 new fields ─────────────────────────────
INSERT INTO role_column_permissions (id, role, table_name, column_key, can_read, can_write, updated_at)
VALUES
  (gen_random_uuid(), 'ADMIN', 'work_orders', 'soil_type',                TRUE, TRUE, NOW()),
  (gen_random_uuid(), 'ADMIN', 'work_orders', 'expected_excavation_date', TRUE, TRUE, NOW()),
  (gen_random_uuid(), 'ADMIN', 'work_orders', 'classified',               TRUE, TRUE, NOW()),
  (gen_random_uuid(), 'ADMIN', 'work_orders', 'current_request_number',   TRUE, TRUE, NOW()),
  (gen_random_uuid(), 'ADMIN', 'work_orders', 'current_request_type',     TRUE, TRUE, NOW())
ON CONFLICT DO NOTHING;

-- ─── 10. Disable GIS_155 group (now empty after moving fields) ─────────────────
UPDATE column_groups SET is_enabled = FALSE WHERE key = 'GIS_155';

-- ─── 11. Hide the stray "notes" field in OPS (no label match in desired layout) ─
UPDATE column_catalog SET is_enabled = FALSE WHERE column_key = 'notes' AND group_key = 'OPS';
