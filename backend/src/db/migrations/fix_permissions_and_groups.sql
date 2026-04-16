-- =============================================================
-- Migration: Fix permissions for new fields + clean up groups
-- =============================================================

-- ─── 1. Disable empty/unused column groups ────────────────────────────────────
UPDATE column_groups SET active = FALSE WHERE key IN ('GIS_155', 'GIS');

-- ─── 2. Fix sort_order conflicts ─────────────────────────────────────────────
UPDATE column_groups SET sort_order = 1 WHERE key = 'BASE';
UPDATE column_groups SET sort_order = 2 WHERE key = 'OPS';
UPDATE column_groups SET sort_order = 3 WHERE key = 'COORD';
UPDATE column_groups SET sort_order = 4 WHERE key = 'PROCEDURE_155';
UPDATE column_groups SET sort_order = 5 WHERE key = 'FINANCE';
UPDATE column_groups SET sort_order = 90 WHERE key = 'GIS_155';
UPDATE column_groups SET sort_order = 91 WHERE key = 'GIS';

-- =============================================================
-- 3. Permissions for the 5 new COORDINATION fields
--    soil_type | expected_excavation_date | classified
--    current_request_number | current_request_type
-- =============================================================

-- Helper: insert all role×field combos with ON CONFLICT DO NOTHING
-- COORDINATOR: read + write
INSERT INTO role_column_permissions (id, role, table_name, column_key, can_read, can_write, updated_at)
SELECT gen_random_uuid(), 'COORDINATOR', 'work_orders', col, TRUE, TRUE, NOW()
FROM unnest(ARRAY['soil_type','expected_excavation_date','classified','current_request_number','current_request_type']) AS col
ON CONFLICT DO NOTHING;

-- COR: read + write
INSERT INTO role_column_permissions (id, role, table_name, column_key, can_read, can_write, updated_at)
SELECT gen_random_uuid(), 'COR', 'work_orders', col, TRUE, TRUE, NOW()
FROM unnest(ARRAY['soil_type','expected_excavation_date','classified','current_request_number','current_request_type']) AS col
ON CONFLICT DO NOTHING;

-- MANAGER: read only
INSERT INTO role_column_permissions (id, role, table_name, column_key, can_read, can_write, updated_at)
SELECT gen_random_uuid(), 'MANAGER', 'work_orders', col, TRUE, FALSE, NOW()
FROM unnest(ARRAY['soil_type','expected_excavation_date','classified','current_request_number','current_request_type']) AS col
ON CONFLICT DO NOTHING;

-- REGION_MANAGER: read only
INSERT INTO role_column_permissions (id, role, table_name, column_key, can_read, can_write, updated_at)
SELECT gen_random_uuid(), 'REGION_MANAGER', 'work_orders', col, TRUE, FALSE, NOW()
FROM unnest(ARRAY['soil_type','expected_excavation_date','classified','current_request_number','current_request_type']) AS col
ON CONFLICT DO NOTHING;

-- OPERATOR: read only
INSERT INTO role_column_permissions (id, role, table_name, column_key, can_read, can_write, updated_at)
SELECT gen_random_uuid(), 'OPERATOR', 'work_orders', col, TRUE, FALSE, NOW()
FROM unnest(ARRAY['soil_type','expected_excavation_date','classified','current_request_number','current_request_type']) AS col
ON CONFLICT DO NOTHING;

-- SECTOR_MANAGER: read only
INSERT INTO role_column_permissions (id, role, table_name, column_key, can_read, can_write, updated_at)
SELECT gen_random_uuid(), 'SECTOR_MANAGER', 'work_orders', col, TRUE, FALSE, NOW()
FROM unnest(ARRAY['soil_type','expected_excavation_date','classified','current_request_number','current_request_type']) AS col
ON CONFLICT DO NOTHING;

-- ASSISTANT: read only
INSERT INTO role_column_permissions (id, role, table_name, column_key, can_read, can_write, updated_at)
SELECT gen_random_uuid(), 'ASSISTANT', 'work_orders', col, TRUE, FALSE, NOW()
FROM unnest(ARRAY['soil_type','expected_excavation_date','classified','current_request_number','current_request_type']) AS col
ON CONFLICT DO NOTHING;

