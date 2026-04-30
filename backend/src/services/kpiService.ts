import { db } from '../db';
import { kpiRules, kpiTemplates, workOrders, roleColumnPermissions, stages, columnCatalog } from '../db/schema';
import { eq, and, inArray, lte, gte } from 'drizzle-orm';

export interface KpiResult {
  ruleId: string;
  templateId: string;
  nameAr: string;
  category: string;
  slaDays: number;
  elapsedDays: number | null;
  remainingDays: number | null;
  percentValue: number | null;
  status: 'OK' | 'WARN' | 'OVERDUE' | 'INCOMPLETE' | 'COMPLETED' | 'COMPLETED_LATE';
  isCompleted: boolean;
  details: any;
}

export type DashboardStatus = 'CANCELLED' | 'COMPLETED' | 'COMPLETED_LATE' | 'OVERDUE' | 'WARN' | 'OK' | 'NONE';

export interface DashboardKpiResult {
  exec: DashboardStatus;
  fin:  DashboardStatus;
}

/** Convert snake_case to camelCase for Drizzle field access */
function toCamel(s: string): string {
  return s.replace(/_(\d+)/g, (_, n) => n).replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

/** Get work order field by snake_case column key.
 *  Tries: columnKey → camelCase(columnKey) → physicalKey → camelCase(physicalKey) → customFields JSONB
 *  physicalKeyMap: optional map of columnKey → physicalKey loaded from column_catalog */
function getWoField(wo: any, columnKey: string, physicalKeyMap?: Map<string, string>): any {
  // 1. Try the columnKey directly and its camelCase form
  if (wo[columnKey] !== undefined && wo[columnKey] !== null) return wo[columnKey];
  const camel = toCamel(columnKey);
  if (wo[camel] !== undefined && wo[camel] !== null) return wo[camel];

  // 2. If a physicalKey exists (column was renamed), try that too
  const physKey = physicalKeyMap?.get(columnKey);
  if (physKey && physKey !== columnKey) {
    if (wo[physKey] !== undefined && wo[physKey] !== null) return wo[physKey];
    const physCamel = toCamel(physKey);
    if (wo[physCamel] !== undefined && wo[physCamel] !== null) return wo[physCamel];
  }

  // 3. Fall back to customFields JSONB — dynamic physical columns not tracked by Drizzle schema
  const cf = wo.customFields ?? wo.custom_fields;
  if (cf) {
    const parsed = typeof cf === 'string' ? JSON.parse(cf) : cf;
    if (parsed) {
      if (parsed[columnKey] !== undefined && parsed[columnKey] !== null) return parsed[columnKey];
      if (parsed[camel]    !== undefined && parsed[camel]    !== null) return parsed[camel];
      if (physKey && physKey !== columnKey) {
        if (parsed[physKey]           !== undefined && parsed[physKey]           !== null) return parsed[physKey];
        const physCamel = toCamel(physKey);
        if (parsed[physCamel]         !== undefined && parsed[physCamel]         !== null) return parsed[physCamel];
      }
    }
  }
  return undefined;
}

interface KpiPrefetch {
  wo?: any;
  physicalKeyMap?: Map<string, string>;
  stageMap?: Map<string, any>;
  orderRules?: Array<{ rule: any; template: any }>;
  readableColumns?: Set<string>;
}

export async function computeWorkOrderKpis(
  workOrderId: string,
  userRole: string,
  prefetched?: KpiPrefetch,
): Promise<KpiResult[]> {
  let wo: any;
  if (prefetched?.wo) {
    wo = prefetched.wo;
  } else {
    const [fetched] = await db.select().from(workOrders).where(eq(workOrders.id, workOrderId));
    if (!fetched) return [];
    wo = fetched;
  }

  let physicalKeyMap: Map<string, string>;
  if (prefetched?.physicalKeyMap) {
    physicalKeyMap = prefetched.physicalKeyMap;
  } else {
    const colCatalog = await db.select({ columnKey: columnCatalog.columnKey, physicalKey: (columnCatalog as any).physicalKey }).from(columnCatalog);
    physicalKeyMap = new Map(colCatalog.filter(c => c.physicalKey).map(c => [c.columnKey, c.physicalKey as string]));
  }

  let stageMap: Map<string, any>;
  if (prefetched?.stageMap) {
    stageMap = prefetched.stageMap;
  } else {
    const allStages = await db.select().from(stages);
    stageMap = new Map(allStages.map(s => [s.id, s]));
  }
  const currentStage: any = wo.stageId ? stageMap.get(wo.stageId) : null;

  let rules: Array<{ rule: any; template: any }>;
  if (prefetched?.orderRules) {
    rules = prefetched.orderRules;
  } else {
    rules = await db.select({ rule: kpiRules, template: kpiTemplates })
      .from(kpiRules)
      .innerJoin(kpiTemplates, eq(kpiRules.templateId, kpiTemplates.id))
      .where(and(eq(kpiRules.active, true), eq(kpiTemplates.displayScope, 'ORDER')));
  }

  const woProjectType = getWoField(wo, 'project_type') ?? getWoField(wo, 'projectType');
  const applicableRules = rules.filter(({ rule }) => {
    if (!rule.workTypeFilter) return true;
    return rule.workTypeFilter === woProjectType;
  });

  let readableColumns: Set<string>;
  if (prefetched?.readableColumns) {
    readableColumns = prefetched.readableColumns;
  } else if (userRole === 'ADMIN') {
    readableColumns = new Set(['*']);
  } else {
    const permissions = await db.select()
      .from(roleColumnPermissions)
      .where(and(
        eq(roleColumnPermissions.role, userRole),
        eq(roleColumnPermissions.canRead, true)
      ));
    readableColumns = new Set(permissions.map(p => p.columnKey));
  }

  const canRead = (col: string | null | undefined) => !col || readableColumns.has('*') || readableColumns.has(col);

  // Resolve start date: column date OR stage-based (use wo.createdAt when WO has reached the stage)
  const resolveStartVal = (rule: any): string | null => {
    const startMode: string = (rule as any).startMode ?? 'COLUMN_DATE';
    if (startMode === 'STAGE' && (rule as any).startStageId) {
      const startStage = stageMap.get((rule as any).startStageId);
      if (!startStage || !currentStage) return null;
      const sameCategory = startStage.category === currentStage.category;
      const reachedStart = sameCategory
        ? currentStage.seq >= startStage.seq
        : (startStage.category === 'EXEC' && currentStage.category === 'FIN');
      if (!reachedStart) return null;
      return wo.createdAt ? new Date(wo.createdAt).toISOString().slice(0, 10) : null;
    }
    return rule.startColumnKey ? getWoField(wo, rule.startColumnKey, physicalKeyMap) : null;
  };

  const results: KpiResult[] = [];

  for (const { rule, template } of applicableRules) {
    if (!canRead(rule.startColumnKey)) continue;
    if (rule.endColumnKey && !canRead(rule.endColumnKey)) continue;

    const slaDays = rule.slaDaysOverride ?? template.defaultSlaDays;
    let elapsedDays: number | null = null;
    let remainingDays: number | null = null;
    let percentValue: number | null = null;
    let status: KpiResult['status'] = 'INCOMPLETE';
    let isCompleted = false;
    let details: any = {};

    const calcMode = rule.calcMode;

    if (calcMode === 'RATIO') {
      const numerator   = parseFloat(getWoField(wo, rule.startColumnKey, physicalKeyMap) ?? '0');
      const denominator = parseFloat(getWoField(wo, rule.endColumnKey ?? '', physicalKeyMap) ?? '0');
      if (denominator > 0) {
        percentValue = Math.round((numerator / denominator) * 100);
        isCompleted = percentValue >= 100;
        status = percentValue >= 100 ? 'COMPLETED' : percentValue >= 80 ? 'WARN' : 'OVERDUE';
        details = { numerator, denominator, ratio: percentValue };
      } else {
        status = 'INCOMPLETE';
      }
    } else if (calcMode === 'DIFF') {
      const total     = parseFloat(getWoField(wo, rule.startColumnKey, physicalKeyMap) ?? '0');
      const collected = parseFloat(getWoField(wo, rule.endColumnKey ?? '', physicalKeyMap) ?? '0');
      if (total > 0) {
        const remaining = total - collected;
        elapsedDays = Math.round(remaining);
        isCompleted = remaining <= 0;
        status = remaining <= 0 ? 'COMPLETED' : remaining < total * 0.2 ? 'WARN' : 'OVERDUE';
        details = { total, collected, remaining };
      } else {
        status = 'INCOMPLETE';
      }
    } else {
      const startVal = resolveStartVal(rule);
      const endVal   = rule.endColumnKey ? getWoField(wo, rule.endColumnKey, physicalKeyMap) : null;
      // isCompleted = the end column is filled (task was finished, regardless of timing)
      isCompleted = !!endVal;

      if (!startVal) {
        status = 'INCOMPLETE';
      } else {
        const start  = new Date(startVal);
        // If endVal exists → measure elapsed from start→end; else measure start→today (still running)
        const end    = endVal ? new Date(endVal) : new Date();
        // Normalize to UTC midnight to avoid timezone-offset skew on date-only values
        const utcMid = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
        const diffMs = utcMid(end) - utcMid(start);
        elapsedDays  = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
        remainingDays = slaDays > 0 ? slaDays - elapsedDays : null;

        if (isCompleted) {
          // Task is DONE — show COMPLETED or COMPLETED_LATE
          if (slaDays === 0 || elapsedDays <= slaDays) {
            status = 'COMPLETED';
          } else {
            status = 'COMPLETED_LATE';
          }
        } else {
          // Task still in progress — measure against today
          if (slaDays === 0) {
            status = 'OK';
          } else if (elapsedDays > slaDays) {
            status = 'OVERDUE';
          } else {
            const warnDays = (rule as any).warnThresholdDays;
            const warnAt = warnDays != null
              ? slaDays - warnDays
              : slaDays * ((rule.warnThresholdPercent ?? 80) / 100);
            status = elapsedDays >= warnAt ? 'WARN' : 'OK';
          }
        }
        details = {
          startDate: start.toISOString().slice(0, 10),
          endDate: endVal ? end.toISOString().slice(0, 10) : null,
          slaDays,
        };
      }
    }

    results.push({
      ruleId: rule.id,
      templateId: template.id,
      nameAr: rule.nameOverrideAr || template.nameAr,
      category: rule.category,
      slaDays,
      elapsedDays,
      remainingDays,
      percentValue,
      status,
      isCompleted,
      details,
    });
  }

  return results;
}

// ────────────────────────────────────────────────────────────────────────────
// Dashboard KPI — 5-state computation for the summary cards
// Priority: CANCELLED > COMPLETED > OVERDUE > WARN > OK
// ────────────────────────────────────────────────────────────────────────────

function priorityOf(s: DashboardStatus): number {
  const P: Record<DashboardStatus, number> = {
    CANCELLED: 6, COMPLETED: 5, COMPLETED_LATE: 4, OVERDUE: 3, WARN: 2, OK: 1, NONE: 0,
  };
  return P[s] ?? 0;
}

/** Compute DASHBOARD KPI status for a single work order */
export async function computeDashboardKpiForOrder(
  wo: any,
  dashboardRules: Array<{ rule: any; template: any }>,
  stageMap: Map<string, any>,
  physicalKeyMap?: Map<string, string>,
): Promise<DashboardKpiResult> {
  const woProjectType = wo.projectType ?? wo.project_type;
  const currentStage  = wo.stageId ? stageMap.get(wo.stageId) : null;

  const computeCategory = (category: 'EXEC' | 'FIN'): DashboardStatus => {
    // Pick the most specific rule: workTypeFilter match > global (null filter)
    const catRules = dashboardRules.filter(
      ({ rule, template }) => template.category === category && rule.active !== false,
    );

    let specificRule = catRules.find(({ rule }) => rule.workTypeFilter === woProjectType);
    let globalRule   = catRules.find(({ rule }) => !rule.workTypeFilter);
    const chosen     = specificRule ?? globalRule;

    if (!chosen) return 'NONE';

    const { rule, template } = chosen;
    const slaDays = rule.slaDaysOverride ?? template.defaultSlaDays ?? 0;

    // ── 1. CANCELLED — current stage is a cancelled stage ────────────────────
    if (currentStage?.isCancelled) return 'CANCELLED';

    // ── 2. COMPLETED / COMPLETED_LATE — end condition met ────────────────────
    let isCompleted = false;
    let completionDate: Date | null = null;

    if (rule.endMode === 'STAGE' && rule.endStageId) {
      const endStage = stageMap.get(rule.endStageId);
      if (endStage && currentStage) {
        if (currentStage.category === endStage.category) {
          // Same category: compare seq within the category
          isCompleted = currentStage.seq >= endStage.seq;
        } else if (endStage.category === 'EXEC' && currentStage.category === 'FIN') {
          // Work order reached FIN stages → EXEC is definitively done
          isCompleted = true;
        }
        // If checking FIN completion but current stage is EXEC → not yet in FIN = not completed
        if (isCompleted && wo.updatedAt) completionDate = new Date(wo.updatedAt);
      }
    } else if (rule.endColumnKey) {
      const endVal = getWoField(wo, rule.endColumnKey, physicalKeyMap);
      isCompleted = !!endVal;
      if (isCompleted && endVal) completionDate = new Date(endVal);
    }

    if (isCompleted) {
      // Guard: if a startColumnKey is defined, the start condition must also be met.
      // Without a start date, the KPI hasn't begun — do not mark as completed.
      const startVal2 = getWoField(wo, rule.startColumnKey, physicalKeyMap);
      if (rule.startColumnKey && !startVal2) return 'NONE';

      // Detect if completion was late: compare (completionDate - startDate) vs slaDays
      if (completionDate && slaDays > 0 && startVal2) {
        const startDate = new Date(startVal2);
        const daysToComplete = Math.floor(
          (completionDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
        );
        if (daysToComplete > slaDays) return 'COMPLETED_LATE';
      }
      return 'COMPLETED';
    }

    // ── 3-5. Compute elapsed vs SLA ──────────────────────────────────────────
    const startVal = getWoField(wo, rule.startColumnKey, physicalKeyMap);
    if (!startVal) return 'NONE';

    const start = new Date(startVal);
    const now   = new Date();
    const elapsed = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

    if (slaDays <= 0) return 'OK';
    if (elapsed > slaDays) return 'OVERDUE';

    // Warning threshold: use warn_threshold_days if set, else use percent
    const warnDays = rule.warnThresholdDays;
    const warnAt   = warnDays != null
      ? slaDays - warnDays
      : slaDays * ((rule.warnThresholdPercent ?? 80) / 100);

    return elapsed >= warnAt ? 'WARN' : 'OK';
  };

  return {
    exec: computeCategory('EXEC'),
    fin:  computeCategory('FIN'),
  };
}

/** Aggregate dashboard KPI summary across all work orders */
export async function computeDashboardSummary(opts?: {
  sectorIds?: string[] | null;
  regionId?: string | null;
  projectType?: string | null;
  dateTo?: Date | null;
}): Promise<{
  exec: Record<DashboardStatus, number>;
  fin:  Record<DashboardStatus, number>;
  execCompletedButFinDelayed: number;
  execDelayedJustified:   number;
  execDelayedUnjustified: number;
  finDelayedJustified:    number;
  finDelayedUnjustified:  number;
}> {
  const emptyBucket = (): Record<DashboardStatus, number> => ({
    OK: 0, WARN: 0, OVERDUE: 0, COMPLETED: 0, COMPLETED_LATE: 0, CANCELLED: 0, NONE: 0,
  });

  const exec = emptyBucket();
  const fin  = emptyBucket();
  let execCompletedButFinDelayed = 0;
  let execDelayedJustified   = 0;
  let execDelayedUnjustified = 0;
  let finDelayedJustified    = 0;
  let finDelayedUnjustified  = 0;

  // Fetch DASHBOARD-scoped rules
  const dashboardRules = await db.select({
    rule:     kpiRules,
    template: kpiTemplates,
  })
  .from(kpiRules)
  .innerJoin(kpiTemplates, eq(kpiRules.templateId, kpiTemplates.id))
  .where(and(eq(kpiRules.active, true), eq(kpiTemplates.displayScope, 'DASHBOARD')));

  if (dashboardRules.length === 0) return { exec, fin, execCompletedButFinDelayed };

  const allStages = await db.select().from(stages);
  const stageMap  = new Map<string, any>(allStages.map(s => [s.id, s]));

  // Build columnKey → physicalKey map so renamed columns still resolve correctly
  const colCatalog = await db.select({ columnKey: columnCatalog.columnKey, physicalKey: (columnCatalog as any).physicalKey }).from(columnCatalog);
  const physicalKeyMap = new Map<string, string>(
    colCatalog.filter(c => c.physicalKey).map(c => [c.columnKey, c.physicalKey as string])
  );

  // Build filter conditions
  const conds: any[] = [];
  if (opts?.sectorIds && opts.sectorIds.length > 0) {
    conds.push(opts.sectorIds.length === 1
      ? eq(workOrders.sectorId, opts.sectorIds[0])
      : inArray(workOrders.sectorId, opts.sectorIds));
  }
  if (opts?.regionId)    conds.push(eq(workOrders.regionId,   opts.regionId));
  if (opts?.projectType) conds.push(eq(workOrders.projectType, opts.projectType));
  if (opts?.dateTo)      conds.push(lte(workOrders.assignmentDate, opts.dateTo));

  const allOrders = conds.length
    ? await db.select().from(workOrders).where(and(...conds))
    : await db.select().from(workOrders);

  const EXEC_DONE = new Set<DashboardStatus>(['COMPLETED', 'COMPLETED_LATE']);

  for (const wo of allOrders) {
    const result = await computeDashboardKpiForOrder(wo, dashboardRules, stageMap, physicalKeyMap);
    exec[result.exec]++;
    fin[result.fin]++;
    // Count orders that are exec-completed but financially overdue
    if (EXEC_DONE.has(result.exec) && result.fin === 'OVERDUE') {
      execCompletedButFinDelayed++;
    }
    // Count exec-overdue by justification
    if (result.exec === 'OVERDUE') {
      const woAny = wo as any;
      if (woAny.execDelayJustified === true || woAny.exec_delay_justified === true) execDelayedJustified++;
      else execDelayedUnjustified++;
    }
    // Count fin-overdue by justification (all fin OVERDUE, not only exec-completed)
    if (result.fin === 'OVERDUE') {
      const woAny = wo as any;
      if (woAny.finDelayJustified === true || woAny.fin_delay_justified === true) finDelayedJustified++;
      else finDelayedUnjustified++;
    }
  }

  return { exec, fin, execCompletedButFinDelayed, execDelayedJustified, execDelayedUnjustified, finDelayedJustified, finDelayedUnjustified };
}

/** Per-sector KPI summary — returns exec/fin status buckets per sectorId */
export async function computeDashboardSummaryPerSector(opts?: {
  sectorIds?: string[] | null;
  regionId?: string | null;
  projectType?: string | null;
  dateFrom?: Date | null;
  dateTo?: Date | null;
}): Promise<Record<string, {
  exec: Record<DashboardStatus, number>;
  fin:  Record<DashboardStatus, number>;
}>> {
  const emptyBucket = (): Record<DashboardStatus, number> => ({
    OK: 0, WARN: 0, OVERDUE: 0, COMPLETED: 0, COMPLETED_LATE: 0, CANCELLED: 0, NONE: 0,
  });

  const dashboardRules = await db.select({ rule: kpiRules, template: kpiTemplates })
    .from(kpiRules)
    .innerJoin(kpiTemplates, eq(kpiRules.templateId, kpiTemplates.id))
    .where(and(eq(kpiRules.active, true), eq(kpiTemplates.displayScope, 'DASHBOARD')));

  const result: Record<string, { exec: Record<DashboardStatus, number>; fin: Record<DashboardStatus, number> }> = {};

  if (dashboardRules.length === 0) return result;

  const allStages = await db.select().from(stages);
  const stageMap  = new Map<string, any>(allStages.map(s => [s.id, s]));

  const colCatalog = await db.select({ columnKey: columnCatalog.columnKey, physicalKey: (columnCatalog as any).physicalKey }).from(columnCatalog);
  const physicalKeyMap = new Map<string, string>(
    colCatalog.filter(c => c.physicalKey).map(c => [c.columnKey, c.physicalKey as string])
  );

  const conds: any[] = [];
  if (opts?.sectorIds && opts.sectorIds.length > 0) {
    conds.push(opts.sectorIds.length === 1
      ? eq(workOrders.sectorId, opts.sectorIds[0])
      : inArray(workOrders.sectorId, opts.sectorIds));
  }
  if (opts?.regionId)    conds.push(eq(workOrders.regionId,    opts.regionId));
  if (opts?.projectType) conds.push(eq(workOrders.projectType,  opts.projectType));
  if (opts?.dateFrom)    conds.push(gte(workOrders.assignmentDate, opts.dateFrom));
  if (opts?.dateTo)      conds.push(lte(workOrders.assignmentDate, opts.dateTo));

  const allOrders = conds.length
    ? await db.select().from(workOrders).where(and(...conds))
    : await db.select().from(workOrders);

  for (const wo of allOrders) {
    const woAny = wo as any;
    const sid: string = woAny.sectorId || woAny.sector_id || '__none__';
    if (!result[sid]) result[sid] = { exec: emptyBucket(), fin: emptyBucket() };

    const kpiResult = await computeDashboardKpiForOrder(wo, dashboardRules, stageMap, physicalKeyMap);
    result[sid].exec[kpiResult.exec]++;
    result[sid].fin[kpiResult.fin]++;
  }

  return result;
}
