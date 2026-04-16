import express, { Response } from 'express';
import * as XLSX from 'xlsx';
import { db } from '../db';
import {
  workOrders, users, regions, sectors, stages, columnCatalog,
  columnGroups, columnOptions, kpiRules, kpiTemplates, roleColumnPermissions,
  userColumnOverrides, importRuns, auditLogs, periodicKpiExecutionRules,
  roleDefinitions,
} from '../db/schema';
import { authenticate, AuthRequest } from '../middleware/auth';
import { and, gte, lte, eq } from 'drizzle-orm';

const router = express.Router();

// ── Admin guard ────────────────────────────────────────────────────────────────
function requireAdmin(req: AuthRequest, res: Response, next: Function) {
  if (req.user?.role !== 'ADMIN') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ── Sensitive fields that must NEVER be exported ───────────────────────────────
const SENSITIVE_FIELDS = new Set([
  'password', 'passwordHash', 'token', 'apiKey', 'apiSecret',
  'encryptedCredentials', 'secret', 'accessToken', 'refreshToken',
]);

function stripSensitive(rows: any[]): any[] {
  return rows.map(row => {
    const clean: Record<string, any> = {};
    for (const [k, v] of Object.entries(row)) {
      if (!SENSITIVE_FIELDS.has(k)) clean[k] = v;
    }
    return clean;
  });
}

// ── Dataset catalog ─────────────────────────────────────────────────────────────
interface DatasetDef {
  key: string;
  nameAr: string;
  nameEn: string;
  descAr: string;
  descEn: string;
  supportsDateRange: boolean;
  supportsRegionSector: boolean;
  supportsStatusFilter: boolean;
}

const DATASETS: DatasetDef[] = [
  { key: 'work_orders',           nameAr: 'أوامر العمل',           nameEn: 'Work Orders',             descAr: 'جميع أوامر العمل في النظام',                    descEn: 'All work orders in the system',                  supportsDateRange: true,  supportsRegionSector: true,  supportsStatusFilter: true  },
  { key: 'users',                 nameAr: 'المستخدمون',            nameEn: 'Users',                   descAr: 'بيانات المستخدمين (بدون كلمات المرور)',         descEn: 'User accounts (passwords excluded)',             supportsDateRange: false, supportsRegionSector: false, supportsStatusFilter: false },
  { key: 'regions',               nameAr: 'المناطق',               nameEn: 'Regions',                 descAr: 'قائمة المناطق الجغرافية',                       descEn: 'Geographic regions',                             supportsDateRange: false, supportsRegionSector: false, supportsStatusFilter: false },
  { key: 'sectors',               nameAr: 'القطاعات',              nameEn: 'Sectors',                 descAr: 'قائمة القطاعات التنظيمية',                      descEn: 'Organizational sectors',                         supportsDateRange: false, supportsRegionSector: false, supportsStatusFilter: false },
  { key: 'stages',                nameAr: 'المراحل والإجراءات',    nameEn: 'Stages',                  descAr: 'مراحل سير العمل والإجراءات',                    descEn: 'Workflow stages and procedures',                  supportsDateRange: false, supportsRegionSector: false, supportsStatusFilter: false },
  { key: 'column_catalog',        nameAr: 'كتالوج الأعمدة',        nameEn: 'Column Catalog',          descAr: 'تعريفات أعمدة الجداول',                          descEn: 'Table column definitions',                       supportsDateRange: false, supportsRegionSector: false, supportsStatusFilter: false },
  { key: 'column_groups',         nameAr: 'مجموعات الأعمدة',       nameEn: 'Column Groups',           descAr: 'مجموعات تنظيم الأعمدة',                          descEn: 'Column groupings',                               supportsDateRange: false, supportsRegionSector: false, supportsStatusFilter: false },
  { key: 'column_options',        nameAr: 'خيارات الأعمدة',        nameEn: 'Column Options',          descAr: 'القيم المسموح بها للأعمدة ذات القوائم',         descEn: 'Allowed values for dropdown columns',            supportsDateRange: false, supportsRegionSector: false, supportsStatusFilter: false },
  { key: 'kpi_rules',             nameAr: 'قواعد مؤشرات الأداء',  nameEn: 'KPI Rules',               descAr: 'قواعد حساب مؤشرات الأداء',                      descEn: 'KPI calculation rules',                          supportsDateRange: false, supportsRegionSector: false, supportsStatusFilter: false },
  { key: 'kpi_templates',         nameAr: 'قوالب مؤشرات الأداء',  nameEn: 'KPI Templates',           descAr: 'قوالب مؤشرات الأداء الرئيسية',                  descEn: 'KPI template definitions',                       supportsDateRange: false, supportsRegionSector: false, supportsStatusFilter: false },
  { key: 'periodic_kpi_rules',    nameAr: 'قواعد KPI الدورية',     nameEn: 'Periodic KPI Rules',      descAr: 'قواعد مؤشرات الأداء للتقارير الدورية',          descEn: 'Periodic KPI execution rules',                   supportsDateRange: false, supportsRegionSector: false, supportsStatusFilter: false },
  { key: 'role_permissions',      nameAr: 'صلاحيات الأدوار',       nameEn: 'Role Permissions',        descAr: 'صلاحيات القراءة والكتابة لكل دور على الأعمدة', descEn: 'Role-level column read/write permissions',       supportsDateRange: false, supportsRegionSector: false, supportsStatusFilter: false },
  { key: 'user_overrides',        nameAr: 'استثناءات المستخدمين',  nameEn: 'User Permission Overrides', descAr: 'تجاوزات الصلاحيات على مستوى المستخدم',        descEn: 'Per-user column permission overrides',           supportsDateRange: false, supportsRegionSector: false, supportsStatusFilter: false },
  { key: 'import_logs',           nameAr: 'سجلات الاستيراد',       nameEn: 'Import Logs',             descAr: 'سجل عمليات الاستيراد السابقة',                   descEn: 'History of import operations',                   supportsDateRange: true,  supportsRegionSector: false, supportsStatusFilter: false },
  { key: 'audit_logs',            nameAr: 'سجلات المراجعة',        nameEn: 'Audit Logs',              descAr: 'سجل جميع التعديلات على النظام',                  descEn: 'Full audit trail of system changes',             supportsDateRange: true,  supportsRegionSector: false, supportsStatusFilter: false },
];

const DATASET_KEYS = new Set(DATASETS.map(d => d.key));

// ── Fetch rows for a dataset ────────────────────────────────────────────────────
async function fetchDataset(key: string, opts: {
  from?: string; to?: string;
  regionId?: string; sectorId?: string;
  status?: string; includeCancelled?: boolean;
}): Promise<any[]> {
  switch (key) {
    case 'work_orders': {
      let rows: any[] = await db.select().from(workOrders);
      if (opts.regionId) rows = rows.filter(r => r.regionId === opts.regionId);
      if (opts.sectorId) rows = rows.filter(r => r.sectorId === opts.sectorId);
      return rows;
    }
    case 'users':
      return db.select({
        id: users.id, username: users.username, fullName: users.fullName,
        role: users.role, sectorId: users.sectorId, regionId: users.regionId,
        active: users.active, createdAt: users.createdAt,
        employeeId: users.employeeId, phoneNumber: users.phoneNumber, email: users.email,
      }).from(users);
    case 'regions':
      return db.select().from(regions);
    case 'sectors':
      return db.select().from(sectors);
    case 'stages':
      return db.select().from(stages);
    case 'column_catalog':
      return db.select().from(columnCatalog);
    case 'column_groups':
      return db.select().from(columnGroups);
    case 'column_options':
      return db.select().from(columnOptions);
    case 'kpi_rules':
      return db.select().from(kpiRules);
    case 'kpi_templates':
      return db.select().from(kpiTemplates);
    case 'periodic_kpi_rules':
      return db.select().from(periodicKpiExecutionRules);
    case 'role_permissions':
      return db.select().from(roleColumnPermissions);
    case 'user_overrides':
      return db.select().from(userColumnOverrides);
    case 'import_logs':
      return db.select().from(importRuns).orderBy(importRuns.createdAt);
    case 'audit_logs':
      return db.select().from(auditLogs).orderBy(auditLogs.createdAt);
    default:
      return [];
  }
}

// ── Convert rows to CSV ─────────────────────────────────────────────────────────
function toCsv(rows: any[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v: any) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    headers.join(','),
    ...rows.map(row => headers.map(h => escape(row[h])).join(',')),
  ];
  return lines.join('\n');
}

