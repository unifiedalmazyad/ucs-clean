import { Router, Response } from 'express';
import { eq, and, gte, lte, asc, isNotNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { db } from '../db';
import {
  workOrders, stages, users, regions, sectors,
  periodicKpiExecutionRules, periodicKpiFinancialRule, periodicKpiReportSettings,
  periodicKpiMetrics, userReportColumnPrefs, roleDefinitions, columnCatalog,
} from '../db/schema_pg';
import { authenticate } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';

const router = Router();

// ── Column key → Drizzle column map (date columns for date-basis filtering) ──
// Keys here are PHYSICAL column keys (snake_case DB column names).

const DATE_COL_MAP: Record<string, any> = {
  created_at:           workOrders.createdAt,
  assignment_date:      workOrders.assignmentDate,
  survey_date:          workOrders.surveyDate,
  coordination_date:    workOrders.coordinationDate,
  drilling_date:        workOrders.drillingDate,
  shutdown_date:        workOrders.shutdownDate,
  material_sheet_date:  workOrders.materialSheetDate,
  check_sheets_date:    workOrders.checkSheetsDate,
  metering_sheet_date:  workOrders.meteringSheetDate,
  gis_completion_date:  workOrders.gisCompletionDate,
  proc_155_close_date:   workOrders.proc155CloseDate,
  completion_cert_date:  workOrders.completionCertDate,
};

// ── physicalKeyMap: columnKey → physicalKey (from column_catalog) ─────────────

async function loadPhysicalKeyMap(): Promise<Map<string, string>> {
  const rows = await db.select({ columnKey: columnCatalog.columnKey, physicalKey: columnCatalog.physicalKey })
    .from(columnCatalog);
  const map = new Map<string, string>();
  for (const r of rows) {
    if (r.columnKey && r.physicalKey && r.columnKey !== r.physicalKey) {
      map.set(r.columnKey, r.physicalKey);
    }
  }
  return map;
}

// Resolve a Drizzle column for SQL filtering: tries columnKey first, then
// falls back to physicalKey via column_catalog.
function resolveDrizzleCol(columnKey: string, physicalKeyMap: Map<string, string>): any | null {
  if (DATE_COL_MAP[columnKey]) return DATE_COL_MAP[columnKey];
  const physKey = physicalKeyMap.get(columnKey);
  if (physKey && DATE_COL_MAP[physKey]) return DATE_COL_MAP[physKey];
  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const toCamel = (s: string) => s.replace(/_(\d+)/g, (_: string, n: string) => n).replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase());

function resolveDate(
  wo: any,
  mode: string,
  columnKey: string | null,
  stageId: string | null,
  stageMap: Map<string, any>,
  physicalKeyMap?: Map<string, string>,
): Date | null {
  if (mode === 'COLUMN_DATE') {
    if (!columnKey) return null;
    const camel = toCamel(columnKey);
    // 1) Try Drizzle-known camelCase key (by logical columnKey)
    let val = wo[camel];
    // 2) Try snake_case directly (physical column returned from raw SQL)
    if (val == null) val = wo[columnKey];
    // 3) If renamed column: look up physical key and try via that
    if (val == null && physicalKeyMap) {
      const physKey = physicalKeyMap.get(columnKey);
      if (physKey) {
        const physCamel = toCamel(physKey);
        val = wo[physCamel] ?? wo[physKey] ?? null;
      }
    }
    // 4) Fall back to customFields JSONB (dynamic physical columns not in Drizzle schema)
    if (val == null) {
      const cf = wo.customFields ?? wo.custom_fields;
      if (cf) {
        const parsed = typeof cf === 'string' ? JSON.parse(cf) : cf;
        if (parsed) {
          val = parsed[columnKey] ?? parsed[camel];
          if (val == null && physicalKeyMap) {
            const physKey = physicalKeyMap.get(columnKey);
            if (physKey) val = parsed[physKey] ?? parsed[toCamel(physKey)] ?? null;
          }
        }
      }
    }
    return val ? new Date(val) : null;
  }
  if (mode === 'STAGE_EVENT') {
    if (!stageId) return null;
    if (wo.stageId === stageId) return new Date(wo.updatedAt);
    const target = stageMap.get(stageId);
    const current = stageMap.get(wo.stageId);
    if (target && current && (current.seq ?? 0) > (target.seq ?? 0)) return new Date(wo.updatedAt);
    return null;
  }
  return null;
}

type WOStatus = 'COMPLETED' | 'CANCELLED' | 'OVERDUE' | 'WARNING' | 'ON_TIME' | 'UNKNOWN';
type FinStatus = 'COMPLETED' | 'OVERDUE' | 'WARNING' | 'ON_TIME';

function computeExecStatus(wo: any, rule: any, stageMap: Map<string, any>, now: Date, physicalKeyMap?: Map<string, string>): WOStatus {
  const stage = stageMap.get(wo.stageId ?? '');
  if (stage?.isCancelled) return 'CANCELLED';
  const endDate = resolveDate(wo, rule.endMode, rule.endColumnKey, rule.endStageId, stageMap, physicalKeyMap);
  if (endDate) return 'COMPLETED';
  const startDate = resolveDate(wo, rule.startMode, rule.startColumnKey, rule.startStageId, stageMap, physicalKeyMap);
  if (!startDate) return 'UNKNOWN';
  const days = (now.getTime() - startDate.getTime()) / 86_400_000;
  if (days > rule.slaDays) return 'OVERDUE';
  if (days >= rule.slaDays - rule.warningDays) return 'WARNING';
  return 'ON_TIME';
}

function computeFinStatus(wo: any, execRule: any, finRule: any, stageMap: Map<string, any>, now: Date, physicalKeyMap?: Map<string, string>): FinStatus | null {
  const execEnd = resolveDate(wo, execRule.endMode, execRule.endColumnKey, execRule.endStageId, stageMap, physicalKeyMap);
  if (!execEnd) return null;
  const finEnd = resolveDate(wo, finRule.endMode, finRule.endColumnKey, finRule.endStageId, stageMap, physicalKeyMap);
  if (finEnd) return 'COMPLETED';
  const days = (now.getTime() - execEnd.getTime()) / 86_400_000;
  if (days > finRule.slaDays) return 'OVERDUE';
  if (days >= finRule.slaDays - finRule.warningDays) return 'WARNING';
  return 'ON_TIME';
}

function getDays(wo: any, rule: any, stageMap: Map<string, any>, now: Date, physicalKeyMap?: Map<string, string>): number | null {
  const startDate = resolveDate(wo, rule.startMode, rule.startColumnKey, rule.startStageId, stageMap, physicalKeyMap);
  if (!startDate) return null;
  return (now.getTime() - startDate.getTime()) / 86_400_000;
}

// ── Metric computation ────────────────────────────────────────────────────────

function computeMetricDays(wo: any, metric: any, stageMap: Map<string, any>, now: Date, physicalKeyMap?: Map<string, string>): number | null {
  const start = resolveDate(wo, metric.startMode, metric.startColumnKey, metric.startStageId, stageMap, physicalKeyMap);
  if (!start) return null;
  const end = metric.endMode === 'TODAY'
    ? now
    : (resolveDate(wo, metric.endMode, metric.endColumnKey, metric.endStageId, stageMap, physicalKeyMap) ?? now);
  const days = (end.getTime() - start.getTime()) / 86_400_000;
  return days >= 0 ? days : null;
}

function computeNumericAgg(wos: any[], metric: any, physicalKeyMap?: Map<string, string>): MetricResult {
  // Try logical columnKey first, then physicalKey fallback
  const vKey = metric.valueColumnKey ?? '';
  const camelVKey = toCamel(vKey);
  const physVKey = physicalKeyMap?.get(vKey);
  const camelPhysVKey = physVKey ? toCamel(physVKey) : null;
  const values = wos
    .map(wo => {
      let v = wo[camelVKey];
      if ((v == null || isNaN(parseFloat(v))) && camelPhysVKey) v = wo[camelPhysVKey] ?? wo[physVKey!];
      return parseFloat(v);
    })
    .filter(v => !isNaN(v) && isFinite(v));

  let result: number | null = null;
  if (values.length > 0) {
    switch (metric.aggFunction) {
      case 'SUM': result = values.reduce((a, b) => a + b, 0); break;
      case 'AVG': result = values.reduce((a, b) => a + b, 0) / values.length; break;
      case 'MIN': result = Math.min(...values); break;
      case 'MAX': result = Math.max(...values); break;
    }
  }

  const avgDays = result !== null ? Math.round(result * 100) / 100 : null;
  let statusColor: 'red' | 'amber' | 'green' | null = null;
  if (metric.thresholdDays && avgDays !== null) {
    if (avgDays > metric.thresholdDays) statusColor = 'red';
    else if (avgDays > metric.thresholdDays * 0.8) statusColor = 'amber';
    else statusColor = 'green';
  }

  return {
    code: metric.code, nameAr: metric.nameAr, nameEn: metric.nameEn ?? null,
    metricType: 'NUMERIC_AGG' as const,
    aggFunction: metric.aggFunction ?? null,
    avgDays, totalDays: result ?? 0, count: values.length,
    thresholdDays: metric.thresholdDays ?? null, statusColor,
  };
}

export interface MetricResult {
  code: string; nameAr: string; nameEn?: string | null;
  metricType?: 'DATE_DIFF' | 'NUMERIC_AGG';
  aggFunction?: string | null;
  avgDays: number | null; totalDays: number; count: number;
  thresholdDays: number | null; statusColor: 'red' | 'amber' | 'green' | null;
}

function aggregateMetrics(
  wos: any[], metrics: any[], stageMap: Map<string, any>, now: Date,
  physicalKeyMap?: Map<string, string>,
  fallbackSlaDays?: number | null,
  projectTypeValue?: string | null,
): MetricResult[] {
  // Operational metrics ALWAYS exclude cancelled work orders — regardless of includeCancelled flag.
  // Cancelled records may appear in count summaries only; they must never skew averages or SLA calculations.
  const operationalWOs = wos.filter(wo => !stageMap.get(wo.stageId ?? '')?.isCancelled);

  return metrics
    .filter(m => m.isEnabled)
    .filter(m => {
      // Skip metric if this project type is in its excludedProjectTypes list
      if (!projectTypeValue) return true;
      try {
        const excluded: string[] = JSON.parse(m.excludedProjectTypes || '[]');
        return !excluded.includes(projectTypeValue);
      } catch { return true; }
    })
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map(metric => {
      if (metric.metricType === 'NUMERIC_AGG') return computeNumericAgg(operationalWOs, metric, physicalKeyMap);

      // DATE_DIFF
      let totalDays = 0, count = 0;
      for (const wo of operationalWOs) {
        const days = computeMetricDays(wo, metric, stageMap, now, physicalKeyMap);
        if (days !== null) { totalDays += days; count++; }
      }
      const avgDays = count > 0 ? Math.round(totalDays / count) : null;
      // useExecSla=true → always use project-type SLA (ignore thresholdDays).
      // useExecSla=false (default) → use metric's own thresholdDays; no fallback.
      const effectiveThreshold: number | null = (metric.useExecSla && fallbackSlaDays && fallbackSlaDays > 0)
        ? fallbackSlaDays
        : ((metric.thresholdDays && metric.thresholdDays > 0) ? metric.thresholdDays : null);
      let statusColor: 'red' | 'amber' | 'green' | null = null;
      if (effectiveThreshold && avgDays !== null) {
        if (avgDays > effectiveThreshold) statusColor = 'red';
        else if (avgDays > effectiveThreshold * 0.8) statusColor = 'amber';
        else statusColor = 'green';
      }
      return { code: metric.code, nameAr: metric.nameAr, nameEn: metric.nameEn ?? null, metricType: 'DATE_DIFF' as const, aggFunction: null, avgDays, totalDays, count, thresholdDays: effectiveThreshold, statusColor };
    });
}

async function getUserScope(userId: string) {
  const [u] = await db.select({ sectorId: users.sectorId, regionId: users.regionId, role: users.role })
    .from(users).where(eq(users.id, userId));
  if (!u) return { sectorId: null as string|null, regionId: null as string|null, role: 'VIEWER', canViewPeriodicReport: false };
  const isAdmin = u.role === 'ADMIN';
  let canViewPeriodicReport = isAdmin;
  if (!isAdmin) {
    const [rd] = await db.select({ canViewPeriodicReport: roleDefinitions.canViewPeriodicReport })
      .from(roleDefinitions).where(eq(roleDefinitions.roleKey, u.role));
    canViewPeriodicReport = rd?.canViewPeriodicReport ?? false;
  }
  return { sectorId: u.sectorId, regionId: u.regionId, role: u.role, canViewPeriodicReport };
}

// ── Numeric columns for NUMERIC_AGG ──────────────────────────────────────────

const WO_FIELDS = {
  id: workOrders.id,
  orderNumber: workOrders.orderNumber,
  projectType: workOrders.projectType,
  regionId: workOrders.regionId,
  sectorId: workOrders.sectorId,
  stageId: workOrders.stageId,
  stage: workOrders.stage,
  status: workOrders.status,
  district: workOrders.district,
  client: workOrders.client,
  workType: workOrders.workType,
  assignmentDate: workOrders.assignmentDate,
  surveyDate: workOrders.surveyDate,
  coordinationDate: workOrders.coordinationDate,
  drillingDate: workOrders.drillingDate,
  shutdownDate: workOrders.shutdownDate,
  materialSheetDate: workOrders.materialSheetDate,
  checkSheetsDate: workOrders.checkSheetsDate,
  meteringSheetDate: workOrders.meteringSheetDate,
  gisCompletionDate: workOrders.gisCompletionDate,
  completionCertDate: workOrders.completionCertDate,
  proc155CloseDate: workOrders.proc155CloseDate,
  // Numeric columns for NUMERIC_AGG
  length: workOrders.length,
  estimatedValue: workOrders.estimatedValue,
  actualInvoiceValue: workOrders.actualInvoiceValue,
  collectedAmount: workOrders.collectedAmount,
  remainingAmount: workOrders.remainingAmount,
  // Financial
  invoiceNumber: workOrders.invoiceNumber,
  invoiceType: workOrders.invoiceType,
  invoiceBillingDate: workOrders.invoiceBillingDate,
  invoice1: workOrders.invoice1,
  invoice2: workOrders.invoice2,
  holdReason: workOrders.holdReason,
  procedure: workOrders.procedure,
  createdAt: workOrders.createdAt,
  updatedAt: workOrders.updatedAt,
  customFields: workOrders.customFields,
  // Delay classification
  execDelayJustified: workOrders.execDelayJustified,
  execDelayReason:    workOrders.execDelayReason,
  finDelayJustified:  workOrders.finDelayJustified,
  finDelayReason:     workOrders.finDelayReason,
  // KPI alerts
  completionCertConfirm: workOrders.completionCertConfirm,
  financialCloseDate: sql<Date | null>`financial_close_date`.as('financialCloseDate'),
};

type FetchOpts = {
  sectorId?: string | null; regionId?: string | null; projectType?: string | null;
  from: Date; to: Date;
  dateBasisType?: string | null; dateBasisColumnKey?: string | null;
  includeCancelled?: boolean;
  physicalKeyMap?: Map<string, string>;
};

async function fetchWOs(opts: FetchOpts) {
  const pkMap = opts.physicalKeyMap ?? new Map<string, string>();
  const resolvedCol =
    opts.dateBasisType === 'COLUMN_DATE' && opts.dateBasisColumnKey
      ? resolveDrizzleCol(opts.dateBasisColumnKey, pkMap)
      : null;
  const basisCol = resolvedCol ?? workOrders.createdAt;

  const conds: any[] = [];

  // Date basis: use isNotNull guard when filtering by nullable column
  if (opts.dateBasisType === 'COLUMN_DATE' && opts.dateBasisColumnKey && resolvedCol) {
    // NULL rows in the chosen column are excluded (not in range) — explicit, documented behavior
    conds.push(isNotNull(basisCol));
    conds.push(gte(basisCol, opts.from));
    conds.push(lte(basisCol, opts.to));
  } else {
    conds.push(gte(workOrders.createdAt, opts.from));
    conds.push(lte(workOrders.createdAt, opts.to));
  }

  if (opts.sectorId)   conds.push(eq(workOrders.sectorId,   opts.sectorId));
  if (opts.regionId)   conds.push(eq(workOrders.regionId,   opts.regionId));
  if (opts.projectType) conds.push(eq(workOrders.projectType, opts.projectType));

  return db.select(WO_FIELDS).from(workOrders).where(and(...conds));
}

interface Counts {
  total: number; active: number; completed: number; cancelled: number;
  overdue: number; warning: number; onTime: number; unconfigured: number;
}
const zeroCounts = (): Counts => ({
  total: 0, active: 0, completed: 0, cancelled: 0, overdue: 0, warning: 0, onTime: 0, unconfigured: 0,
});

function aggregateCounts(
  wos: any[], ruleMap: Map<string, any>, stageMap: Map<string, any>, now: Date,
  includeCancelled = false, includeCompleted = true,
  physicalKeyMap?: Map<string, string>,
): Counts & { totalDays: number; daysCount: number } {
  const r = { ...zeroCounts(), totalDays: 0, daysCount: 0 };
  for (const wo of wos) {
    const rule = ruleMap.get(wo.projectType ?? '');
    if (!rule) { r.total++; r.unconfigured++; continue; }
    const status = computeExecStatus(wo, rule, stageMap, now, physicalKeyMap);
    if (status === 'CANCELLED') {
      if (includeCancelled) { r.total++; r.cancelled++; }
      continue;
    }
    if (status === 'COMPLETED' && !includeCompleted) continue;
    r.total++;
    if (status === 'COMPLETED') { r.completed++; r.active++; }
    else if (status === 'OVERDUE')  { r.overdue++;  r.active++; }
    else if (status === 'WARNING')  { r.warning++;  r.active++; }
    else if (status === 'ON_TIME')  { r.onTime++;   r.active++; }
    const days = getDays(wo, rule, stageMap, now, physicalKeyMap);
    if (days !== null) { r.totalDays += days; r.daysCount++; }
  }
  return r;
}

// ── KPI alerts: مغلقة لم تُفوتر + فُوتر بلا شهادة إنجاز ─────────────────────
function computeKpiAlerts(wos: any[]): { closedNotInvoiced: number; invoicedNoCert: number } {
  let closedNotInvoiced = 0;
  let invoicedNoCert    = 0;
  for (const wo of wos) {
    const hasFinClose       = !!(wo.financialCloseDate);
    const hasInvoice        = !!(wo.invoiceNumber);
    const hasBillingDate    = !!(wo.invoiceBillingDate);
    const hasCertDate       = !!(wo.completionCertDate);

    // مغلق مالياً (financial_close_date) لكن بدون تاريخ فوترة (invoice_billing_date)
    if (hasFinClose && !hasBillingDate) closedNotInvoiced++;

    // له رقم فاتورة (invoice_number) لكن لا يوجد تاريخ شهادة إنجاز
    if (hasInvoice && !hasCertDate) invoicedNoCert++;
  }
  return { closedNotInvoiced, invoicedNoCert };
}

function computeBillingCounts(wos: any[]): { partialBilled: number; notFullyBilled: number } {
  let partialBilled = 0;
  let notFullyBilled = 0;
  for (const wo of wos) {
    const invType = wo.invoiceType ?? wo.invoice_type;
    if (
      invType === 'جزئي' &&
      (wo.invoiceBillingDate ?? wo.invoice_billing_date) != null &&
      (wo.invoice1 ?? wo.invoice_1) != null
    ) {
      partialBilled++;
    }
    if (invType != null) {
      const collected = parseFloat(wo.collectedAmount ?? wo.collected_amount ?? '0') || 0;
      const actual    = parseFloat(wo.actualInvoiceValue ?? wo.actual_invoice_value ?? '0') || 0;
      if (actual > 0 && collected < actual) notFullyBilled++;
    }
  }
  return { partialBilled, notFullyBilled };
}

function buildDateRange(from?: string, to?: string, defMode?: string): { from: Date; to: Date } {
  if (from && to) return { from: new Date(from), to: new Date(to) };
  const now = new Date();
  let f: Date;
  switch (defMode ?? 'month') {
    case 'week': {
      // Week: Sunday → Saturday (getDay: 0=Sun, 6=Sat)
      f = new Date(now);
      f.setDate(now.getDate() - now.getDay()); // back to this Sunday
      f.setHours(0, 0, 0, 0);
      break;
    }
    case 'ytd':  f = new Date(now.getFullYear(), 0, 1); break;
    default:     f = new Date(now); f.setDate(now.getDate() - 30); break;
  }
  return { from: f, to: now };
}

async function loadKpiConfig() {
  const [rules, fin, sett, stagesAll, metrics] = await Promise.all([
    db.select().from(periodicKpiExecutionRules).where(eq(periodicKpiExecutionRules.isEnabled, true)),
    db.select().from(periodicKpiFinancialRule).limit(1),
    db.select().from(periodicKpiReportSettings).limit(1),
    db.select().from(stages).orderBy(asc(stages.seq)),
    db.select().from(periodicKpiMetrics).orderBy(asc(periodicKpiMetrics.orderIndex)),
  ]);
  const settings = sett[0] ?? { defaultDateRangeMode: 'month', includeCancelled: false, includeCompleted: true };
  return {
    ruleMap: new Map<string, any>(rules.map(r => [r.projectTypeValue, r])),
    finRule: fin[0] ?? { isEnabled: false, slaDays: 20, warningDays: 3, endMode: 'COLUMN_DATE', endColumnKey: null, endStageId: null },
    settings,
    stageMap: new Map<string, any>(stagesAll.map(s => [s.id, s])),
    rules,
    metrics,
    includeCancelled: settings.includeCancelled ?? false,
  };
}

function parseDateBasis(query: any): { dateBasisType: string; dateBasisColumnKey: string | null } {
  return {
    dateBasisType: (query.dateBasisType as string) || 'CREATED_AT',
    dateBasisColumnKey: (query.dateBasisColumnKey as string) || null,
  };
}

// ── 1. GET /config ─────────────────────────────────────────────────────────────

router.get('/config', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const scope = await getUserScope(req.user!.id);
    if (!scope.canViewPeriodicReport) {
      return res.status(403).json({ error: 'Access denied: Periodic Report permission required' });
    }
    const [execRules, fin, sett, stagesAll, ptRaw, sectorsAll, regionsAll, dateColsRaw, numColsRaw, metricsAll] = await Promise.all([
      db.select().from(periodicKpiExecutionRules),
      db.select().from(periodicKpiFinancialRule).limit(1),
      db.select().from(periodicKpiReportSettings).limit(1),
      db.select().from(stages).orderBy(asc(stages.seq)),
      db.execute(sql`SELECT value, label_ar AS "labelAr" FROM column_options WHERE column_key = 'project_type' AND active = true ORDER BY sort_order`),
      db.select({ id: sectors.id, nameAr: sectors.nameAr }).from(sectors).where(eq(sectors.active, true)),
      db.select({ id: regions.id, nameAr: regions.nameAr, sectorId: regions.sectorId }).from(regions).where(eq(regions.active, true)),
      db.execute(sql`
        SELECT column_key AS "columnKey", label_ar AS "labelAr", data_type AS "dataType"
        FROM column_catalog WHERE is_enabled = true AND data_type IN ('date','timestamp','timestamp with time zone')
        ORDER BY sort_order
      `),
      db.execute(sql`
        SELECT column_key AS "columnKey", label_ar AS "labelAr", data_type AS "dataType"
        FROM column_catalog WHERE is_enabled = true AND data_type IN ('numeric','integer','float','decimal')
        ORDER BY sort_order
      `),
      db.select().from(periodicKpiMetrics).orderBy(asc(periodicKpiMetrics.orderIndex)),
    ]);
    const toRows = (r: any) => r.rows ?? r;
    const dateColumns = toRows(dateColsRaw);
    const numericColumns = toRows(numColsRaw);

    const dateBasisOptions = [
      { type: 'CREATED_AT', labelAr: 'تاريخ الإنشاء', columnKey: null },
      ...dateColumns.map((c: any) => ({ type: 'COLUMN_DATE', labelAr: c.labelAr, columnKey: c.columnKey })),
    ];

    // Column definitions per table for Column Picker
    const columnsByTable = {
      EXEC: [
        { key: 'orderNumber',       labelAr: 'أمر العمل' },
        { key: 'projectType',       labelAr: 'نوع المشروع' },
        { key: 'district',          labelAr: 'الحي' },
        { key: 'client',            labelAr: 'العميل' },
        { key: '_status',           labelAr: 'الحالة', virtual: true },
        { key: 'workType',          labelAr: 'نوع العمل' },
        { key: 'assignmentDate',    labelAr: 'تاريخ الإسناد' },
        { key: 'surveyDate',        labelAr: 'تاريخ المسح' },
        { key: 'coordinationDate',  labelAr: 'تاريخ التنسيق' },
        { key: 'drillingDate',      labelAr: 'تاريخ الحفر' },
        { key: 'shutdownDate',      labelAr: 'تاريخ التطفئة' },
        { key: 'materialSheetDate', labelAr: 'ورقة المواد' },
        { key: 'proc155CloseDate',  labelAr: 'إقفال 155' },
        { key: 'gisCompletionDate', labelAr: 'إنجاز GIS' },
        { key: 'length',            labelAr: 'الطول (م)' },
        { key: 'stage',             labelAr: 'المرحلة' },
      ],
      FIN: [
        { key: 'orderNumber',       labelAr: 'أمر العمل' },
        { key: 'projectType',       labelAr: 'نوع المشروع' },
        { key: 'client',            labelAr: 'العميل' },
        { key: '_finStatus',        labelAr: 'الحالة المالية', virtual: true },
        { key: 'assignmentDate',    labelAr: 'تاريخ الإسناد' },
        { key: 'invoiceNumber',     labelAr: 'رقم المستخلص' },
        { key: 'invoiceType',       labelAr: 'نوع المستخلص' },
        { key: 'estimatedValue',    labelAr: 'القيمة التقديرية' },
        { key: 'actualInvoiceValue',labelAr: 'القيمة الفعلية' },
        { key: 'collectedAmount',   labelAr: 'المحصّل' },
        { key: 'remainingAmount',   labelAr: 'المتبقى' },
      ],
      REASONS: [
        { key: 'orderNumber',  labelAr: 'أمر العمل' },
        { key: 'projectType',  labelAr: 'نوع المشروع' },
        { key: 'district',     labelAr: 'الحي' },
        { key: 'client',       labelAr: 'العميل' },
        { key: 'holdReason',   labelAr: 'سبب التعليق' },
        { key: 'stage',        labelAr: 'المرحلة' },
        { key: 'procedure',    labelAr: 'الإجراء' },
      ],
    };

    res.json({
      execRules, finRule: fin[0] ?? null, settings: sett[0] ?? null,
      stages: stagesAll, projectTypes: toRows(ptRaw),
      sectors: sectorsAll, regions: regionsAll,
      dateColumns, numericColumns, dateBasisOptions,
      columnsByTable, metrics: metricsAll,
      userScope: { sectorId: scope.sectorId, regionId: scope.regionId, role: scope.role },
    });
  } catch (err) {
    console.error('[PERIODIC CONFIG]', err);
    res.status(500).json({ error: 'Failed to fetch config' });
  }
});

