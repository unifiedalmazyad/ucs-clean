import express from 'express';
import { db, pool } from '../db';
import { workOrders, auditLogs, columnCatalog, columnOptions, kpiRules, columnGroups, users, stages, sectors, regions, roleDefinitions, roleColumnPermissions, workOrderNotes, workOrderAttachments, excavationPermits } from '../db/schema';
import { authenticate, AuthRequest } from '../middleware/auth';
import { filterOutput, filterInput, getEffectivePermissions } from '../services/permissionService';
import { eq, sql, desc, and, asc } from 'drizzle-orm';
import { unlink } from 'fs/promises';
import path from 'path';
import { emitEvent } from '../events/dispatcher';
import { EventTypes } from '../events/eventTypes';
import { resolveContractId } from './contracts';

/**
 * Auto-compute collected_amount and remaining_amount from invoice fields.
 * Returns null if no invoice_type is set (nothing to compute).
 */
function computeFinancials(
  invoiceType: string | null | undefined,
  invoice1: number | string | null | undefined,
  invoice2: number | string | null | undefined,
  estimatedValue: number | string | null | undefined,
): { collectedAmount: number; remainingAmount: number } | null {
  if (!invoiceType) return null;
  const inv1 = Number(invoice1)        || 0;
  const inv2 = Number(invoice2)        || 0;
  const est  = Number(estimatedValue)  || 0;
  const totalInvoiced = inv1 + inv2;
  return { collectedAmount: totalInvoiced, remainingAmount: est - totalInvoiced };
}

/**
 * Fetch the sector/region assigned to this user, plus the role's scopeType.
 */
async function getUserScope(userId: string, roleKey: string): Promise<{
  sectorId:  string | null;
  regionId:  string | null;
  scopeType: string;
  canCreateOrder:             boolean;
  canDeleteOrder:             boolean;
  canViewExcavationPermits:   boolean;
  canEditExcavationPermits:   boolean;
  canDeleteExcavationPermits: boolean;
}> {
  const [user, roleDef] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, userId) }),
    db.query.roleDefinitions.findFirst({ where: eq(roleDefinitions.roleKey, roleKey) }),
  ]);
  const isAdmin = roleKey === 'ADMIN';
  return {
    sectorId:  (user as any)?.sectorId  ?? (user as any)?.sector_id  ?? null,
    regionId:  (user as any)?.regionId  ?? (user as any)?.region_id  ?? null,
    scopeType: roleDef?.scopeType ?? 'ALL',
    canCreateOrder:             isAdmin ? true : ((roleDef as any)?.canCreateOrder             ?? false),
    canDeleteOrder:             isAdmin ? true : ((roleDef as any)?.canDeleteOrder             ?? false),
    canViewExcavationPermits:   isAdmin ? true : ((roleDef as any)?.canViewExcavationPermits   ?? true),
    canEditExcavationPermits:   isAdmin ? true : ((roleDef as any)?.canEditExcavationPermits   ?? false),
    canDeleteExcavationPermits: isAdmin ? true : ((roleDef as any)?.canDeleteExcavationPermits ?? false),
  };
}

import { computeWorkOrderKpis } from '../services/kpiService';

const router = express.Router();

// ── GET /api/work-orders/table-columns
// Returns columns the current user can read for the work_orders table
// IMPORTANT: must be BEFORE /:id routes
router.get('/table-columns', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;

    const catalog = await db.select().from(columnCatalog)
      .where(eq(columnCatalog.isEnabled, true))
      .orderBy(asc(columnCatalog.sortOrder));

    let readable: typeof catalog;
    if (user.role === 'ADMIN') {
      readable = catalog;
    } else {
      const perms = await db.select().from(roleColumnPermissions as any)
        .where(and(
          eq((roleColumnPermissions as any).role, user.role),
          eq((roleColumnPermissions as any).canRead, true)
        ));
      const readableKeys = new Set(perms.map((p: any) => p.columnKey));
      readable = catalog.filter(c => readableKeys.has(c.columnKey));
    }

    // Fetch options for select-type columns
    const allOptions = await db.select().from(columnOptions)
      .where(eq(columnOptions.active, true))
      .orderBy(asc(columnOptions.sortOrder));

    const optMap: Record<string, { value: string; labelAr: string; labelEn?: string }[]> = {};
    for (const opt of allOptions) {
      if (!optMap[opt.columnKey]) optMap[opt.columnKey] = [];
      optMap[opt.columnKey].push({ value: opt.value, labelAr: opt.labelAr, labelEn: opt.labelEn ?? '' });
    }

    // Add region and sector options (stored in separate tables, not column_options)
    const allRegionsList = await db.select().from(regions).where(eq(regions.active, true));
    const allSectorsList = await db.select().from(sectors).where(eq(sectors.active, true));
    optMap['region_id'] = allRegionsList.map(r => ({ value: r.id, labelAr: r.nameAr, labelEn: r.nameEn ?? '' }));
    optMap['sector_id'] = allSectorsList.map(s => ({ value: s.id, labelAr: s.nameAr, labelEn: s.nameEn ?? '' }));

    res.json({ columns: readable, options: optMap });
  } catch (err) {
    console.error('[TABLE-COLUMNS ERROR]', err);
    res.status(500).json({ error: 'Failed to fetch table columns' });
  }
});

