-- Migration: Add street_category column and catalog entries
-- Run: psql $DATABASE_URL -f backend/src/db/migrations/add_street_category.sql

-- 1. Add column to work_orders table
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS street_category TEXT;

-- 2. Add to column_catalog (OPS group, select type)
INSERT INTO column_catalog
  (id, table_name, column_key, label_ar, label_en, group_key, category, data_type,
   is_sensitive, is_custom, is_enabled, show_in_create, sort_order, physical_key, created_at)
VALUES
  (gen_random_uuid(), 'work_orders', 'street_category', 'فئة الشارع', 'Street Category',
   'OPS', 'EXEC', 'select', FALSE, FALSE, TRUE, FALSE, 25, 'street_category', NOW())
ON CONFLICT (table_name, column_key) DO NOTHING;

-- 3. Add select options for street_category
INSERT INTO column_options (id, column_key, value, label_ar, label_en, sort_order, active)
VALUES
  (gen_random_uuid(), 'street_category', 'فئة أ ( مقاول الأمانة )',   'فئة أ ( مقاول الأمانة )',   'Cat A (Amanah Contractor)',  1, TRUE),
  (gen_random_uuid(), 'street_category', 'فئة أ ( إعادة من قبلنا )', 'فئة أ ( إعادة من قبلنا )', 'Cat A (Re-work by Us)',      2, TRUE),
  (gen_random_uuid(), 'street_category', 'فئة ب',                     'فئة ب',                     'Category B',                3, TRUE),
  (gen_random_uuid(), 'street_category', 'فئة ب ( استخدام الفرادة )', 'فئة ب ( استخدام الفرادة )', 'Cat B (Single Use)',         4, TRUE)
ON CONFLICT DO NOTHING;

-- 4. Add ADMIN read/write permission
INSERT INTO role_column_permissions (id, role, table_name, column_key, can_read, can_write, updated_at)
VALUES
  (gen_random_uuid(), 'ADMIN', 'work_orders', 'street_category', TRUE, TRUE, NOW())
ON CONFLICT DO NOTHING;
