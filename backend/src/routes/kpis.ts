import { Router } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import {
  computeWorkOrderKpis,
  computeDashboardSummary,
  computeDashboardKpiForOrder,
} from '../services/kpiService';
import { db } from '../db';
import { workOrders, users, regions, sectors, columnOptions, stages, kpiRules, kpiTemplates, roleDefinitions, columnCatalog, roleColumnPermissions } from '../db/schema';
import { eq, and } from 'drizzle-orm';

async function getScopeInfo(userId: string, roleKey: string) {
  const [user, roleDef] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, userId) }),
    db.query.roleDefinitions.findFirst({ where: eq(roleDefinitions.roleKey, roleKey) }),
  ]);
  return {
    sectorId:  (user as any)?.sectorId  ?? (user as any)?.sector_id  ?? null,
    regionId:  (user as any)?.regionId  ?? (user as any)?.region_id  ?? null,
    scopeType: roleDef?.scopeType ?? 'ALL',
  };
}

const router = Router();

// KPI Report — filtered by user's region/sector + query params
router.get('/report', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;

    // Fetch the requesting user's region/sector assignments
    const [dbUser] = await db.select().from(users).where(eq(users.id, user.id));
    const userRegionId = dbUser?.regionId ?? null;
    const userSectorId = dbUser?.sectorId ?? null;

    // Query params for client-side filtering (applied after KPI computation)
    const filterStatus      = (req.query.status      as string) || 'ALL';
    const filterRegion      = (req.query.regionId    as string) || '';
    const filterSector      = (req.query.sectorId    as string) || '';
    const filterProjectType = (req.query.projectType as string) || '';

    // Build DB-level where clause
    const conditions: any[] = [];

    // ADMIN and MANAGER roles see all; others are restricted to their region/sector
    if (!['ADMIN', 'MANAGER'].includes(user.role)) {
      if (userRegionId) conditions.push(eq(workOrders.regionId, userRegionId));
      if (userSectorId) conditions.push(eq(workOrders.sectorId, userSectorId));
    }

    // Client-supplied override filters (respected only when user has access)
    if (filterRegion)   conditions.push(eq(workOrders.regionId, filterRegion));
    if (filterSector)   conditions.push(eq(workOrders.sectorId, filterSector));

    // Select ALL work order fields so dynamic columns can be rendered in the table
    let query = db.select().from(workOrders) as any;

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    const allOrders: any[] = await query;

    // Pre-fetch all shared KPI data once — prevents N×5 queries inside the loop
    const [dashboardRules, orderRules, allStages, allColKeys] = await Promise.all([
      db.select({ rule: kpiRules, template: kpiTemplates })
        .from(kpiRules)
        .innerJoin(kpiTemplates, eq(kpiRules.templateId, kpiTemplates.id))
        .where(and(eq(kpiRules.active, true), eq(kpiTemplates.displayScope, 'DASHBOARD'))),
      db.select({ rule: kpiRules, template: kpiTemplates })
        .from(kpiRules)
        .innerJoin(kpiTemplates, eq(kpiRules.templateId, kpiTemplates.id))
        .where(and(eq(kpiRules.active, true), eq(kpiTemplates.displayScope, 'ORDER'))),
      db.select().from(stages),
      db.select({ columnKey: columnCatalog.columnKey, physicalKey: (columnCatalog as any).physicalKey }).from(columnCatalog),
    ]);

    const stageMap = new Map<string, any>(allStages.map((s: any) => [s.id, s]));
    const physicalKeyMap = new Map<string, string>(
      allColKeys.filter((c: any) => c.physicalKey).map((c: any) => [c.columnKey, c.physicalKey as string])
    );

    // Pre-fetch column permissions once for this role (same for all orders in this request)
    let readableColumns: Set<string>;
    if (user.role === 'ADMIN') {
      readableColumns = new Set(['*']);
    } else {
      const perms = await db.select()
        .from(roleColumnPermissions)
        .where(and(eq((roleColumnPermissions as any).role, user.role), eq((roleColumnPermissions as any).canRead, true)));
      readableColumns = new Set(perms.map((p: any) => p.columnKey));
    }

    // Compute KPIs for each order, apply workType + status filters
    const reportRows: any[] = [];

    for (const order of allOrders) {
      if (filterProjectType && order.projectType !== filterProjectType) continue;

      const kpis = await computeWorkOrderKpis(order.id, user.role, {
        wo: order,
        physicalKeyMap,
        stageMap,
        orderRules,
        readableColumns,
      });
      const overdueKpis = kpis.filter(k => k.status === 'OVERDUE');
      const warnKpis    = kpis.filter(k => k.status === 'WARN');
      const worstStatus = overdueKpis.length > 0 ? 'OVERDUE'
        : warnKpis.length > 0 ? 'WARN'
        : kpis.some(k => k.status === 'OK') ? 'OK'
        : 'INCOMPLETE';

      if (filterStatus !== 'ALL' && worstStatus !== filterStatus) continue;

      // Compute DASHBOARD KPI status (5-state) per order for card-based filtering
      const dash = await computeDashboardKpiForOrder(order, dashboardRules, stageMap, physicalKeyMap);

      // Resolve procedure name from stageId (authoritative) → fall back to text column
      const resolvedStage = order.stageId ? stageMap.get(order.stageId) : null;
      const procedureName = resolvedStage?.nameAr ?? order.procedure ?? null;

      // Compute overall status from exec + fin
      const DONE = new Set(['COMPLETED', 'COMPLETED_LATE', 'CANCELLED']);
      const EXEC_DONE = new Set(['COMPLETED', 'COMPLETED_LATE']);
      const execS = dash.exec;
      // Financial status is only meaningful after exec is complete
      const finS  = EXEC_DONE.has(execS) ? dash.fin : 'NONE';
      let overallStatus: string;
      if (DONE.has(execS) && DONE.has(dash.fin)) {
        overallStatus = 'CLOSED';
      } else if (execS === 'OVERDUE' || finS === 'OVERDUE') {
        overallStatus = 'OVERDUE';
      } else if (execS === 'WARN' || finS === 'WARN') {
        overallStatus = 'WARN';
      } else if (execS === 'OK' || finS === 'OK') {
        overallStatus = 'OK';
      } else {
        overallStatus = 'NONE';
      }

      reportRows.push({
        ...order,
        procedure: procedureName,  // override raw text with resolved stage name
        kpis,
        worstStatus,
        overdueCount: overdueKpis.length,
        warnCount: warnKpis.length,
        overdueKpis,
        warnKpis,
        dashExec: dash.exec,
        dashFin:  dash.fin,
        execStatus:    execS,
        finStatus:     finS,   // NONE when exec not yet complete
        overallStatus,
      });
    }

    // Sort: OVERDUE first, then WARN, then rest
    const statusOrder: Record<string, number> = { OVERDUE: 0, WARN: 1, OK: 2, INCOMPLETE: 3 };
    reportRows.sort((a, b) => (statusOrder[a.worstStatus] ?? 9) - (statusOrder[b.worstStatus] ?? 9));

    // Also return available filter options
    const allRegions = await db.select().from(regions);
    const allSectors = await db.select().from(sectors);
    const projectTypeOptions = await db.select().from(columnOptions)
      .where(and(eq(columnOptions.columnKey, 'project_type'), eq(columnOptions.active, true)));

    res.json({
      rows: reportRows,
      meta: {
        total: reportRows.length,
        overdue: reportRows.filter(r => r.worstStatus === 'OVERDUE').length,
        warn: reportRows.filter(r => r.worstStatus === 'WARN').length,
        ok: reportRows.filter(r => r.worstStatus === 'OK').length,
        userRegionId,
        userSectorId,
        userRole: user.role,
      },
      regions: allRegions,
      sectors: allSectors,
      projectTypeOptions,
    });
  } catch (err) {
    console.error('[KPI REPORT ERROR]', err);
    res.status(500).json({ error: 'Failed to generate KPI report' });
  }
});