// ── 2. GET /summary ────────────────────────────────────────────────────────────

router.get('/summary', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const scope = await getUserScope(req.user!.id);
    if (!scope.canViewPeriodicReport) {
      return res.status(403).json({ error: 'Access denied: Periodic Report permission required' });
    }
    const [{ ruleMap, stageMap, finRule, settings, metrics, includeCancelled: cfgIncCancelled }, physicalKeyMap] =
      await Promise.all([loadKpiConfig(), loadPhysicalKeyMap()]);
    const { from, to } = buildDateRange(req.query.from as string, req.query.to as string, settings.defaultDateRangeMode);
    const { dateBasisType, dateBasisColumnKey } = parseDateBasis(req.query);
    const sectorId = scope.sectorId ?? (req.query.sectorId as string | undefined) ?? null;
    const regionId = scope.regionId ?? (req.query.regionId as string | undefined) ?? null;
    const projectType = (req.query.projectType as string | undefined) || null;
    const includeCancelled = req.query.includeCancelled !== undefined ? req.query.includeCancelled === 'true' : cfgIncCancelled;
    const includeCompleted = req.query.includeCompleted !== undefined ? req.query.includeCompleted === 'true' : true;

    const wos = await fetchWOs({ sectorId, regionId, projectType, from, to, dateBasisType, dateBasisColumnKey, includeCancelled, physicalKeyMap });
    const now = new Date();
    const counts = aggregateCounts(wos, ruleMap, stageMap, now, includeCancelled, includeCompleted, physicalKeyMap);
    const wosForMetrics = wos.filter(wo => {
      const rule = ruleMap.get(wo.projectType ?? '');
      if (!rule) return true;
      const status = computeExecStatus(wo, rule, stageMap, now, physicalKeyMap);
      if (status === 'CANCELLED' && !includeCancelled) return false;
      if (status === 'COMPLETED' && !includeCompleted) return false;
      return true;
    });
    const metricsAverages = aggregateMetrics(wosForMetrics, metrics, stageMap, now, physicalKeyMap);

    // ── Financial summary — exact same logic as /regions (computeFinStatus)
    const finCounts = { total: 0, completed: 0, overdue: 0, warning: 0, onTime: 0 };
    if (finRule.isEnabled) {
      for (const wo of wos) {
        const rule = ruleMap.get(wo.projectType ?? '');
        if (!rule) continue;
        const execStatus = computeExecStatus(wo, rule, stageMap, now, physicalKeyMap);
        if (execStatus === 'CANCELLED' && !includeCancelled) continue;
        const finStatus = computeFinStatus(wo, rule, finRule, stageMap, now, physicalKeyMap);
        if (finStatus === null) continue;
        finCounts.total++;
        if (finStatus === 'COMPLETED') finCounts.completed++;
        else if (finStatus === 'OVERDUE')  finCounts.overdue++;
        else if (finStatus === 'WARNING')  finCounts.warning++;
        else if (finStatus === 'ON_TIME')  finCounts.onTime++;
      }
    }

    const kpiAlerts = computeKpiAlerts(wos);

    res.json({
      ...counts,
      avgDays: counts.daysCount > 0 ? Math.round(counts.totalDays / counts.daysCount) : null,
      metricsAverages,
      billingCounts: computeBillingCounts(wos),
      finEnabled: finRule.isEnabled,
      finCounts: finRule.isEnabled ? finCounts : null,
      kpiAlerts,
      from: from.toISOString(), to: to.toISOString(),
    });
  } catch (err) {
    console.error('[PERIODIC SUMMARY]', err);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// ── 3. GET /regions ────────────────────────────────────────────────────────────

router.get('/regions', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const scope = await getUserScope(req.user!.id);
    const [{ ruleMap, stageMap, finRule, settings, metrics, includeCancelled: cfgIncCancelled }, physicalKeyMap] =
      await Promise.all([loadKpiConfig(), loadPhysicalKeyMap()]);
    const { from, to } = buildDateRange(req.query.from as string, req.query.to as string, settings.defaultDateRangeMode);
    const { dateBasisType, dateBasisColumnKey } = parseDateBasis(req.query);
    const forceSectorId = scope.sectorId ?? ((req.query.sectorId as string) || null);
    const forceRegionId = scope.regionId ?? ((req.query.regionId as string) || null);
    const projectType = (req.query.projectType as string) || null;
    const includeCancelled = req.query.includeCancelled !== undefined ? req.query.includeCancelled === 'true' : cfgIncCancelled;
    const includeCompleted = req.query.includeCompleted !== undefined ? req.query.includeCompleted === 'true' : true;

    const allWOs = await fetchWOs({ sectorId: forceSectorId, regionId: forceRegionId, projectType, from, to, dateBasisType, dateBasisColumnKey, includeCancelled, physicalKeyMap });
    const now = new Date();

    const regionConds: any[] = [eq(regions.active, true)];
    if (forceRegionId) regionConds.push(eq(regions.id, forceRegionId));
    else if (forceSectorId) regionConds.push(eq(regions.sectorId, forceSectorId));
    const allRegions = await db.select({ id: regions.id, nameAr: regions.nameAr, sectorId: regions.sectorId })
      .from(regions).where(and(...regionConds));

    const sectorIds = [...new Set(allRegions.map(r => r.sectorId).filter(Boolean))] as string[];
    const allSectors = sectorIds.length
      ? await db.select({ id: sectors.id, nameAr: sectors.nameAr }).from(sectors).where(eq(sectors.active, true))
      : [];
    const sectorMap = new Map<string, any>(allSectors.map(s => [s.id, s]));

    const result = allRegions.map(region => {
      const wos = allWOs.filter(wo => wo.regionId === region.id);
      const counts = aggregateCounts(wos, ruleMap, stageMap, now, includeCancelled, includeCompleted, physicalKeyMap);
      const wosForMetrics = wos.filter(wo => {
        const rule = ruleMap.get(wo.projectType ?? '');
        if (!rule) return true;
        const status = computeExecStatus(wo, rule, stageMap, now, physicalKeyMap);
        if (status === 'CANCELLED' && !includeCancelled) return false;
        if (status === 'COMPLETED' && !includeCompleted) return false;
        return true;
      });
      const metricsAverages = aggregateMetrics(wosForMetrics, metrics, stageMap, now, physicalKeyMap);

      // Delay classification breakdown
      let execDelayedJustified = 0, execDelayedUnjustified = 0;
      let finDelayedJustified  = 0, finDelayedUnjustified  = 0;
      for (const wo of wos) {
        const rule = ruleMap.get(wo.projectType ?? '');
        if (!rule) continue;
        const status = computeExecStatus(wo, rule, stageMap, now, physicalKeyMap);
        if (status === 'OVERDUE') {
          if (wo.execDelayJustified === true) execDelayedJustified++;
          else execDelayedUnjustified++;
        }
        if (finRule.isEnabled) {
          const finStatus = computeFinStatus(wo, rule, finRule, stageMap, now, physicalKeyMap);
          if (finStatus === 'OVERDUE') {
            if (wo.finDelayJustified === true) finDelayedJustified++;
            else finDelayedUnjustified++;
          }
        }
      }

      return {
        id: region.id, nameAr: region.nameAr, sectorId: region.sectorId,
        sectorNameAr: region.sectorId ? (sectorMap.get(region.sectorId)?.nameAr ?? null) : null,
        ...counts, avgDays: counts.daysCount > 0 ? Math.round(counts.totalDays / counts.daysCount) : null,
        metricsAverages,
        execDelayedJustified, execDelayedUnjustified,
        finDelayedJustified,  finDelayedUnjustified,
      };
    });
    res.json(result);
  } catch (err) {
    console.error('[PERIODIC REGIONS]', err);
    res.status(500).json({ error: 'Failed to fetch regions' });
  }
});

