import express from 'express';
import { db, pool } from '../db';
import { contracts, contractAttachments, workOrders, sectors, users, auditLogs, regions, roleDefinitions } from '../db/schema';
import { authenticate, AuthRequest } from '../middleware/auth';
import { eq, and, isNull, isNotNull, or, sql, gte, lte } from 'drizzle-orm';

const router = express.Router();

// ─── Permission helpers ───────────────────────────────────────────────────────

async function requireCanView(req: AuthRequest, res: express.Response): Promise<boolean> {
  if (req.user!.role === 'ADMIN') return true;
  const { roleDefinitions } = await import('../db/schema');
  const roleDef = await db.query.roleDefinitions.findFirst({
    where: eq(roleDefinitions.roleKey, req.user!.role),
  });
  if (!roleDef?.canViewContracts) {
    res.status(403).json({ error: 'ليس لديك صلاحية عرض العقود' });
    return false;
  }
  return true;
}

async function requireCanManage(req: AuthRequest, res: express.Response): Promise<boolean> {
  if (req.user!.role === 'ADMIN') return true;
  const { roleDefinitions } = await import('../db/schema');
  const roleDef = await db.query.roleDefinitions.findFirst({
    where: eq(roleDefinitions.roleKey, req.user!.role),
  });
  if (!roleDef?.canManageContracts) {
    res.status(403).json({ error: 'ليس لديك صلاحية إدارة العقود' });
    return false;
  }
  return true;
}

// ─── Scope helper ────────────────────────────────────────────────────────────
async function getContractScope(userId: string) {
  const u = await db.query.users.findFirst({ where: eq(users.id, userId) });
  const roleDef = await db.query.roleDefinitions.findFirst({
    where: eq(roleDefinitions.roleKey, (u as any)?.role ?? ''),
  });
  const scopeType = roleDef?.scopeType ?? 'ALL';
  let sectorId: string | null = (u as any)?.sectorId ?? null;
  if (!sectorId && (u as any)?.regionId) {
    const reg = await db.query.regions.findFirst({
      where: eq(regions.id, (u as any).regionId),
    });
    sectorId = (reg as any)?.sectorId ?? null;
  }
  return { scopeType, sectorId, isOwnRegion: scopeType === 'OWN_REGION' };
}

// ─── resolveContractId ────────────────────────────────────────────────────────
// Given a sectorId and a reference date, returns the matching active contract id or null.
// Used by workOrders create/update to auto-link.

export async function resolveContractId(
  sectorId: string | null | undefined,
  referenceDate: Date | string | null | undefined,
): Promise<string | null> {
  if (!sectorId || !referenceDate) return null;

  const dateStr = referenceDate instanceof Date
    ? referenceDate.toISOString().slice(0, 10)
    : String(referenceDate).slice(0, 10);

  if (!pool) return null;

  const { rows } = await pool.query(
    `SELECT id FROM contracts
     WHERE sector_id = $1
       AND start_date <= $2::date
       AND end_date   >= $2::date
       AND archived_at IS NULL
     ORDER BY start_date DESC
     LIMIT 1`,
    [sectorId, dateStr],
  ) as any;

  return rows[0]?.id ?? null;
}