router.get('/', authenticate, async (req: AuthRequest, res) => {
  try {
    // ── Scope-based row-level filtering ──────────────────────────────────
    let scopeWhere: any = undefined;

    if (req.user!.role !== 'ADMIN') {
      const scope = await getUserScope(req.user!.id, req.user!.role);

      if (scope.scopeType === 'OWN_REGION' && scope.regionId) {
        scopeWhere = eq(workOrders.regionId, scope.regionId);
      } else if (scope.scopeType === 'OWN_SECTOR' && scope.sectorId) {
        scopeWhere = eq(workOrders.sectorId, scope.sectorId);
      }
      // scopeType === 'ALL' → no filter applied
    }

    const allOrders = scopeWhere
      ? await db.select().from(workOrders).where(scopeWhere)
      : await db.select().from(workOrders);

    const filtered = await filterOutput(allOrders, req.user!.id, req.user!.role, 'work_orders');
    
    // Add KPI summary to each order
    const ordersWithKpis = await Promise.all(filtered.map(async (order: any) => {
      const kpis = await computeWorkOrderKpis(order.id, req.user!.role);
      const summary = {
        overdue: kpis.filter(k => k.status === 'OVERDUE').length,
        warn: kpis.filter(k => k.status === 'WARN').length,
      };
      return { ...order, kpiSummary: summary };
    }));

    res.json(ordersWithKpis);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch work orders' });
  }
});

router.get('/:id/edit-context', authenticate, async (req: AuthRequest, res) => {
  try {
    const order = await db.query.workOrders.findFirst({
      where: eq(workOrders.id, req.params.id),
    });

    if (!order) return res.status(404).json({ error: 'Not found' });

    // ── Scope enforcement — block out-of-scope orders ─────────────────────
    if (req.user!.role !== 'ADMIN') {
      const scope = await getUserScope(req.user!.id, req.user!.role);
      const orderAny = order as any;
      if (scope.scopeType === 'OWN_REGION' && scope.regionId &&
          (orderAny.regionId ?? orderAny.region_id) !== scope.regionId) {
        return res.status(403).json({ error: 'Access denied: outside your region' });
      }
      if (scope.scopeType === 'OWN_SECTOR' && scope.sectorId &&
          (orderAny.sectorId ?? orderAny.sector_id) !== scope.sectorId) {
        return res.status(403).json({ error: 'Access denied: outside your sector' });
      }
    }

    const filtered = await filterOutput([order], req.user!.id, req.user!.role, 'work_orders');
    const workOrder = filtered[0];

    const catalog = await db.select().from(columnCatalog).where(eq(columnCatalog.isEnabled, true)).orderBy(asc(columnCatalog.sortOrder));
    const options = await db.select().from(columnOptions).where(eq(columnOptions.active, true));
    const kpis = await db.select().from(kpiRules).where(eq(kpiRules.active, true));
    const groups = await db.select().from(columnGroups).where(eq(columnGroups.active, true)).orderBy(columnGroups.sortOrder);
    const stagesList  = await db.select().from(stages).where(eq(stages.active, true)).orderBy(stages.category, stages.seq);
    const sectorsList = await db.select().from(sectors).where(eq(sectors.active, true));
    const regionsList = await db.select().from(regions).where(eq(regions.active, true));

    // Include the acting user's own scope so the frontend can show read-only values
    const scopeInfo   = await getUserScope(req.user!.id, req.user!.role);
    const userScope   = {
      role:      req.user!.role,
      sectorId:  scopeInfo.sectorId,
      regionId:  scopeInfo.regionId,
      scopeType: scopeInfo.scopeType,   // ALL | OWN_SECTOR | OWN_REGION
      canViewExcavationPermits:   scopeInfo.canViewExcavationPermits,
      canEditExcavationPermits:   scopeInfo.canEditExcavationPermits,
      canDeleteExcavationPermits: scopeInfo.canDeleteExcavationPermits,
    };

    // Effective per-column read/write for the acting user — drives frontend field locking
    const effectivePerms = await getEffectivePermissions(req.user!.id, req.user!.role, 'work_orders');

    res.json({
      workOrder,
      catalog,
      options,
      kpiDefinitions: kpis,
      groups,
      stages:        stagesList,
      sectors:       sectorsList,
      regions:       regionsList,
      userScope,
      effectivePerms,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch edit context' });
  }
});

router.get('/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const order = await db.query.workOrders.findFirst({
      where: eq(workOrders.id, req.params.id),
    });

    if (!order) return res.status(404).json({ error: 'Not found' });

    // Enforce region/sector scope — mirrors the check in /:id/edit-context
    if (req.user!.role !== 'ADMIN') {
      const scope = await getUserScope(req.user!.id, req.user!.role);
      const orderAny = order as any;
      if (scope.scopeType === 'OWN_REGION' && scope.regionId &&
          (orderAny.regionId ?? orderAny.region_id) !== scope.regionId) {
        return res.status(403).json({ error: 'Access denied: outside your region' });
      }
      if (scope.scopeType === 'OWN_SECTOR' && scope.sectorId &&
          (orderAny.sectorId ?? orderAny.sector_id) !== scope.sectorId) {
        return res.status(403).json({ error: 'Access denied: outside your sector' });
      }
    }

    const filtered = await filterOutput([order], req.user!.id, req.user!.role, 'work_orders');
    res.json(filtered[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch work order' });
  }
});

