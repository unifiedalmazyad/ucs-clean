-- Add new work_order columns
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS completion_cert_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invoice_billing_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invoice_2_number TEXT,
  ADD COLUMN IF NOT EXISTS financial_close_date TIMESTAMPTZ;

-- Fix role_definitions if can_manage_targets column is missing
ALTER TABLE role_definitions
  ADD COLUMN IF NOT EXISTS can_manage_targets BOOLEAN DEFAULT FALSE;