// ── 4. GET /region/:id/details ─────────────────────────────────────────────────

router.get('/region/:id/details', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const regionId = req.params.id;
    const scope = await getUserScope(req.user!.id);
    if (scope.regionId && scope.regionId !== regionId) return res.status(403).json({ error: 'Forbidden' });

    const [{ ruleMap, stageMap, finRule, settings, rules, metrics, includeCancelled: cfgIncCancelled }, physicalKeyMap] =
      await Promise.all([loadKpiConfig(), loadPhysicalKeyMap()]);
    const { from, to } = buildDateRange(req.query.from as string, req.query.to as string, settings.defaultDateRangeMode);
    const { dateBasisType, dateBasisColumnKey } = parseDateBasis(req.query);
    const projectType = (req.query.projectType as string) || null;
    const includeCancelled = req.query.includeCancelled !== undefined ? req.query.includeCancelled === 'true' : cfgIncCancelled;
    const includeCompleted = req.query.includeCompleted !== undefined ? req.query.includeCompleted === 'true' : true;

    const wos = await fetchWOs({ regionId, projectType, from, to, dateBasisType, dateBasisColumnKey, includeCancelled, physicalKeyMap });
    const now = new Date();

    const projectTypeGroups = new Map<string, any[]>();
    for (const wo of wos) {
      const pt = wo.projectType ?? '_unconfigured';
      if (!projectTypeGroups.has(pt)) projectTypeGroups.set(pt, []);
      projectTypeGroups.get(pt)!.push(wo);
    }

    const projectTypeStats: any[] = [];
    const overdueWOs: any[] = [];
    const onTimeWOs: any[] = [];
    const cancelledWOs: any[] = [];
    const finOverdueWOs: any[] = [];
    const finOnTimeWOs: any[] = [];
    const finRegionCounts = { total: 0, completed: 0, overdue: 0, warning: 0, onTime: 0 };

    for (const [ptValue, ptWOs] of projectTypeGroups) {
      const rule = ruleMap.get(ptValue);
      const ptLabel = rules.find(r => r.projectTypeValue === ptValue)?.projectTypeLabelAr ?? ptValue;

      if (!rule) {
        projectTypeStats.push({ projectTypeValue: ptValue, projectTypeLabelAr: ptLabel, configured: false, total: ptWOs.length });
        continue;
      }

      const counts = zeroCounts();
      let totalDays = 0, daysCount = 0;
      const metricsWOs: any[] = [];
      const ptFinCounts = { total: 0, completed: 0, overdue: 0, warning: 0, onTime: 0 };

      for (const wo of ptWOs) {
        const status = computeExecStatus(wo, rule, stageMap, now, physicalKeyMap);
        if (status === 'CANCELLED') {
          if (includeCancelled) { counts.total++; counts.cancelled++; cancelledWOs.push({ ...wo, _status: 'CANCELLED', _ptLabel: ptLabel }); }
          continue;
        }
        if (status === 'COMPLETED' && !includeCompleted) continue;
        metricsWOs.push(wo);
        counts.total++;
        if (status === 'COMPLETED') { counts.completed++; counts.active++; }
        else if (status === 'OVERDUE')  { counts.overdue++;  counts.active++; overdueWOs.push({ ...wo, _status: 'OVERDUE', _ptLabel: ptLabel }); }
        else if (status === 'WARNING')  { counts.warning++;  counts.active++; onTimeWOs.push({ ...wo, _status: 'WARNING', _ptLabel: ptLabel }); }
        else if (status === 'ON_TIME')  { counts.onTime++;   counts.active++; onTimeWOs.push({ ...wo, _status: 'ON_TIME', _ptLabel: ptLabel }); }
        const days = getDays(wo, rule, stageMap, now, physicalKeyMap);
        if (days !== null) { totalDays += days; daysCount++; }

        if (finRule.isEnabled) {
          const finStatus = computeFinStatus(wo, rule, finRule, stageMap, now, physicalKeyMap);
          if (finStatus !== null) {
            ptFinCounts.total++; finRegionCounts.total++;
            if (finStatus === 'OVERDUE') {
              ptFinCounts.overdue++; finRegionCounts.overdue++;
              finOverdueWOs.push({ ...wo, _finStatus: 'OVERDUE', _ptLabel: ptLabel });
            } else if (finStatus === 'WARNING') {
              ptFinCounts.warning++; finRegionCounts.warning++;
              finOnTimeWOs.push({ ...wo, _finStatus: 'WARNING', _ptLabel: ptLabel });
            } else if (finStatus === 'ON_TIME') {
              ptFinCounts.onTime++; finRegionCounts.onTime++;
              finOnTimeWOs.push({ ...wo, _finStatus: 'ON_TIME', _ptLabel: ptLabel });
            } else if (finStatus === 'COMPLETED') {
              ptFinCounts.completed++; finRegionCounts.completed++;
            }
          }
        }
      }

      projectTypeStats.push({
        projectTypeValue: ptValue, projectTypeLabelAr: ptLabel, configured: true,
        slaDays: rule.slaDays, warningDays: rule.warningDays, ...counts,
        avgDays: daysCount > 0 ? Math.round(totalDays / daysCount) : null,
        metricsAverages: aggregateMetrics(metricsWOs, metrics, stageMap, now, physicalKeyMap, rule.slaDays, ptValue),
        finCounts: finRule.isEnabled ? ptFinCounts : null,
      });
    }

    // WOs with holdReason set (for REASONS table)
    const reasonWOs = wos.filter(wo => wo.holdReason && wo.holdReason.trim());

    res.json({
      projectTypeStats, overdueWOs, onTimeWOs,
      cancelledWOs: includeCancelled ? cancelledWOs : [],
      finOverdueWOs: finRule.isEnabled ? finOverdueWOs : [],
      finOnTimeWOs:  finRule.isEnabled ? finOnTimeWOs  : [],
      finStats: finRule.isEnabled ? { ...finRegionCounts, slaDays: finRule.slaDays } : null,
      reasonWOs,
      finEnabled: finRule.isEnabled, includeCancelled, includeCompleted,
      metricsAverages: aggregateMetrics(wos, metrics, stageMap, now, physicalKeyMap),
    });
  } catch (err) {
    console.error('[PERIODIC REGION DETAILS]', err);
    res.status(500).json({ error: 'Failed to fetch region details' });
  }
});