router.post('/', authenticate, async (req: AuthRequest, res) => {
  try {
    const { coreFiltered, dynamicFiltered } = await filterInput(req.body, req.user!.id, req.user!.role, 'work_orders');

    // Auto-clear reason when justified = false
    if (coreFiltered.execDelayJustified === false) coreFiltered.execDelayReason = null;
    if (coreFiltered.finDelayJustified  === false) coreFiltered.finDelayReason  = null;

    // Convert date strings → Date objects for Drizzle
    const coreReady = parseDates(coreFiltered);

    // ── Sector / Region enforcement + permission check ───────────────────────
    // Non-admin users: check canCreateOrder and enforce their own sector/region.
    if (req.user!.role !== 'ADMIN') {
      const scope = await getUserScope(req.user!.id, req.user!.role);
      if (!scope.canCreateOrder) return res.status(403).json({ error: 'ليس لديك صلاحية إنشاء أوامر عمل' });
      if (scope.sectorId) (coreReady as any).sectorId = scope.sectorId;
      if (scope.regionId) (coreReady as any).regionId = scope.regionId;
    }

    // ── Auto-compute financial fields ────────────────────────────────────────
    const finPost = computeFinancials(
      (coreReady as any).invoiceType,
      (coreReady as any).invoice1,
      (coreReady as any).invoice2,
      (coreReady as any).estimatedValue,
    );
    if (finPost) Object.assign(coreReady, finPost);

    // ── Auto-link contract (system-managed, never from user input) ───────────
    const postSectorId = (coreReady as any).sectorId ?? null;
    const postRefDate  = (coreReady as any).assignmentDate ?? (coreReady as any).createdAt ?? null;
    (coreReady as any).contractId = await resolveContractId(postSectorId, postRefDate);

    // ── Duplicate order number check ─────────────────────────────────────────
    const incomingOrderNumber = (coreReady as any).orderNumber?.toString().trim();
    if (incomingOrderNumber) {
      const [existing] = await db
        .select({ id: workOrders.id, projectType: workOrders.projectType, workType: workOrders.workType })
        .from(workOrders)
        .where(eq(workOrders.orderNumber, incomingOrderNumber))
        .limit(1);
      if (existing) {
        const incomingProjectType = (coreReady as any).projectType ?? null;
        const incomingWorkType    = (coreReady as any).workType ?? null;
        const sameProjectType = existing.projectType === incomingProjectType;
        const sameWorkType    = existing.workType    === incomingWorkType;
        if (sameProjectType && sameWorkType) {
          return res.status(409).json({ error: `رقم الأمر "${incomingOrderNumber}" موجود مسبقاً بنفس نوعية المشروع ونوع العمل` });
        }
      }
    }

    // dynamicFiltered goes into customFields for backward-compat reads, AND into
    // physical columns via raw SQL so reports/SQL queries can use them directly.
    const [newOrder] = await db.insert(workOrders).values({
      ...coreReady,
      customFields: dynamicFiltered,
      createdBy: req.user!.id,
      updatedBy: req.user!.id,
    }).returning();

    // Write to the physical columns (ALTER TABLE added) via raw SQL
    if (Object.keys(dynamicFiltered).length > 0) {
      await updateDynamicCols(newOrder.id, dynamicFiltered);
    }

    await db.insert(auditLogs).values({
      actorUserId: req.user!.id,
      entityType: 'WORK_ORDER',
      entityId: newOrder.id,
      action: 'CREATE',
      changes: { after: newOrder },
    });

    emitEvent(EventTypes.WORK_ORDER_CREATED, newOrder.id, req.user!.username, {
      orderNumber: (newOrder as any).orderNumber,
      stageId:     (newOrder as any).stageId,
      sectorId:    (newOrder as any).sectorId,
    });

    res.status(201).json(newOrder);
  } catch (err: any) {
    console.error('[WO POST ERROR]', err?.message || err);
    res.status(500).json({ error: 'Failed to create work order' });
  }
});

