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
import { filterOutput } from '../services/permissionService';

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
  financial_close_date:    workOrders.financialCloseDate,
  invoice_billing_date:    workOrders.invoiceBillingDate,
  invoice_2_billing_date:  workOrders.invoice2BillingDate,
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

// Single general status per work order — priority order (highest wins):
// CANCELLED > FIN_COMPLETED > FIN_OVERDUE > FIN_WARNING > FIN_ON_TIME
//           > EXEC_COMPLETED > EXEC_OVERDUE > EXEC_WARNING > EXEC_ON_TIME > UNKNOWN
// Financial statuses only apply once execution is complete.
// When finEnabled=false, EXEC_COMPLETED is the terminal "done" state.
type GeneralStatus =
  | 'CANCELLED'
  | 'FIN_COMPLETED' | 'FIN_OVERDUE' | 'FIN_WARNING' | 'FIN_ON_TIME'
  | 'EXEC_COMPLETED'
  | 'EXEC_OVERDUE'  | 'EXEC_WARNING' | 'EXEC_ON_TIME'
  | 'UNKNOWN';

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

// Assigns a single GeneralStatus to a work order using the priority chain above.
// Each WO belongs to exactly one category — no double-counting possible.
function computeGeneralStatus(
  wo: any,
  execRule: any,
  finRule: any | null,
  finEnabled: boolean,
  stageMap: Map<string, any>,
  now: Date,
  physicalKeyMap?: Map<string, string>,
): GeneralStatus {
  const execStatus = computeExecStatus(wo, execRule, stageMap, now, physicalKeyMap);
  if (execStatus === 'CANCELLED') return 'CANCELLED';
  if (execStatus === 'COMPLETED') {
    if (finEnabled && finRule) {
      const fs = computeFinStatus(wo, execRule, finRule, stageMap, now, physicalKeyMap);
      if (fs === 'COMPLETED') return 'FIN_COMPLETED';
      if (fs === 'OVERDUE')   return 'FIN_OVERDUE';
      if (fs === 'WARNING')   return 'FIN_WARNING';
      if (fs === 'ON_TIME')   return 'FIN_ON_TIME';
    }
    return 'EXEC_COMPLETED';
  }
  if (execStatus === 'OVERDUE')  return 'EXEC_OVERDUE';
  if (execStatus === 'WARNING')  return 'EXEC_WARNING';
  if (execStatus === 'ON_TIME')  return 'EXEC_ON_TIME';
  return 'UNKNOWN';
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
  invoiceBillingDate:  workOrders.invoiceBillingDate,
  invoice2BillingDate: workOrders.invoice2BillingDate,
  invoice1: workOrders.invoice1,
  invoice2: workOrders.invoice2,
  invoice2Number: workOrders.invoice2Number,
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
  total: number; active: number; cancelled: number; unconfigured: number;
  // ── General status counts (main card values — each WO counted exactly once) ──
  completed: number; overdue: number; warning: number; onTime: number;
  // ── Exec phase breakdown (informational only) ─────────────────────────────────
  execCompleted: number; execOverdue: number; execWarning: number; execOnTime: number;
  // ── Fin phase breakdown (informational only, always 0 when fin disabled) ──────
  finCompleted: number; finOverdue: number; finWarning: number; finOnTime: number;
  finActiveTotal: number; // WOs that have entered the financial phase
}

const zeroCounts = (): Counts => ({
  total: 0, active: 0, cancelled: 0, unconfigured: 0,
  completed: 0, overdue: 0, warning: 0, onTime: 0,
  execCompleted: 0, execOverdue: 0, execWarning: 0, execOnTime: 0,
  finCompleted: 0, finOverdue: 0, finWarning: 0, finOnTime: 0,
  finActiveTotal: 0,
});

// aggregateCounts — each WO is assigned exactly one GeneralStatus and counted
// in exactly one bucket. No WO can appear in both exec and fin totals.
// finRule / finEnabled are optional for callers that do not track finance.
function aggregateCounts(
  wos: any[], ruleMap: Map<string, any>, stageMap: Map<string, any>, now: Date,
  includeCancelled = false, includeCompleted = true,
  physicalKeyMap?: Map<string, string>,
  finRule: any | null = null,
  finEnabled = false,
): Counts & { totalDays: number; daysCount: number } {
  const r = { ...zeroCounts(), totalDays: 0, daysCount: 0 };
  for (const wo of wos) {
    const rule = ruleMap.get(wo.projectType ?? '');
    if (!rule) { r.total++; r.unconfigured++; continue; }

    const gs = computeGeneralStatus(wo, rule, finRule, finEnabled, stageMap, now, physicalKeyMap);

    // CANCELLED — only counted when includeCancelled is enabled
    if (gs === 'CANCELLED') {
      if (includeCancelled) { r.total++; r.cancelled++; }
      continue;
    }

    // "Fully completed" means the WO is done under the current configuration:
    //   • finEnabled=true  → FIN_COMPLETED
    //   • finEnabled=false → EXEC_COMPLETED
    // EXEC_COMPLETED with finEnabled=true means exec is done but fin is tracked
    // (still active financially) — it must NOT be skipped by includeCompleted.
    const isFullyCompleted =
      gs === 'FIN_COMPLETED' || (gs === 'EXEC_COMPLETED' && !finEnabled);
    if (isFullyCompleted && !includeCompleted) continue;

    r.total++;
    r.active++;

    switch (gs) {
      // ── Financial phase (exec already complete) ──────────────────────────────
      case 'FIN_COMPLETED':
        r.completed++;  r.finCompleted++;  r.finActiveTotal++;  r.execCompleted++;  break;
      case 'FIN_OVERDUE':
        r.overdue++;    r.finOverdue++;    r.finActiveTotal++;  r.execCompleted++;  break;
      case 'FIN_WARNING':
        r.warning++;    r.finWarning++;    r.finActiveTotal++;  r.execCompleted++;  break;
      case 'FIN_ON_TIME':
        r.onTime++;     r.finOnTime++;     r.finActiveTotal++;  r.execCompleted++;  break;
      // ── Exec phase (execution not yet complete) ───────────────────────────────
      case 'EXEC_COMPLETED':
        r.completed++;  r.execCompleted++;  break;
      case 'EXEC_OVERDUE':
        r.overdue++;    r.execOverdue++;    break;
      case 'EXEC_WARNING':
        r.warning++;    r.execWarning++;    break;
      case 'EXEC_ON_TIME':
        r.onTime++;     r.execOnTime++;     break;
    }

    const days = getDays(wo, rule, stageMap, now, physicalKeyMap);
    if (days !== null) { r.totalDays += days; r.daysCount++; }
  }
  return r;
}

