import express, { Response } from 'express';
import * as XLSX from 'xlsx';
import { db } from '../db';
import { auditLogs, users, stages, regions, sectors } from '../db/schema';
import { authenticate, AuthRequest } from '../middleware/auth';
import { eq, desc, and, gte, lte, sql, asc } from 'drizzle-orm';

const router = express.Router();

function requireAdmin(req: AuthRequest, res: Response, next: Function) {
  if (req.user?.role !== 'ADMIN') return res.status(403).json({ error: 'Admin only' });
  next();
}

function buildConditions(query: Record<string, any>) {
  const conds: any[] = [];
  if (query.entityType) conds.push(eq(auditLogs.entityType, query.entityType));
  if (query.action)     conds.push(eq(auditLogs.action,     query.action));
  if (query.actorUserId) conds.push(eq(auditLogs.actorUserId, query.actorUserId));
  if (query.from) conds.push(gte(auditLogs.createdAt, new Date(query.from)));
  if (query.to)   {
    const d = new Date(query.to); d.setHours(23, 59, 59, 999);
    conds.push(lte(auditLogs.createdAt, d));
  }
  return conds.length > 0 ? and(...conds) : undefined;
}

// ── GET /api/audit-logs — paginated list ────────────────────────────────────
router.get('/', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page  as string) || 1);
    const limit  = Math.min(100, parseInt(req.query.limit as string) || 50);
    const offset = (page - 1) * limit;
    const where  = buildConditions(req.query as Record<string, any>);

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(where);

    const rows = await db.select({
      id:            auditLogs.id,
      actorUserId:   auditLogs.actorUserId,
      actorName:     users.fullName,
      actorUsername: users.username,
      entityType:    auditLogs.entityType,
      entityId:      auditLogs.entityId,
      action:        auditLogs.action,
      changes:       auditLogs.changes,
      createdAt:     auditLogs.createdAt,
    })
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.actorUserId, users.id))
    .where(where)
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit)
    .offset(offset);

    res.json({ rows, total, page, limit });
  } catch (err) {
    console.error('[AUDIT LOG GET]', err);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

// ── GET /api/audit-logs/actors — distinct actors for filter dropdown ─────────
router.get('/actors', authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const all = await db.select({
      id:       users.id,
      fullName: users.fullName,
      username: users.username,
    })
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.actorUserId, users.id))
    .groupBy(users.id, users.fullName, users.username);

    const unique = all.filter((a, i, arr) =>
      a.id && arr.findIndex(x => x.id === a.id) === i
    );
    res.json(unique);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// ── GET /api/audit-logs/meta — distinct entity types and actions ─────────────
