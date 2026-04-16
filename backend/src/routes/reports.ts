import { Router } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { db } from '../db';
import {
  workOrders, users, regions, sectors, columnCatalog, columnGroups,
  reportExports, reportTemplates, stages, kpiRules, kpiTemplates, excavationPermits,
} from '../db/schema';
import { eq, and, desc, asc, sql } from 'drizzle-orm';

function permitStatus(endDate: string | Date | null): string {
  if (!endDate) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end   = new Date(endDate as any); end.setHours(0, 0, 0, 0);
  const warn  = new Date(end); warn.setDate(warn.getDate() - 5);
  if (today >= end)  return 'منتهي';
  if (today >= warn) return 'شارف على الانتهاء';
  return 'ساري';
}
import { getEffectivePermissions } from '../services/permissionService';
import { computeDashboardKpiForOrder } from '../services/kpiService';

const router = Router();

function toCamel(s: string): string {
  return s.replace(/_(\d+)/g, (_, n) => n).replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

const DONE = new Set(['COMPLETED', 'COMPLETED_LATE', 'CANCELLED']);

function computeOverall(execS: string, finS: string): string {
  if (DONE.has(execS) && DONE.has(finS)) return 'CLOSED';
  if (execS === 'OVERDUE' || finS === 'OVERDUE')  return 'OVERDUE';
  if (execS === 'WARN'    || finS === 'WARN')      return 'WARN';
  if (execS === 'OK'      || finS === 'OK')        return 'OK';
  return 'NONE';
}

// GET /api/reports/meta — columns the user can read + filter options
router.get('/meta', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;

    const perms = await getEffectivePermissions(user.id, user.role, 'work_orders');
    const readable = perms.filter(p => p.canRead).map(p => p.columnKey);

    // Fetch catalog joined with groups — order by group.sort_order, then column.sort_order
    // This ensures columnGroups object is built with groups in the correct display order
    const allGroupRows = await db.select().from(columnGroups).orderBy(asc(columnGroups.sortOrder));
    const groupMap = new Map(allGroupRows.map(g => [g.key, g.nameAr]));

    const allCols = await db.select({
      columnKey:   columnCatalog.columnKey,
      physicalKey: columnCatalog.physicalKey,
      labelAr:     columnCatalog.labelAr,
      groupKey:    columnCatalog.groupKey,
      dataType:    columnCatalog.dataType,
      sortOrder:   columnCatalog.sortOrder,
    }).from(columnCatalog)
      .where(eq(columnCatalog.tableName, 'work_orders'))
      .orderBy(asc(columnCatalog.sortOrder));

    const visibleCols = user.role === 'ADMIN'
      ? allCols
      : allCols.filter(c => readable.includes(c.columnKey));

    // Build grouped output — pre-populate groups in correct sort_order to preserve order
    // dataKey = camelCase of physicalKey (what the /data response uses as field name)
    // columnKey returned as camelCase for frontend consistency
    const grouped: Record<string, { labelAr: string; columns: any[] }> = {};
    // Pre-populate groups in sort_order (allGroupRows is already sorted by sortOrder)
    for (const gr of allGroupRows) {
      grouped[gr.key] = { labelAr: gr.nameAr, columns: [] };
    }
    for (const col of visibleCols) {
      const camelColKey  = toCamel(col.columnKey);
      const camelDataKey = toCamel(col.physicalKey ?? col.columnKey);
      if (!grouped[col.groupKey]) {
        grouped[col.groupKey] = { labelAr: groupMap.get(col.groupKey) ?? col.groupKey, columns: [] };
      }
      grouped[col.groupKey].columns.push({
        columnKey: camelColKey,   // display / permission key (camelCase)
        dataKey:   camelDataKey,  // actual key in /data rows (camelCase of physicalKey)
        labelAr:   col.labelAr,
        groupKey:  col.groupKey,
        dataType:  col.dataType,
        sortOrder: col.sortOrder,
      });
    }
    for (const g of Object.values(grouped)) {
      g.columns.sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    }

    // Computed status columns
    const statusCols = [
      { columnKey: 'execStatus',    dataKey: 'execStatus',    labelAr: 'حالة التنفيذ',  groupKey: '__status' },
      { columnKey: 'finStatus',     dataKey: 'finStatus',     labelAr: 'حالة المالي',   groupKey: '__status' },
      { columnKey: 'overallStatus', dataKey: 'overallStatus', labelAr: 'الحالة العامة', groupKey: '__status' },
    ];
    grouped['__status'] = { labelAr: 'حالة المؤشرات', columns: statusCols };

    // Permit virtual columns — latest permit per work order, injected in /data
    grouped['PERMITS'] = {
      labelAr: 'تصاريح الحفر',
      columns: [
        { columnKey: 'permitNo',        dataKey: 'permitNo',        labelAr: 'رقم التصريح',           groupKey: 'PERMITS' },
        { columnKey: 'permitStartDate', dataKey: 'permitStartDate', labelAr: 'تاريخ بداية التصريح',   groupKey: 'PERMITS', dataType: 'date' },
        { columnKey: 'permitEndDate',   dataKey: 'permitEndDate',   labelAr: 'تاريخ نهاية التصريح',   groupKey: 'PERMITS', dataType: 'date' },
        { columnKey: 'permitStatus',    dataKey: 'permitStatus',    labelAr: 'حالة التصريح',           groupKey: 'PERMITS' },
      ],
    };

    // Note: sectorName/regionName/stageName were removed from __virtual —
    // sectorId and regionId are resolved to Arabic names in the frontend display,
    // and procedure (BASE column) already shows the current stage name.
    // The __virtual group is kept only for __status columns now (handled above).
    // Removed to prevent duplicates in the column picker.

    // Accessible regions/sectors for this user
    const [dbUser] = await db.select().from(users).where(eq(users.id, user.id));
    const isAdminOrManager = ['ADMIN', 'MANAGER'].includes(user.role);

    let accessibleRegions: { id: string; nameAr: string; sectorId: string | null }[] = [];
    let accessibleSectors: { id: string; nameAr: string }[] = [];

    if (isAdminOrManager) {
      accessibleRegions = await db.select({ id: regions.id, nameAr: regions.nameAr, sectorId: regions.sectorId }).from(regions);
      accessibleSectors = await db.select({ id: sectors.id, nameAr: sectors.nameAr }).from(sectors);
    } else {
      if (dbUser?.sectorId) {
        const [sec] = await db.select({ id: sectors.id, nameAr: sectors.nameAr }).from(sectors).where(eq(sectors.id, dbUser.sectorId));
        if (sec) accessibleSectors = [sec];
        accessibleRegions = await db.select({ id: regions.id, nameAr: regions.nameAr, sectorId: regions.sectorId })
          .from(regions).where(eq(regions.sectorId, dbUser.sectorId));
      } else if (dbUser?.regionId) {
        const [reg] = await db.select({ id: regions.id, nameAr: regions.nameAr, sectorId: regions.sectorId }).from(regions).where(eq(regions.id, dbUser.regionId));
        if (reg) accessibleRegions = [reg];
      }
    }

    res.json({ columnGroups: grouped, regions: accessibleRegions, sectors: accessibleSectors });
  } catch (err: any) {
    console.error('reports/meta error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/data — filtered work order rows
router.get('/data', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const [dbUser] = await db.select().from(users).where(eq(users.id, user.id));
    const isAdminOrManager = ['ADMIN', 'MANAGER'].includes(user.role);

    const filterRegion     = (req.query.regionId      as string) || '';
    const filterSector     = (req.query.sectorId      as string) || '';
    // Support comma-separated multi-select values e.g. "OVERDUE,WARN"
    const filterExecSet  = new Set(((req.query.execStatus    as string) || '').split(',').filter(Boolean));
    const filterFinSet   = new Set(((req.query.finStatus     as string) || '').split(',').filter(Boolean));
    const filterOverallSet = new Set(((req.query.overallStatus as string) || '').split(',').filter(Boolean));

    // Row-level scoping
    const conditions: any[] = [];
    if (!isAdminOrManager) {
      if (dbUser?.regionId)      conditions.push(eq(workOrders.regionId, dbUser.regionId));
      else if (dbUser?.sectorId) conditions.push(eq(workOrders.sectorId, dbUser.sectorId));
    }
    if (filterRegion) conditions.push(eq(workOrders.regionId, filterRegion));
    if (filterSector) conditions.push(eq(workOrders.sectorId, filterSector));

    let query = db.select().from(workOrders) as any;
    if (conditions.length > 0) query = query.where(and(...conditions));
    const allOrders: any[] = await query;

    // Pre-fetch dashboard rules + stage map
    const dashboardRules = await db.select({ rule: kpiRules, template: kpiTemplates })
      .from(kpiRules)
      .innerJoin(kpiTemplates, eq(kpiRules.templateId, kpiTemplates.id))
      .where(and(eq(kpiRules.active, true), eq(kpiTemplates.displayScope, 'DASHBOARD')));
    const allStages = await db.select().from(stages);
    const stageMap  = new Map<string, any>(allStages.map(s => [s.id, s]));

    // Build columnKey → physicalKey map so renamed columns still resolve correctly in KPI
    const allColKeys = await db.select({ columnKey: columnCatalog.columnKey, physicalKey: columnCatalog.physicalKey }).from(columnCatalog);
    const physicalKeyMap = new Map<string, string>(
      allColKeys.filter((c: any) => c.physicalKey).map((c: any) => [c.columnKey, c.physicalKey as string])
    );

    // Build region/sector name maps
    const allRegions = await db.select({ id: regions.id, nameAr: regions.nameAr }).from(regions);
    const allSectors = await db.select({ id: sectors.id, nameAr: sectors.nameAr }).from(sectors);
    const regionMap  = new Map(allRegions.map(r => [r.id, r.nameAr]));
    const sectorMap  = new Map(allSectors.map(s => [s.id, s.nameAr]));

    // ── Latest permit per work order ─────────────────────────────────────────
    const allPermits = await db.select().from(excavationPermits)
      .orderBy(desc(excavationPermits.endDate), desc(excavationPermits.createdAt));
    const latestPermitMap = new Map<string, any>();
    for (const p of allPermits) {
      if (!latestPermitMap.has(p.workOrderId)) latestPermitMap.set(p.workOrderId, p);
    }

    const rows: any[] = [];
    for (const order of allOrders) {
      // ── Compute KPI statuses ─────────────────────────────────────────────
      const dash = await computeDashboardKpiForOrder(order, dashboardRules, stageMap, physicalKeyMap);
      const execStatus    = dash.exec;
      // Financial status is only meaningful after exec is complete
      const EXEC_DONE_SET = new Set(['COMPLETED', 'COMPLETED_LATE']);
      const finStatus     = EXEC_DONE_SET.has(execStatus) ? dash.fin : 'NONE';
      const overallStatus = computeOverall(execStatus, finStatus);

      if (filterExecSet.size   > 0 && !filterExecSet.has(execStatus))     continue;
      if (filterFinSet.size    > 0 && !filterFinSet.has(finStatus))       continue;
      if (filterOverallSet.size > 0 && !filterOverallSet.has(overallStatus)) continue;

      // ── Flatten order into camelCase flat object ──────────────────────────
      const flat: Record<string, any> = {};
      for (const [k, v] of Object.entries(order)) {
        flat[toCamel(k)] = v;
      }

      // Merge custom fields (JSONB)
      if (order.customFields && typeof order.customFields === 'object') {
        for (const [k, v] of Object.entries(order.customFields as Record<string, any>)) {
          if (!(toCamel(k) in flat)) flat[toCamel(k)] = v;
        }
      }

      // ── Resolve human-readable / computed fields ──────────────────────────
      // Procedure: use stageId → stage nameAr (authoritative), fall back to text
      const currentStage = order.stageId ? stageMap.get(order.stageId) : null;
      flat.procedure     = currentStage?.nameAr ?? order.procedure ?? '';

      // Region / Sector names (virtual)
      flat.regionName    = regionMap.get(order.regionId)  ?? '';
      flat.sectorName    = sectorMap.get(order.sectorId)  ?? '';
      flat.stageName     = currentStage?.nameAr ?? '';

      // Inject computed KPI statuses
      flat.execStatus    = execStatus;
      flat.finStatus     = finStatus;
      flat.overallStatus = overallStatus;

      // ── Inject latest permit data ────────────────────────────────────────
      const lp = latestPermitMap.get(order.id);
      flat.permitNo        = lp?.permitNo   ?? '';
      flat.permitStartDate = lp?.startDate  ?? null;
      flat.permitEndDate   = lp?.endDate    ?? null;
      flat.permitStatus    = lp ? permitStatus(lp.endDate) : '';

      rows.push(flat);
    }

    res.json({ rows, total: rows.length });
  } catch (err: any) {
    console.error('reports/data error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reports/permits — excavation permits with work order info + status
// Supports same filters: regionId, sectorId
// ─────────────────────────────────────────────────────────────────────────────
router.get('/permits', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const [dbUser] = await db.select().from(users).where(eq(users.id, user.id));
    const isAdminOrManager = ['ADMIN', 'MANAGER'].includes(user.role);

    const filterRegion = (req.query.regionId as string) || '';
    const filterSector = (req.query.sectorId as string) || '';

    // Row-level scoping (same as /data)
    const conditions: any[] = [];
    if (!isAdminOrManager) {
      if (dbUser?.regionId)      conditions.push(eq(workOrders.regionId, dbUser.regionId));
      else if (dbUser?.sectorId) conditions.push(eq(workOrders.sectorId, dbUser.sectorId));
    }
    if (filterRegion) conditions.push(eq(workOrders.regionId, filterRegion));
    if (filterSector) conditions.push(eq(workOrders.sectorId, filterSector));

    let woQuery = db.select({
      id:          workOrders.id,
      orderNumber: workOrders.orderNumber,
      client:      workOrders.client,
      regionId:    workOrders.regionId,
      sectorId:    workOrders.sectorId,
    }).from(workOrders) as any;
    if (conditions.length > 0) woQuery = woQuery.where(and(...conditions));
    const filteredWos: any[] = await woQuery;
    const woIds = filteredWos.map((w: any) => w.id);

    if (woIds.length === 0) return res.json({ permits: [] });

    const woMap = new Map(filteredWos.map((w: any) => [w.id, w]));

    // Fetch region/sector names
    const allRegions = await db.select({ id: regions.id, nameAr: regions.nameAr }).from(regions);
    const allSectors = await db.select({ id: sectors.id, nameAr: sectors.nameAr }).from(sectors);
    const regionMap  = new Map(allRegions.map(r => [r.id, r.nameAr]));
    const sectorMap  = new Map(allSectors.map(s => [s.id, s.nameAr]));

    // Fetch all permits for these WOs
    const permits: any[] = await db.select().from(excavationPermits);
    const filtered = permits.filter(p => woIds.includes(p.workOrderId));

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const result = filtered.map(p => {
      const wo = woMap.get(p.workOrderId) ?? {};
      const endDate = p.endDate ? new Date(p.endDate) : null;

      let status = 'غير محدد';
      if (endDate) {
        const diffDays = Math.floor((endDate.getTime() - today.getTime()) / 86400000);
        if (diffDays <= 0)      status = 'منتهي';
        else if (diffDays <= 7) status = 'شارف على الانتهاء';
        else                    status = 'ساري';
      }

      return {
        permitId:       p.id,
        permitNo:       p.permitNo,
        workOrderId:    p.workOrderId,
        orderNumber:    wo.orderNumber ?? '',
        client:         wo.client ?? '',
        regionName:     regionMap.get(wo.regionId) ?? '',
        sectorName:     sectorMap.get(wo.sectorId) ?? '',
        startDate:      p.startDate ? new Date(p.startDate).toISOString().slice(0, 10) : '',
        endDate:        p.endDate   ? new Date(p.endDate).toISOString().slice(0, 10)   : '',
        isExtension:    p.isExtension ? 'تمديد' : 'أصلي',
        extensionNumber:p.extensionNumber ?? 0,
        status,
      };
    });

    result.sort((a, b) => (a.orderNumber ?? '').localeCompare(b.orderNumber ?? '') || (a.permitNo ?? '').localeCompare(b.permitNo ?? ''));
    res.json({ permits: result });
  } catch (err: any) {
    console.error('reports/permits error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reports/viewer-summary
// Aggregated counts for the human-readable viewer page.
// Respects same region/sector scope as /data.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/viewer-summary', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const [dbUser] = await db.select().from(users).where(eq(users.id, user.id));
    const isAdminOrManager = ['ADMIN', 'MANAGER'].includes(user.role);

    const filterRegion = (req.query.regionId as string) || '';
    const filterSector = (req.query.sectorId as string) || '';

    // Build WHERE clause respecting scope
    const conditions: any[] = [];
    if (!isAdminOrManager) {
      if (dbUser?.regionId)      conditions.push(eq(workOrders.regionId, dbUser.regionId));
      else if (dbUser?.sectorId) conditions.push(eq(workOrders.sectorId, dbUser.sectorId));
    }
    if (filterRegion) conditions.push(eq(workOrders.regionId, filterRegion));
    if (filterSector) conditions.push(eq(workOrders.sectorId, filterSector));

    // ── Fetch all scoped orders (no KPI computation — uses raw status field) ─
    let ordersQuery = db.select({
      id:       workOrders.id,
      status:   workOrders.status,
      stageId:  workOrders.stageId,
      regionId: workOrders.regionId,
      sectorId: workOrders.sectorId,
    }).from(workOrders) as any;
    if (conditions.length > 0) ordersQuery = ordersQuery.where(and(...conditions));
    const allOrders: any[] = await ordersQuery;

    // ── Lookup maps ─────────────────────────────────────────────────────────
    const allStages  = await db.select({ id: stages.id, nameAr: stages.nameAr, seq: stages.seq }).from(stages).orderBy(asc(stages.seq));
    const allRegions = await db.select({ id: regions.id, nameAr: regions.nameAr }).from(regions);
    const allSectors = await db.select({ id: sectors.id, nameAr: sectors.nameAr }).from(sectors);
    const stageMap   = new Map(allStages.map(s  => [s.id,  s.nameAr]));
    const regionMap  = new Map(allRegions.map(r => [r.id, r.nameAr]));
    const sectorMap  = new Map(allSectors.map(s => [s.id, s.nameAr]));

    // ── KPI statuses — re-use existing dashboard-cards logic via per-order compute
    const dashboardRules = await db.select({ rule: kpiRules, template: kpiTemplates })
      .from(kpiRules)
      .innerJoin(kpiTemplates, eq(kpiRules.templateId, kpiTemplates.id))
      .where(and(eq(kpiRules.active, true), eq(kpiTemplates.displayScope, 'DASHBOARD')));
    const stageMapFull = new Map<string, any>(allStages.map(s => [s.id, s]));
    // For full KPI we need full order rows
    let fullOrdersQuery = db.select().from(workOrders) as any;
    if (conditions.length > 0) fullOrdersQuery = fullOrdersQuery.where(and(...conditions));
    const fullOrders: any[] = await fullOrdersQuery;

    // Build columnKey → physicalKey map so renamed columns still resolve correctly in KPI
    const reportColKeys = await db.select({ columnKey: columnCatalog.columnKey, physicalKey: columnCatalog.physicalKey }).from(columnCatalog);
    const reportPhysicalKeyMap = new Map<string, string>(
      reportColKeys.filter((c: any) => c.physicalKey).map((c: any) => [c.columnKey, c.physicalKey as string])
    );

    // ── Aggregate: totals + KPI distribution ────────────────────────────────
    const kpiExec: Record<string,number> = {};
    const kpiFin:  Record<string,number> = {};
    for (const order of fullOrders) {
      const dash = await computeDashboardKpiForOrder(order, dashboardRules, stageMapFull, reportPhysicalKeyMap);
      kpiExec[dash.exec] = (kpiExec[dash.exec] || 0) + 1;
      kpiFin[dash.fin]   = (kpiFin[dash.fin]   || 0) + 1;
    }

    // ── Aggregate: by stage ──────────────────────────────────────────────────
    const stageCount = new Map<string, number>();
    for (const o of allOrders) {
      const key = o.stageId || '__none__';
      stageCount.set(key, (stageCount.get(key) || 0) + 1);
    }
    const byStage = allStages
      .map(s => ({ stageId: s.id, stageName: s.nameAr, count: stageCount.get(s.id) || 0 }))
      .filter(s => s.count > 0);

    // ── Aggregate: by sector ─────────────────────────────────────────────────
    const sectorCount = new Map<string, number>();
    for (const o of allOrders) { if (o.sectorId) sectorCount.set(o.sectorId, (sectorCount.get(o.sectorId) || 0) + 1); }
    const bySector = Array.from(sectorCount.entries())
      .map(([id, count]) => ({ sectorId: id, sectorName: sectorMap.get(id) || id, count }))
      .sort((a, b) => b.count - a.count);

    // ── Aggregate: by region ─────────────────────────────────────────────────
    const regionCount = new Map<string, number>();
    for (const o of allOrders) { if (o.regionId) regionCount.set(o.regionId, (regionCount.get(o.regionId) || 0) + 1); }
    const byRegion = Array.from(regionCount.entries())
      .map(([id, count]) => ({ regionId: id, regionName: regionMap.get(id) || id, count }))
      .sort((a, b) => b.count - a.count);

    // ── Totals ───────────────────────────────────────────────────────────────
    const total     = allOrders.length;
    const active    = (kpiExec['OK'] || 0) + (kpiExec['WARN'] || 0);
    const overdue   = kpiExec['OVERDUE'] || 0;
    const completed = (kpiExec['COMPLETED'] || 0) + (kpiExec['COMPLETED_LATE'] || 0);
    const cancelled = kpiExec['CANCELLED'] || 0;

    res.json({ total, active, overdue, completed, cancelled, kpiExec, kpiFin, byStage, bySector, byRegion });
  } catch (err: any) {
    console.error('reports/viewer-summary error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/reports/export-log
router.post('/export-log', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const { fileName, rowCount, columns, filters } = req.body;
    const [row] = await db.insert(reportExports).values({
      actorUserId: user.id,
      actorRole:   user.role,
      fileName:    fileName || 'تقرير.xlsx',
      rowCount:    rowCount || 0,
      columns:     columns  || [],
      filters:     filters  || {},
    }).returning();
    res.json({ ok: true, id: row.id });
  } catch (err: any) {
    console.error('reports/export-log error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/export-log
router.get('/export-log', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const isAdminOrManager = ['ADMIN', 'MANAGER'].includes(user.role);

    let rows: any[];
    const base = db.select({
      id:        reportExports.id,
      actorRole: reportExports.actorRole,
      fileName:  reportExports.fileName,
      rowCount:  reportExports.rowCount,
      columns:   reportExports.columns,
      filters:   reportExports.filters,
      createdAt: reportExports.createdAt,
      username:  users.username,
    }).from(reportExports)
      .leftJoin(users, eq(reportExports.actorUserId, users.id))
      .orderBy(desc(reportExports.createdAt));

    rows = isAdminOrManager
      ? await (base as any).limit(100)
      : await (base as any).where(eq(reportExports.actorUserId, user.id)).limit(50);

    res.json(rows);
  } catch (err: any) {
    console.error('reports/export-log error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Report Templates CRUD ─────────────────────────────────────────────────────

// GET /api/reports/templates — all templates visible to this user
router.get('/templates', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const all = await db.select({
      id:        reportTemplates.id,
      name:      reportTemplates.name,
      columns:   reportTemplates.columns,
      filters:   reportTemplates.filters,
      isShared:  reportTemplates.isShared,
      createdBy: reportTemplates.createdBy,
      createdAt: reportTemplates.createdAt,
      updatedAt: reportTemplates.updatedAt,
      username:  users.username,
    }).from(reportTemplates)
      .leftJoin(users, eq(reportTemplates.createdBy, users.id))
      .orderBy(desc(reportTemplates.updatedAt));

    const visible = all.filter((t: any) =>
      t.isShared || t.createdBy === user.id || user.role === 'ADMIN'
    );
    res.json(visible);
  } catch (err: any) {
    console.error('templates GET error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/reports/templates — save new template
router.post('/templates', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const { name, columns, filters, isShared } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'اسم القالب مطلوب' });

    const [t] = await db.insert(reportTemplates).values({
      name: name.trim(),
      createdBy: user.id,
      columns: columns ?? [],
      filters: filters ?? {},
      isShared: isShared ?? false,
    }).returning();
    res.status(201).json(t);
  } catch (err: any) {
    console.error('templates POST error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/reports/templates/:id — update template
router.put('/templates/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const [existing] = await db.select().from(reportTemplates).where(eq(reportTemplates.id, req.params.id)).limit(1);
    if (!existing) return res.status(404).json({ error: 'القالب غير موجود' });
    if (existing.createdBy !== user.id && user.role !== 'ADMIN')
      return res.status(403).json({ error: 'غير مصرح' });

    const { name, columns, filters, isShared } = req.body;
    const [updated] = await db.update(reportTemplates)
      .set({
        name:      name?.trim() ?? existing.name,
        columns:   columns   ?? existing.columns,
        filters:   filters   ?? existing.filters,
        isShared:  isShared  ?? existing.isShared,
        updatedAt: new Date(),
      })
      .where(eq(reportTemplates.id, req.params.id))
      .returning();
    res.json(updated);
  } catch (err: any) {
    console.error('templates PUT error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/reports/templates/:id
router.delete('/templates/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const [existing] = await db.select().from(reportTemplates).where(eq(reportTemplates.id, req.params.id)).limit(1);
    if (!existing) return res.status(404).json({ error: 'القالب غير موجود' });
    if (existing.createdBy !== user.id && user.role !== 'ADMIN')
      return res.status(403).json({ error: 'غير مصرح' });

    await db.delete(reportTemplates).where(eq(reportTemplates.id, req.params.id));
    res.json({ success: true });
  } catch (err: any) {
    console.error('templates DELETE error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Fixed/Built-in Reports ─────────────────────────────────────────────────────

// ── Shared loader for fixed reports (with row-level scoping) ─────────────────
async function loadFixedReportContext(user: any, dbUser: any) {
  const isAdminOrManager = ['ADMIN', 'MANAGER'].includes(user.role);

  // Build scoped work-orders query (same logic as /data)
  const conditions: any[] = [];
  if (!isAdminOrManager) {
    if (dbUser?.regionId)      conditions.push(eq(workOrders.regionId, dbUser.regionId));
    else if (dbUser?.sectorId) conditions.push(eq(workOrders.sectorId, dbUser.sectorId));
  }

  let ordersQuery = db.select().from(workOrders) as any;
  if (conditions.length > 0) ordersQuery = ordersQuery.where(and(...conditions));

  const [scopedOrders, allStagesRaw, dashboardRulesRaw, allColKeys] = await Promise.all([
    ordersQuery as Promise<any[]>,
    db.select().from(stages),
    db.select({ rule: kpiRules, template: kpiTemplates })
      .from(kpiRules)
      .innerJoin(kpiTemplates, eq(kpiRules.templateId, kpiTemplates.id))
      .where(and(eq(kpiRules.active, true), eq(kpiTemplates.displayScope, 'DASHBOARD'))),
    db.select({ columnKey: columnCatalog.columnKey, physicalKey: columnCatalog.physicalKey }).from(columnCatalog),
  ]);
  const stageMap      = new Map<string, any>(allStagesRaw.map(s => [s.id, s]));
  const physicalKeyMap = new Map<string, string>(
    allColKeys.filter((c: any) => c.physicalKey).map((c: any) => [c.columnKey, c.physicalKey as string])
  );
  return { allOrders: scopedOrders, stageMap, dashboardRules: dashboardRulesRaw, physicalKeyMap, isAdminOrManager };
}

// GET /api/reports/fixed/overdue — أوامر العمل المتأخرة
router.get('/fixed/overdue', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const [dbUser] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    const { allOrders, stageMap, dashboardRules, physicalKeyMap } = await loadFixedReportContext(user, dbUser);

    const rows: any[] = [];
    for (const order of allOrders) {
      const dash = await computeDashboardKpiForOrder(order, dashboardRules, stageMap, physicalKeyMap);
      if (dash.exec === 'OVERDUE' || dash.fin === 'OVERDUE') {
        const stage = (order as any).stageId ? stageMap.get((order as any).stageId) : null;
        rows.push({
          orderNumber:    (order as any).orderNumber,
          client:         (order as any).client,
          district:       (order as any).district,
          assignmentDate: (order as any).assignmentDate,
          procedure:      stage?.nameAr ?? (order as any).procedure,
          execStatus:     dash.exec,
          finStatus:      dash.fin,
          workType:       (order as any).workType,
          projectType:    (order as any).projectType,
        });
      }
    }
    rows.sort((a, b) => {
      const da = a.assignmentDate ? new Date(a.assignmentDate).getTime() : Infinity;
      const db2 = b.assignmentDate ? new Date(b.assignmentDate).getTime() : Infinity;
      return da - db2;
    });
    res.json({ rows, total: rows.length });
  } catch (err: any) {
    console.error('fixed/overdue error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/fixed/by-sector — ملخص حسب القطاعات
router.get('/fixed/by-sector', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const [dbUser] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    const [{ allOrders, stageMap, dashboardRules, physicalKeyMap, isAdminOrManager }, allSecs] = await Promise.all([
      loadFixedReportContext(user, dbUser),
      db.select().from(sectors).where(eq(sectors.active, true)),
    ]);

    const bySecMap: Record<string, { name: string; total: number; overdue: number; warn: number; ok: number; completed: number; cancelled: number }> = {};
    for (const sec of allSecs) {
      bySecMap[sec.id] = { name: sec.nameAr, total: 0, overdue: 0, warn: 0, ok: 0, completed: 0, cancelled: 0 };
    }

    for (const order of allOrders) {
      const secId = (order as any).sectorId;
      if (!secId || !bySecMap[secId]) continue;
      const dash = await computeDashboardKpiForOrder(order, dashboardRules, stageMap, physicalKeyMap);
      bySecMap[secId].total++;
      const e = dash.exec;
      if (e === 'CANCELLED') bySecMap[secId].cancelled++;
      else if (e === 'COMPLETED' || e === 'COMPLETED_LATE') bySecMap[secId].completed++;
      else if (e === 'OVERDUE') bySecMap[secId].overdue++;
      else if (e === 'WARN') bySecMap[secId].warn++;
      else bySecMap[secId].ok++;
    }
    res.json({ rows: Object.values(bySecMap).filter(r => r.total > 0) });
  } catch (err: any) {
    console.error('fixed/by-sector error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/fixed/monthly — تقرير شهري (آخر 12 شهر حسب تاريخ الإسناد)
router.get('/fixed/monthly', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const [dbUser] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    const { allOrders, stageMap, dashboardRules, physicalKeyMap } = await loadFixedReportContext(user, dbUser);
    const monthMap: Record<string, { month: string; total: number; completed: number; overdue: number }> = {};

    for (const order of allOrders) {
      const d = (order as any).assignmentDate;
      if (!d) continue;
      const date = new Date(d);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!monthMap[key]) monthMap[key] = { month: key, total: 0, completed: 0, overdue: 0 };
      monthMap[key].total++;
      const dash = await computeDashboardKpiForOrder(order, dashboardRules, stageMap, physicalKeyMap);
      if (dash.exec === 'COMPLETED' || dash.exec === 'COMPLETED_LATE') monthMap[key].completed++;
      if (dash.exec === 'OVERDUE') monthMap[key].overdue++;
    }
    const rows = Object.values(monthMap).sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
    res.json({ rows });
  } catch (err: any) {
    console.error('fixed/monthly error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/fixed/new-orders — أوامر العمل الجديدة (إسناد خلال N أيام، افتراضي 7)
router.get('/fixed/new-orders', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const [dbUser] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    const { allOrders, stageMap, dashboardRules, physicalKeyMap } = await loadFixedReportContext(user, dbUser);

    const windowDays = Math.max(1, Math.min(365, parseInt((req.query.days as string) || '7', 10) || 7));
    const now   = new Date();
    const cutoff = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

    const rows: any[] = [];
    for (const order of allOrders) {
      const d = (order as any).assignmentDate;
      if (!d) continue;

      const assignDate = new Date(d);
      // Keep only if assigned within last 7 days (after cutoff, not in the future)
      if (assignDate < cutoff || assignDate > now) continue;

      const daysOld = Math.floor((now.getTime() - assignDate.getTime()) / (1000 * 60 * 60 * 24));
      const stage   = (order as any).stageId ? stageMap.get((order as any).stageId) : null;
      const dash    = await computeDashboardKpiForOrder(order, dashboardRules, stageMap, physicalKeyMap);

      rows.push({
        orderNumber:    (order as any).orderNumber,
        client:         (order as any).client,
        district:       (order as any).district,
        workType:       (order as any).workType,
        projectType:    (order as any).projectType,
        assignmentDate: (order as any).assignmentDate,
        daysOld,
        procedure:      stage?.nameAr ?? (order as any).procedure,
        execStatus:     dash.exec,
        finStatus:      dash.fin,
      });
    }

    // Sort newest first
    rows.sort((a, b) => {
      const da = a.assignmentDate ? new Date(a.assignmentDate).getTime() : 0;
      const db2 = b.assignmentDate ? new Date(b.assignmentDate).getTime() : 0;
      return db2 - da;
    });

    res.json({ rows, total: rows.length, windowDays });
  } catch (err: any) {
    console.error('fixed/new-orders error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