// ── KPI alerts: مغلقة لم تُفوتر + فُوتر بلا شهادة إنجاز + غير الممسوحة + غير المنسقة ──
interface PendingAlert { count: number; avgDays: number | null; thresholdDays: number | null; statusColor: 'red' | 'amber' | 'green' | null; }

function computeKpiAlerts(wos: any[], stageMap: Map<string, any>, metrics: any[] = [], now: Date = new Date()): {
  closedNotInvoiced: number; invoicedNoCert: number;
  closedNotInvoicedValue: number; invoicedNoCertValue: number;
  completedWithCert: number; completedWithCertValue: number;
  unSurveyed: PendingAlert; unCoordinated: PendingAlert;
} {
  let closedNotInvoiced      = 0;
  let invoicedNoCert         = 0;
  let closedNotInvoicedValue = 0;
  let invoicedNoCertValue    = 0;
  let completedWithCert      = 0;
  let completedWithCertValue = 0;

  // SLA thresholds from matching metrics, or safe fallbacks
  const surveyMetric = metrics.find((m: any) => m.startColumnKey === 'assignment_date' && m.endColumnKey === 'survey_date');
  const coordMetric  = metrics.find((m: any) => m.startColumnKey === 'survey_date'     && m.endColumnKey === 'coordination_date');
  const surveyThreshold = (surveyMetric?.thresholdDays ?? 1) as number;
  const coordThreshold  = (coordMetric?.thresholdDays  ?? 9) as number;

  let unSurveyedDaysTotal = 0, unSurveyedCount = 0;
  let unCoordDaysTotal    = 0, unCoordCount    = 0;

  for (const wo of wos) {
    const hasProc155    = !!(wo.proc155CloseDate);
    const isCancelled   = stageMap.get(wo.stageId ?? '')?.isCancelled === true;
    const inv1Val       = parseFloat(wo.invoice1 ?? wo.invoice_1 ?? '0') || 0;
    const inv2Val       = parseFloat(wo.invoice2 ?? wo.invoice_2 ?? '0') || 0;
    const certConfirmed = wo.completionCertConfirm === true || wo.completionCertConfirm === 't';
    const invType       = wo.invoiceType ?? wo.invoice_type;
    const isPartial     = invType === 'جزئي';
    const isFinal       = invType === 'نهائي';

    // شروط "مغلقة لم تُفوتر" — لا تغيير
    if (hasProc155 && !isCancelled && inv1Val <= 0) {
      closedNotInvoiced++;
      closedNotInvoicedValue += parseFloat(wo.estimatedValue ?? wo.estimated_value ?? '0') || 0;
    }

    // شروط "مفوتر ولم يصدر له شهادة إنجاز" — لا تغيير
    if (hasProc155 && isPartial && !certConfirmed && inv1Val > 0 && inv2Val <= 0) {
      invoicedNoCert++;
      invoicedNoCertValue += inv1Val;
    }

    // شروط "شهادات الإنجاز المكتملة" — لا تغيير
    const isCertComplete =
      hasProc155 && certConfirmed &&
      ((isPartial && inv1Val > 0 && inv2Val > 0) || (isFinal && inv1Val > 0));
    if (isCertComplete) {
      completedWithCert++;
      completedWithCertValue += isPartial ? (inv1Val + inv2Val) : inv1Val;
    }

    // شروط "غير الممسوحة": assignment_date موجود + survey_date = null + ليست ملغية
    const assignDate = wo.assignmentDate ?? wo.assignment_date;
    const surveyDate = wo.surveyDate ?? wo.survey_date;
    if (assignDate && !surveyDate && !isCancelled) {
      const days = (now.getTime() - new Date(assignDate).getTime()) / 86_400_000;
      if (days >= 0) { unSurveyedDaysTotal += days; unSurveyedCount++; }
    }

    // شروط "غير المنسقة": survey_date موجود + coordination_date = null + ليست ملغية
    const coordDate = wo.coordinationDate ?? wo.coordination_date;
    if (surveyDate && !coordDate && !isCancelled) {
      const days = (now.getTime() - new Date(surveyDate).getTime()) / 86_400_000;
      if (days >= 0) { unCoordDaysTotal += days; unCoordCount++; }
    }
  }

  const buildPendingAlert = (count: number, totalDays: number, threshold: number): PendingAlert => {
    const avgDays = count > 0 ? Math.round(totalDays / count) : null;
    let statusColor: PendingAlert['statusColor'] = null;
    if (avgDays !== null) {
      if (avgDays > threshold)       statusColor = 'red';
      else if (avgDays > threshold * 0.8) statusColor = 'amber';
      else statusColor = 'green';
    }
    return { count, avgDays, thresholdDays: threshold, statusColor };
  };

  return {
    closedNotInvoiced, invoicedNoCert, closedNotInvoicedValue, invoicedNoCertValue, completedWithCert, completedWithCertValue,
    unSurveyed:    buildPendingAlert(unSurveyedCount, unSurveyedDaysTotal, surveyThreshold),
    unCoordinated: buildPendingAlert(unCoordCount,    unCoordDaysTotal,    coordThreshold),
  };
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
      const collected  = parseFloat(wo.collectedAmount ?? wo.collected_amount ?? '0') || 0;
      const estimated  = parseFloat(wo.estimatedValue  ?? wo.estimated_value  ?? '0') || 0;
      if (estimated > 0 && collected < estimated) notFullyBilled++;
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
    ruleMap: new Map<string, any>(rules.map((r: any) => [r.projectTypeValue, r])),
    finRule: fin[0] ?? { isEnabled: false, slaDays: 20, warningDays: 3, endMode: 'COLUMN_DATE', endColumnKey: null, endStageId: null },
    settings,
    stageMap: new Map<string, any>(stagesAll.map((s: any) => [s.id, s])),
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
    const [{ ruleMap, stageMap, finRule, settings, metrics }, physicalKeyMap] =
      await Promise.all([loadKpiConfig(), loadPhysicalKeyMap()]);
    const { from, to } = buildDateRange(req.query.from as string, req.query.to as string, settings.defaultDateRangeMode);
    const { dateBasisType, dateBasisColumnKey } = parseDateBasis(req.query);
    const sectorId = scope.sectorId ?? (req.query.sectorId as string | undefined) ?? null;
    const regionId = scope.regionId ?? (req.query.regionId as string | undefined) ?? null;
    const projectType = (req.query.projectType as string | undefined) || null;
    const includeCancelled = false; // cancelled WOs are never shown in reports — export-only via ExportCenter
    const includeCompleted = req.query.includeCompleted !== undefined ? req.query.includeCompleted === 'true' : true;

    const wos = await fetchWOs({ sectorId, regionId, projectType, from, to, dateBasisType, dateBasisColumnKey, includeCancelled, physicalKeyMap });
    const now = new Date();

    // aggregateCounts now uses GeneralStatus — each WO counted exactly once.
    // finRule + finEnabled are passed so financial phase statuses override exec.
    const counts = aggregateCounts(
      wos, ruleMap, stageMap, now, includeCancelled, includeCompleted,
      physicalKeyMap, finRule, finRule.isEnabled,
    );

    const wosForMetrics = wos.filter((wo: any) => {
      const rule = ruleMap.get(wo.projectType ?? '');
      if (!rule) return true;
      const status = computeExecStatus(wo, rule, stageMap, now, physicalKeyMap);
      if (status === 'CANCELLED' && !includeCancelled) return false;
      if (status === 'COMPLETED' && !includeCompleted) return false;
      return true;
    });
    const metricsAverages = aggregateMetrics(wosForMetrics, metrics, stageMap, now, physicalKeyMap);

    // Build structured breakdown objects from the new counts fields.
    // These are informational only — card main values use the general-status fields above.
    const execBreakdown = {
      overdue:   counts.execOverdue,
      warning:   counts.execWarning,
      onTime:    counts.execOnTime,
      completed: counts.completed - counts.finCompleted,
    };
    const finCountsObj = finRule.isEnabled ? {
      total:     counts.finActiveTotal,
      overdue:   counts.finOverdue,
      warning:   counts.finWarning,
      onTime:    counts.finOnTime,
      completed: counts.finCompleted,
    } : null;

    const kpiAlerts = computeKpiAlerts(wos, stageMap, metrics, now);

    res.json({
      ...counts,
      avgDays: counts.daysCount > 0 ? Math.round(counts.totalDays / counts.daysCount) : null,
      metricsAverages,
      billingCounts: computeBillingCounts(wos),
      finEnabled: finRule.isEnabled,
      finCounts: finCountsObj,
      execBreakdown,
      kpiAlerts,
      from: from.toISOString(), to: to.toISOString(),
    });
  } catch (err) {
    console.error('[PERIODIC SUMMARY]', err);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// ── 3. GET /kpi-alerts/closed-not-invoiced ────────────────────────────────────
// Returns the individual work orders counted in the "مغلقة لم تُفوتر" KPI card,
// with the same filters as /summary, plus approxValue per row for the drill-down drawer.

router.get('/kpi-alerts/closed-not-invoiced', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const scope = await getUserScope(req.user!.id);
    if (!scope.canViewPeriodicReport) {
      return res.status(403).json({ error: 'Access denied: Periodic Report permission required' });
    }
    const [{ settings, stageMap }, physicalKeyMap] = await Promise.all([loadKpiConfig(), loadPhysicalKeyMap()]);
    const { from, to } = buildDateRange(req.query.from as string, req.query.to as string, settings.defaultDateRangeMode);
    const { dateBasisType, dateBasisColumnKey } = parseDateBasis(req.query);
    const sectorId = scope.sectorId ?? (req.query.sectorId as string | undefined) ?? null;
    const regionId = scope.regionId ?? (req.query.regionId as string | undefined) ?? null;
    const projectType = (req.query.projectType as string | undefined) || null;

    const wos = await fetchWOs({ sectorId, regionId, projectType, from, to, dateBasisType, dateBasisColumnKey, physicalKeyMap });

    // Load region + sector name maps for display
    const [allRegions, allSectors] = await Promise.all([
      db.select({ id: regions.id, nameAr: regions.nameAr, sectorId: regions.sectorId }).from(regions),
      db.select({ id: sectors.id, nameAr: sectors.nameAr }).from(sectors),
    ]);
    type RegionRow = { id: string; nameAr: string | null; sectorId: string | null };
    const regionMap = new Map<string, RegionRow>();
    for (const r of allRegions) regionMap.set(r.id, { id: r.id, nameAr: r.nameAr as string | null, sectorId: (r as any).sectorId ?? null });
    const sectorMap = new Map<string, string | null>();
    for (const s of allSectors) sectorMap.set(s.id, s.nameAr as string | null);

    const rows: any[] = [];
    for (const wo of wos) {
      const hasProc155  = !!(wo.proc155CloseDate);
      const isCancelled = stageMap.get(wo.stageId ?? '')?.isCancelled === true;
      const invType     = wo.invoiceType ?? (wo as any).invoice_type;
      const inv1Val     = parseFloat(wo.invoice1 as any ?? '0') || 0;

      // نفس منطق computeKpiAlerts: إجراء 155 + ليست ملغية + قيمة م.1 = 0
      if (!(hasProc155 && !isCancelled && inv1Val <= 0)) continue;

      const inv2Val   = parseFloat(wo.invoice2 as any ?? '0') || 0;
      const estimated = parseFloat(wo.estimatedValue as any ?? '0') || 0;

      const region       = wo.regionId ? regionMap.get(wo.regionId) : null;
      const sectorNameAr = region?.sectorId ? sectorMap.get(region.sectorId) : null;

      rows.push({
        orderNumber:        wo.orderNumber,
        district:           wo.district,
        regionNameAr:       region?.nameAr ?? null,
        sectorNameAr:       sectorNameAr ?? null,
        invoiceType:        invType ?? null,
        proc155CloseDate:   wo.proc155CloseDate,
        financialCloseDate: (wo as any).financialCloseDate ?? null,
        invoiceNumber:      wo.invoiceNumber ?? null,
        invoice1:           inv1Val || null,
        invoice2Number:     wo.invoice2Number ?? null,
        invoice2:           inv2Val || null,
        estimatedValue:     estimated || null,
        approxValue:        estimated,
      });
    }

    const totalValue = rows.reduce((s, r) => s + r.approxValue, 0);
    res.json({ rows, count: rows.length, totalValue });
  } catch (err) {
    console.error('[KPI DRILL-DOWN closed-not-invoiced]', err);
    res.status(500).json({ error: 'Failed to fetch drill-down data' });
  }
});

