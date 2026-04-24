-- Migration: Contracts System (عقود القطاعات)
-- Run: psql $DATABASE_URL -f backend/src/db/migrations/add_contracts.sql
--
-- What this does:
--   1. Creates contracts table with soft-delete (archived_at)
--   2. Creates contract_attachments table (reuses upload infrastructure)
--   3. Adds contract_id (system-managed) to work_orders
--   4. Adds canViewContracts / canManageContracts flags to role_definitions
--   5. Adds DB-level overlap prevention via btree_gist EXCLUDE constraint

-- ── 1. Enable btree_gist for overlap constraint ───────────────────────────────
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── 2. contracts table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contracts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sector_id       UUID NOT NULL REFERENCES sectors(id),
  contract_number TEXT NOT NULL,
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  notes           TEXT,
  archived_at     TIMESTAMP,                             -- NULL = active, set = archived
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT contracts_dates_check CHECK (end_date >= start_date)
);

-- Overlap prevention: two active contracts for the same sector cannot share a date range.
-- archived contracts are excluded from this constraint.
-- Uses a partial EXCLUDE on non-archived rows only (via a computed expression trick).
-- Note: archived_at IS NOT NULL contracts are allowed to overlap (historical data).
ALTER TABLE contracts
  ADD CONSTRAINT contracts_no_overlap
  EXCLUDE USING gist (
    sector_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  )
  WHERE (archived_at IS NULL);

-- ── 3. contract_attachments table ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contract_attachments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  url         TEXT NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── 4. Add contract_id to work_orders ─────────────────────────────────────────
-- System-managed column — never written by users directly.
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS contract_id UUID REFERENCES contracts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS wo_contract_id_idx ON work_orders(contract_id);
CREATE INDEX IF NOT EXISTS wo_sector_assignment_idx ON work_orders(sector_id, assignment_date);
CREATE INDEX IF NOT EXISTS contracts_sector_dates_idx ON contracts(sector_id, start_date, end_date);

-- ── 5. Add permission flags to role_definitions ───────────────────────────────
ALTER TABLE role_definitions
  ADD COLUMN IF NOT EXISTS can_view_contracts    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS can_manage_contracts  BOOLEAN NOT NULL DEFAULT FALSE;

-- ADMIN role definition gets full access
UPDATE role_definitions
  SET can_view_contracts = TRUE, can_manage_contracts = TRUE
  WHERE role_key = 'ADMIN';