// ── Dashboard Cards — 5-state summary (CANCELLED, COMPLETED, OVERDUE, WARN, OK)
// Uses DASHBOARD-scoped kpi_templates + kpi_rules
// IMPORTANT: must be BEFORE /:id route
router.get('/dashboard-cards', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const isUnrestricted = ['ADMIN', 'MANAGER'].includes(user.role);

    // Enforce scope for restricted users
    let effectiveSectorId: string | null = (req.query.sectorId as string) || null;
    let effectiveRegionId: string | null = (req.query.regionId as string) || null;

    if (!isUnrestricted) {
      const scope = await getScopeInfo(user.id, user.role);
      if (scope.scopeType === 'OWN_REGION' && scope.regionId) {
        effectiveRegionId = scope.regionId;
      } else if (scope.scopeType === 'OWN_SECTOR' && scope.sectorId) {
        effectiveSectorId = scope.sectorId;
        effectiveRegionId = null;
      }
    }

    const projectType = (req.query.projectType as string) || null;
    const summary = await computeDashboardSummary({
      sectorIds:   effectiveSectorId ? [effectiveSectorId] : null,
      regionId:    effectiveRegionId,
      projectType,
    });
    res.json(summary);
  } catch (err) {
    console.error('[DASHBOARD-CARDS ERROR]', err);
    res.status(500).json({ error: 'Failed to compute dashboard cards' });
  }
});

// Dashboard KPI summary (legacy)
// IMPORTANT: must be BEFORE /:id route
router.get('/summary/all', authenticate, async (req, res) => {
  try {
    const user = (req as any).user;
    const orders = await db.select({ id: workOrders.id }).from(workOrders);
    let overdue = 0, warn = 0, ok = 0;
    for (const order of orders) {
      const kpis = await computeWorkOrderKpis(order.id, user.role);
      for (const kpi of kpis) {
        if (kpi.status === 'OVERDUE') overdue++;
        else if (kpi.status === 'WARN') warn++;
        else if (kpi.status === 'OK') ok++;
      }
    }
    res.json({ overdue, warn, ok });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to get KPI summary' });
  }
});