// ── 3b. GET /kpi-alerts/invoiced-no-cert ─────────────────────────────────────
// Returns work orders counted in "فُوتر بلا شهادة إنجاز":
//   1. إجراء 155 موجود
//   2. نهائي → م.1 موجود / جزئي → م.1 و م.2 معاً
//   3. completionCertConfirm !== true

router.get('/kpi-alerts/invoiced-no-cert', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const scope = await getUserScope(req.user!.id);
    if (!scope.canViewPeriodicReport) {
      return res.status(403).json({ error: 'Access denied: Periodic Report permission required' });
    }
    const [{ settings }, physicalKeyMap] = await Promise.all([loadKpiConfig(), loadPhysicalKeyMap()]);
    const { from, to } = buildDateRange(req.query.from as string, req.query.to as string, settings.defaultDateRangeMode);
    const { dateBasisType, dateBasisColumnKey } = parseDateBasis(req.query);
    const sectorId = scope.sectorId ?? (req.query.sectorId as string | undefined) ?? null;
    const regionId = scope.regionId ?? (req.query.regionId as string | undefined) ?? null;
    const projectType = (req.query.projectType as string | undefined) || null;

    const wos = await fetchWOs({ sectorId, regionId, projectType, from, to, dateBasisType, dateBasisColumnKey, physicalKeyMap });

    const [allRegions, allSectors] = await Promise.all([
      db.select({ id: regions.id, nameAr: regions.nameAr, sectorId: regions.sectorId }).from(regions),
      db.select({ id: sectors.id, nameAr: sectors.nameAr }).from(sectors),
    ]);
    type RegionRow2 = { id: string; nameAr: string | null; sectorId: string | null };
    const regionMap2 = new Map<string, RegionRow2>();
    for (const r of allRegions) regionMap2.set(r.id, { id: r.id, nameAr: r.nameAr as string | null, sectorId: (r as any).sectorId ?? null });
    const sectorMap2 = new Map<string, string | null>();
    for (const s of allSectors) sectorMap2.set(s.id, s.nameAr as string | null);

    const rows: any[] = [];
    for (const wo of wos) {
      const hasProc155    = !!(wo.proc155CloseDate);
      const certConfirmed = wo.completionCertConfirm === true || wo.completionCertConfirm === 't';
      const inv1Val       = parseFloat(wo.invoice1 as any ?? '0') || 0;
      const inv2Val       = parseFloat(wo.invoice2 as any ?? '0') || 0;
      const isPartial     = (wo.invoiceType ?? (wo as any).invoice_type) === 'جزئي';

      // نفس منطق computeKpiAlerts: جزئي فقط
      if (!(hasProc155 && isPartial && !certConfirmed && inv1Val > 0 && inv2Val <= 0)) continue;

      const invType      = wo.invoiceType ?? (wo as any).invoice_type;
      const region       = wo.regionId ? regionMap2.get(wo.regionId) : null;
      const sectorNameAr = region?.sectorId ? sectorMap2.get(region.sectorId) : null;

      rows.push({
        orderNumber:          wo.orderNumber,
        district:             wo.district,
        regionNameAr:         region?.nameAr ?? null,
        sectorNameAr:         sectorNameAr ?? null,
        invoiceType:          invType ?? null,
        proc155CloseDate:     wo.proc155CloseDate,
        invoiceNumber:        wo.invoiceNumber ?? null,
        invoice1:             inv1Val,
        invoiceBillingDate:   wo.invoiceBillingDate ?? null,
        approxInvoice2:       inv1Val,   // تقدير م.2 = م.1
        completionCertConfirm: wo.completionCertConfirm ?? null,
      });
    }

    const totalValue = rows.reduce((s, r) => s + r.invoice1, 0);
    res.json({ rows, count: rows.length, totalValue });
  } catch (err) {
    console.error('[KPI DRILL-DOWN invoiced-no-cert]', err);
    res.status(500).json({ error: 'Failed to fetch drill-down data' });
  }
});

