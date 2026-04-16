INSERT INTO periodic_kpi_metrics
  (code, name_ar, name_en, is_enabled, metric_type, start_mode, start_column_key,
   end_mode, end_column_key, threshold_days, use_exec_sla, order_index)
VALUES
  ('POST155_METERING',    'مؤشر أوراق التمتير',   'Metering Sheets',
   true, 'DATE_DIFF', 'COLUMN_DATE', 'proc_155_close_date', 'COLUMN_DATE', 'metering_sheet_date',    3,  false, 100),
  ('POST155_MATERIAL',    'مؤشر ورقة المواد',     'Material Sheet',
   true, 'DATE_DIFF', 'COLUMN_DATE', 'proc_155_close_date', 'COLUMN_DATE', 'material_sheet_date',    3,  false, 101),
  ('POST155_CHECKSHEETS', 'مؤشر أوراق التشييك',  'Check Sheets',
   true, 'DATE_DIFF', 'COLUMN_DATE', 'proc_155_close_date', 'COLUMN_DATE', 'check_sheets_date',      5,  false, 102),
  ('POST155_GIS',         'مؤشر GIS',             'GIS Completion',
   true, 'DATE_DIFF', 'COLUMN_DATE', 'proc_155_close_date', 'COLUMN_DATE', 'gis_completion_date',    10, false, 103),
  ('POST155_CERT',        'مؤشر شهادة الإنجاز',  'Completion Certificate',
   true, 'DATE_DIFF', 'COLUMN_DATE', 'proc_155_close_date', 'COLUMN_DATE', 'completion_cert_date',   25, false, 104)
ON CONFLICT (code) DO NOTHING;