/**
 * Write dynamically-added physical columns (not in Drizzle schema) via raw SQL.
 * Also updates custom_fields JSONB so filterOutput reads still work.
 * @param id       work_order UUID
 * @param dynamic  snake_case key → value map from filterInput.dynamicFiltered
 */
async function updateDynamicCols(id: string, dynamic: Record<string, any>) {
  if (!pool) return;
  const ISO_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]+)?$/;
  const COL_KEY_RE = /^[a-z][a-z0-9_]*$/;
  const entries = Object.entries(dynamic).filter(([k, v]) => v !== undefined && COL_KEY_RE.test(k));
  if (!entries.length) return;

  // Build: col1 = $2, col2 = $3, ...
  const setClauses = entries.map(([k], i) => `"${k}" = $${i + 2}`).join(', ');
  const values = entries.map(([, v]) => {
    if (typeof v === 'string' && ISO_RE.test(v)) {
      const d = new Date(v);
      return isNaN(d.getTime()) ? v : d;
    }
    return v;
  });
  await pool.query(
    `UPDATE work_orders SET ${setClauses} WHERE id = $1`,
    [id, ...values],
  );
}

/** Convert any ISO date strings to Date objects so Drizzle doesn't crash */
function parseDates(obj: Record<string, any>): Record<string, any> {
  const ISO_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]+)?$/;
  const result: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && ISO_RE.test(v)) {
      const d = new Date(v);
      result[k] = isNaN(d.getTime()) ? v : d;
    } else {
      result[k] = v;
    }
  }
  return result;
}