// ── 3c. GET /kpi-alerts/completed-with-cert ──────────────────────────────────
// Returns work orders counted in "شهادات الإنجاز المكتملة":
//   إجراء 155 + شهادة مؤكدة + (جزئي: م.1 وم.2 / نهائي: م.1)

router.get('/kpi-alerts/completed-with-cert', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const scope = await getUserScope(req.user!.id);
    if (!scope.canViewPeriodicReport) {
      return res.status(403).json({ error: 'Access denied: Periodic Report permission required' });
    }
    const [{ settings }, physicalKeyMap] = await Promise.all([loadKpiConfig(), loadPhysicalKeyMap()]);
    const { from, to } = buildDateRange(req.query.from as string, req.query.to as string, settings.defaultDateRangeMode);
    const { dateBasisType, dateBasisColumnKey } = parseDateBasis(req.query);
    const sectorId   = scope.sectorId ?? (req.query.sectorId as string | undefined) ?? null;
    const regionId   = scope.regionId ?? (req.query.regionId as string | undefined) ?? null;
    const projectType = (req.query.projectType as string | undefined) || null;

    const wos = await fetchWOs({ sectorId, regionId, projectType, from, to, dateBasisType, dateBasisColumnKey, physicalKeyMap });

    const [allRegions, allSectors] = await Promise.all([
      db.select({ id: regions.id, nameAr: regions.nameAr, sectorId: regions.sectorId }).from(regions),
      db.select({ id: sectors.id, nameAr: sectors.nameAr }).from(sectors),
    ]);
    type RegionRow3 = { id: string; nameAr: string | null; sectorId: string | null };
    const regionMap3 = new Map<string, RegionRow3>();
    for (const r of allRegions) regionMap3.set(r.id, { id: r.id, nameAr: r.nameAr as string | null, sectorId: (r as any).sectorId ?? null });
    const sectorMap3 = new Map<string, string | null>();
    for (const s of allSectors) sectorMap3.set(s.id, s.nameAr as string | null);

    const rows: any[] = [];
    for (const wo of wos) {
      const hasProc155    = !!(wo.proc155CloseDate);
      const certConfirmed = wo.completionCertConfirm === true || wo.completionCertConfirm === 't';
      const inv1Val       = parseFloat(wo.invoice1 as any ?? '0') || 0;
      const inv2Val       = parseFloat(wo.invoice2 as any ?? '0') || 0;
      const invType       = wo.invoiceType ?? (wo as any).invoice_type;
      const isPartial     = invType === 'جزئي';
      const isFinal       = invType === 'نهائي';

      const isCertComplete =
        hasProc155 && certConfirmed &&
        ((isPartial && inv1Val > 0 && inv2Val > 0) || (isFinal && inv1Val > 0));
      if (!isCertComplete) continue;

      const region       = wo.regionId ? regionMap3.get(wo.regionId) : null;
      const sectorNameAr = region?.sectorId ? sectorMap3.get(region.sectorId) : null;
      const totalInvoiced = isPartial ? (inv1Val + inv2Val) : inv1Val;

      // Merge customFields JSONB to top-level so dynamic catalog columns are accessible
      const cf = (wo as any).customFields ?? (wo as any).custom_fields;
      const customMerged = cf ? (typeof cf === 'string' ? JSON.parse(cf) : cf) ?? {} : {};

      rows.push({
        ...wo,
        ...customMerged,
        // Computed/joined fields (override any WO-level values with the same key)
        regionNameAr:  region?.nameAr ?? null,
        sectorNameAr:  sectorNameAr ?? null,
        totalInvoiced,
      });
    }

    const filteredRows = await filterOutput(rows, req.user!.id, req.user!.role, 'work_orders');
    // Re-attach computed fields stripped by filterOutput (they are not in column catalog)
    const safeRows = filteredRows.map((r: any, i: number) => ({
      ...r,
      regionNameAr:  rows[i].regionNameAr,
      sectorNameAr:  rows[i].sectorNameAr,
      totalInvoiced: rows[i].totalInvoiced,
    }));
    const totalValue = safeRows.reduce((s: number, r: any) => s + r.totalInvoiced, 0);
    res.json({ rows: safeRows, count: safeRows.length, totalValue });
  } catch (err) {
    console.error('[KPI DRILL-DOWN completed-with-cert]', err);
    res.status(500).json({ error: 'Failed to fetch drill-down data' });
  }
});