-- GIS: read only
INSERT INTO role_column_permissions (id, role, table_name, column_key, can_read, can_write, updated_at)
SELECT gen_random_uuid(), 'GIS', 'work_orders', col, TRUE, FALSE, NOW()
FROM unnest(ARRAY['soil_type','expected_excavation_date','classified','current_request_number','current_request_type']) AS col
ON CONFLICT DO NOTHING;

-- VIEWER: read only
INSERT INTO role_column_permissions (id, role, table_name, column_key, can_read, can_write, updated_at)
SELECT gen_random_uuid(), 'VIEWER', 'work_orders', col, TRUE, FALSE, NOW()
FROM unnest(ARRAY['soil_type','expected_excavation_date','classified','current_request_number','current_request_type']) AS col
ON CONFLICT DO NOTHING;

-- FINANCE: read only
INSERT INTO role_column_permissions (id, role, table_name, column_key, can_read, can_write, updated_at)
SELECT gen_random_uuid(), 'FINANCE', 'work_orders', col, TRUE, FALSE, NOW()
FROM unnest(ARRAY['soil_type','expected_excavation_date','classified','current_request_number','current_request_type']) AS col
ON CONFLICT DO NOTHING;

-- =============================================================
-- 4. Permissions for street_category (OPS field)
-- =============================================================

-- OPERATOR: read + write (fills this field)
INSERT INTO role_column_permissions (id, role, table_name, column_key, can_read, can_write, updated_at)
VALUES (gen_random_uuid(), 'OPERATOR', 'work_orders', 'street_category', TRUE, TRUE, NOW())
ON CONFLICT DO NOTHING;

-- ASSISTANT: read + write
INSERT INTO role_column_permissions (id, role, table_name, column_key, can_read, can_write, updated_at)
VALUES (gen_random_uuid(), 'ASSISTANT', 'work_orders', 'street_category', TRUE, TRUE, NOW())
ON CONFLICT DO NOTHING;

-- COORDINATOR: read only
INSERT INTO role_column_permissions (id, role, table_name, column_key, can_read, can_write, updated_at)
VALUES (gen_random_uuid(), 'COORDINATOR', 'work_orders', 'street_category', TRUE, FALSE, NOW())
ON CONFLICT DO NOTHING;

-- COR: read only
INSERT INTO role_column_permissions (id, role, table_name, column_key, can_read, can_write, updated_at)
VALUES (gen_random_uuid(), 'COR', 'work_orders', 'street_category', TRUE, FALSE, NOW())
ON CONFLICT DO NOTHING;

-- MANAGER: read only
INSERT INTO role_column_permissions (id, role, table_name, column_key, can_read, can_write, updated_at)
VALUES (gen_random_uuid(), 'MANAGER', 'work_orders', 'street_category', TRUE, FALSE, NOW())
ON CONFLICT DO NOTHING;

-- REGION_MANAGER: read only
INSERT INTO role_column_permissions (id, role, table_name, column_key, can_read, can_write, updated_at)
VALUES (gen_random_uuid(), 'REGION_MANAGER', 'work_orders', 'street_category', TRUE, FALSE, NOW())
ON CONFLICT DO NOTHING;

-- SECTOR_MANAGER: read only
INSERT INTO role_column_permissions (id, role, table_name, column_key, can_read, can_write, updated_at)
VALUES (gen_random_uuid(), 'SECTOR_MANAGER', 'work_orders', 'street_category', TRUE, FALSE, NOW())
ON CONFLICT DO NOTHING;

-- GIS: read only
INSERT INTO role_column_permissions (id, role, table_name, column_key, can_read, can_write, updated_at)
VALUES (gen_random_uuid(), 'GIS', 'work_orders', 'street_category', TRUE, FALSE, NOW())
ON CONFLICT DO NOTHING;

-- VIEWER: read only
INSERT INTO role_column_permissions (id, role, table_name, column_key, can_read, can_write, updated_at)
VALUES (gen_random_uuid(), 'VIEWER', 'work_orders', 'street_category', TRUE, FALSE, NOW())
ON CONFLICT DO NOTHING;

-- FINANCE: read only
INSERT INTO role_column_permissions (id, role, table_name, column_key, can_read, can_write, updated_at)
VALUES (gen_random_uuid(), 'FINANCE', 'work_orders', 'street_category', TRUE, FALSE, NOW())
ON CONFLICT DO NOTHING;