router.put('/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const existing = await db.query.workOrders.findFirst({
      where: eq(workOrders.id, req.params.id),
    });

    if (!existing) return res.status(404).json({ error: 'Not found' });

    // Enforce region/sector scope — prevent editing orders outside the user's scope
    if (req.user!.role !== 'ADMIN') {
      const scope = await getUserScope(req.user!.id, req.user!.role);
      const existingAny = existing as any;
      if (scope.scopeType === 'OWN_REGION' && scope.regionId &&
          (existingAny.regionId ?? existingAny.region_id) !== scope.regionId) {
        return res.status(403).json({ error: 'Access denied: outside your region' });
      }
      if (scope.scopeType === 'OWN_SECTOR' && scope.sectorId &&
          (existingAny.sectorId ?? existingAny.sector_id) !== scope.sectorId) {
        return res.status(403).json({ error: 'Access denied: outside your sector' });
      }
    }

    const { coreFiltered, dynamicFiltered } = await filterInput(req.body, req.user!.id, req.user!.role, 'work_orders');

    // Auto-clear reason when justified = false
    if (coreFiltered.execDelayJustified === false) coreFiltered.execDelayReason = null;
    if (coreFiltered.finDelayJustified  === false) coreFiltered.finDelayReason  = null;

    // Convert date strings → Date objects for Drizzle
    const coreReady = parseDates(coreFiltered);

    // ── Auto-compute financial fields (merge incoming with existing) ──────────
    const finPut = computeFinancials(
      (coreReady as any).invoiceType     ?? (existing as any).invoiceType,
      (coreReady as any).invoice1        ?? (existing as any).invoice1,
      (coreReady as any).invoice2        ?? (existing as any).invoice2,
      (coreReady as any).estimatedValue  ?? (existing as any).estimatedValue,
    );
    if (finPut) Object.assign(coreReady, finPut);

    // ── Sector / Region enforcement ──────────────────────────────────────────
    // sectorId: always locked for non-admin.
    // regionId: locked for OWN_REGION; OWN_SECTOR may update only within their sector.
    if (req.user!.role !== 'ADMIN') {
      const scopeEdit = await getUserScope(req.user!.id, req.user!.role);
      delete (coreReady as any).sectorId;

      if (scopeEdit.scopeType === 'OWN_REGION') {
        delete (coreReady as any).regionId;
      } else if (
        scopeEdit.scopeType === 'OWN_SECTOR' &&
        (coreReady as any).regionId &&
        scopeEdit.sectorId
      ) {
        const validRegion = await db.query.regions.findFirst({
          where: and(
            eq(regions.id, (coreReady as any).regionId),
            eq(regions.sectorId, scopeEdit.sectorId)
          ),
        });
        if (!validRegion) delete (coreReady as any).regionId;
      }
      // scopeType === 'ALL': no restriction on regionId
    }

    // ── Re-resolve contract if sectorId or assignmentDate changed ────────────
    // contractId is system-managed — never accepted from user input.
    const putSectorId    = (coreReady as any).sectorId      ?? (existing as any).sectorId;
    const putAssignDate  = (coreReady as any).assignmentDate ?? (existing as any).assignmentDate ?? (existing as any).createdAt;
    const sectorChanged  = (coreReady as any).sectorId      !== undefined &&
                           (coreReady as any).sectorId      !== (existing as any).sectorId;
    const dateChanged    = (coreReady as any).assignmentDate !== undefined &&
                           String((coreReady as any).assignmentDate).slice(0, 10) !==
                           String((existing as any).assignmentDate ?? '').slice(0, 10);
    if (sectorChanged || dateChanged) {
      (coreReady as any).contractId = await resolveContractId(putSectorId, putAssignDate);
    }

    // Merge dynamic cols into existing customFields for backward-compat reads
    const currentCustomFields = typeof existing.customFields === 'string'
      ? JSON.parse(existing.customFields)
      : (existing.customFields || {});
    const mergedCustomFields = { ...currentCustomFields, ...dynamicFiltered };

    const [updated] = await db.update(workOrders)
      .set({
        ...coreReady,
        customFields: mergedCustomFields,
        updatedBy: req.user!.id,
        updatedAt: new Date(),
      })
      .where(eq(workOrders.id, req.params.id))
      .returning();

    // Write to physical columns via raw SQL
    if (Object.keys(dynamicFiltered).length > 0) {
      await updateDynamicCols(req.params.id, dynamicFiltered);
    }

    await db.insert(auditLogs).values({
      actorUserId: req.user!.id,
      entityType: 'WORK_ORDER',
      entityId: updated.id,
      action: 'UPDATE',
      changes: { before: existing, after: updated },
    });

    emitEvent(EventTypes.WORK_ORDER_UPDATED, updated.id, req.user!.username, {
      orderNumber: (updated as any).orderNumber,
      stageId:     (updated as any).stageId,
    });

    // Emit stage_changed only when stageId actually changed
    if ((existing as any).stageId !== (updated as any).stageId) {
      emitEvent(EventTypes.WORK_ORDER_STAGE_CHANGED, updated.id, req.user!.username, {
        orderNumber:    (updated as any).orderNumber,
        previousStageId:(existing as any).stageId,
        newStageId:     (updated as any).stageId,
      });
    }

    res.json(updated);
  } catch (err: any) {
    console.error('[WO PUT ERROR]', err?.message || err);
    res.status(500).json({ error: 'Failed to update work order' });
  }
});

router.delete('/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    // ── Permission: canDeleteOrder ───────────────────────────────────────────
    if (req.user!.role !== 'ADMIN') {
      const scope = await getUserScope(req.user!.id, req.user!.role);
      if (!scope.canDeleteOrder) return res.status(403).json({ error: 'ليس لديك صلاحية حذف أوامر العمل' });
    }

    const existing = await db.query.workOrders.findFirst({
      where: eq(workOrders.id, req.params.id),
    });

    if (!existing) return res.status(404).json({ error: 'Not found' });

    await db.delete(workOrders).where(eq(workOrders.id, req.params.id));

    await db.insert(auditLogs).values({
      actorUserId: req.user!.id,
      entityType: 'WORK_ORDER',
      entityId: req.params.id,
      action: 'DELETE',
      changes: { before: existing },
    });

    res.json({ message: 'Deleted' });
  } catch (err: any) {
    console.error('[WO DELETE ERROR]', err?.message || err);
    res.status(500).json({ error: 'Failed to delete work order' });
  }
});