// ── 3d. GET /kpi-alerts/by-status ─────────────────────────────────────────────
// Returns work orders for a given general status bucket (OVERDUE|WARNING|ON_TIME|COMPLETED|ALL).
// Used by stat-card drill-down drawers on the periodic report.

router.get('/kpi-alerts/by-status', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const scope = await getUserScope(req.user!.id);
    if (!scope.canViewPeriodicReport) {
      return res.status(403).json({ error: 'Access denied: Periodic Report permission required' });
    }
    const statusFilter = (req.query.status as string | undefined) ?? 'ALL';
    const validStatuses = ['OVERDUE', 'WARNING', 'ON_TIME', 'COMPLETED', 'ALL'];
    if (!validStatuses.includes(statusFilter)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }

    const [{ ruleMap, stageMap, finRule, settings }, physicalKeyMap] =
      await Promise.all([loadKpiConfig(), loadPhysicalKeyMap()]);
    const { from, to } = buildDateRange(req.query.from as string, req.query.to as string, settings.defaultDateRangeMode);
    const { dateBasisType, dateBasisColumnKey } = parseDateBasis(req.query);
    const sectorId    = scope.sectorId ?? (req.query.sectorId as string | undefined) ?? null;
    const regionId    = scope.regionId ?? (req.query.regionId as string | undefined) ?? null;
    const projectType = (req.query.projectType as string | undefined) || null;
    const includeCompleted = req.query.includeCompleted !== undefined ? req.query.includeCompleted === 'true' : true;
    const finEnabled  = finRule?.isEnabled ?? false;

    const wos = await fetchWOs({ sectorId, regionId, projectType, from, to, dateBasisType, dateBasisColumnKey, physicalKeyMap });

    const [allRegions, allSectors] = await Promise.all([
      db.select({ id: regions.id, nameAr: regions.nameAr, sectorId: regions.sectorId }).from(regions),
      db.select({ id: sectors.id, nameAr: sectors.nameAr }).from(sectors),
    ]);
    type RegionRowBS = { id: string; nameAr: string | null; sectorId: string | null };
    const regionMapBS = new Map<string, RegionRowBS>();
    for (const r of allRegions) regionMapBS.set(r.id, { id: r.id, nameAr: r.nameAr as string | null, sectorId: (r as any).sectorId ?? null });
    const sectorMapBS = new Map<string, string | null>(allSectors.map((s: any) => [s.id, s.nameAr as string | null]));

    const now = new Date();
    const rows: any[] = [];

    for (const wo of wos) {
      const rule = ruleMap.get(wo.projectType ?? '');
      if (!rule) continue;

      const gs = computeGeneralStatus(wo, rule, finRule, finEnabled, stageMap, now, physicalKeyMap);

      // Respect includeCompleted flag
      const isFullyCompleted = gs === 'FIN_COMPLETED' || (gs === 'EXEC_COMPLETED' && !finEnabled);
      if (isFullyCompleted && !includeCompleted) continue;
      if (gs === 'CANCELLED') continue;

      // Filter by requested status bucket
      const matchesStatus =
        statusFilter === 'ALL' ||
        (statusFilter === 'OVERDUE'   && (gs === 'EXEC_OVERDUE'  || gs === 'FIN_OVERDUE'))  ||
        (statusFilter === 'WARNING'   && (gs === 'EXEC_WARNING'  || gs === 'FIN_WARNING'))  ||
        (statusFilter === 'ON_TIME'   && (gs === 'EXEC_ON_TIME'  || gs === 'FIN_ON_TIME'))  ||
        (statusFilter === 'COMPLETED' && (gs === 'EXEC_COMPLETED' || gs === 'FIN_COMPLETED'));
      if (!matchesStatus) continue;

      const region      = wo.regionId ? regionMapBS.get(wo.regionId) : null;
      const sectorNameAr = region?.sectorId ? sectorMapBS.get(region.sectorId) : null;

      // Merge customFields so dynamic columns are accessible by filterOutput
      const cf = (wo as any).customFields ?? (wo as any).custom_fields;
      const customMerged = cf ? (typeof cf === 'string' ? JSON.parse(cf) : cf) ?? {} : {};

      rows.push({ ...wo, ...customMerged, regionNameAr: region?.nameAr ?? null, sectorNameAr: sectorNameAr ?? null, generalStatus: gs });
    }

    const filteredRows = await filterOutput(rows, req.user!.id, req.user!.role, 'work_orders');
    const safeRows = filteredRows.map((r: any, i: number) => ({
      ...r,
      regionNameAr:  rows[i].regionNameAr,
      sectorNameAr:  rows[i].sectorNameAr,
      generalStatus: rows[i].generalStatus,
    }));

    res.json({ rows: safeRows, count: safeRows.length });
  } catch (err) {
    console.error('[KPI DRILL-DOWN by-status]', err);
    res.status(500).json({ error: 'Failed to fetch drill-down data' });
  }
});