// ── Convert rows to XLSX buffer ─────────────────────────────────────────────────
function toXlsx(rows: any[], sheetName: string): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// ── Helpers for human-readable XLSX ──────────────────────────────────────────
function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function fmtDate(v: any): string {
  if (!v) return '';
  try { return new Date(v).toLocaleDateString('en-GB'); } catch { return String(v); }
}

function fmtBool(v: any): string {
  if (v === true)  return 'نعم';
  if (v === false) return 'لا';
  return v === null || v === undefined ? '' : String(v);
}

function isDateLike(v: any): boolean {
  if (v instanceof Date) return true;
  if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}(T|$)/.test(v);
  return false;
}

// Arabic labels for system/FK fields
const SYSTEM_LABELS: Record<string, string> = {
  id:          'المعرف',
  createdAt:   'تاريخ الإنشاء',
  updatedAt:   'آخر تعديل',
  active:      'نشط',
  sectorId:    'القطاع',
  regionId:    'المنطقة',
  stageId:     'الإجراء الحالي',
  createdBy:   'أُنشئ بواسطة',
  updatedBy:   'عُدِّل بواسطة',
};

/** Resolve work_orders rows: FK IDs → Arabic names + Arabic column headers. */
async function resolveWorkOrdersForXlsx(rawRows: any[]): Promise<any[]> {
  if (!rawRows.length) return rawRows;

  const [allSectors, allRegions, allStages, allUsers, allCols] = await Promise.all([
    db.select({ id: sectors.id, nameAr: sectors.nameAr }).from(sectors),
    db.select({ id: regions.id, nameAr: regions.nameAr }).from(regions),
    db.select({ id: stages.id,  nameAr: stages.nameAr  }).from(stages),
    db.select({ id: users.id,   fullName: users.fullName, username: users.username }).from(users),
    db.select({ columnKey: columnCatalog.columnKey, labelAr: columnCatalog.labelAr }).from(columnCatalog),
  ]);

  const sectorMap = new Map(allSectors.map(s => [s.id, s.nameAr]));
  const regionMap = new Map(allRegions.map(r => [r.id, r.nameAr]));
  const stageMap  = new Map(allStages .map(s => [s.id, s.nameAr]));
  const userMap   = new Map(allUsers  .map(u => [u.id, u.fullName || u.username]));

  // Build camelCase → Arabic label map (catalog + system overrides)
  const colLabelMap: Record<string, string> = { ...SYSTEM_LABELS };
  for (const col of allCols) {
    const camel = snakeToCamel(col.columnKey);
    if (!colLabelMap[camel]) colLabelMap[camel] = col.labelAr;
  }

  return rawRows.map(row => {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(row)) {
      const label = colLabelMap[k] || k;
      if      (k === 'sectorId')       { out[label] = sectorMap.get(v as string) ?? v ?? '—'; }
      else if (k === 'regionId')       { out[label] = regionMap.get(v as string) ?? v ?? '—'; }
      else if (k === 'stageId')        { out[label] = stageMap .get(v as string) ?? v ?? '—'; }
      else if (k === 'createdBy')      { out[label] = userMap  .get(v as string) ?? v ?? '—'; }
      else if (k === 'updatedBy')      { out[label] = userMap  .get(v as string) ?? v ?? '—'; }
      else if (typeof v === 'boolean') { out[label] = fmtBool(v); }
      else if (isDateLike(v))          { out[label] = fmtDate(v); }
      else                             { out[label] = v ?? ''; }
    }
    return out;
  });
}