// ── 5. GET /metrics ────────────────────────────────────────────────────────────

router.get('/metrics', authenticate, async (_req: AuthRequest, res: Response) => {
  try {
    res.json(await db.select().from(periodicKpiMetrics).orderBy(asc(periodicKpiMetrics.orderIndex)));
  } catch (err) { res.status(500).json({ error: 'Failed to fetch metrics' }); }
});

// ── 6. PUT /metrics/:id ────────────────────────────────────────────────────────

router.put('/metrics/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { nameAr, nameEn, isEnabled, metricType, aggFunction, valueColumnKey,
      startMode, startColumnKey, startStageId, endMode, endColumnKey, endStageId,
      thresholdDays, useExecSla, excludedProjectTypes, orderIndex } = req.body;

    const [updated] = await db.update(periodicKpiMetrics).set({
      nameAr, nameEn: nameEn || null, isEnabled,
      metricType: metricType ?? 'DATE_DIFF',
      aggFunction: aggFunction || null,
      valueColumnKey: valueColumnKey || null,
      startMode: startMode ?? 'COLUMN_DATE',
      startColumnKey: startColumnKey || null,
      startStageId: startStageId || null,
      endMode: endMode ?? 'COLUMN_DATE',
      endColumnKey: endColumnKey || null,
      endStageId: endStageId || null,
      thresholdDays: thresholdDays ?? null,
      useExecSla: useExecSla ?? false,
      excludedProjectTypes: Array.isArray(excludedProjectTypes) ? JSON.stringify(excludedProjectTypes) : (excludedProjectTypes ?? '[]'),
      orderIndex: orderIndex ?? 0,
      updatedAt: new Date(),
    }).where(eq(periodicKpiMetrics.id, id)).returning();

    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(updated);
  } catch (err) { res.status(500).json({ error: 'Failed to update metric' }); }
});