// ── 3e. GET /kpi-alerts/metric-orders ─────────────────────────────────────────
// Returns work orders contributing to a specific metric average (by metricCode).
// Used by metric-card drill-down drawers.

router.get('/kpi-alerts/metric-orders', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const scope = await getUserScope(req.user!.id);
    if (!scope.canViewPeriodicReport) {
      return res.status(403).json({ error: 'Access denied: Periodic Report permission required' });
    }
    const metricCode = (req.query.metricCode as string | undefined) ?? '';
    if (!metricCode) return res.status(400).json({ error: 'metricCode is required' });

    const [{ stageMap, settings, metrics }, physicalKeyMap] =
      await Promise.all([loadKpiConfig(), loadPhysicalKeyMap()]);

    const metric = metrics.find((m: any) => m.code === metricCode && m.isEnabled);
    if (!metric) return res.status(404).json({ error: 'Metric not found or disabled' });

    const { from, to } = buildDateRange(req.query.from as string, req.query.to as string, settings.defaultDateRangeMode);
    const { dateBasisType, dateBasisColumnKey } = parseDateBasis(req.query);
    const sectorId    = scope.sectorId ?? (req.query.sectorId as string | undefined) ?? null;
    const regionId    = scope.regionId ?? (req.query.regionId as string | undefined) ?? null;
    const projectType = (req.query.projectType as string | undefined) || null;

    const wos = await fetchWOs({ sectorId, regionId, projectType, from, to, dateBasisType, dateBasisColumnKey, physicalKeyMap });

    const [allRegions, allSectors] = await Promise.all([
      db.select({ id: regions.id, nameAr: regions.nameAr, sectorId: regions.sectorId }).from(regions),
      db.select({ id: sectors.id, nameAr: sectors.nameAr }).from(sectors),
    ]);
    type RegionRowMO = { id: string; nameAr: string | null; sectorId: string | null };
    const regionMapMO = new Map<string, RegionRowMO>();
    for (const r of allRegions) regionMapMO.set(r.id, { id: r.id, nameAr: r.nameAr as string | null, sectorId: (r as any).sectorId ?? null });
    const sectorMapMO = new Map<string, string | null>(allSectors.map((s: any) => [s.id, s.nameAr as string | null]));

    const now = new Date();
    const rows: any[] = [];

    for (const wo of wos) {
      // Cancelled WOs are never included in metric calculations
      const stage = stageMap.get(wo.stageId ?? '');
      if (stage?.isCancelled) continue;

      const metricDays = computeMetricDays(wo, metric, stageMap, now, physicalKeyMap);
      if (metricDays === null) continue; // WO has no value for this metric

      const region      = wo.regionId ? regionMapMO.get(wo.regionId) : null;
      const sectorNameAr = region?.sectorId ? sectorMapMO.get(region.sectorId) : null;

      const cf = (wo as any).customFields ?? (wo as any).custom_fields;
      const customMerged = cf ? (typeof cf === 'string' ? JSON.parse(cf) : cf) ?? {} : {};

      rows.push({ ...wo, ...customMerged, regionNameAr: region?.nameAr ?? null, sectorNameAr: sectorNameAr ?? null, metricDays: Math.round(metricDays) });
    }

    const filteredRows = await filterOutput(rows, req.user!.id, req.user!.role, 'work_orders');
    const safeRows = filteredRows.map((r: any, i: number) => ({
      ...r,
      regionNameAr: rows[i].regionNameAr,
      sectorNameAr: rows[i].sectorNameAr,
      metricDays:   rows[i].metricDays,
    }));

    res.json({ rows: safeRows, count: safeRows.length, metricNameAr: metric.nameAr, metricNameEn: metric.nameEn ?? null });
  } catch (err) {
    console.error('[KPI DRILL-DOWN metric-orders]', err);
    res.status(500).json({ error: 'Failed to fetch drill-down data' });
  }
});

// ── 3f. GET /kpi-alerts/partial-billed-orders ─────────────────────────────────
// Returns work orders for billing-count badges:
//   type=partialBilled  → مفوتر جزئياً
//   type=notFullyBilled → غير مُحصَّل بالكامل