// Get exec/fin phase SLA days for a specific work order (based on project type)
router.get('/phase-sla/:workOrderId', authenticate, async (req, res) => {
  try {
    const [wo] = await db.select({ projectType: workOrders.projectType })
      .from(workOrders)
      .where(eq(workOrders.id, req.params.workOrderId));

    if (!wo) return res.json({ execSlaDays: null, finSlaDays: 20 });

    const projectType: string | null = (wo as any).projectType ?? null;

    // Find EXEC rule: assignment_date → proc_155_date for this project type
    const execRules = await db.select({ slaDays: kpiRules.slaDaysOverride, defaultSla: kpiTemplates.defaultSlaDays })
      .from(kpiRules)
      .innerJoin(kpiTemplates, eq(kpiRules.templateId, kpiTemplates.id))
      .where(
        and(
          eq(kpiRules.startColumnKey, 'assignment_date'),
          eq(kpiRules.endColumnKey, 'proc_155_date'),
          eq(kpiRules.active, true),
          projectType
            ? eq(kpiRules.workTypeFilter, projectType)
            : undefined as any
        )
      )
      .limit(1);

    // Find FIN rule: proc_155_date → financial_close_date (global, no project type filter)
    const finRules = await db.select({ slaDays: kpiRules.slaDaysOverride, defaultSla: kpiTemplates.defaultSlaDays })
      .from(kpiRules)
      .innerJoin(kpiTemplates, eq(kpiRules.templateId, kpiTemplates.id))
      .where(
        and(
          eq(kpiRules.startColumnKey, 'proc_155_date'),
          eq(kpiRules.endColumnKey, 'financial_close_date'),
          eq(kpiRules.active, true)
        )
      )
      .limit(1);

    const execSla = execRules[0] ? (execRules[0].slaDays ?? execRules[0].defaultSla ?? null) : null;
    const finSla  = finRules[0]  ? (finRules[0].slaDays  ?? finRules[0].defaultSla  ?? 20)  : 20;

    res.json({ execSlaDays: execSla, finSlaDays: finSla, projectType });
  } catch (err) {
    console.error('[phase-sla]', err);
    res.json({ execSlaDays: null, finSlaDays: 20 });
  }
});

// Get date constraints for a specific work order
// Returns pairs: { startCol, endCol, labelAr } — end date must be >= start date
router.get('/date-constraints/:workOrderId', authenticate, async (req, res) => {
  try {
    const [wo] = await db.select({ projectType: workOrders.projectType })
      .from(workOrders)
      .where(eq(workOrders.id, req.params.workOrderId));

    const projectType: string | null = wo ? ((wo as any).projectType ?? null) : null;

    // Load physical key map (e.g. proc_155_date → proc_155_close_date)
    const colCatalog = await db.select({
      columnKey: columnCatalog.columnKey,
      physicalKey: (columnCatalog as any).physicalKey
    }).from(columnCatalog);
    const toPhysical = (key: string): string => {
      const entry = colCatalog.find((c: any) => c.columnKey === key);
      return (entry?.physicalKey as string | null) ?? key;
    };

    // Fetch all active DATES-based KPI rules applicable to this project type
    const allRules = await db.select({
      startColumnKey: kpiRules.startColumnKey,
      endColumnKey:   kpiRules.endColumnKey,
      workTypeFilter: kpiRules.workTypeFilter,
      labelAr:        kpiTemplates.nameAr,
    })
    .from(kpiRules)
    .innerJoin(kpiTemplates, eq(kpiRules.templateId, kpiTemplates.id))
    .where(and(
      eq(kpiRules.active, true),
      eq(kpiRules.calcMode, 'DATES')
    ));

    // Filter by project type: include global rules + rules for this project type
    const applicable = allRules.filter((r: any) =>
      !r.workTypeFilter || r.workTypeFilter === projectType
    );

    // Deduplicate by (startCol, endCol) — keep unique pairs
    const seen = new Set<string>();
    const constraints = applicable
      .filter((r: any) => r.startColumnKey && r.endColumnKey)
      .map((r: any) => ({
        startCol: toPhysical(r.startColumnKey!),
        endCol:   toPhysical(r.endColumnKey!),
        labelAr:  r.labelAr,
      }))
      .filter((r: any) => {
        const k = `${r.startCol}|${r.endCol}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

    res.json(constraints);
  } catch (err) {
    console.error('[date-constraints]', err);
    res.json([]);
  }
});

// Get KPIs for a specific work order
router.get('/:id', authenticate, async (req, res) => {
  try {
    const user = (req as any).user;
    const kpis = await computeWorkOrderKpis(req.params.id, user.role);
    res.json(kpis);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to compute KPIs' });
  }
});

export default router;