/** Resolve users rows: sectorId/regionId UUIDs → Arabic names. */
async function resolveUsersForXlsx(rawRows: any[]): Promise<any[]> {
  if (!rawRows.length) return rawRows;
  const [allSectors, allRegions] = await Promise.all([
    db.select({ id: sectors.id, nameAr: sectors.nameAr }).from(sectors),
    db.select({ id: regions.id, nameAr: regions.nameAr }).from(regions),
  ]);
  const sectorMap = new Map(allSectors.map(s => [s.id, s.nameAr]));
  const regionMap = new Map(allRegions.map(r => [r.id, r.nameAr]));

  const LABEL: Record<string, string> = {
    id: 'المعرف', username: 'اسم المستخدم', fullName: 'الاسم الكامل',
    role: 'الدور', sectorId: 'القطاع', regionId: 'المنطقة',
    active: 'نشط', createdAt: 'تاريخ الإنشاء',
    employeeId: 'الرقم الوظيفي', phoneNumber: 'رقم الجوال', email: 'البريد الإلكتروني',
  };

  return rawRows.map(row => {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(row)) {
      const label = LABEL[k] || k;
      if      (k === 'sectorId')       { out[label] = sectorMap.get(v as string) ?? v ?? '—'; }
      else if (k === 'regionId')       { out[label] = regionMap.get(v as string) ?? v ?? '—'; }
      else if (typeof v === 'boolean') { out[label] = fmtBool(v); }
      else if (isDateLike(v))          { out[label] = fmtDate(v); }
      else                             { out[label] = v ?? ''; }
    }
    return out;
  });
}