// ─── API-level overlap check ──────────────────────────────────────────────────
// Returns the conflicting contract if any; otherwise null.
async function checkOverlap(
  sectorId: string,
  startDate: string,
  endDate: string,
  excludeId?: string,
): Promise<{ id: string; contractNumber: string; startDate: string; endDate: string } | null> {
  if (!pool) return null;

  const { rows } = (await pool.query(
    `SELECT id, contract_number, start_date::text, end_date::text
     FROM contracts
     WHERE sector_id   = $1
       AND archived_at IS NULL
       AND start_date <= $3::date
       AND end_date   >= $2::date
       ${excludeId ? 'AND id <> $4' : ''}
     LIMIT 1`,
    excludeId
      ? [sectorId, startDate, endDate, excludeId]
      : [sectorId, startDate, endDate],
  )) as any;

  if (!rows[0]) return null;
  return {
    id:             rows[0].id,
    contractNumber: rows[0].contract_number,
    startDate:      rows[0].start_date,
    endDate:        rows[0].end_date,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/contracts
// List all contracts (with sector name), optional ?sectorId= & ?archived=true
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/', authenticate, async (req: AuthRequest, res) => {
  if (!await requireCanView(req, res)) return;
  try {
    const { sectorId, archived } = req.query as Record<string, string>;
    const showArchived = archived === 'true';
    const scope = req.user!.role !== 'ADMIN' ? await getContractScope(req.user!.id) : null;
    const scopeFilter = scope && scope.scopeType !== 'ALL' ? scope.sectorId : null;

    const result = await pool!.query(
      `SELECT c.*,
              c.start_date::text, c.end_date::text,
              s.name_ar AS sector_name_ar, s.name_en AS sector_name_en,
              (SELECT COUNT(*) FROM contract_attachments ca WHERE ca.contract_id = c.id)::text AS attachment_count,
              (SELECT COUNT(*) FROM work_orders wo WHERE wo.contract_id = c.id)::text AS wo_count
       FROM contracts c
       LEFT JOIN sectors s ON s.id = c.sector_id
       WHERE ($1::uuid IS NULL OR c.sector_id = $1)
         AND ($2::boolean OR c.archived_at IS NULL)
         AND ($3::uuid IS NULL OR c.sector_id = $3)
       ORDER BY s.name_ar, c.start_date DESC`,
      [sectorId || null, showArchived, scopeFilter],
    ) as any;
    const rows = result.rows;

    res.json(rows.map((r: any) => ({
      id:             r.id,
      sectorId:       r.sector_id,
      contractNumber: r.contract_number,
      startDate:      r.start_date,
      endDate:        r.end_date,
      notes:          r.notes,
      archivedAt:     r.archived_at,
      createdBy:      r.created_by,
      createdAt:      r.created_at,
      updatedAt:      r.updated_at,
      sectorNameAr:   r.sector_name_ar,
      sectorNameEn:   r.sector_name_en,
      attachmentCount: Number(r.attachment_count),
      woCount:         Number(r.wo_count),
    })));
  } catch (err) {
    console.error('[GET /contracts]', err);
    res.status(500).json({ error: 'Failed to fetch contracts' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/contracts/unlinked-orders
// Returns work orders not linked to any contract, categorised by reason.
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/unlinked-orders', authenticate, async (req: AuthRequest, res) => {
  if (!await requireCanView(req, res)) return;
  try {
    const scope = req.user!.role !== 'ADMIN' ? await getContractScope(req.user!.id) : null;
    const scopeFilter = scope && scope.scopeType !== 'ALL' ? scope.sectorId : null;
    const { rows } = (await pool!.query(
      `SELECT
         wo.id,
         wo.order_number,
         wo.sector_id,
         wo.assignment_date::text,
         wo.created_at::text,
         s.name_ar AS sector_name_ar,
         CASE
           WHEN wo.sector_id IS NULL                     THEN 'missing_data'
           WHEN wo.assignment_date IS NULL
                AND wo.created_at IS NULL                THEN 'missing_data'
           WHEN wo.assignment_date IS NULL               THEN 'no_assignment_date'
           ELSE                                               'no_contract_coverage'
         END AS unlink_reason
       FROM work_orders wo
       LEFT JOIN sectors s ON s.id = wo.sector_id
       WHERE wo.contract_id IS NULL
         AND wo.status <> 'CANCELLED'
         AND ($1::uuid IS NULL OR wo.sector_id = $1)
       ORDER BY unlink_reason, wo.created_at DESC`,
      [scopeFilter],
    )) as any;

    const summary = {
      total: rows.length,
      byReason: {
        no_assignment_date:   rows.filter((r: any) => r.unlink_reason === 'no_assignment_date').length,
        no_contract_coverage: rows.filter((r: any) => r.unlink_reason === 'no_contract_coverage').length,
        missing_data:         rows.filter((r: any) => r.unlink_reason === 'missing_data').length,
      },
    };

    res.json({
      summary,
      orders: rows.map((r: any) => ({
        id:             r.id,
        orderNumber:    r.order_number,
        sectorId:       r.sector_id,
        sectorNameAr:   r.sector_name_ar,
        assignmentDate: r.assignment_date,
        createdAt:      r.created_at,
        unlinkReason:   r.unlink_reason,
      })),
    });
  } catch (err) {
    console.error('[GET /contracts/unlinked-orders]', err);
    res.status(500).json({ error: 'Failed to fetch unlinked orders' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/contracts/relink/preview
// Dry-run: shows what would change if relink runs for a sector/period.
// Body: { sectorId, fromDate?, toDate? }
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/relink/preview', authenticate, async (req: AuthRequest, res) => {
  if (!await requireCanManage(req, res)) return;
  try {
    const scope = req.user!.role !== 'ADMIN' ? await getContractScope(req.user!.id) : null;
    if (scope?.isOwnRegion) return res.status(403).json({ error: 'ليس لديك صلاحية إدارة العقود' });
    const scopeFilter = scope && scope.scopeType !== 'ALL' ? scope.sectorId : null;
    const { sectorId: bodySectorId, fromDate, toDate } = req.body as {
      sectorId?: string; fromDate?: string; toDate?: string;
    };
    const sectorId = scopeFilter ?? bodySectorId;
    if (!sectorId) return res.status(400).json({ error: 'sectorId مطلوب' });

    const { rows } = (await pool!.query(
      `SELECT
         wo.id,
         wo.order_number,
         wo.assignment_date::text,
         wo.created_at::text,
         wo.contract_id AS current_contract_id,
         c.id           AS new_contract_id,
         c.contract_number AS new_contract_number
       FROM work_orders wo
       LEFT JOIN LATERAL (
         SELECT id, contract_number FROM contracts
         WHERE sector_id   = wo.sector_id
           AND archived_at IS NULL
           AND start_date <= COALESCE(wo.assignment_date::date, wo.created_at::date)
           AND end_date   >= COALESCE(wo.assignment_date::date, wo.created_at::date)
         ORDER BY start_date DESC
         LIMIT 1
       ) c ON TRUE
       WHERE wo.sector_id = $1
         AND wo.status <> 'CANCELLED'
         AND ($2::date IS NULL OR COALESCE(wo.assignment_date::date, wo.created_at::date) >= $2::date)
         AND ($3::date IS NULL OR COALESCE(wo.assignment_date::date, wo.created_at::date) <= $3::date)`,
      [sectorId, fromDate || null, toDate || null],
    )) as any;

    const willChange  = rows.filter((r: any) => r.current_contract_id !== r.new_contract_id);
    const willStayUnlinked = willChange.filter((r: any) => r.new_contract_id === null);

    res.json({
      total:           rows.length,
      willChange:      willChange.length,
      willStayUnlinked: willStayUnlinked.length,
      changes: willChange.map((r: any) => ({
        id:                  r.id,
        orderNumber:         r.order_number,
        assignmentDate:      r.assignment_date,
        currentContractId:   r.current_contract_id,
        newContractId:       r.new_contract_id,
        newContractNumber:   r.new_contract_number,
      })),
    });
  } catch (err) {
    console.error('[POST /contracts/relink/preview]', err);
    res.status(500).json({ error: 'Failed to generate relink preview' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/contracts/relink/execute
// Execute the relink for a specific sector/period (Admin/canManageContracts only).
// Body: { sectorId, fromDate?, toDate? }
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/relink/execute', authenticate, async (req: AuthRequest, res) => {
  if (!await requireCanManage(req, res)) return;
  try {
    const scope = req.user!.role !== 'ADMIN' ? await getContractScope(req.user!.id) : null;
    if (scope?.isOwnRegion) return res.status(403).json({ error: 'ليس لديك صلاحية إدارة العقود' });
    const scopeFilter = scope && scope.scopeType !== 'ALL' ? scope.sectorId : null;
    const { sectorId: bodySectorId, fromDate, toDate } = req.body as {
      sectorId?: string; fromDate?: string; toDate?: string;
    };
    const sectorId = scopeFilter ?? bodySectorId;
    if (!sectorId) return res.status(400).json({ error: 'sectorId مطلوب' });

    const { rowCount } = await pool!.query(
      `UPDATE work_orders wo
       SET contract_id = c.contract_id,
           updated_at  = NOW()
       FROM (
         SELECT
           wo2.id AS wo_id,
           (SELECT id FROM contracts
            WHERE sector_id   = wo2.sector_id
              AND archived_at IS NULL
              AND start_date <= COALESCE(wo2.assignment_date::date, wo2.created_at::date)
              AND end_date   >= COALESCE(wo2.assignment_date::date, wo2.created_at::date)
            ORDER BY start_date DESC
            LIMIT 1
           ) AS contract_id
         FROM work_orders wo2
         WHERE wo2.sector_id = $1
           AND wo2.status <> 'CANCELLED'
           AND ($2::date IS NULL OR COALESCE(wo2.assignment_date::date, wo2.created_at::date) >= $2::date)
           AND ($3::date IS NULL OR COALESCE(wo2.assignment_date::date, wo2.created_at::date) <= $3::date)
       ) c
       WHERE wo.id = c.wo_id
         AND (wo.contract_id IS DISTINCT FROM c.contract_id)`,
      [sectorId, fromDate || null, toDate || null],
    );

    await db.insert(auditLogs).values({
      actorUserId: req.user!.id,
      entityType:  'CONTRACT',
      action:      'RELINK',
      changes:     { sectorId, fromDate, toDate, updatedCount: rowCount },
    });

    res.json({ updated: rowCount ?? 0 });
  } catch (err) {
    console.error('[POST /contracts/relink/execute]', err);
    res.status(500).json({ error: 'Failed to execute relink' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/contracts/:id
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/:id', authenticate, async (req: AuthRequest, res) => {
  if (!await requireCanView(req, res)) return;
  try {
    const scope = req.user!.role !== 'ADMIN' ? await getContractScope(req.user!.id) : null;
    const scopeFilter = scope && scope.scopeType !== 'ALL' ? scope.sectorId : null;
    const { rows } = await pool!.query(
      `SELECT c.*, c.start_date::text, c.end_date::text,
              s.name_ar AS sector_name_ar, s.name_en AS sector_name_en
       FROM contracts c
       LEFT JOIN sectors s ON s.id = c.sector_id
       WHERE c.id = $1`,
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'العقد غير موجود' });
    const r = rows[0];
    if (scopeFilter && r.sector_id !== scopeFilter) {
      return res.status(403).json({ error: 'ليس لديك صلاحية على هذا العقد' });
    }
    res.json({
      id: r.id, sectorId: r.sector_id, contractNumber: r.contract_number,
      startDate: r.start_date, endDate: r.end_date, notes: r.notes,
      archivedAt: r.archived_at, createdBy: r.created_by,
      createdAt: r.created_at, updatedAt: r.updated_at,
      sectorNameAr: r.sector_name_ar, sectorNameEn: r.sector_name_en,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch contract' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/contracts
// Create a new contract
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/', authenticate, async (req: AuthRequest, res) => {
  if (!await requireCanManage(req, res)) return;
  try {
    const scope = req.user!.role !== 'ADMIN' ? await getContractScope(req.user!.id) : null;
    if (scope?.isOwnRegion) return res.status(403).json({ error: 'ليس لديك صلاحية إدارة العقود' });
    const scopeFilter = scope && scope.scopeType !== 'ALL' ? scope.sectorId : null;
    const { sectorId: bodySectorId, contractNumber, startDate, endDate, notes } = req.body as {
      sectorId: string; contractNumber: string;
      startDate: string; endDate: string; notes?: string;
    };
    const sectorId = scopeFilter ?? bodySectorId;

    if (!sectorId || !contractNumber || !startDate || !endDate)
      return res.status(400).json({ error: 'sectorId, contractNumber, startDate, endDate مطلوبة' });

    if (new Date(endDate) < new Date(startDate))
      return res.status(400).json({ error: 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية' });

    // API-level overlap check
    const conflict = await checkOverlap(sectorId, startDate, endDate);
    if (conflict) {
      return res.status(409).json({
        error: `يتعارض مع عقد موجود: رقم ${conflict.contractNumber} (${conflict.startDate} — ${conflict.endDate})`,
        conflict,
      });
    }

    const [created] = await db.insert(contracts).values({
      sectorId, contractNumber, startDate, endDate,
      notes: notes ?? null,
      createdBy: req.user!.id,
    }).returning();

    await db.insert(auditLogs).values({
      actorUserId: req.user!.id,
      entityType:  'CONTRACT',
      action:      'CREATE',
      entityId:    (created as any).id,
      changes:     { after: created },
    });

    res.status(201).json(created);
  } catch (err: any) {
    // Catch DB-level EXCLUDE violation as extra safety net
    if (err?.code === '23P01') {
      return res.status(409).json({ error: 'يتعارض مع عقد موجود في نفس القطاع والفترة الزمنية' });
    }
    console.error('[POST /contracts]', err);
    res.status(500).json({ error: 'Failed to create contract' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUT /api/contracts/:id
// Update contract (number, dates, notes). Checks overlap after update.
// ═══════════════════════════════════════════════════════════════════════════════
router.put('/:id', authenticate, async (req: AuthRequest, res) => {
  if (!await requireCanManage(req, res)) return;
  try {
    const scope = req.user!.role !== 'ADMIN' ? await getContractScope(req.user!.id) : null;
    if (scope?.isOwnRegion) return res.status(403).json({ error: 'ليس لديك صلاحية إدارة العقود' });
    const scopeFilter = scope && scope.scopeType !== 'ALL' ? scope.sectorId : null;
    const existing = await db.query.contracts.findFirst({
      where: eq(contracts.id, req.params.id),
    });
    if (!existing) return res.status(404).json({ error: 'العقد غير موجود' });
    if (scopeFilter && (existing as any).sectorId !== scopeFilter)
      return res.status(403).json({ error: 'ليس لديك صلاحية على هذا العقد' });
    if ((existing as any).archivedAt)
      return res.status(400).json({ error: 'لا يمكن تعديل عقد مؤرشف' });

    const { contractNumber, startDate, endDate, notes } = req.body as {
      contractNumber?: string; startDate?: string; endDate?: string; notes?: string;
    };

    const newStart = startDate ?? String((existing as any).startDate).slice(0, 10);
    const newEnd   = endDate   ?? String((existing as any).endDate).slice(0, 10);

    if (new Date(newEnd) < new Date(newStart))
      return res.status(400).json({ error: 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية' });

    // API-level overlap check (exclude self)
    const conflict = await checkOverlap((existing as any).sectorId, newStart, newEnd, req.params.id);
    if (conflict) {
      return res.status(409).json({
        error: `يتعارض مع عقد موجود: رقم ${conflict.contractNumber} (${conflict.startDate} — ${conflict.endDate})`,
        conflict,
      });
    }

    const [updated] = await db.update(contracts)
      .set({
        ...(contractNumber !== undefined && { contractNumber }),
        ...(startDate      !== undefined && { startDate }),
        ...(endDate        !== undefined && { endDate }),
        ...(notes          !== undefined && { notes }),
        updatedAt: new Date(),
      })
      .where(eq(contracts.id, req.params.id))
      .returning();

    await db.insert(auditLogs).values({
      actorUserId: req.user!.id,
      entityType:  'CONTRACT',
      action:      'UPDATE',
      entityId:    req.params.id,
      changes:     { before: existing, after: updated },
    });

    res.json(updated);
  } catch (err: any) {
    if (err?.code === '23P01') {
      return res.status(409).json({ error: 'يتعارض مع عقد موجود في نفس القطاع والفترة الزمنية' });
    }
    console.error('[PUT /contracts/:id]', err);
    res.status(500).json({ error: 'Failed to update contract' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/contracts/:id/archive   — soft delete
// POST /api/contracts/:id/unarchive — restore
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/:id/archive', authenticate, async (req: AuthRequest, res) => {
  if (!await requireCanManage(req, res)) return;
  try {
    const scope = req.user!.role !== 'ADMIN' ? await getContractScope(req.user!.id) : null;
    if (scope?.isOwnRegion) return res.status(403).json({ error: 'ليس لديك صلاحية إدارة العقود' });
    const scopeFilter = scope && scope.scopeType !== 'ALL' ? scope.sectorId : null;
    if (scopeFilter) {
      const c = await db.query.contracts.findFirst({ where: eq(contracts.id, req.params.id) });
      if (!c || (c as any).sectorId !== scopeFilter)
        return res.status(403).json({ error: 'ليس لديك صلاحية على هذا العقد' });
    }
    const [updated] = await db.update(contracts)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(contracts.id, req.params.id), isNull(contracts.archivedAt)))
      .returning();

    if (!updated) return res.status(404).json({ error: 'العقد غير موجود أو مؤرشف مسبقاً' });

    await db.insert(auditLogs).values({
      actorUserId: req.user!.id, entityType: 'CONTRACT',
      action: 'ARCHIVE', entityId: req.params.id,
    });

    res.json({ archived: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to archive contract' });
  }
});

router.post('/:id/unarchive', authenticate, async (req: AuthRequest, res) => {
  if (!await requireCanManage(req, res)) return;
  try {
    const scope = req.user!.role !== 'ADMIN' ? await getContractScope(req.user!.id) : null;
    if (scope?.isOwnRegion) return res.status(403).json({ error: 'ليس لديك صلاحية إدارة العقود' });
    const scopeFilter = scope && scope.scopeType !== 'ALL' ? scope.sectorId : null;
    // Unarchiving: must check overlap again since it re-enters the active pool
    const existing = await db.query.contracts.findFirst({
      where: eq(contracts.id, req.params.id),
    });
    if (!existing || !(existing as any).archivedAt)
      return res.status(404).json({ error: 'العقد غير موجود أو غير مؤرشف' });
    if (scopeFilter && (existing as any).sectorId !== scopeFilter)
      return res.status(403).json({ error: 'ليس لديك صلاحية على هذا العقد' });

    const conflict = await checkOverlap(
      (existing as any).sectorId,
      String((existing as any).startDate).slice(0, 10),
      String((existing as any).endDate).slice(0, 10),
      req.params.id,
    );
    if (conflict) {
      return res.status(409).json({
        error: `لا يمكن استعادة العقد — يتعارض مع: رقم ${conflict.contractNumber} (${conflict.startDate} — ${conflict.endDate})`,
        conflict,
      });
    }

    const [updated] = await db.update(contracts)
      .set({ archivedAt: null, updatedAt: new Date() } as any)
      .where(eq(contracts.id, req.params.id))
      .returning();

    await db.insert(auditLogs).values({
      actorUserId: req.user!.id, entityType: 'CONTRACT',
      action: 'UNARCHIVE', entityId: req.params.id,
    });

    res.json({ archived: false, contract: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to unarchive contract' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET  /api/contracts/:id/attachments
// POST /api/contracts/:id/attachments
// DELETE /api/contracts/:id/attachments/:aid
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/:id/attachments', authenticate, async (req: AuthRequest, res) => {
  if (!await requireCanView(req, res)) return;
  try {
    const scope = req.user!.role !== 'ADMIN' ? await getContractScope(req.user!.id) : null;
    const scopeFilter = scope && scope.scopeType !== 'ALL' ? scope.sectorId : null;
    if (scopeFilter) {
      const c = await db.query.contracts.findFirst({ where: eq(contracts.id, req.params.id) });
      if (!c || (c as any).sectorId !== scopeFilter)
        return res.status(403).json({ error: 'ليس لديك صلاحية على هذا العقد' });
    }
    const atts = await db.select().from(contractAttachments)
      .where(eq(contractAttachments.contractId, req.params.id))
      .orderBy(contractAttachments.createdAt);
    res.json(atts);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch attachments' });
  }
});

router.post('/:id/attachments', authenticate, async (req: AuthRequest, res) => {
  if (!await requireCanManage(req, res)) return;
  try {
    const scope = req.user!.role !== 'ADMIN' ? await getContractScope(req.user!.id) : null;
    if (scope?.isOwnRegion) return res.status(403).json({ error: 'ليس لديك صلاحية إدارة العقود' });
    const scopeFilter = scope && scope.scopeType !== 'ALL' ? scope.sectorId : null;
    const contract = await db.query.contracts.findFirst({
      where: eq(contracts.id, req.params.id),
    });
    if (!contract) return res.status(404).json({ error: 'العقد غير موجود' });
    if (scopeFilter && (contract as any).sectorId !== scopeFilter)
      return res.status(403).json({ error: 'ليس لديك صلاحية على هذا العقد' });

    const { name, url } = req.body as { name: string; url: string };
    if (!name || !url) return res.status(400).json({ error: 'name و url مطلوبان' });

    const [att] = await db.insert(contractAttachments).values({
      contractId: req.params.id,
      userId: req.user!.id,
      name,
      url,
    }).returning();

    res.status(201).json(att);
  } catch (err) {
    res.status(500).json({ error: 'Failed to add attachment' });
  }
});

router.delete('/:id/attachments/:aid', authenticate, async (req: AuthRequest, res) => {
  if (!await requireCanManage(req, res)) return;
  try {
    const scope = req.user!.role !== 'ADMIN' ? await getContractScope(req.user!.id) : null;
    if (scope?.isOwnRegion) return res.status(403).json({ error: 'ليس لديك صلاحية إدارة العقود' });
    const scopeFilter = scope && scope.scopeType !== 'ALL' ? scope.sectorId : null;
    if (scopeFilter) {
      const c = await db.query.contracts.findFirst({ where: eq(contracts.id, req.params.id) });
      if (!c || (c as any).sectorId !== scopeFilter)
        return res.status(403).json({ error: 'ليس لديك صلاحية على هذا العقد' });
    }
    const [deleted] = await db.delete(contractAttachments)
      .where(and(
        eq(contractAttachments.id, req.params.aid),
        eq(contractAttachments.contractId, req.params.id),
      ))
      .returning();

    if (!deleted) return res.status(404).json({ error: 'المرفق غير موجود' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete attachment' });
  }
});

export default router;