router.get('/kpi-alerts/partial-billed-orders', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const scope = await getUserScope(req.user!.id);
    if (!scope.canViewPeriodicReport) {
      return res.status(403).json({ error: 'Access denied: Periodic Report permission required' });
    }
    const type = (req.query.type as string | undefined) ?? '';
    if (type !== 'partialBilled' && type !== 'notFullyBilled') {
      return res.status(400).json({ error: 'type must be partialBilled or notFullyBilled' });
    }

    const [{ settings }, physicalKeyMap] = await Promise.all([loadKpiConfig(), loadPhysicalKeyMap()]);
    const { from, to } = buildDateRange(req.query.from as string, req.query.to as string, settings.defaultDateRangeMode);
    const { dateBasisType, dateBasisColumnKey } = parseDateBasis(req.query);
    const sectorId    = scope.sectorId ?? (req.query.sectorId as string | undefined) ?? null;
    const regionId    = scope.regionId ?? (req.query.regionId as string | undefined) ?? null;
    const projectType = (req.query.projectType as string | undefined) || null;

    const wos = await fetchWOs({ sectorId, regionId, projectType, from, to, dateBasisType, dateBasisColumnKey, physicalKeyMap });

    const [allRegions, allSectors] = await Promise.all([
      db.select({ id: regions.id, nameAr: regions.nameAr, sectorId: regions.sectorId }).from(regions),
      db.select({ id: sectors.id, nameAr: sectors.nameAr }).from(sectors),
    ]);
    type RegionRowPB = { id: string; nameAr: string | null; sectorId: string | null };
    const regionMapPB = new Map<string, RegionRowPB>();
    for (const r of allRegions) regionMapPB.set(r.id, { id: r.id, nameAr: r.nameAr as string | null, sectorId: (r as any).sectorId ?? null });
    const sectorMapPB = new Map<string, string | null>(allSectors.map((s: any) => [s.id, s.nameAr as string | null]));

    const rows: any[] = [];

    for (const wo of wos) {
      const invType      = wo.invoiceType ?? (wo as any).invoice_type;
      const collected    = parseFloat(wo.collectedAmount ?? (wo as any).collected_amount ?? '0') || 0;
      const estimated    = parseFloat(wo.estimatedValue  ?? (wo as any).estimated_value  ?? '0') || 0;
      const inv1Val      = parseFloat(wo.invoice1 ?? (wo as any).invoice_1 ?? '0') || 0;

      let matches = false;
      if (type === 'partialBilled') {
        matches = invType === 'جزئي' && (wo.invoiceBillingDate ?? (wo as any).invoice_billing_date) != null && inv1Val > 0;
      } else {
        matches = invType != null && estimated > 0 && collected < estimated;
      }
      if (!matches) continue;

      const region      = wo.regionId ? regionMapPB.get(wo.regionId) : null;
      const sectorNameAr = region?.sectorId ? sectorMapPB.get(region.sectorId) : null;

      const cf = (wo as any).customFields ?? (wo as any).custom_fields;
      const customMerged = cf ? (typeof cf === 'string' ? JSON.parse(cf) : cf) ?? {} : {};

      rows.push({ ...wo, ...customMerged, regionNameAr: region?.nameAr ?? null, sectorNameAr: sectorNameAr ?? null });
    }

    const filteredRows = await filterOutput(rows, req.user!.id, req.user!.role, 'work_orders');
    const safeRows = filteredRows.map((r: any, i: number) => ({
      ...r,
      regionNameAr: rows[i].regionNameAr,
      sectorNameAr: rows[i].sectorNameAr,
    }));

    res.json({ rows: safeRows, count: safeRows.length });
  } catch (err) {
    console.error('[KPI DRILL-DOWN partial-billed-orders]', err);
    res.status(500).json({ error: 'Failed to fetch drill-down data' });
  }
});

// ── 3g. GET /kpi-alerts/pending-survey ───────────────────────────────────────
// Work orders with assignment_date set but survey_date missing (not cancelled).

router.get('/kpi-alerts/pending-survey', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const scope = await getUserScope(req.user!.id);
    if (!scope.canViewPeriodicReport) return res.status(403).json({ error: 'Access denied: Periodic Report permission required' });

    const [{ settings, stageMap, metrics }, physicalKeyMap] = await Promise.all([loadKpiConfig(), loadPhysicalKeyMap()]);
    const { from, to } = buildDateRange(req.query.from as string, req.query.to as string, settings.defaultDateRangeMode);
    const { dateBasisType, dateBasisColumnKey } = parseDateBasis(req.query);
    const sectorId    = scope.sectorId ?? (req.query.sectorId as string | undefined) ?? null;
    const regionId    = scope.regionId ?? (req.query.regionId as string | undefined) ?? null;
    const projectType = (req.query.projectType as string | undefined) || null;

    const wos = await fetchWOs({ sectorId, regionId, projectType, from, to, dateBasisType, dateBasisColumnKey, physicalKeyMap });
    const now = new Date();

    const surveyMetric = metrics.find((m: any) => m.startColumnKey === 'assignment_date' && m.endColumnKey === 'survey_date');
    const threshold = (surveyMetric?.thresholdDays ?? 1) as number;

    const [allRegions, allSectors] = await Promise.all([
      db.select({ id: regions.id, nameAr: regions.nameAr, sectorId: regions.sectorId }).from(regions),
      db.select({ id: sectors.id, nameAr: sectors.nameAr }).from(sectors),
    ]);
    const regionMapPS = new Map<string, { nameAr: string | null; sectorId: string | null }>(allRegions.map((r: any) => [r.id, { nameAr: r.nameAr as string | null, sectorId: r.sectorId as string | null }]));
    const sectorMapPS = new Map<string, string | null>(allSectors.map((s: any) => [s.id, s.nameAr as string | null]));

    const rows: any[] = [];
    for (const wo of wos) {
      const isCancelled = stageMap.get(wo.stageId ?? '')?.isCancelled === true;
      if (isCancelled) continue;
      const assignDate = wo.assignmentDate ?? (wo as any).assignment_date;
      const surveyDate = wo.surveyDate ?? (wo as any).survey_date;
      if (!assignDate || surveyDate) continue;

      const days = Math.round((now.getTime() - new Date(assignDate).getTime()) / 86_400_000);
      if (days < 0) continue;

      const region = wo.regionId ? regionMapPS.get(wo.regionId) : null;
      const sectorNameAr = region?.sectorId ? sectorMapPS.get(region.sectorId) : null;
      const cf = (wo as any).customFields ?? (wo as any).custom_fields;
      const customMerged = cf ? (typeof cf === 'string' ? JSON.parse(cf) : cf) ?? {} : {};

      let statusColor: 'red' | 'amber' | 'green' = days > threshold ? 'red' : days > threshold * 0.8 ? 'amber' : 'green';
      rows.push({ ...wo, ...customMerged, regionNameAr: region?.nameAr ?? null, sectorNameAr: sectorNameAr ?? null, metricDays: days, thresholdDays: threshold, statusColor });
    }

    const filtered = await filterOutput(rows, req.user!.id, req.user!.role, 'work_orders');
    const safeRows = filtered.map((r: any, i: number) => ({
      ...r, regionNameAr: rows[i].regionNameAr, sectorNameAr: rows[i].sectorNameAr,
      metricDays: rows[i].metricDays, thresholdDays: rows[i].thresholdDays, statusColor: rows[i].statusColor,
    }));

    res.json({ rows: safeRows, count: safeRows.length, thresholdDays: threshold });
  } catch (err) {
    console.error('[KPI pending-survey]', err);
    res.status(500).json({ error: 'Failed to fetch pending survey orders' });
  }
});

// ── 3h. GET /kpi-alerts/pending-coordination ──────────────────────────────────
// Work orders with survey_date set but coordination_date missing (not cancelled).