router.get('/meta', authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const [entityTypes, actions] = await Promise.all([
      db.selectDistinct({ entityType: auditLogs.entityType }).from(auditLogs),
      db.selectDistinct({ action: auditLogs.action }).from(auditLogs),
    ]);
    res.json({
      entityTypes: entityTypes.map(e => e.entityType),
      actions:     actions.map(a => a.action),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// ── Shared label/resolve helpers ─────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  orderNumber:              'رقم الأمر',
  stageId:                  'المرحلة',
  regionId:                 'المنطقة',
  sectorId:                 'القطاع',
  projectType:              'نوع المشروع',
  assignmentDate:           'تاريخ التعميد',
  estimatedValue:           'القيمة التقديرية',
  actualInvoiceValue:       'المبلغ المفوتر',
  collectedAmount:          'المبلغ المحصّل',
  remainingAmount:          'المبلغ المتبقي',
  financialCloseDate:       'تاريخ إغلاق مالي',
  excavationCompletionDate: 'تاريخ اكتمال الحفر',
  surveyNotes:              'ملاحظات المسح',
  executionNotes:           'ملاحظات التنفيذ',
  electricalTeam:           'فريق الكهرباء',
  d9No:                     'رقم D9',
  procedure:                'الإجراء',
  username:                 'اسم المستخدم',
  fullName:                 'الاسم الكامل',
  role:                     'الدور',
  active:                   'الحالة',
  email:                    'البريد الإلكتروني',
  phoneNumber:              'رقم الجوال',
  employeeId:               'رقم الموظف',
  nameAr:                   'الاسم (عربي)',
  nameEn:                   'الاسم (إنجليزي)',
  seq:                      'الترتيب',
  isTerminal:               'مرحلة نهائية',
  isCancelled:              'مرحلة إلغاء',
  category:                 'الفئة',
  slaDays:                  'مدة SLA (أيام)',
  district:                 'الحي',
  client:                   'العميل',
  workType:                 'نوع العمل',
  status:                   'الحالة',
  length:                   'الطول',
  invoiceNumber:            'رقم الفاتورة',
  invoiceType:              'نوع الفاتورة',
  invoice1:                 'فاتورة 1',
  invoice2:                 'فاتورة 2',
  holdReason:               'سبب التعليق',
  surveyDate:               'تاريخ المسح',
  coordinationDate:         'تاريخ التنسيق',
  drillingDate:             'تاريخ الحفر',
  shutdownDate:             'تاريخ الإيقاف',
  materialSheetDate:        'تاريخ ورقة المواد',
  checkSheetsDate:          'تاريخ كشف الفحص',
  meteringSheetDate:        'تاريخ ورقة القياس',
  gisCompletionDate:        'تاريخ اكتمال GIS',
  proc155CloseDate:         'تاريخ إغلاق 155',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function labelField(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
}

function resolveVal(
  fieldKey: string,
  value: any,
  lk: { stagesMap: Map<string, string>; regionsMap: Map<string, string>; sectorsMap: Map<string, string> }
): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا';
  const str = String(value);
  if (UUID_RE.test(str)) {
    if (fieldKey === 'stageId')  return lk.stagesMap.get(str)  ?? str.slice(0, 8) + '…';
    if (fieldKey === 'regionId') return lk.regionsMap.get(str) ?? str.slice(0, 8) + '…';
    if (fieldKey === 'sectorId') return lk.sectorsMap.get(str) ?? str.slice(0, 8) + '…';
    return str.slice(0, 8) + '…';
  }
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 80);
  return str;
}

// ── GET /api/audit-logs/export — XLSX export ────────────────────────────────
router.get('/export', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const where = buildConditions(req.query as Record<string, any>);

    const [rows, stagesAll, regionsAll, sectorsAll] = await Promise.all([
      db.select({
        actorName:     users.fullName,
        actorUsername: users.username,
        entityType:    auditLogs.entityType,
        entityId:      auditLogs.entityId,
        action:        auditLogs.action,
        changes:       auditLogs.changes,
        createdAt:     auditLogs.createdAt,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.actorUserId, users.id))
      .where(where)
      .orderBy(desc(auditLogs.createdAt)),
      db.select({ id: stages.id, nameAr: stages.nameAr }).from(stages).orderBy(asc(stages.seq)),
      db.select({ id: regions.id, nameAr: regions.nameAr }).from(regions),
      db.select({ id: sectors.id, nameAr: sectors.nameAr }).from(sectors),
    ]);

    const stagesMap  = new Map<string, string>(stagesAll.map(s  => [s.id,  s.nameAr ?? '']));
    const regionsMap = new Map<string, string>(regionsAll.map(r => [r.id,  r.nameAr ?? '']));
    const sectorsMap = new Map<string, string>(sectorsAll.map(s => [s.id,  s.nameAr ?? '']));
    const lk = { stagesMap, regionsMap, sectorsMap };

    const ENTITY_AR: Record<string, string> = {
      WORK_ORDER: 'أمر عمل', USER: 'مستخدم', STAGE: 'مرحلة',
      REGION: 'منطقة', SECTOR: 'قطاع', SYSTEM: 'النظام',
    };
    const ACTION_AR: Record<string, string> = {
      CREATE: 'إنشاء', UPDATE: 'تعديل', DELETE: 'حذف',
      LOGIN: 'تسجيل دخول', LOGOUT: 'تسجيل خروج', PASSWORD_CHANGE: 'تغيير كلمة المرور',
    };

    const SKIP = new Set(['id', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'customFields', 'attachments']);

    const exportRows: Record<string, string>[] = [];

    for (const r of rows) {
      const ch     = r.changes as any;
      const before = ch?.before || {};
      const after  = ch?.after  || {};
      const orderNum = after.orderNumber || before.orderNumber || r.entityId || '';
      const dateStr  = new Date(r.createdAt).toLocaleString('ar-SA', { hour12: false }).replace('،', '');
      const actor    = r.actorName || r.actorUsername || '—';
      const action   = ACTION_AR[r.action] || r.action;
      const entity   = ENTITY_AR[r.entityType] || r.entityType;

      const header: Record<string, string> = {
        'التاريخ':            dateStr,
        'المستخدم':           actor,
        'الإجراء':            action,
        'الكيان':             entity,
        'رقم الأمر / المعرف': orderNum,
      };

      if (r.action === 'UPDATE') {
        const allKeys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
          .filter(k => !SKIP.has(k))
          .filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]));

        if (allKeys.length === 0) {
          exportRows.push({ ...header, 'الحقل': '—', 'القيمة القديمة': '—', 'القيمة الجديدة': '—' });
        } else {
          for (const k of allKeys) {
            exportRows.push({
              ...header,
              'الحقل':          labelField(k),
              'القيمة القديمة': resolveVal(k, before[k], lk),
              'القيمة الجديدة': resolveVal(k, after[k],  lk),
            });
          }
        }
      } else if (r.action === 'CREATE') {
        const createKeys = Object.keys(after)
          .filter(k => !SKIP.has(k) && after[k] !== null && after[k] !== undefined && after[k] !== '');
        if (createKeys.length === 0) {
          exportRows.push({ ...header, 'الحقل': '—', 'القيمة القديمة': '—', 'القيمة الجديدة': 'إنشاء جديد' });
        } else {
          for (const k of createKeys) {
            exportRows.push({
              ...header,
              'الحقل':          labelField(k),
              'القيمة القديمة': '—',
              'القيمة الجديدة': resolveVal(k, after[k], lk),
            });
          }
        }
      } else if (r.action === 'DELETE') {
        const deleteKeys = Object.keys(before)
          .filter(k => !SKIP.has(k) && before[k] !== null && before[k] !== undefined && before[k] !== '');
        if (deleteKeys.length === 0) {
          exportRows.push({ ...header, 'الحقل': '—', 'القيمة القديمة': 'تم الحذف', 'القيمة الجديدة': '—' });
        } else {
          for (const k of deleteKeys) {
            exportRows.push({
              ...header,
              'الحقل':          labelField(k),
              'القيمة القديمة': resolveVal(k, before[k], lk),
              'القيمة الجديدة': '—',
            });
          }
        }
      } else {
        exportRows.push({ ...header, 'الحقل': '—', 'القيمة القديمة': '—', 'القيمة الجديدة': '—' });
      }
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportRows, {
      header: ['التاريخ', 'المستخدم', 'الإجراء', 'الكيان', 'رقم الأمر / المعرف', 'الحقل', 'القيمة القديمة', 'القيمة الجديدة'],
    });
    ws['!cols'] = [
      { width: 22 }, { width: 22 }, { width: 16 }, { width: 14 },
      { width: 20 }, { width: 22 }, { width: 28 }, { width: 28 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'سجل المراجعة');
    const buf      = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `سجل_المراجعة_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(buf);
  } catch (err) {
    console.error('[AUDIT LOG EXPORT]', err);
    res.status(500).json({ error: 'Export failed' });
  }
});

export default router;