// GET audit history for a work order (with actor user info)
router.get('/:id/history', authenticate, async (req: AuthRequest, res) => {
  try {
    const logs = await db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        changes: auditLogs.changes,
        createdAt: auditLogs.createdAt,
        actorUserId: auditLogs.actorUserId,
        actorUsername: users.username,
        actorFullName: users.fullName,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.actorUserId, users.id))
      .where(eq(auditLogs.entityId, req.params.id))
      .orderBy(desc(auditLogs.createdAt));

    // Build diff for each UPDATE entry
    const result = logs.map(log => {
      let diff: Array<{ key: string; before: any; after: any }> = [];
      if (log.action === 'UPDATE' && log.changes) {
        const changes = log.changes as any;
        const before = changes.before ?? {};
        const after = changes.after ?? {};
        const SKIP = new Set(['updatedAt', 'updated_at', 'updatedBy', 'updated_by', 'createdAt', 'created_at', 'id', 'customFields', 'attachments']);
        for (const key of Object.keys(after)) {
          if (SKIP.has(key)) continue;
          const bVal = before[key];
          const aVal = after[key];
          if (JSON.stringify(bVal) !== JSON.stringify(aVal)) {
            diff.push({ key, before: bVal, after: aVal });
          }
        }
      }
      return { ...log, diff };
    });

    res.json(result);
  } catch (err) {
    console.error('[WO HISTORY ERROR]', err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// GET notes for a work order
router.get('/:id/notes', authenticate, async (req: AuthRequest, res) => {
  try {
    const notes = await db
      .select({
        id: workOrderNotes.id,
        content: workOrderNotes.content,
        createdAt: workOrderNotes.createdAt,
        userId: workOrderNotes.userId,
        authorUsername: users.username,
        authorFullName: users.fullName,
      })
      .from(workOrderNotes)
      .leftJoin(users, eq(workOrderNotes.userId, users.id))
      .where(eq(workOrderNotes.workOrderId, req.params.id))
      .orderBy(asc(workOrderNotes.createdAt));
    res.json(notes);
  } catch (err) {
    console.error('[WO NOTES GET ERROR]', err);
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

// POST a new note for a work order
router.post('/:id/notes', authenticate, async (req: AuthRequest, res) => {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'الملاحظة لا يمكن أن تكون فارغة' });
    }
    // Verify work order exists
    const [wo] = await db.select({ id: workOrders.id }).from(workOrders).where(eq(workOrders.id, req.params.id));
    if (!wo) return res.status(404).json({ error: 'Work order not found' });

    const [note] = await db.insert(workOrderNotes).values({
      workOrderId: req.params.id,
      userId: req.user!.id,
      content: content.trim(),
    }).returning({
      id: workOrderNotes.id,
      content: workOrderNotes.content,
      createdAt: workOrderNotes.createdAt,
      userId: workOrderNotes.userId,
    });

    const noteResponse = {
      ...note,
      authorUsername: req.user!.username,
      authorFullName: req.user!.fullName,
    };

    emitEvent(EventTypes.COMMENT_CREATED, req.params.id, req.user!.username, {
      noteId:       note.id,
      workOrderId:  req.params.id,
      contentLength: note.content?.length,
    });

    res.json(noteResponse);
  } catch (err) {
    console.error('[WO NOTES POST ERROR]', err);
    res.status(500).json({ error: 'Failed to add note' });
  }
});

// GET attachments for a work order
router.get('/:id/attachments', authenticate, async (req: AuthRequest, res) => {
  try {
    const rows = await db
      .select({
        id: workOrderAttachments.id,
        name: workOrderAttachments.name,
        url: workOrderAttachments.url,
        createdAt: workOrderAttachments.createdAt,
        userId: workOrderAttachments.userId,
        uploaderUsername: users.username,
        uploaderFullName: users.fullName,
      })
      .from(workOrderAttachments)
      .leftJoin(users, eq(workOrderAttachments.userId, users.id))
      .where(eq(workOrderAttachments.workOrderId, req.params.id))
      .orderBy(desc(workOrderAttachments.createdAt));
    res.json(rows);
  } catch (err) {
    console.error('[WO ATTACHMENTS GET ERROR]', err);
    res.status(500).json({ error: 'Failed to fetch attachments' });
  }
});

// POST a new attachment
router.post('/:id/attachments', authenticate, async (req: AuthRequest, res) => {
  try {
    const { name, url } = req.body;
    if (!name?.trim() || !url?.trim()) {
      return res.status(400).json({ error: 'اسم المرفق والرابط مطلوبان' });
    }
    const [wo] = await db.select({ id: workOrders.id }).from(workOrders).where(eq(workOrders.id, req.params.id));
    if (!wo) return res.status(404).json({ error: 'Work order not found' });

    const [att] = await db.insert(workOrderAttachments).values({
      workOrderId: req.params.id,
      userId: req.user!.id,
      name: name.trim(),
      url: url.trim(),
    }).returning();

    res.json({
      ...att,
      uploaderUsername: req.user!.username,
      uploaderFullName: req.user!.fullName,
    });
  } catch (err) {
    console.error('[WO ATTACHMENTS POST ERROR]', err);
    res.status(500).json({ error: 'Failed to add attachment' });
  }
});

// DELETE an attachment
router.delete('/:id/attachments/:attId', authenticate, async (req: AuthRequest, res) => {
  try {
    // Fetch the attachment first so we know the URL before deleting the record
    const [att] = await db.select({ url: workOrderAttachments.url })
      .from(workOrderAttachments)
      .where(and(
        eq(workOrderAttachments.id, req.params.attId),
        eq(workOrderAttachments.workOrderId, req.params.id)
      ));

    if (!att) return res.status(404).json({ error: 'المرفق غير موجود' });

    // Delete the DB record first
    await db.delete(workOrderAttachments)
      .where(and(
        eq(workOrderAttachments.id, req.params.attId),
        eq(workOrderAttachments.workOrderId, req.params.id)
      ));

    // If it's a local file, delete from filesystem (fire-and-forget — don't fail the request)
    if (att.url.startsWith('/objects/')) {
      const filename = path.basename(att.url);
      const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
      const filePath  = path.join(uploadDir, filename);
      unlink(filePath).catch((err) => {
        if (err.code !== 'ENOENT') {
          console.error('[LOCAL DELETE ERROR] Failed to delete file:', filePath, err.message);
        }
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[WO ATTACHMENTS DELETE ERROR]', err);
    res.status(500).json({ error: 'فشل في حذف المرفق' });
  }
});

// ─── Excavation Permits ───────────────────────────────────────────────────────

async function getExcavationPerms(userId: string, roleKey: string) {
  const scope = await getUserScope(userId, roleKey);
  return {
    canView:   scope.canViewExcavationPermits,
    canEdit:   scope.canEditExcavationPermits,
    canDelete: scope.canDeleteExcavationPermits,
  };
}

function toDateOnly(val: string | Date | null | undefined): string | null {
  if (val == null) return null;
  const d = val instanceof Date ? val : new Date(String(val));
  return d.toLocaleDateString('sv'); // YYYY-MM-DD in server local time (TZ=Asia/Riyadh)
}

function validatePermitDates(
  startDate: string | null | undefined,
  endDate:   string | null | undefined,
  assignmentDate: string | null | undefined,
): string | null {
  if (!startDate) return 'تاريخ البداية مطلوب';
  if (!endDate)   return 'تاريخ الانتهاء مطلوب';
  const ad = toDateOnly(assignmentDate);
  if (ad && startDate < ad) return 'تاريخ البداية لا يمكن أن يكون قبل تاريخ إسناد أمر العمل';
  if (endDate < startDate)  return 'تاريخ الانتهاء لا يمكن أن يكون قبل تاريخ البداية';
  return null;
}

function permitStatus(startDate: string | null, endDate: string | null): string {
  const today = toDateOnly(new Date())!;
  if (endDate && today > endDate) return 'منتهي';
  if (startDate && startDate > today) return 'لم يبدأ بعد';
  if (!endDate) return 'ساري';
  const warnD = new Date(endDate + 'T12:00:00');
  warnD.setDate(warnD.getDate() - 5);
  const warn = toDateOnly(warnD)!;
  if (today >= warn) return 'شارف على الانتهاء';
  return 'ساري';
}

function enrichPermit(p: any) {
  return { ...p, status: permitStatus(p.startDate ?? p.start_date, p.endDate ?? p.end_date) };
}

// GET /api/work-orders/:id/excavation-permits
router.get('/:id/excavation-permits', authenticate, async (req: AuthRequest, res) => {
  try {
    const perms = await getExcavationPerms(req.user!.id, req.user!.role);
    if (!perms.canView) return res.status(403).json({ error: 'ليس لديك صلاحية عرض التصاريح' });
    const rows = await db.select().from(excavationPermits)
      .where(eq(excavationPermits.workOrderId, req.params.id))
      .orderBy(asc(excavationPermits.createdAt));
    res.json(rows.map(enrichPermit));
  } catch (err) {
    console.error('[EXCAVATION GET ERROR]', err);
    res.status(500).json({ error: 'Failed to fetch permits' });
  }
});

// POST /api/work-orders/:id/excavation-permits
router.post('/:id/excavation-permits', authenticate, async (req: AuthRequest, res) => {
  try {
    const perms = await getExcavationPerms(req.user!.id, req.user!.role);
    if (!perms.canEdit) return res.status(403).json({ error: 'ليس لديك صلاحية إضافة التصاريح' });
    const { permitNo, startDate, endDate } = req.body;
    if (!permitNo) return res.status(400).json({ error: 'permit_no مطلوب' });
    const [wo] = await db.select({ assignmentDate: workOrders.assignmentDate })
      .from(workOrders).where(eq(workOrders.id, req.params.id)).limit(1);
    const validErr = validatePermitDates(startDate, endDate, wo?.assignmentDate ? String(wo.assignmentDate) : null);
    if (validErr) return res.status(400).json({ error: validErr });
    const [row] = await db.insert(excavationPermits).values({
      workOrderId: req.params.id,
      permitNo,
      startDate,
      endDate,
      extensionNumber: 0,
      isExtension: false,
    }).returning();
    res.json(enrichPermit(row));
  } catch (err) {
    console.error('[EXCAVATION POST ERROR]', err);
    res.status(500).json({ error: 'Failed to create permit' });
  }
});

// PUT /api/work-orders/:id/excavation-permits/:permitId
router.put('/:id/excavation-permits/:permitId', authenticate, async (req: AuthRequest, res) => {
  try {
    const perms = await getExcavationPerms(req.user!.id, req.user!.role);
    if (!perms.canEdit) return res.status(403).json({ error: 'ليس لديك صلاحية تعديل التصاريح' });
    const { permitNo, startDate, endDate } = req.body;
    const [wo] = await db.select({ assignmentDate: workOrders.assignmentDate })
      .from(workOrders).where(eq(workOrders.id, req.params.id)).limit(1);
    const validErr = validatePermitDates(startDate, endDate, wo?.assignmentDate ? String(wo.assignmentDate) : null);
    if (validErr) return res.status(400).json({ error: validErr });
    const [row] = await db.update(excavationPermits)
      .set({
        permitNo:  permitNo  ?? undefined,
        startDate,
        endDate,
      })
      .where(and(
        eq(excavationPermits.id, req.params.permitId),
        eq(excavationPermits.workOrderId, req.params.id),
      ))
      .returning();
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(enrichPermit(row));
  } catch (err) {
    console.error('[EXCAVATION PUT ERROR]', err);
    res.status(500).json({ error: 'Failed to update permit' });
  }
});

// DELETE /api/work-orders/:id/excavation-permits/:permitId
router.delete('/:id/excavation-permits/:permitId', authenticate, async (req: AuthRequest, res) => {
  try {
    const perms = await getExcavationPerms(req.user!.id, req.user!.role);
    if (!perms.canDelete) return res.status(403).json({ error: 'ليس لديك صلاحية حذف التصاريح' });
    await db.delete(excavationPermits)
      .where(and(
        eq(excavationPermits.id, req.params.permitId),
        eq(excavationPermits.workOrderId, req.params.id),
      ));
    res.json({ ok: true });
  } catch (err) {
    console.error('[EXCAVATION DELETE ERROR]', err);
    res.status(500).json({ error: 'Failed to delete permit' });
  }
});

// POST /api/work-orders/:id/excavation-permits/:permitId/extend
router.post('/:id/excavation-permits/:permitId/extend', authenticate, async (req: AuthRequest, res) => {
  try {
    const perms = await getExcavationPerms(req.user!.id, req.user!.role);
    if (!perms.canEdit) return res.status(403).json({ error: 'ليس لديك صلاحية إضافة تمديد' });
    const [original] = await db.select().from(excavationPermits)
      .where(and(
        eq(excavationPermits.id, req.params.permitId),
        eq(excavationPermits.workOrderId, req.params.id),
      ))
      .limit(1);
    if (!original) return res.status(404).json({ error: 'التصريح غير موجود' });

    const siblings = await db.select().from(excavationPermits)
      .where(and(
        eq(excavationPermits.workOrderId, req.params.id),
        eq(excavationPermits.permitNo, original.permitNo),
      ));
    const maxExt = Math.max(...siblings.map((s: any) => s.extensionNumber ?? 0));
    if (maxExt >= 5) return res.status(400).json({ error: 'الحد الأقصى للتمديدات هو 5' });

    const { startDate, endDate } = req.body;
    if (!startDate) return res.status(400).json({ error: 'تاريخ البداية مطلوب' });
    if (!endDate)   return res.status(400).json({ error: 'تاريخ الانتهاء مطلوب' });

    const lastSibling = siblings.find((s: any) => s.extensionNumber === maxExt);
    if (lastSibling?.endDate) {
      const lastEnd = toDateOnly(String(lastSibling.endDate));
      if (lastEnd && startDate < lastEnd) {
        return res.status(400).json({ error: 'تاريخ بداية التمديد لا يمكن أن يكون قبل نهاية التصريح السابق' });
      }
    }

    const [wo] = await db.select({ assignmentDate: workOrders.assignmentDate })
      .from(workOrders).where(eq(workOrders.id, req.params.id)).limit(1);
    const validErr = validatePermitDates(startDate, endDate, wo?.assignmentDate ? String(wo.assignmentDate) : null);
    if (validErr) return res.status(400).json({ error: validErr });

    const [row] = await db.insert(excavationPermits).values({
      workOrderId: req.params.id,
      permitNo: original.permitNo,
      startDate,
      endDate,
      extensionNumber: maxExt + 1,
      isExtension: true,
    }).returning();
    res.json(enrichPermit(row));
  } catch (err) {
    console.error('[EXCAVATION EXTEND ERROR]', err);
    res.status(500).json({ error: 'Failed to create extension' });
  }
});

export default router;