router.get('/kpi-alerts/pending-coordination', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const scope = await getUserScope(req.user!.id);
    if (!scope.canViewPeriodicReport) return res.status(403).json({ error: 'Access denied: Periodic Report permission required' });

    const [{ settings, stageMap, metrics }, physicalKeyMap] = await Promise.all([loadKpiConfig(), loadPhysicalKeyMap()]);
    const { from, to } = buildDateRange(req.query.from as string, req.query.to as string, settings.defaultDateRangeMode);
    const { dateBasisType, dateBasisColumnKey } = parseDateBasis(req.query);
    const sectorId    = scope.sectorId ?? (req.query.sectorId as string | undefined) ?? null;
    const regionId    = scope.regionId ?? (req.query.regionId as string | undefined) ?? null;
    const projectType = (req.query.projectType as string | undefined) || null;

    const wos = await fetchWOs({ sectorId, regionId, projectType, from, to, dateBasisType, dateBasisColumnKey, physicalKeyMap });
    const now = new Date();

    const coordMetric = metrics.find((m: any) => m.startColumnKey === 'survey_date' && m.endColumnKey === 'coordination_date');
    const threshold = (coordMetric?.thresholdDays ?? 9) as number;

    const [allRegions, allSectors] = await Promise.all([
      db.select({ id: regions.id, nameAr: regions.nameAr, sectorId: regions.sectorId }).from(regions),
      db.select({ id: sectors.id, nameAr: sectors.nameAr }).from(sectors),
    ]);
    const regionMapPC = new Map<string, { nameAr: string | null; sectorId: string | null }>(allRegions.map((r: any) => [r.id, { nameAr: r.nameAr as string | null, sectorId: r.sectorId as string | null }]));
    const sectorMapPC = new Map<string, string | null>(allSectors.map((s: any) => [s.id, s.nameAr as string | null]));

    const rows: any[] = [];
    for (const wo of wos) {
      const isCancelled = stageMap.get(wo.stageId ?? '')?.isCancelled === true;
      if (isCancelled) continue;
      const surveyDate = wo.surveyDate ?? (wo as any).survey_date;
      const coordDate  = wo.coordinationDate ?? (wo as any).coordination_date;
      if (!surveyDate || coordDate) continue;

      const days = Math.round((now.getTime() - new Date(surveyDate).getTime()) / 86_400_000);
      if (days < 0) continue;

      const region = wo.regionId ? regionMapPC.get(wo.regionId) : null;
      const sectorNameAr = region?.sectorId ? sectorMapPC.get(region.sectorId) : null;
      const cf = (wo as any).customFields ?? (wo as any).custom_fields;
      const customMerged = cf ? (typeof cf === 'string' ? JSON.parse(cf) : cf) ?? {} : {};

      let statusColor: 'red' | 'amber' | 'green' = days > threshold ? 'red' : days > threshold * 0.8 ? 'amber' : 'green';
      rows.push({ ...wo, ...customMerged, regionNameAr: region?.nameAr ?? null, sectorNameAr: sectorNameAr ?? null, metricDays: days, thresholdDays: threshold, statusColor });
    }

    const filtered = await filterOutput(rows, req.user!.id, req.user!.role, 'work_orders');
    const safeRows = filtered.map((r: any, i: number) => ({
      ...r, regionNameAr: rows[i].regionNameAr, sectorNameAr: rows[i].sectorNameAr,
      metricDays: rows[i].metricDays, thresholdDays: rows[i].thresholdDays, statusColor: rows[i].statusColor,
    }));

    res.json({ rows: safeRows, count: safeRows.length, thresholdDays: threshold });
  } catch (err) {
    console.error('[KPI pending-coordination]', err);
    res.status(500).json({ error: 'Failed to fetch pending coordination orders' });
  }
});

// ── 4. GET /regions ────────────────────────────────────────────────────────────

router.get('/regions', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const scope = await getUserScope(req.user!.id);
    const [{ ruleMap, stageMap, finRule, settings, metrics }, physicalKeyMap] =
      await Promise.all([loadKpiConfig(), loadPhysicalKeyMap()]);
    const { from, to } = buildDateRange(req.query.from as string, req.query.to as string, settings.defaultDateRangeMode);
    const { dateBasisType, dateBasisColumnKey } = parseDateBasis(req.query);
    const forceSectorId = scope.sectorId ?? ((req.query.sectorId as string) || null);
    const forceRegionId = scope.regionId ?? ((req.query.regionId as string) || null);
    const projectType = (req.query.projectType as string) || null;
    const includeCancelled = false; // cancelled WOs are never shown in reports — export-only via ExportCenter
    const includeCompleted = req.query.includeCompleted !== undefined ? req.query.includeCompleted === 'true' : true;

    const allWOs = await fetchWOs({ sectorId: forceSectorId, regionId: forceRegionId, projectType, from, to, dateBasisType, dateBasisColumnKey, includeCancelled, physicalKeyMap });
    const now = new Date();

    const regionConds: any[] = [eq(regions.active, true)];
    if (forceRegionId) regionConds.push(eq(regions.id, forceRegionId));
    else if (forceSectorId) regionConds.push(eq(regions.sectorId, forceSectorId));
    const allRegions = await db.select({ id: regions.id, nameAr: regions.nameAr, sectorId: regions.sectorId })
      .from(regions).where(and(...regionConds));

    const sectorIds = [...new Set(allRegions.map((r: any) => r.sectorId).filter(Boolean))] as string[];
    const allSectors = sectorIds.length
      ? await db.select({ id: sectors.id, nameAr: sectors.nameAr }).from(sectors).where(eq(sectors.active, true))
      : [];
    const sectorMap = new Map<string, any>(allSectors.map((s: any) => [s.id, s]));

    const result = allRegions.map((region: any) => {
      const wos = allWOs.filter((wo: any) => wo.regionId === region.id);
      const counts = aggregateCounts(wos, ruleMap, stageMap, now, includeCancelled, includeCompleted, physicalKeyMap, finRule, finRule.isEnabled);
      const wosForMetrics = wos.filter((wo: any) => {
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

    const [{ ruleMap, stageMap, finRule, settings, rules, metrics }, physicalKeyMap] =
      await Promise.all([loadKpiConfig(), loadPhysicalKeyMap()]);
    const { from, to } = buildDateRange(req.query.from as string, req.query.to as string, settings.defaultDateRangeMode);
    const { dateBasisType, dateBasisColumnKey } = parseDateBasis(req.query);
    const projectType = (req.query.projectType as string) || null;
    const includeCancelled = false; // cancelled WOs are never shown in reports — export-only via ExportCenter
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
      const ptLabel = rules.find((r: any) => r.projectTypeValue === ptValue)?.projectTypeLabelAr ?? ptValue;

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
    const reasonWOs = wos.filter((wo: any) => wo.holdReason && wo.holdReason.trim());

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