// ── 7. POST /metrics ───────────────────────────────────────────────────────────

router.post('/metrics', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { code, nameAr, nameEn, isEnabled, metricType, aggFunction, valueColumnKey,
      startMode, startColumnKey, startStageId, endMode, endColumnKey, endStageId,
      thresholdDays, useExecSla, excludedProjectTypes, orderIndex } = req.body;
    if (!code || !nameAr) return res.status(400).json({ error: 'code and nameAr required' });

    const [created] = await db.insert(periodicKpiMetrics).values({
      code, nameAr, nameEn: nameEn || null,
      isEnabled: isEnabled ?? true,
      metricType: metricType ?? 'DATE_DIFF',
      aggFunction: aggFunction || null,
      valueColumnKey: valueColumnKey || null,
      startMode: startMode ?? 'COLUMN_DATE',
      startColumnKey: startColumnKey || null,
      startStageId: startStageId || null,
      endMode: endMode ?? 'COLUMN_DATE',
      endColumnKey: endColumnKey || null,
      endStageId: endStageId || null,
      thresholdDays: thresholdDays ?? null,
      useExecSla: useExecSla ?? false,
      excludedProjectTypes: Array.isArray(excludedProjectTypes) ? JSON.stringify(excludedProjectTypes) : '[]',
      orderIndex: orderIndex ?? 0,
    }).returning();
    res.status(201).json(created);
  } catch (err: any) {
    if (err?.code === '23505') return res.status(409).json({ error: 'Code already exists' });
    res.status(500).json({ error: 'Failed to create metric' });
  }
});

