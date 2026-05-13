INSERT INTO periodic_kpi_metrics
  (code, name_ar, name_en, is_enabled, metric_type, start_mode, start_column_key,
   end_mode, end_column_key, threshold_days, use_exec_sla, order_index)
VALUES
  ('FIN_CLOSURE', 'متوسط أيام الإغلاق المالي', 'Avg. Financial Closure Days',
   true, 'DATE_DIFF',
   'COLUMN_DATE', 'proc_155_close_date',
   'COLUMN_DATE', 'financial_close_date',
   20, false, 105)
ON CONFLICT (code) DO UPDATE
  SET name_ar          = EXCLUDED.name_ar,
      name_en          = EXCLUDED.name_en,
      is_enabled       = EXCLUDED.is_enabled,
      metric_type      = EXCLUDED.metric_type,
      start_mode       = EXCLUDED.start_mode,
      start_column_key = EXCLUDED.start_column_key,
      end_mode         = EXCLUDED.end_mode,
      end_column_key   = EXCLUDED.end_column_key,
      threshold_days   = EXCLUDED.threshold_days,
      use_exec_sla     = EXCLUDED.use_exec_sla,
      order_index      = EXCLUDED.order_index;