/** Resolve audit_logs rows: actorUserId UUID → user full name, format dates. */
async function resolveAuditLogsForXlsx(rawRows: any[]): Promise<any[]> {
  if (!rawRows.length) return rawRows;
  const allUsers = await db.select({ id: users.id, fullName: users.fullName, username: users.username }).from(users);
  const userMap  = new Map(allUsers.map(u => [u.id, u.fullName || u.username]));
  return rawRows.map(row => ({
    ...row,
    actorUserId: row.actorUserId ? (userMap.get(row.actorUserId) ?? row.actorUserId) : '',
    createdAt:   fmtDate(row.createdAt),
    updatedAt:   row.updatedAt ? fmtDate(row.updatedAt) : undefined,
  }));
}

/** Entry point: dispatch to the correct resolver for XLSX format. */
async function resolveForXlsx(dataset: string, rawRows: any[]): Promise<any[]> {
  if (dataset === 'work_orders') return resolveWorkOrdersForXlsx(rawRows);
  if (dataset === 'users')       return resolveUsersForXlsx(rawRows);
  if (dataset === 'audit_logs')  return resolveAuditLogsForXlsx(rawRows);
  return rawRows;
}

// ── GET /api/export-center/datasets ────────────────────────────────────────────
router.get('/datasets', authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const counts = await Promise.allSettled([
      db.select().from(workOrders),
      db.select({ id: users.id }).from(users),
      db.select({ id: regions.id }).from(regions),
      db.select({ id: sectors.id }).from(sectors),
      db.select({ id: stages.id }).from(stages),
      db.select({ id: columnCatalog.id }).from(columnCatalog),
      db.select({ id: columnGroups.id }).from(columnGroups),
      db.select({ id: columnOptions.id }).from(columnOptions),
      db.select({ id: kpiRules.id }).from(kpiRules),
      db.select({ id: kpiTemplates.id }).from(kpiTemplates),
      db.select({ id: periodicKpiExecutionRules.id }).from(periodicKpiExecutionRules),
      db.select({ id: roleColumnPermissions.id }).from(roleColumnPermissions),
      db.select({ id: userColumnOverrides.id }).from(userColumnOverrides),
      db.select({ id: importRuns.id }).from(importRuns),
      db.select({ id: auditLogs.id }).from(auditLogs),
    ]);

    const result = DATASETS.map((d, i) => ({
      ...d,
      count: counts[i].status === 'fulfilled' ? (counts[i] as any).value.length : null,
    }));

    res.json(result);
  } catch (err) {
    console.error('[EXPORT CENTER DATASETS]', err);
    res.status(500).json({ error: 'Failed to fetch dataset list' });
  }
});

// ── GET /api/export-center/export/:dataset ──────────────────────────────────────
router.get('/export/:dataset', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { dataset } = req.params;

    // Allowlist validation — never trust user input for table names
    if (!DATASET_KEYS.has(dataset)) {
      return res.status(400).json({ error: 'Unknown dataset' });
    }

    const format = (req.query.format as string) === 'xlsx' ? 'xlsx' : 'csv';
    const opts = {
      from:             req.query.from        as string | undefined,
      to:               req.query.to          as string | undefined,
      regionId:         req.query.regionId    as string | undefined,
      sectorId:         req.query.sectorId    as string | undefined,
      status:           req.query.status      as string | undefined,
      includeCancelled: req.query.includeCancelled === 'true',
    };

    let rows = await fetchDataset(dataset, opts);

    // Strip sensitive fields
    rows = stripSensitive(rows);

    // Flatten JSON/object fields for readability
    rows = rows.map(row => {
      const flat: Record<string, any> = {};
      for (const [k, v] of Object.entries(row)) {
        flat[k] = v !== null && typeof v === 'object' && !Array.isArray(v)
          ? JSON.stringify(v)
          : (Array.isArray(v) ? JSON.stringify(v) : v);
      }
      return flat;
    });

    const def = DATASETS.find(d => d.key === dataset)!;
    const filename = `${dataset}_${new Date().toISOString().slice(0, 10)}`;

    if (format === 'xlsx') {
      // Resolve FK IDs → human-readable names and use Arabic column headers
      const readable = await resolveForXlsx(dataset, rows);
      const buf = toXlsx(readable, def.nameAr);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
      res.send(buf);
    } else {
      // CSV stays raw (IDs and technical fields as-is) for system use
      const csv = toCsv(rows);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.send('\uFEFF' + csv); // UTF-8 BOM for proper Arabic display in Excel
    }
  } catch (err) {
    console.error('[EXPORT CENTER EXPORT]', err);
    res.status(500).json({ error: 'Export failed' });
  }
});

export default router;
