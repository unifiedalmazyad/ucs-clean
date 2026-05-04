import { pgTable, uuid, text, timestamp, boolean, numeric, jsonb, pgEnum, uniqueIndex, integer, date, serial, varchar } from 'drizzle-orm/pg-core';

// Enums
export const roleEnum = ['ADMIN', 'MANAGER', 'OPERATOR', 'COORDINATOR', 'GIS', 'FINANCE', 'ASSISTANT', 'VIEWER'] as const;
export type Role = (typeof roleEnum)[number];

// Regions Table
export const regions = pgTable('regions', {
  id: uuid('id').primaryKey().defaultRandom(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en'),
  sectorId: uuid('sector_id').references(() => sectors.id),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Sectors Table
export const sectors = pgTable('sectors', {
  id: uuid('id').primaryKey().defaultRandom(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Users Table
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').notNull().unique(),
  fullName: text('full_name'),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('OPERATOR'),
  regionId: uuid('region_id').references(() => regions.id),
  sectorId: uuid('sector_id').references(() => sectors.id),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  // Contact & identity fields
  employeeId: text('employee_id'),
  phoneNumber: text('phone_number'),
  email: text('email'),
});

// Work Orders Table
export const workOrders = pgTable('work_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  
  // Business Columns (Arabic labels in UI)
  workType: text('work_type'), // نوع العمل
  orderNumber: text('order_number'), // امر العمل
  client: text('client'), // العميل
  assignmentDate: timestamp('assignment_date'), // تاريخ الاسناد
  district: text('district'), // الحي / الموقع
  projectType: text('project_type'), // نوعية المشروع
  station: text('station'), // المحطة
  length: numeric('length'), // الطول
  consultant: text('consultant'), // الاستشاري
  surveyDate: timestamp('survey_date'), // تاريخ المسح
  coordinationDate: timestamp('coordination_date'), // تاريخ التنسيق
  coordinationCertNumber: text('coordination_cert_number'), // رقم شهادة التنسيق
  notes: text('notes'), // ملاحظات
  drillingTeam: text('drilling_team'), // فريق الحفر
  drillingDate: timestamp('drilling_date'), // تاريخ الحفر
  shutdownDate: timestamp('shutdown_date'), // تاريخ التطفئة
  procedure: text('procedure'), // الاجراء
  holdReason: text('hold_reason'), // سبب تعليق الإجراء
  materialSheetDate: timestamp('material_sheet_date'), // تاريخ استلام ورقة المواد
  checkSheetsDate: timestamp('check_sheets_date'), // تاريخ استلام اوراق تشيك
  meteringSheetDate: timestamp('metering_sheet_date'), // تاريخ تجهيز ورقة التمتير
  gisCompletionDate: timestamp('gis_completion_date'), // تاريخ الانتهاء من GIS
  proc155CloseDate: timestamp('proc_155_close_date'), // تاريخ اقفال اجراء 155
  completionCertConfirm: boolean('completion_cert_confirm'), // تأكيد شهادة إنجاز
  completionCertDate: timestamp('completion_cert_date'),   // تاريخ شهادة الإنجاز
  invoiceBillingDate:  timestamp('invoice_billing_date'),    // تاريخ إصدار الفاتورة 1
  invoice2BillingDate: timestamp('invoice_2_billing_date'),  // تاريخ إصدار الفاتورة 2
  financialCloseDate:  timestamp('financial_close_date'),    // تاريخ الإغلاق المالي
  invoice2Number: text('invoice_2_number'),                  // رقم المستخلص الثاني
  estimatedValue: numeric('estimated_value'), // القيمة التقديرية
  invoiceNumber: text('invoice_number'), // رقم المستخلص
  actualInvoiceValue: numeric('actual_invoice_value'), // القيمة الفعلية للفاتورة
  invoiceType: text('invoice_type'), // نوع المستخلص
  invoice1: numeric('invoice_1'), // مستخلص 1
  invoice2: numeric('invoice_2'), // مستخلص 2
  collectedAmount: numeric('collected_amount'), // القيمة المحصله
  remainingAmount: numeric('remaining_amount'), // المتبقى
  customFields: jsonb('custom_fields').default({}),

  // Delay classification — تصنيف التأخير
  execDelayJustified: boolean('exec_delay_justified').default(false),
  execDelayReason:    text('exec_delay_reason'),
  finDelayJustified:  boolean('fin_delay_justified').default(false),
  finDelayReason:     text('fin_delay_reason'),

  // Execution status classification — حالة التنفيذ (يدوي)
  workStatusClassification: text('work_status_classification'),

  // Street category — فئة الشارع
  streetCategory: text('street_category'),

  // Coordination fields — حقول التنسيق
  soilType:                 text('soil_type'),
  expectedExcavationDate:   timestamp('expected_excavation_date'),
  classified:               text('classified'),
  currentRequestNumber:     text('current_request_number'),
  currentRequestType:       text('current_request_type'),

  // Region / Sector
  regionId:   uuid('region_id').references(() => regions.id),
  sectorId:   uuid('sector_id').references(() => sectors.id),
  // Contract — system-managed, never written by users directly
  contractId: uuid('contract_id').references(() => contracts.id, { onDelete: 'set null' }),

  // Metadata
  status: text('status').default('PENDING'),
  stage: text('stage').default('BASIC'),
  stageId: uuid('stage_id').references(() => stages.id),
  createdBy: uuid('created_by').references(() => users.id),
  updatedBy: uuid('updated_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Column Groups Table
export const columnGroups = pgTable('column_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en'),
  sortOrder: integer('sort_order').default(0),
  active: boolean('active').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Column Categories (EXEC = تنفيذي, FIN = مالي, custom...)
export const columnCategories = pgTable('column_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  nameAr: text('name_ar').notNull(),
  sortOrder: integer('sort_order').default(0),
  active: boolean('active').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Column Catalog
export const columnCatalog = pgTable('column_catalog', {
  id: uuid('id').primaryKey().defaultRandom(),
  tableName: text('table_name').notNull(),
  columnKey: text('column_key').notNull(),
  physicalKey: text('physical_key'), // actual DB column name — set once, NEVER changed on rename
  labelAr: text('label_ar').notNull(),
  labelEn: text('label_en'),
  groupKey: text('group_key').notNull().references(() => columnGroups.key),
  category: text('category').default('EXEC'), // EXEC / FIN
  dataType: text('data_type').notNull(),
  isSensitive: boolean('is_sensitive').default(false),
  isCustom: boolean('is_custom').default(false),
  isEnabled: boolean('is_enabled').default(true),
  showInCreate: boolean('show_in_create').default(false),
  sortOrder: integer('sort_order').default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  unq: uniqueIndex('table_col_unq').on(table.tableName, table.columnKey),
}));

// Column Options Table
export const columnOptions = pgTable('column_options', {
  id: uuid('id').primaryKey().defaultRandom(),
  columnKey: text('column_key').notNull(),
  value: text('value').notNull(),
  labelAr: text('label_ar').notNull(),
  labelEn: text('label_en'),
  sortOrder: integer('sort_order').default(0),
  active: boolean('active').default(true),
});

// Role Column Permissions
export const roleColumnPermissions = pgTable('role_column_permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  role: text('role').notNull(),
  tableName: text('table_name').notNull(),
  columnKey: text('column_key').notNull(),
  canRead: boolean('can_read').notNull().default(false),
  canWrite: boolean('can_write').notNull().default(false),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  unq: uniqueIndex('role_table_col_unq').on(table.role, table.tableName, table.columnKey),
}));

// User Column Overrides
export const userColumnOverrides = pgTable('user_column_overrides', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  tableName: text('table_name').notNull(),
  columnKey: text('column_key').notNull(),
  canRead: boolean('can_read'),
  canWrite: boolean('can_write'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  unq: uniqueIndex('user_table_col_unq').on(table.userId, table.tableName, table.columnKey),
}));

// Stages Table
export const stages = pgTable('stages', {
  id: uuid('id').primaryKey().defaultRandom(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en'),
  category: text('category').notNull(), // EXEC / FIN
  seq: integer('seq').notNull().default(0),
  isTerminal: boolean('is_terminal').notNull().default(false),
  isCancelled: boolean('is_cancelled').notNull().default(false),
  active: boolean('active').notNull().default(true),
  startColumnKey: text('start_column_key'), // عمود بداية الإجراء
  endColumnKey: text('end_column_key'),     // عمود نهاية الإجراء
  isDynamic: boolean('is_dynamic').notNull().default(false), // حساب ديناميكي
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// KPI Templates Table
export const kpiTemplates = pgTable('kpi_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  nameAr: text('name_ar').notNull(),
  category: text('category').notNull(), // EXEC / FIN
  defaultSlaDays: integer('default_sla_days').notNull().default(0),
  seq: integer('seq').notNull().default(0),
  active: boolean('active').notNull().default(true),
  displayScope: text('display_scope').notNull().default('ORDER'), // ORDER | REPORT | DASHBOARD
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// KPI Rules Table
export const kpiRules = pgTable('kpi_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  templateId: uuid('template_id').references(() => kpiTemplates.id).notNull(),
  nameOverrideAr: text('name_override_ar'),
  category: text('category').notNull(),
  startMode: text('start_mode').notNull().default('COLUMN_DATE'), // COLUMN_DATE | STAGE
  startColumnKey: text('start_column_key'),
  startStageId: uuid('start_stage_id').references(() => stages.id),
  endMode: text('end_mode').notNull().default('COLUMN_DATE'), // COLUMN_DATE | STAGE
  endColumnKey: text('end_column_key'),
  endStageId: uuid('end_stage_id').references(() => stages.id),
  slaDaysOverride: integer('sla_days_override'),
  calcMode: text('calc_mode').notNull(), // DATES, START_PLUS_SLA, STAGE_BASED
  workTypeFilter: text('work_type_filter'),
  sectorIdFilter: uuid('sector_id_filter').references(() => sectors.id),
  regionIdFilter: uuid('region_id_filter').references(() => regions.id),
  alertEnabled: boolean('alert_enabled').default(true),
  warnThresholdPercent: integer('warn_threshold_percent').default(80),
  warnThresholdDays: integer('warn_threshold_days'), // warn X days before SLA expiry
  showOnDashboard: boolean('show_on_dashboard').default(true),
  active: boolean('active').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Work Order KPI Cache
export const workOrderKpiCache = pgTable('work_order_kpi_cache', {
  id: uuid('id').primaryKey().defaultRandom(),
  workOrderId: uuid('work_order_id').references(() => workOrders.id).notNull(),
  kpiRuleId: uuid('kpi_rule_id').references(() => kpiRules.id).notNull(),
  computedAt: timestamp('computed_at').defaultNow().notNull(),
  elapsedDays: integer('elapsed_days'),
  remainingDays: integer('remaining_days'),
  status: text('status').notNull(), // OK, WARN, OVERDUE, INCOMPLETE
  details: jsonb('details'),
}, (table) => ({
  unq: uniqueIndex('wo_kpi_unq').on(table.workOrderId, table.kpiRuleId),
}));

// Role Definitions (dynamic roles)
export const roleDefinitions = pgTable('role_definitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  roleKey: text('role_key').notNull().unique(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en'),
  scopeType: text('scope_type').notNull().default('ALL'), // ALL | OWN_SECTOR | OWN_REGION
  canCreateOrder: boolean('can_create_order').default(false),
  canDeleteOrder: boolean('can_delete_order').default(false),
  canEditExecution: boolean('can_edit_execution').default(true),
  canViewExcavationPermits: boolean('can_view_excavation_permits').default(true),
  canEditExcavationPermits: boolean('can_edit_excavation_permits').default(false),
  canDeleteExcavationPermits: boolean('can_delete_excavation_permits').default(false),
  canViewExecutiveDashboard: boolean('can_view_executive_dashboard').default(false),
  canViewExecKpiCards: boolean('can_view_exec_kpi_cards').default(true),
  canViewFinKpiCards:       boolean('can_view_fin_kpi_cards').default(true),
  canViewPeriodicReport:    boolean('can_view_periodic_report').default(false),
  canManageTargets:         boolean('can_manage_targets').default(false),
  canViewContracts:         boolean('can_view_contracts').default(false),
  canManageContracts:       boolean('can_manage_contracts').default(false),
  isSystem: boolean('is_system').default(false),
  active: boolean('active').default(true),
  sortOrder: integer('sort_order').default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Report Templates (قوالب التقارير المحفوظة)
export const reportTemplates = pgTable('report_templates', {
  id:        uuid('id').primaryKey().defaultRandom(),
  name:      text('name').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  columns:   jsonb('columns').notNull().$type<string[]>().default([]),
  filters:   jsonb('filters').notNull().$type<Record<string,string>>().default({}),
  isShared:  boolean('is_shared').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Report Exports Log
export const reportExports = pgTable('report_exports', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  actorRole: text('actor_role').notNull(),
  fileName: text('file_name').notNull(),
  rowCount: integer('row_count').notNull().default(0),
  columns: jsonb('columns').notNull().$type<string[]>().default([]),
  filters: jsonb('filters').notNull().$type<Record<string,string>>().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Work Order Notes
export const workOrderNotes = pgTable('work_order_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  workOrderId: uuid('work_order_id').notNull().references(() => workOrders.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const workOrderAttachments = pgTable('work_order_attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  workOrderId: uuid('work_order_id').notNull().references(() => workOrders.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  url: text('url').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Excavation Permits (sub-table linked to work_orders) ─────────────────────
export const excavationPermits = pgTable('excavation_permits', {
  id: uuid('id').primaryKey().defaultRandom(),
  workOrderId: uuid('work_order_id').notNull().references(() => workOrders.id, { onDelete: 'cascade' }),
  permitNo: text('permit_no').notNull(),
  startDate: date('start_date'),
  endDate: date('end_date'),
  extensionNumber: integer('extension_number').notNull().default(0),
  isExtension: boolean('is_extension').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  entityType: text('entity_type').notNull(), // WORK_ORDER, USER, etc
  entityId: uuid('entity_id'),
  action: text('action').notNull(), // LOGIN, CREATE, UPDATE, etc
  changes: jsonb('changes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Periodic Performance KPI — 3 independent tables (never touch existing KPIs) ──

export const periodicKpiExecutionRules = pgTable('periodic_kpi_execution_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectTypeValue: text('project_type_value').notNull().unique(),
  projectTypeLabelAr: text('project_type_label_ar').notNull(),
  isEnabled: boolean('is_enabled').notNull().default(true),
  slaDays: integer('sla_days').notNull().default(30),
  warningDays: integer('warning_days').notNull().default(5),
  startMode: text('start_mode').notNull().default('COLUMN_DATE'), // COLUMN_DATE | STAGE_EVENT
  startColumnKey: text('start_column_key'),
  startStageId: uuid('start_stage_id'),
  endMode: text('end_mode').notNull().default('COLUMN_DATE'), // COLUMN_DATE | STAGE_EVENT
  endColumnKey: text('end_column_key'),
  endStageId: uuid('end_stage_id'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const periodicKpiFinancialRule = pgTable('periodic_kpi_financial_rule', {
  id: uuid('id').primaryKey().defaultRandom(),
  isEnabled: boolean('is_enabled').notNull().default(true),
  slaDays: integer('sla_days').notNull().default(20),
  warningDays: integer('warning_days').notNull().default(3),
  startMode: text('start_mode').notNull().default('COLUMN_DATE'),
  startColumnKey: text('start_column_key'),
  startStageId: uuid('start_stage_id'),
  endMode: text('end_mode').notNull().default('COLUMN_DATE'),
  endColumnKey: text('end_column_key'),
  endStageId: uuid('end_stage_id'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const periodicKpiReportSettings = pgTable('periodic_kpi_report_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  defaultDateRangeMode: text('default_date_range_mode').notNull().default('week'),
  avgModeDefault: text('avg_mode_default').notNull().default('All'),
  includeCancelled: boolean('include_cancelled').notNull().default(false),
  includeCompleted: boolean('include_completed').notNull().default(true),
  enableFocusMode: boolean('enable_focus_mode').notNull().default(false),
  regionCardsPerRow: integer('region_cards_per_row').notNull().default(3),
  projectCardsPerRow: integer('project_cards_per_row').notNull().default(3),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Periodic KPI Metrics (configurable multi-average engine) ────────────────
export const periodicKpiMetrics = pgTable('periodic_kpi_metrics', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en'),
  isEnabled: boolean('is_enabled').notNull().default(true),
  metricType: text('metric_type').notNull().default('DATE_DIFF'), // DATE_DIFF | NUMERIC_AGG
  // DATE_DIFF fields
  startMode: text('start_mode').notNull().default('COLUMN_DATE'), // COLUMN_DATE | STAGE_EVENT
  startColumnKey: text('start_column_key'),
  startStageId: uuid('start_stage_id'),
  endMode: text('end_mode').notNull().default('COLUMN_DATE'), // COLUMN_DATE | STAGE_EVENT | TODAY
  endColumnKey: text('end_column_key'),
  endStageId: uuid('end_stage_id'),
  // NUMERIC_AGG fields
  aggFunction: text('agg_function'), // SUM | AVG | MIN | MAX
  valueColumnKey: text('value_column_key'), // numeric column from column_catalog
  // Common
  thresholdDays: integer('threshold_days'),
  useExecSla: boolean('use_exec_sla').notNull().default(false), // if true: use project-type SLA as threshold instead of thresholdDays
  excludedProjectTypes: text('excluded_project_types').default('[]'), // JSON array of projectTypeValue strings to hide this metric from
  orderIndex: integer('order_index').notNull().default(0),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── User Report Column Preferences ─────────────────────────────────────────
export const userReportColumnPrefs = pgTable('user_report_column_prefs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  reportKey: text('report_key').notNull(),
  tableKey: text('table_key').notNull(),
  selectedColumnKeys: jsonb('selected_column_keys').notNull().$type<string[]>().default([]),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  unq: uniqueIndex('user_report_col_prefs_unq').on(table.userId, table.reportKey, table.tableKey),
}));

// ─── Import/Export Logs (additive only — does not touch existing tables) ─────
export const importRuns = pgTable('import_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  module: text('module').notNull(),        // 'work_orders' | 'users'
  uploadedBy: uuid('uploaded_by').references(() => users.id),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
  status: text('status').notNull().default('PENDING'), // PENDING | DONE | FAILED
  inserted: integer('inserted').notNull().default(0),
  updated: integer('updated').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  errorsJson: jsonb('errors_json').default([]),
});

// ─── Integrations ────────────────────────────────────────────────────────────
export const integrations = pgTable('integrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),                   // n8n | jisr | odoo | custom
  name: text('name').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  baseUrl: text('base_url'),
  authType: text('auth_type').default('api_key'),          // api_key | basic | oauth2 | odoo_jsonrpc
  syncMode: text('sync_mode').default('manual'),           // webhook | pull | manual
  apiKey: text('api_key'),
  username: text('username'),
  password: text('password'),
  clientId: text('client_id'),
  clientSecret: text('client_secret'),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  webhookSecret: text('webhook_secret'),
  lastSyncAt: timestamp('last_sync_at'),
  lastStatus: text('last_status').default('never_run'),    // success | failed | never_run
  lastError: text('last_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Executive Dashboard Targets
export const executiveTargets = pgTable('executive_targets', {
  id: uuid('id').primaryKey().defaultRandom(),
  year: integer('year').notNull(),
  execClosureTarget: integer('exec_closure_target'),           // مستهدف الإغلاق التنفيذي (عدد أوامر)
  financialCollectionTarget: numeric('financial_collection_target'), // مستهدف الإغلاق المالي (تحصيل)
  financialInvoicingTarget: numeric('financial_invoicing_target'),   // مستهدف الفوترة
  noteAr: text('note_ar'),
  noteEn: text('note_en'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  updatedBy: text('updated_by'),
});

// بنود المستهدفات المخصصة القابلة للتعديل والحذف (deprecated — kept for DB compatibility)
export const annualTargetItems = pgTable('annual_target_items', {
  id: serial('id').primaryKey(),
  year: integer('year').notNull(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en'),
  category: text('category').notNull().default('EXEC'),
  unit: text('unit').notNull().default('COUNT'),
  targetValue: numeric('target_value'),
  sortOrder: integer('sort_order').notNull().default(0),
  enabled: boolean('enabled').notNull().default(true),
});

// مستهدفات القطاعات السنوية (deprecated — kept for DB compatibility)
export const executiveSectorTargets = pgTable('executive_sector_targets', {
  id: uuid('id').primaryKey().defaultRandom(),
  year: integer('year').notNull(),
  sectorId: text('sector_id').notNull(),
  execClosureTarget: integer('exec_closure_target'),
  financialCollectionTarget: numeric('financial_collection_target'),
  financialInvoicingTarget: numeric('financial_invoicing_target'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  updatedBy: text('updated_by'),
});

// ─── Contracts (عقود القطاعات) ───────────────────────────────────────────────
// Overlap prevention is enforced at API level AND via DB exclusion constraint in migration SQL.
// contract_id on work_orders is system-managed only — never written directly by users.
export const contracts = pgTable('contracts', {
  id:             uuid('id').primaryKey().defaultRandom(),
  sectorId:       uuid('sector_id').notNull().references(() => sectors.id),
  contractNumber: text('contract_number').notNull(),
  startDate:      date('start_date').notNull(),
  endDate:        date('end_date').notNull(),
  notes:          text('notes'),
  archivedAt:     timestamp('archived_at'),           // null = active, set = archived (soft delete)
  createdBy:      uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt:      timestamp('created_at').defaultNow().notNull(),
  updatedAt:      timestamp('updated_at').defaultNow().notNull(),
});

export const contractAttachments = pgTable('contract_attachments', {
  id:         uuid('id').primaryKey().defaultRandom(),
  contractId: uuid('contract_id').notNull().references(() => contracts.id, { onDelete: 'cascade' }),
  userId:     uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  name:       text('name').notNull(),
  url:        text('url').notNull(),
  createdAt:  timestamp('created_at').defaultNow().notNull(),
});

// مستهدفات القطاعات بالنسبة المئوية (النظام الجديد)
export const sectorAnnualTargets = pgTable('sector_annual_targets', {
  id: uuid('id').primaryKey().defaultRandom(),
  year: integer('year').notNull(),
  sectorId: uuid('sector_id').notNull().references(() => sectors.id),
  // الجانب التنفيذي
  execComplianceTarget: numeric('exec_compliance_target').default('90'), // الالتزام التنفيذي %
  closureRateTarget: numeric('closure_rate_target').default('80'),       // الإنجاز (الإغلاق) %
  // الجانب المالي
  salesAmountTarget: numeric('sales_amount_target'),                     // المبيعات (مبلغ ريال)
  collectionRateTarget: numeric('collection_rate_target').default('75'), // التحصيل %
  finComplianceTarget: numeric('fin_compliance_target').default('85'),   // الالتزام المالي %
  // قديم (للتوافق فقط)
  salesRateTarget: numeric('sales_rate_target').default('90'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  updatedBy: text('updated_by'),
});

// ─── System Settings (key-value store for global app config) ─────────────────
export const systemSettings = pgTable('system_settings', {
  key:       varchar('key', { length: 100 }).primaryKey(),
  value:     text('value'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
