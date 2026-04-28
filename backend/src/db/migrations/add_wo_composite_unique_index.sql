-- Partial unique index: prevents duplicate (order_number, work_type) among non-cancelled work orders.
-- CANCELLED orders are excluded so the system can keep a cancelled copy alongside an active one.
CREATE UNIQUE INDEX IF NOT EXISTS wo_active_order_work_uniq
  ON work_orders(order_number, work_type)
  WHERE status != 'CANCELLED';
