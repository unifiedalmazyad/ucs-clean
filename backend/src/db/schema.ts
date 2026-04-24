import * as schemaPg from './schema_pg';
import * as schemaSqlite from './schema_sqlite';

const isDemo = process.env.DEMO_MODE === 'true' || !process.env.DATABASE_URL;

const schema = isDemo ? schemaSqlite : schemaPg;

export const {
  users,
  workOrders,
  columnCatalog,
  columnOptions,
  roleColumnPermissions,
  userColumnOverrides,
  auditLogs,
  stages,
  regions,
  sectors,
  kpiTemplates,
  kpiRules,
  workOrderKpiCache,
  columnGroups,
  columnCategories,
  roleEnum,
  roleDefinitions,
  reportExports,
  workOrderNotes,
  workOrderAttachments,
  importRuns,
  excavationPermits,
  periodicKpiExecutionRules,
  periodicKpiFinancialRule,
  periodicKpiReportSettings,
  periodicKpiMetrics,
  userReportColumnPrefs,
  executiveTargets,
  executiveSectorTargets,
  annualTargetItems,
  reportTemplates,
  integrations,
  sectorAnnualTargets,
  contracts,
  contractAttachments,
} = schema as any;