// ── 8. DELETE /metrics/:id ─────────────────────────────────────────────────────

router.delete('/metrics/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    await db.delete(periodicKpiMetrics).where(eq(periodicKpiMetrics.id, req.params.id));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Failed to delete metric' }); }
});

// ── 9. GET /column-prefs ───────────────────────────────────────────────────────

router.get('/column-prefs', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const reportKey = (req.query.reportKey as string) || 'PERIODIC_KPI';
    const tableKey  = (req.query.tableKey  as string) || 'EXEC';
    const [pref] = await db.select().from(userReportColumnPrefs)
      .where(and(eq(userReportColumnPrefs.userId, userId), eq(userReportColumnPrefs.reportKey, reportKey), eq(userReportColumnPrefs.tableKey, tableKey)));
    res.json({ selectedColumnKeys: pref?.selectedColumnKeys ?? null });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch column prefs' }); }
});

// ── 10. PUT /column-prefs ──────────────────────────────────────────────────────

router.put('/column-prefs', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { reportKey = 'PERIODIC_KPI', tableKey = 'EXEC', selectedColumnKeys } = req.body;
    if (!Array.isArray(selectedColumnKeys)) return res.status(400).json({ error: 'selectedColumnKeys must be array' });
    await db.insert(userReportColumnPrefs).values({ userId, reportKey, tableKey, selectedColumnKeys, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [userReportColumnPrefs.userId, userReportColumnPrefs.reportKey, userReportColumnPrefs.tableKey],
        set: { selectedColumnKeys, updatedAt: new Date() },
      });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Failed to save column prefs' }); }
});

export default router;
