import express from 'express';
import { db } from '../db';
import { workOrders, regions, sectors, stages, roleDefinitions, users, executiveTargets, executiveSectorTargets, annualTargetItems, sectorAnnualTargets } from '../db/schema';
import { authenticate, AuthRequest } from '../middleware/auth';
import { eq, and, inArray, gte, lte, sql, desc, or } from 'drizzle-orm';
import { computeDashboardSummary, computeDashboardSummaryPerSector } from '../services/kpiService';

const router = express.Router();

async function getUserScope(userId: string, roleKey: string) {
  const [user, roleDef] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, userId) }),
    db.query.roleDefinitions.findFirst({ where: eq(roleDefinitions.roleKey, roleKey) }),
  ]);
  const isAdmin = roleKey === 'ADMIN';
  return {
    sectorId: (user as any)?.sectorId ?? (user as any)?.sector_id ?? null,
    regionId: (user as any)?.regionId ?? (user as any)?.region_id ?? null,
    scopeType: roleDef?.scopeType ?? 'ALL',
    canViewExecutiveDashboard: isAdmin ? true : (roleDef?.canViewExecutiveDashboard ?? false),
  };
}

router.get('/', authenticate, async (req: AuthRequest, res) => {
  try {
    const scope = await getUserScope(req.user!.id, req.user!.role);
    if (!scope.canViewExecutiveDashboard) {
      return res.status(403).json({ error: 'Access denied: Executive Dashboard permission required' });
    }

    const { sectors: sectorIdsQuery, regionIds: regionIdsQuery, regionId, projectType, period = 'MONTH', dateFrom, dateTo, granularity = 'MONTH' } = req.query;
    // دعم regionIds (متعدد) أو regionId (قديم)
    const rawRegionIds = (regionIdsQuery as string) || (regionId as string) || '';

    // Default dates: last 3 months
    const now = new Date();
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(now.getMonth() - 3);

    const start = dateFrom ? new Date(dateFrom as string) : threeMonthsAgo;
    const end = dateTo ? new Date(dateTo as string) : now;

    // Scope filters (no date range) — used for KPI cards, financial totals, sector breakdowns
    let scopeFilters: any[] = [];

    // Period filters (with date range) — used for trend charts only
    let periodFilters: any[] = [
      gte(workOrders.assignmentDate, start),
      lte(workOrders.assignmentDate, end),
    ];

    if (scope.scopeType === 'OWN_REGION' && scope.regionId) {
      scopeFilters.push(eq(workOrders.regionId, scope.regionId));
    } else if (scope.scopeType === 'OWN_SECTOR' && scope.sectorId) {
      scopeFilters.push(eq(workOrders.sectorId, scope.sectorId));
    } else {
      // ALL scope — apply optional user-selected filters
      if (sectorIdsQuery) {
        const sIds = (sectorIdsQuery as string).split(',').filter(Boolean).slice(0, 2);
        if (sIds.length > 0) scopeFilters.push(inArray(workOrders.sectorId, sIds));
      }
      if (rawRegionIds) {
        const rIds = rawRegionIds.split(',').filter(Boolean);
        if (rIds.length === 1) scopeFilters.push(eq(workOrders.regionId, rIds[0]));
        else if (rIds.length > 1) scopeFilters.push(inArray(workOrders.regionId, rIds));
      }
    }

    if (projectType) {
      scopeFilters.push(eq(workOrders.projectType, projectType as string));
    }

    periodFilters = [...scopeFilters, ...periodFilters];

    // Fetch all scope orders (no date limit) for KPI cards and financial totals
    const allWorkOrders = await db.select().from(workOrders)
      .where(scopeFilters.length > 0 ? and(...scopeFilters) : undefined);
    // Fetch period-limited orders for trend charts
    const periodWorkOrders = await db.select({ id: workOrders.id, assignmentDate: workOrders.assignmentDate, projectType: workOrders.projectType })
      .from(workOrders).where(and(...periodFilters));
    const allRegions = await db.select().from(regions);
    const allSectors = await db.select().from(sectors);
    const allStages = await db.select().from(stages);

    const regionMap = Object.fromEntries(allRegions.map(r => [r.id, r]));
    const sectorMap = Object.fromEntries(allSectors.map(s => [s.id, s]));
    const stageMap = Object.fromEntries(allStages.map(s => [s.id, s]));

    // Exclude both terminal (completed) stages AND cancelled stages from delay tracking
    const terminalStageIds = new Set(
      allStages.filter(s => s.isTerminal || (s as any).isCancelled).map(s => s.id)
    );
    // Cancelled-only set — used to exclude cancelled orders from financial aggregations
    const cancelledStageIds = new Set(
      allStages.filter((s: any) => s.isCancelled).map((s: any) => s.id)
    );

    // Compute KPI status counts using KPI service (exec vs fin, separated)
    // Resolve which sector IDs and region ID to filter on — mirror exactly what scopeFilters does
    let kpiSectorIds: string[] | null = null;
    let kpiRegionId:  string  | null  = null;

    if (scope.scopeType === 'OWN_SECTOR' && scope.sectorId) {
      kpiSectorIds = [scope.sectorId];
    } else if (scope.scopeType === 'OWN_REGION' && scope.regionId) {
      kpiRegionId = scope.regionId;
    } else {
      // ALL scope — use whatever the admin selected in the UI
      if (sectorIdsQuery) {
        kpiSectorIds = (sectorIdsQuery as string).split(',').filter(Boolean).slice(0, 2);
      }
      if (regionId) {
        kpiRegionId = regionId as string;
      }
    }

    const kpiSummary = await computeDashboardSummary({
      sectorIds:   kpiSectorIds,
      regionId:    kpiRegionId,
      projectType: projectType ? String(projectType) : null,
    });

    const rawExecCompleted = kpiSummary.exec.COMPLETED + kpiSummary.exec.COMPLETED_LATE;
    const execCompletedButFinDelayed = kpiSummary.execCompletedButFinDelayed;

    const kpis = {
      total:            allWorkOrders.length,
      // EXEC
      execCompleted:    rawExecCompleted - execCompletedButFinDelayed, // truly done (exec + fin both OK)
      execDelayed:      kpiSummary.exec.OVERDUE,
      execCancelledCount: kpiSummary.exec.CANCELLED,
      execPending:      kpiSummary.exec.OK + kpiSummary.exec.WARN + kpiSummary.exec.NONE,
      // FIN — only exec-completed orders with financial delay (waiting for collection)
      finCompleted:     kpiSummary.fin.COMPLETED + kpiSummary.fin.COMPLETED_LATE,
      finDelayed:       execCompletedButFinDelayed,
      // Delay breakdown by justification
      execDelayedJustified:   kpiSummary.execDelayedJustified,
      execDelayedUnjustified: kpiSummary.execDelayedUnjustified,
      finDelayedJustified:    kpiSummary.finDelayedJustified,
      finDelayedUnjustified:  kpiSummary.finDelayedUnjustified,
      // Legacy (keep for backward compat with other components)
      completed:        rawExecCompleted - execCompletedButFinDelayed,
      delayed:          kpiSummary.exec.OVERDUE,
      completionRate:   0,
      cancelled:        kpiSummary.exec.CANCELLED,
    };
    kpis.completionRate = kpis.total > 0 ? (kpis.execCompleted / kpis.total) * 100 : 0;

    const financial = {
      estimated: 0,
      invoiced: 0,
      collected: 0,
      remaining: 0,
      expectedRemaining: 0,
      completedEstimated: 0,
      completedInvoiced: 0,
    };

    const assignmentTrendMap: Record<string, { name: string; value: number }> = {};
    const assignmentStackedMap: Record<string, { name: string; [key: string]: any }> = {};
    const execClosureTrendMap: Record<string, { name: string; value: number }> = {};
    const finClosureTrendMap: Record<string, { name: string; value: number }> = {};
    const typeDistributionMap: Record<string, number> = {};
    const sectorComparisonMap: Record<string, { nameAr: string; nameEn: string; count: number }> = {};
    const regionComparisonMap: Record<string, { nameAr: string; nameEn: string; count: number }> = {};
    const stageBottlenecksMap: Record<string, { nameAr: string; nameEn: string; count: number }> = {};
    const financialBySectorMap: Record<string, { sectorId: string; nameAr: string; nameEn: string; estimated: number; invoiced: number; collected: number; completed: number }> = {};
    const financialByRegionMap: Record<string, { nameAr: string; nameEn: string; estimated: number; invoiced: number; collected: number }> = {};

    // helper: bucket a date by granularity
    const makeBucket = (d: Date): string => {
      if (granularity === 'WEEK') {
        const dt = new Date(d); dt.setHours(0, 0, 0, 0);
        dt.setDate(dt.getDate() + 3 - (dt.getDay() + 6) % 7);
        const w1 = new Date(dt.getFullYear(), 0, 4);
        const wn = 1 + Math.round(((dt.getTime() - w1.getTime()) / 86400000 - 3 + (w1.getDay() + 6) % 7) / 7);
        return `${dt.getFullYear()}-W${String(wn).padStart(2, '0')}`;
      }
      if (granularity === 'QUARTER') return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };

    const today = new Date();
    const topDelaysList: any[] = [];

    allWorkOrders.forEach(order => {
      const orderAny = order as any;

      // Skip cancelled orders from all financial aggregations and counts
      if (cancelledStageIds.has(orderAny.stageId)) return;

      const assignmentDate = orderAny.assignmentDate ? new Date(orderAny.assignmentDate) : null;

      // Financial
      const est  = Number(orderAny.estimatedValue || 0);
      const inv1 = Number(orderAny.invoice1 ?? orderAny.invoice_1 ?? 0) || 0;
      const inv2 = Number(orderAny.invoice2 ?? orderAny.invoice_2 ?? 0) || 0;
      const col  = Number(orderAny.collectedAmount || 0);
      const invType = orderAny.invoiceType ?? orderAny.invoice_type ?? null;

      financial.estimated += est;
      financial.invoiced  += col;
      financial.collected += col;
      financial.remaining += Math.max(0, est - col);

      // المتبقي المتوقع
      if (invType === 'نهائي') {
        financial.expectedRemaining += inv1 > 0 ? 0 : est;
      } else if (invType === 'جزئي') {
        if (inv1 === 0) {
          financial.expectedRemaining += est;
        } else if (inv2 === 0) {
          financial.expectedRemaining += inv1; // proxy: assume inv2 ≈ inv1
        }
        // both invoices exist → +0 (fully invoiced)
      }

      // الفرق للمفوتر المكتمل (only fully-invoiced orders)
      const isFullyInvoiced =
        (invType === 'نهائي' && inv1 > 0) ||
        (invType === 'جزئي' && inv1 > 0 && inv2 > 0);
      if (isFullyInvoiced) {
        financial.completedEstimated += est;
        financial.completedInvoiced  += invType === 'نهائي' ? inv1 : (inv1 + inv2);
      }

      // TopDelays list (use assignment-date SLA for ranking only, not for counting)
      if (assignmentDate && !terminalStageIds.has(orderAny.stageId)) {
        const diffDays = Math.floor((today.getTime() - assignmentDate.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays > 30) {
          topDelaysList.push({
            ...orderAny,
            delayedDays: diffDays,
            sectorNameAr: sectorMap[orderAny.sectorId]?.nameAr || '',
            sectorNameEn: sectorMap[orderAny.sectorId]?.nameEn || sectorMap[orderAny.sectorId]?.nameAr || '',
            regionNameAr: regionMap[orderAny.regionId]?.nameAr || '',
            regionNameEn: regionMap[orderAny.regionId]?.nameEn || regionMap[orderAny.regionId]?.nameAr || '',
            stageNameAr:  stageMap[orderAny.stageId]?.nameAr || '',
            stageNameEn:  stageMap[orderAny.stageId]?.nameEn || stageMap[orderAny.stageId]?.nameAr || '',
            // Delay justification fields
            execDelayJustified: orderAny.execDelayJustified ?? orderAny.exec_delay_justified ?? null,
            execDelayReason:    orderAny.execDelayReason    ?? orderAny.exec_delay_reason    ?? null,
            finDelayJustified:  orderAny.finDelayJustified  ?? orderAny.fin_delay_justified  ?? null,
            finDelayReason:     orderAny.finDelayReason     ?? orderAny.fin_delay_reason     ?? null,
          });
        }
      }

      if (orderAny.sectorId) {
        const sid = orderAny.sectorId;
        if (!sectorComparisonMap[sid]) {
          sectorComparisonMap[sid] = {
            nameAr: sectorMap[sid]?.nameAr || sid,
            nameEn: sectorMap[sid]?.nameEn || sectorMap[sid]?.nameAr || sid,
            count: 0,
          };
        }
        sectorComparisonMap[sid].count++;
      }

      if (orderAny.regionId) {
        const rid = orderAny.regionId;
        if (!regionComparisonMap[rid]) {
          regionComparisonMap[rid] = {
            nameAr: regionMap[rid]?.nameAr || rid,
            nameEn: regionMap[rid]?.nameEn || regionMap[rid]?.nameAr || rid,
            count: 0,
          };
        }
        regionComparisonMap[rid].count++;
      }

      // Financial by Sector (including per-sector completed orders count)
      if (orderAny.sectorId) {
        const sid = orderAny.sectorId;
        if (!financialBySectorMap[sid]) {
          financialBySectorMap[sid] = {
            sectorId: sid,
            nameAr: sectorMap[sid]?.nameAr || sid,
            nameEn: sectorMap[sid]?.nameEn || sectorMap[sid]?.nameAr || sid,
            estimated: 0, invoiced: 0, collected: 0, completed: 0,
          };
        }
        financialBySectorMap[sid].estimated += Number(orderAny.estimatedValue || 0);
        financialBySectorMap[sid].invoiced  += Number(orderAny.collectedAmount || 0);
        financialBySectorMap[sid].collected += Number(orderAny.collectedAmount || 0);
        if (terminalStageIds.has(orderAny.stageId)) {
          financialBySectorMap[sid].completed++;
        }
      }

      // Financial by Region
      if (orderAny.regionId) {
        const rid = orderAny.regionId;
        if (!financialByRegionMap[rid]) {
          financialByRegionMap[rid] = {
            nameAr: regionMap[rid]?.nameAr || rid,
            nameEn: regionMap[rid]?.nameEn || regionMap[rid]?.nameAr || rid,
            estimated: 0, invoiced: 0, collected: 0,
          };
        }
        financialByRegionMap[rid].estimated += Number(orderAny.estimatedValue || 0);
        financialByRegionMap[rid].invoiced  += Number(orderAny.collectedAmount || 0);
        financialByRegionMap[rid].collected += Number(orderAny.collectedAmount || 0);
      }

      if (orderAny.stageId) {
        const stid = orderAny.stageId;
        if (!stageBottlenecksMap[stid]) {
          stageBottlenecksMap[stid] = {
            nameAr: stageMap[stid]?.nameAr || 'غير محدد',
            nameEn: stageMap[stid]?.nameEn || stageMap[stid]?.nameAr || 'Unknown',
            count: 0,
          };
        }
        stageBottlenecksMap[stid].count++;
      }

      // اتجاه الإغلاق التنفيذي — proc_155_close_date ضمن الفترة
      const proc155Date = orderAny.proc155CloseDate ? new Date(orderAny.proc155CloseDate) : null;
      if (proc155Date && proc155Date >= start && proc155Date <= end) {
        const b = makeBucket(proc155Date);
        if (!execClosureTrendMap[b]) execClosureTrendMap[b] = { name: b, value: 0 };
        execClosureTrendMap[b].value++;
      }

      // اتجاه الإغلاق المالي — financial_close_date ضمن الفترة
      const finCloseDate = orderAny.financialCloseDate ? new Date(orderAny.financialCloseDate) : null;
      if (finCloseDate && finCloseDate >= start && finCloseDate <= end) {
        const b = makeBucket(finCloseDate);
        if (!finClosureTrendMap[b]) finClosureTrendMap[b] = { name: b, value: 0 };
        finClosureTrendMap[b].value++;
      }
    });

    // Build trend/distribution charts from period-filtered orders only
    periodWorkOrders.forEach(order => {
      const orderAny = order as any;
      const assignmentDate = orderAny.assignmentDate ? new Date(orderAny.assignmentDate) : null;
      if (assignmentDate) {
        const bucket = makeBucket(assignmentDate);
        if (!assignmentTrendMap[bucket]) assignmentTrendMap[bucket] = { name: bucket, value: 0 };
        assignmentTrendMap[bucket].value++;
        if (!assignmentStackedMap[bucket]) assignmentStackedMap[bucket] = { name: bucket };
        const pType = orderAny.projectType || 'Other';
        assignmentStackedMap[bucket][pType] = (assignmentStackedMap[bucket][pType] || 0) + 1;
      }
      const pType = orderAny.projectType || 'Other';
      typeDistributionMap[pType] = (typeDistributionMap[pType] || 0) + 1;
    });

    const assignmentTrend = Object.values(assignmentTrendMap).sort((a, b) => a.name.localeCompare(b.name));
    const assignmentStacked = Object.values(assignmentStackedMap).sort((a, b) => a.name.localeCompare(b.name));
    const typeDistribution = Object.entries(typeDistributionMap).map(([name, value]) => ({ name, value }));
    const sectorComparison = Object.values(sectorComparisonMap)
      .map(s => ({ nameAr: s.nameAr, nameEn: s.nameEn, value: s.count }));
    const regionComparison = Object.values(regionComparisonMap)
      .map(r => ({ nameAr: r.nameAr, nameEn: r.nameEn, value: r.count }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 12);
    const stageBottlenecks = Object.values(stageBottlenecksMap)
      .map(s => ({ nameAr: s.nameAr, nameEn: s.nameEn, value: s.count }));

    // Derive الفرق للمفوتر المكتمل
    (financial as any).completedDiffValue = financial.completedInvoiced - financial.completedEstimated;
    (financial as any).completedDiffPct   = financial.completedEstimated > 0
      ? ((financial.completedInvoiced - financial.completedEstimated) / financial.completedEstimated) * 100
      : 0;

    const financialFunnel = [
      { name: 'Estimated', value: financial.estimated },
      { name: 'Invoiced', value: financial.invoiced },
      { name: 'Collected', value: financial.collected },
    ];

    const topDelays = topDelaysList
      .sort((a, b) => b.delayedDays - a.delayedDays)
      .slice(0, 10);

    const financialBySector = Object.values(financialBySectorMap)
      .sort((a, b) => b.estimated - a.estimated);
    const financialByRegion = Object.values(financialByRegionMap)
      .sort((a, b) => b.estimated - a.estimated)
      .slice(0, 10);

    // Per-sector KPI compliance (exec/fin status buckets per sector)
    const perSectorKpi = await computeDashboardSummaryPerSector({
      sectorIds: kpiSectorIds,
      regionId:  kpiRegionId,
    });

    // Per-sector annual targets (percentage-based)
    const currentYear = new Date().getFullYear();
    const sectorTargetRows = await db.select().from(sectorAnnualTargets)
      .where(eq(sectorAnnualTargets.year, currentYear));
    const sectorTargetsMap: Record<string, any> = Object.fromEntries(
      sectorTargetRows.map(r => [(r as any).sectorId, r])
    );

    // حساب نسبة الفترة المختارة من السنة الكاملة لتناسب المستهدف السنوي
    const daysDiff = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
    const yearFraction = Math.min(daysDiff / 365, 1); // 0 < fraction ≤ 1

    // بيانات مالية مُفلترة بالفترة المختارة (للمقارنة مع المستهدف المتناسب)
    const periodSectorFinMap: Record<string, { estimated: number; invoiced: number; collected: number; completed: number; total: number }> = {};
    allWorkOrders.forEach(order => {
      const o = order as any;
      if (cancelledStageIds.has(o.stageId)) return;
      if (!o.sectorId) return;
      const aDate = o.assignmentDate ? new Date(o.assignmentDate) : null;
      if (!aDate || aDate < start || aDate > end) return; // فلتر التاريخ
      const sid = o.sectorId;
      if (!periodSectorFinMap[sid]) {
        periodSectorFinMap[sid] = { estimated: 0, invoiced: 0, collected: 0, completed: 0, total: 0 };
      }
      const _inv1 = Number(o.invoice1 ?? o.invoice_1 ?? 0) || 0;
      const _inv2 = Number(o.invoice2 ?? o.invoice_2 ?? 0) || 0;
      periodSectorFinMap[sid].estimated += Number(o.estimatedValue || 0);
      periodSectorFinMap[sid].invoiced  += _inv1 + _inv2;
      periodSectorFinMap[sid].collected += Number(o.collectedAmount || 0);
      periodSectorFinMap[sid].total++;
      if (terminalStageIds.has(o.stageId)) periodSectorFinMap[sid].completed++;
    });

    // Build unified sector performance array — filtered by user scope
    const COMPLIANT_STATUSES = new Set(['OK', 'WARN', 'COMPLETED', 'COMPLETED_LATE']);

    // Determine which sectors the current user is allowed to see
    const allowedSectorIds: Set<string> | null = (() => {
      if (scope.scopeType === 'OWN_SECTOR' && scope.sectorId) {
        return new Set([scope.sectorId]);
      }
      if (scope.scopeType === 'OWN_REGION' && scope.regionId) {
        // Find the sector that owns this region
        const userRegion = allRegions.find(r => r.id === scope.regionId);
        return userRegion ? new Set([userRegion.sectorId]) : new Set<string>();
      }
      // ALL scope — if admin filtered by specific sectors, respect that
      if (kpiSectorIds && kpiSectorIds.length > 0) return new Set(kpiSectorIds);
      return null; // null = show all sectors
    })();

    const sectorPerformance = allSectors
      .filter(s => s.active && (allowedSectorIds === null || allowedSectorIds.has(s.id)))
      .map(s => {
        const sid = s.id;
        const kpi = perSectorKpi[sid];
        // استخدام البيانات المفلترة بالفترة الزمنية للبيانات المالية وعدد الأوامر
        const fin    = periodSectorFinMap[sid];
        const target = sectorTargetsMap[sid];

        // exec compliance — يُحسب على جميع الأوامر (مؤشر نوعي لا يتأثر بالفترة)
        let execCompliant = 0, execTotal = 0;
        if (kpi) {
          for (const [status, count] of Object.entries(kpi.exec)) {
            if (status === 'CANCELLED') continue;
            execTotal += count as number;
            if (COMPLIANT_STATUSES.has(status)) execCompliant += count as number;
          }
        }
        const execComplianceRate = execTotal > 0 ? (execCompliant / execTotal) * 100 : null;

        // fin compliance — نفس المبدأ
        let finCompliant = 0, finTotal = 0;
        if (kpi) {
          for (const [status, count] of Object.entries(kpi.fin)) {
            if (status === 'CANCELLED') continue;
            finTotal += count as number;
            if (COMPLIANT_STATUSES.has(status)) finCompliant += count as number;
          }
        }
        const finComplianceRate = finTotal > 0 ? (finCompliant / finTotal) * 100 : null;

        // closure وعدد الأوامر — من بيانات الفترة
        const totalOrders     = fin?.total     ?? 0;
        const completedOrders = fin?.completed ?? 0;
        const closureRate = totalOrders > 0 ? (completedOrders / totalOrders) * 100 : null;

        // المبالغ المالية — من بيانات الفترة
        const estimated = fin?.estimated ?? 0;
        const invoiced  = fin?.invoiced  ?? 0;
        const collected = fin?.collected ?? 0;
        const salesRate      = estimated > 0 ? (invoiced   / estimated) * 100 : null;
        const collectionRate = invoiced  > 0 ? (collected / invoiced)  * 100 : null;

        // المستهدفات الخمسة — النسب كما هي، المبلغ مُتناسب مع الفترة
        const execComplianceTarget = target?.execComplianceTarget != null ? Number(target.execComplianceTarget) : null;
        const closureRateTarget    = target?.closureRateTarget    != null ? Number(target.closureRateTarget)    : null;
        const collectionRateTarget = target?.collectionRateTarget != null ? Number(target.collectionRateTarget) : null;
        const finComplianceTarget  = target?.finComplianceTarget  != null ? Number(target.finComplianceTarget)  : null;
        // المستهدف السنوي للمبيعات مُتناسب مع الفترة المختارة (مثال: شهر = 1/12)
        const annualSalesTarget    = target?.salesAmountTarget    != null ? Number(target.salesAmountTarget)    : null;
        const salesAmountTarget    = annualSalesTarget != null ? annualSalesTarget * yearFraction : null;
        // نسبة التقدم في المبيعات = تقديري / مستهدف الفترة × 100
        const salesProgressPct = salesAmountTarget && salesAmountTarget > 0
          ? Math.min((estimated / salesAmountTarget) * 100, 999)
          : null;

        return {
          sectorId:  sid,
          nameAr:    (s as any).nameAr,
          nameEn:    (s as any).nameEn || (s as any).nameAr,
          totalOrders,
          completedOrders,
          // الأرقام الفعلية
          closureRate,
          execComplianceRate,
          finComplianceRate,
          salesRate,
          collectionRate,
          estimated,
          invoiced,
          collected,
          // المستهدفات الخمسة
          execComplianceTarget,
          closureRateTarget,
          salesAmountTarget,       // مستهدف الفترة المتناسب (= سنوي × yearFraction)
          annualSalesTarget,       // المستهدف السنوي الأصلي
          salesProgressPct,
          collectionRateTarget,
          finComplianceTarget,
          periodDays: daysDiff,    // عدد أيام الفترة للعرض
        };
      })
      .filter(s => s.totalOrders > 0 || s.estimated > 0)
      .sort((a, b) => b.totalOrders - a.totalOrders);

    const execClosureTrend = Object.values(execClosureTrendMap).sort((a, b) => a.name.localeCompare(b.name));
    const finClosureTrend  = Object.values(finClosureTrendMap).sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      kpis,
      financial,
      assignmentTrend,
      assignmentStacked,
      execClosureTrend,
      finClosureTrend,
      typeDistribution,
      sectorComparison,
      regionComparison,
      stageBottlenecks,
      financialFunnel,
      financialBySector,
      financialByRegion,
      topDelays,
      sectorPerformance,
    });
  } catch (err) {
    console.error('[EXECUTIVE DASHBOARD ERROR]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/config', authenticate, async (req: AuthRequest, res) => {
  try {
    const scope = await getUserScope(req.user!.id, req.user!.role);
    if (!scope.canViewExecutiveDashboard) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    let sectorsList = await db.select().from(sectors).where(eq(sectors.active, true));
    let regionsList = await db.select().from(regions).where(eq(regions.active, true));

    if (scope.scopeType === 'OWN_REGION' && scope.regionId) {
      regionsList = regionsList.filter(r => r.id === scope.regionId);
      if (scope.sectorId) {
        sectorsList = sectorsList.filter(s => s.id === scope.sectorId);
      }
    } else if (scope.scopeType === 'OWN_SECTOR' && scope.sectorId) {
      sectorsList = sectorsList.filter(s => s.id === scope.sectorId);
      regionsList = regionsList.filter(r => r.sectorId === scope.sectorId);
    }

    res.json({ sectors: sectorsList, regions: regionsList });
  } catch (err) {
    console.error('[DASHBOARD CONFIG ERROR]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Sector Annual Targets (percentage-based — new system) ───────────────────

function canManageCheck(req: AuthRequest, res: any): boolean {
  const u = req.user!;
  const ok = u.role === 'ADMIN' || !!(u as any).canManageTargets;
  if (!ok) { res.status(403).json({ error: 'Permission denied' }); }
  return ok;
}

// GET /sector-targets?year=YYYY — fetch per-sector percentage targets
router.get('/sector-targets', authenticate, async (req: AuthRequest, res) => {
  try {
    const scope = await getUserScope(req.user!.id, req.user!.role);
    if (!scope.canViewExecutiveDashboard) return res.status(403).json({ error: 'Permission denied' });

    const year = parseInt(req.query.year as string) || new Date().getFullYear();

    const [allSectorsList, allRegionsList, targetRows] = await Promise.all([
      db.select().from(sectors).where(eq(sectors.active, true)),
      db.select().from(regions),
      db.select().from(sectorAnnualTargets).where(eq(sectorAnnualTargets.year, year)),
    ]);

    // Filter sectors by user scope
    let visibleSectors = allSectorsList;
    if (scope.scopeType === 'OWN_SECTOR' && scope.sectorId) {
      visibleSectors = allSectorsList.filter(s => s.id === scope.sectorId);
    } else if (scope.scopeType === 'OWN_REGION' && scope.regionId) {
      const userRegion = allRegionsList.find(r => r.id === scope.regionId);
      if (userRegion) visibleSectors = allSectorsList.filter(s => s.id === (userRegion as any).sectorId);
    }

    const targetsBySectorId: Record<string, any> = Object.fromEntries(
      targetRows.map(r => [(r as any).sectorId, r])
    );

    const n = (id: string, field: string) =>
      targetsBySectorId[id]?.[field] != null ? Number(targetsBySectorId[id][field]) : null;

    const result = visibleSectors.map(s => ({
      sectorId:             s.id,
      nameAr:               (s as any).nameAr,
      nameEn:               (s as any).nameEn || (s as any).nameAr,
      // الجانب التنفيذي
      execComplianceTarget: n(s.id, 'execComplianceTarget'),
      closureRateTarget:    n(s.id, 'closureRateTarget'),
      // الجانب المالي
      salesAmountTarget:    n(s.id, 'salesAmountTarget'),
      collectionRateTarget: n(s.id, 'collectionRateTarget'),
      finComplianceTarget:  n(s.id, 'finComplianceTarget'),
    }));

    res.json({ year, sectors: result });
  } catch (err) {
    console.error('[SECTOR-TARGETS GET ERROR]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /sector-targets — upsert per-sector percentage targets
router.put('/sector-targets', authenticate, async (req: AuthRequest, res) => {
  if (!canManageCheck(req, res)) return;
  try {
    const { year, sectors: sectorRows } = req.body;
    if (!year || !Array.isArray(sectorRows)) return res.status(400).json({ error: 'year and sectors[] required' });

    for (const row of sectorRows) {
      const { sectorId, execComplianceTarget, closureRateTarget, salesAmountTarget, collectionRateTarget, finComplianceTarget } = row;
      if (!sectorId) continue;

      const existing = await db.select({ id: sectorAnnualTargets.id })
        .from(sectorAnnualTargets)
        .where(and(eq(sectorAnnualTargets.year, year), eq(sectorAnnualTargets.sectorId, sectorId)));

      const toStr = (v: any) => v != null ? String(v) : null;
      const vals = {
        execComplianceTarget: toStr(execComplianceTarget),
        closureRateTarget:    toStr(closureRateTarget),
        salesAmountTarget:    toStr(salesAmountTarget),
        collectionRateTarget: toStr(collectionRateTarget),
        finComplianceTarget:  toStr(finComplianceTarget),
        updatedAt: new Date(),
        updatedBy: req.user!.username,
      };

      if (existing.length > 0) {
        await db.update(sectorAnnualTargets).set(vals)
          .where(and(eq(sectorAnnualTargets.year, year), eq(sectorAnnualTargets.sectorId, sectorId)));
      } else {
        await db.insert(sectorAnnualTargets).values({ year, sectorId, ...vals });
      }
    }

    res.json({ message: 'Saved' });
  } catch (err) {
    console.error('[SECTOR-TARGETS PUT ERROR]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Financial Detail — row-level breakdown for each financial card ──────────
// GET /financial-detail?card=estimated|invoiced|remaining|gap&page=1&limit=25&...
// Supports same scope filters as the main endpoint (sectors, regionIds, projectType).
// No date filter — mirrors allWorkOrders used in the main endpoint for financial cards.
router.get('/financial-detail', authenticate, async (req: AuthRequest, res) => {
  try {
    const scope = await getUserScope(req.user!.id, req.user!.role);
    if (!scope.canViewExecutiveDashboard) {
      return res.status(403).json({ error: 'Access denied: Executive Dashboard permission required' });
    }

    const {
      card,
      sectors:   sectorIdsQuery,
      regionIds: regionIdsQuery,
      regionId,
      projectType,
      page:  pageQ,
      limit: limitQ,
    } = req.query;

    const VALID_CARDS = ['estimated', 'invoiced', 'remaining', 'gap'] as const;
    type CardType = typeof VALID_CARDS[number];
    if (!card || !VALID_CARDS.includes(card as CardType)) {
      return res.status(400).json({ error: `card must be one of: ${VALID_CARDS.join(', ')}` });
    }
    const cardType = card as CardType;

    const page  = Math.max(1, parseInt(pageQ  as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(limitQ as string) || 25));

    const rawRegionIds = (regionIdsQuery as string) || (regionId as string) || '';

    // Build scopeFilters — identical logic to main endpoint
    const scopeFilters: any[] = [];
    if (scope.scopeType === 'OWN_REGION' && scope.regionId) {
      scopeFilters.push(eq(workOrders.regionId, scope.regionId));
    } else if (scope.scopeType === 'OWN_SECTOR' && scope.sectorId) {
      scopeFilters.push(eq(workOrders.sectorId, scope.sectorId));
    } else {
      if (sectorIdsQuery) {
        const sIds = (sectorIdsQuery as string).split(',').filter(Boolean).slice(0, 2);
        if (sIds.length > 0) scopeFilters.push(inArray(workOrders.sectorId, sIds));
      }
      if (rawRegionIds) {
        const rIds = rawRegionIds.split(',').filter(Boolean);
        if (rIds.length === 1) scopeFilters.push(eq(workOrders.regionId, rIds[0]));
        else if (rIds.length > 1) scopeFilters.push(inArray(workOrders.regionId, rIds));
      }
    }
    if (projectType) {
      scopeFilters.push(eq(workOrders.projectType, projectType as string));
    }

    // Fetch all scope orders — no date filter, same as main endpoint financial cards
    const [allOrders, allRegions, allSectors, allStages] = await Promise.all([
      db.select().from(workOrders)
        .where(scopeFilters.length > 0 ? and(...scopeFilters) : undefined),
      db.select().from(regions),
      db.select().from(sectors),
      db.select().from(stages),
    ]);

    const regionMap = Object.fromEntries(allRegions.map(r => [r.id, r]));
    const sectorMap = Object.fromEntries(allSectors.map(s => [s.id, s]));
    const stageMap  = Object.fromEntries(allStages.map(s  => [s.id, s]));

    // Accumulators for summary — computed across ALL rows before pagination
    const summary = {
      totalEstimated:     0,
      totalInvoiced:      0,
      totalRemaining:     0,
      totalDiffValue:     0,
      totalDiffEstimated: 0,
      totalDiffInvoiced:  0,
    };

    const allRows: any[] = [];

    for (const order of allOrders) {
      const o       = order as any;
      const est     = Number(o.estimatedValue  || 0);
      const inv1    = Number(o.invoice1   ?? o.invoice_1   ?? 0) || 0;
      const inv2    = Number(o.invoice2   ?? o.invoice_2   ?? 0) || 0;
      const col     = Number(o.collectedAmount || 0);
      const invType = o.invoiceType ?? o.invoice_type ?? null;

      const sectorNameAr = (sectorMap[o.sectorId] as any)?.nameAr || '';
      const sectorNameEn = (sectorMap[o.sectorId] as any)?.nameEn || sectorNameAr;
      const regionNameAr = (regionMap[o.regionId] as any)?.nameAr || '';
      const regionNameEn = (regionMap[o.regionId] as any)?.nameEn || regionNameAr;
      const stageNameAr  = (stageMap[o.stageId]   as any)?.nameAr || '';

      // Base fields shared by all cards
      const base = {
        id:              o.id,
        orderNumber:     o.orderNumber     ?? o.order_number     ?? '',
        client:          o.client          ?? null,
        workType:        o.workType        ?? o.work_type        ?? null,
        projectType:     o.projectType     ?? o.project_type     ?? null,
        sectorNameAr,
        sectorNameEn,
        regionNameAr,
        regionNameEn,
        invoiceType:     invType,
        invoice1:        inv1,
        invoice2:        inv2,
        collectedAmount: col,
        estimatedValue:  est,
        assignmentDate:  o.assignmentDate  ?? o.assignment_date  ?? null,
      };

      // Always accumulate summary totals (pre-filter, for cardTotal verification)
      summary.totalEstimated += est;
      summary.totalInvoiced  += col;

      if (cardType === 'estimated') {
        allRows.push({ ...base, stageNameAr });

      } else if (cardType === 'invoiced') {
        allRows.push({ ...base });

      } else if (cardType === 'remaining') {
        // Per-row expected remaining — same logic as main endpoint lines 198-208
        let perRowRemaining = 0;
        if (invType === 'نهائي') {
          perRowRemaining = inv1 > 0 ? 0 : est;
        } else if (invType === 'جزئي') {
          if      (inv1 === 0) perRowRemaining = est;
          else if (inv2 === 0) perRowRemaining = inv1; // proxy: assume inv2 ≈ inv1
          // both invoices exist → 0 (fully invoiced)
        }
        summary.totalRemaining += perRowRemaining;
        if (perRowRemaining > 0) {
          allRows.push({ ...base, expectedRemaining: perRowRemaining });
        }

      } else if (cardType === 'gap') {
        // Fully-invoiced orders only — same condition as main endpoint lines 211-213
        const isFullyInvoiced =
          (invType === 'نهائي' && inv1 > 0) ||
          (invType === 'جزئي'  && inv1 > 0 && inv2 > 0);
        if (isFullyInvoiced) {
          const totalInvoiced = inv1 + inv2;
          const diffValue     = totalInvoiced - est;
          const diffPct       = est > 0 ? (diffValue / est) * 100 : 0;
          summary.totalDiffEstimated += est;
          summary.totalDiffInvoiced  += totalInvoiced;
          summary.totalDiffValue     += diffValue;
          allRows.push({ ...base, totalInvoiced, diffValue, diffPct });
        }
      }
    }

    // Sort by primary field DESC
    if      (cardType === 'estimated') allRows.sort((a, b) => b.estimatedValue    - a.estimatedValue);
    else if (cardType === 'invoiced')  allRows.sort((a, b) => b.collectedAmount   - a.collectedAmount);
    else if (cardType === 'remaining') allRows.sort((a, b) => b.expectedRemaining - a.expectedRemaining);
    else if (cardType === 'gap')       allRows.sort((a, b) => Math.abs(b.diffValue) - Math.abs(a.diffValue));

    // cardTotal: single value matching the corresponding dashboard card
    const cardTotal =
      cardType === 'estimated' ? summary.totalEstimated :
      cardType === 'invoiced'  ? summary.totalInvoiced  :
      cardType === 'remaining' ? summary.totalRemaining :
      /* gap */                  summary.totalDiffValue;

    // summary.totalDiffPct mirrors financial.completedDiffPct from main endpoint
    const totalDiffPct = summary.totalDiffEstimated > 0
      ? (summary.totalDiffValue / summary.totalDiffEstimated) * 100
      : 0;

    // Pagination — applied after all rows are built and sorted
    const total      = allRows.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const offset     = (page - 1) * limit;
    const rows       = allRows.slice(offset, offset + limit);

    res.json({
      rows,
      pagination: { page, limit, total, totalPages },
      // cardTotal = value that should match the dashboard card exactly
      cardTotal,
      // Full summary across all rows — use for cross-endpoint verification
      summary: {
        totalEstimated:     summary.totalEstimated,
        totalInvoiced:      summary.totalInvoiced,
        totalRemaining:     summary.totalRemaining,
        totalDiffValue:     summary.totalDiffValue,
        totalDiffEstimated: summary.totalDiffEstimated,
        totalDiffInvoiced:  summary.totalDiffInvoiced,
        totalDiffPct,
      },
    });
  } catch (err) {
    console.error('[FINANCIAL-DETAIL ERROR]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
