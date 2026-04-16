import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// SQLite doesn't have native UUID or Timestamp with TZ, so we use text/integer
// Stages Table
export const stages = sqliteTable('stages', {
  id: text('id').primaryKey().default(sql`(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))))`),
  nameAr: text('name_ar').notNull(),
  category: text('category').notNull(), // EXEC / FIN
  seq: integer('seq').notNull().default(0),
  isTerminal: integer('is_terminal', { mode: 'boolean' }).notNull().default(false),
  isCancelled: integer('is_cancelled', { mode: 'boolean' }).notNull().default(false),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Regions Table
export const regions = sqliteTable('regions', {
  id: text('id').primaryKey().default(sql`(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))))`),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en'),
  sectorId: text('sector_id').references(() => sectors.id),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Sectors Table
export const sectors = sqliteTable('sectors', {
  id: text('id').primaryKey().default(sql`(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))))`),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const users = sqliteTable('users', {
  id: text('id').primaryKey().default(sql`(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))))`),
  username: text('username').notNull().unique(),
  fullName: text('full_name'),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('OPERATOR'),
  regionId: text('region_id').references(() => regions.id),
  sectorId: text('sector_id').references(() => sectors.id),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const workOrders = sqliteTable('work_orders', {
  id: text('id').primaryKey().default(sql`(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))))`),
  
  workType: text('work_type'),
  orderNumber: text('order_number'),
  client: text('client'),
  assignmentDate: text('assignment_date'),
  district: text('district'),
  projectType: text('project_type'),
  station: text('station'),
  length: real('length'),
  consultant: text('consultant'),
  surveyDate: text('survey_date'),
  coordinationDate: text('coordination_date'),
  coordinationCertNumber: text('coordination_cert_number'),
  notes: text('notes'),
  drillingTeam: text('drilling_team'),
  drillingDate: text('drilling_date'),
  shutdownDate: text('shutdown_date'),
  procedure: text('procedure'),
  holdReason: text('hold_reason'),
  materialSheetDate: text('material_sheet_date'),
  checkSheetsDate: text('check_sheets_date'),
  meteringSheetDate: text('metering_sheet_date'),
  gisCompletionDate: text('gis_completion_date'),
  proc155CloseDate: text('proc_155_close_date'),
  completionCertConfirm: integer('completion_cert_confirm', { mode: 'boolean' }),
  estimatedValue: real('estimated_value'),
  invoiceNumber: text('invoice_number'),
  actualInvoiceValue: real('actual_invoice_value'),
  invoiceType: text('invoice_type'),
  invoice1: real('invoice_1'),
  invoice2: real('invoice_2'),
  collectedAmount: real('collected_amount'),
  remainingAmount: real('remaining_amount'),
  customFields: text('custom_fields', { mode: 'json' }).default('{}'),

  // Delay classification — تصنيف التأخير
  execDelayJustified: integer('exec_delay_justified', { mode: 'boolean' }).default(false),
  execDelayReason:    text('exec_delay_reason'),
  finDelayJustified:  integer('fin_delay_justified', { mode: 'boolean' }).default(false),
  finDelayReason:     text('fin_delay_reason'),

  status: text('status').default('PENDING'),
  stage: text('stage').default('BASIC'),
  stageId: text('stage_id').references(() => stages.id),
  createdBy: text('created_by').references(() => users.id),
  updatedBy: text('updated_by').references(() => users.id),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Column Groups Table
export const columnGroups = sqliteTable('column_groups', {
  id: text('id').primaryKey().default(sql`(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))))`),
  key: text('key').notNull().unique(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en'),
  sortOrder: integer('sort_order').default(0),
  active: integer('active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const columnCatalog = sqliteTable('column_catalog', {
  id: text('id').primaryKey().default(sql`(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))))`),
  tableName: text('table_name').notNull(),
  columnKey: text('column_key').notNull(),
  labelAr: text('label_ar').notNull(),
  labelEn: text('label_en'),
  groupKey: text('group_key').notNull().references(() => columnGroups.key),
  category: text('category').default('EXEC'),
  dataType: text('data_type').notNull(),
  isSensitive: integer('is_sensitive', { mode: 'boolean' }).default(false),
  isCustom: integer('is_custom', { mode: 'boolean' }).default(false),
  isEnabled: integer('is_enabled', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Column Options Table
export const columnOptions = sqliteTable('column_options', {
  id: text('id').primaryKey().default(sql`(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))))`),
  columnKey: text('column_key').notNull(),
  value: text('value').notNull(),
  labelAr: text('label_ar').notNull(),
  labelEn: text('label_en'),
  sortOrder: integer('sort_order').default(0),
  active: integer('active', { mode: 'boolean' }).default(true),
});

export const roleColumnPermissions = sqliteTable('role_column_permissions', {
  id: text('id').primaryKey().default(sql`(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))))`),
  role: text('role').notNull(),
  tableName: text('table_name').notNull(),
  columnKey: text('column_key').notNull(),
  canRead: integer('can_read', { mode: 'boolean' }).notNull().default(false),
  canWrite: integer('can_write', { mode: 'boolean' }).notNull().default(false),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const userColumnOverrides = sqliteTable('user_column_overrides', {
  id: text('id').primaryKey().default(sql`(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))))`),
  userId: text('user_id').references(() => users.id).notNull(),
  tableName: text('table_name').notNull(),
  columnKey: text('column_key').notNull(),
  canRead: integer('can_read', { mode: 'boolean' }),
  canWrite: integer('can_write', { mode: 'boolean' }),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const auditLogs = sqliteTable('audit_logs', {
  id: text('id').primaryKey().default(sql`(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))))`),
  actorUserId: text('actor_user_id').references(() => users.id),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id'),
  action: text('action').notNull(),
  changes: text('changes', { mode: 'json' }),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// KPI Templates Table
export const kpiTemplates = sqliteTable('kpi_templates', {
  id: text('id').primaryKey().default(sql`(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))))`),
  nameAr: text('name_ar').notNull(),
  category: text('category').notNull(), // EXEC / FIN
  defaultSlaDays: integer('default_sla_days').notNull().default(0),
  seq: integer('seq').notNull().default(0),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// KPI Rules Table
export const kpiRules = sqliteTable('kpi_rules', {
  id: text('id').primaryKey().default(sql`(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))))`),
  templateId: text('template_id').references(() => kpiTemplates.id).notNull(),
  nameOverrideAr: text('name_override_ar'),
  category: text('category').notNull(),
  startColumnKey: text('start_column_key').notNull(),
  endMode: text('end_mode').notNull().default('COLUMN_DATE'), // COLUMN_DATE | STAGE
  endColumnKey: text('end_column_key'),
  endStageId: text('end_stage_id').references(() => stages.id),
  slaDaysOverride: integer('sla_days_override'),
  calcMode: text('calc_mode').notNull(), // DATES, START_PLUS_SLA, STAGE_BASED
  workTypeFilter: text('work_type_filter'),
  sectorIdFilter: text('sector_id_filter').references(() => sectors.id),
  regionIdFilter: text('region_id_filter').references(() => regions.id),
  alertEnabled: integer('alert_enabled', { mode: 'boolean' }).default(true),
  warnThresholdPercent: integer('warn_threshold_percent').default(80),
  showOnDashboard: integer('show_on_dashboard', { mode: 'boolean' }).default(true),
  active: integer('active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Work Order KPI Cache
export const workOrderKpiCache = sqliteTable('work_order_kpi_cache', {
  id: text('id').primaryKey().default(sql`(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))))`),
  workOrderId: text('work_order_id').references(() => workOrders.id).notNull(),
  kpiRuleId: text('kpi_rule_id').references(() => kpiRules.id).notNull(),
  computedAt: text('computed_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  elapsedDays: integer('elapsed_days'),
  remainingDays: integer('remaining_days'),
  status: text('status').notNull(), // OK, WARN, OVERDUE, INCOMPLETE
  details: text('details', { mode: 'json' }),
});

// ─── Excavation Permits ──────────────────────────────────────────────────────
export const excavationPermits = sqliteTable('excavation_permits', {
  id: text('id').primaryKey().default(sql`(lower(hex(randomblob(16))))`),
  workOrderId: text('work_order_id').references(() => workOrders.id).notNull(),
  permitNo: text('permit_no').notNull(),
  startDate: text('start_date'),
  endDate: text('end_date'),
  extensionNumber: integer('extension_number').notNull().default(0),
  isExtension: integer('is_extension', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ─── Periodic Performance KPI ─────────────────────────────────────────────────
const _uuidSql = sql`(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))))`;

export const periodicKpiExecutionRules = sqliteTable('periodic_kpi_execution_rules', {
  id: text('id').primaryKey().default(_uuidSql),
  projectTypeValue: text('project_type_value').notNull().unique(),
  projectTypeLabelAr: text('project_type_label_ar').notNull(),
  isEnabled: integer('is_enabled', { mode: 'boolean' }).notNull().default(true),
  slaDays: integer('sla_days').notNull().default(30),
  warningDays: integer('warning_days').notNull().default(5),
  startMode: text('start_mode').notNull().default('COLUMN_DATE'),
  startColumnKey: text('start_column_key'),
  startStageId: text('start_stage_id'),
  endMode: text('end_mode').notNull().default('COLUMN_DATE'),
  endColumnKey: text('end_column_key'),
  endStageId: text('end_stage_id'),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const periodicKpiFinancialRule = sqliteTable('periodic_kpi_financial_rule', {
  id: text('id').primaryKey().default(_uuidSql),
  isEnabled: integer('is_enabled', { mode: 'boolean' }).notNull().default(true),
  slaDays: integer('sla_days').notNull().default(20),
  warningDays: integer('warning_days').notNull().default(3),
  startMode: text('start_mode').notNull().default('COLUMN_DATE'),
  startColumnKey: text('start_column_key'),
  startStageId: text('start_stage_id'),
  endMode: text('end_mode').notNull().default('COLUMN_DATE'),
  endColumnKey: text('end_column_key'),
  endStageId: text('end_stage_id'),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const periodicKpiReportSettings = sqliteTable('periodic_kpi_report_settings', {
  id: text('id').primaryKey().default(_uuidSql),
  defaultDateRangeMode: text('default_date_range_mode').notNull().default('week'),
  avgModeDefault: text('avg_mode_default').notNull().default('All'),
  includeCancelled: integer('include_cancelled', { mode: 'boolean' }).notNull().default(false),
  includeCompleted: integer('include_completed', { mode: 'boolean' }).notNull().default(true),
  enableFocusMode: integer('enable_focus_mode', { mode: 'boolean' }).notNull().default(false),
  regionCardsPerRow: integer('region_cards_per_row').notNull().default(3),
  projectCardsPerRow: integer('project_cards_per_row').notNull().default(3),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ─── Integrations ────────────────────────────────────────────────────────────
export const integrations = sqliteTable('integrations', {
  id: text('id').primaryKey().default(_uuidSql),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  baseUrl: text('base_url'),
  authType: text('auth_type').default('api_key'),
  syncMode: text('sync_mode').default('manual'),
  apiKey: text('api_key'),
  username: text('username'),
  password: text('password'),
  clientId: text('client_id'),
  clientSecret: text('client_secret'),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  webhookSecret: text('webhook_secret'),
  lastSyncAt: text('last_sync_at'),
  lastStatus: text('last_status').default('never_run'),
  lastError: text('last_error'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Executive Dashboard Targets
export const executiveTargets = sqliteTable('executive_targets', {
  id: text('id').primaryKey().default(_uuidSql),
  year: integer('year').notNull(),
  execClosureTarget: integer('exec_closure_target'),
  financialCollectionTarget: real('financial_collection_target'),
  financialInvoicingTarget: real('financial_invoicing_target'),
  noteAr: text('note_ar'),
  noteEn: text('note_en'),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedBy: text('updated_by'),
});

// مستهدفات القطاعات السنوية
export const executiveSectorTargets = sqliteTable('executive_sector_targets', {
  id: text('id').primaryKey().default(_uuidSql),
  year: integer('year').notNull(),
  sectorId: text('sector_id').notNull(),
  execClosureTarget: integer('exec_closure_target'),
  financialCollectionTarget: real('financial_collection_target'),
  financialInvoicingTarget: real('financial_invoicing_target'),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedBy: text('updated_by'),
});

export const sectorAnnualTargets = sqliteTable('sector_annual_targets', {
  id: text('id').primaryKey().default(sql`(lower(hex(randomblob(16))))`),
  year: integer('year').notNull(),
  sectorId: text('sector_id').notNull(),
  salesRateTarget: real('sales_rate_target').default(90),
  collectionRateTarget: real('collection_rate_target').default(75),
  salesAmountTarget: real('sales_amount_target'),
  execComplianceTarget: real('exec_compliance_target').default(90),
  closureRateTarget: real('closure_rate_target').default(80),
  finComplianceTarget: real('fin_compliance_target').default(85),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedBy: text('updated_by'),
});

export const roleDefinitions = sqliteTable('role_definitions', {
  id: text('id').primaryKey().default(_uuidSql),
  roleKey: text('role_key').notNull().unique(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en'),
  scopeType: text('scope_type').notNull().default('ALL'), // ALL | OWN_SECTOR | OWN_REGION
  canCreateOrder: integer('can_create_order', { mode: 'boolean' }).default(false),
  canDeleteOrder: integer('can_delete_order', { mode: 'boolean' }).default(false),
  canEditExecution: integer('can_edit_execution', { mode: 'boolean' }).default(true),
  canViewExcavationPermits: integer('can_view_excavation_permits', { mode: 'boolean' }).default(true),
  canEditExcavationPermits: integer('can_edit_excavation_permits', { mode: 'boolean' }).default(false),
  canDeleteExcavationPermits: integer('can_delete_excavation_permits', { mode: 'boolean' }).default(false),
  canViewExecutiveDashboard: integer('can_view_executive_dashboard', { mode: 'boolean' }).default(false),
  isSystem: integer('is_system', { mode: 'boolean' }).default(false),
  active: integer('active', { mode: 'boolean' }).default(true),
  sortOrder: integer('sort_order').default(0),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});
