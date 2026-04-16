/**
 * Comprehensive seed script for PostgreSQL production database.
 * Seeds: column_groups, column_catalog, role_column_permissions,
 *        sectors, regions, stages, kpi_templates, kpi_rules, work_orders
 */

import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, eq } from 'drizzle-orm';
import * as schema from './schema_pg';
import bcrypt from 'bcryptjs';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

// ─── 1. COLUMN GROUPS ───────────────────────────────────────────────────────

const COLUMN_GROUPS = [
  { key: 'BASE',    nameAr: 'البيانات الأساسية', nameEn: 'Basic Data',    sortOrder: 1 },
  { key: 'OPS',     nameAr: 'العمليات',           nameEn: 'Operations',    sortOrder: 2 },
  { key: 'COORD',   nameAr: 'التنسيق',            nameEn: 'Coordination',  sortOrder: 3 },
  { key: 'GIS_155', nameAr: 'GIS & 155',          nameEn: 'GIS & 155',     sortOrder: 4 },
  { key: 'FINANCE', nameAr: 'المالية',             nameEn: 'Finance',       sortOrder: 5 },
];

// ─── 2. COLUMN CATALOG ──────────────────────────────────────────────────────

const COLUMNS = [
  // BASE
  { columnKey: 'work_type',                  labelAr: 'نوع العمل',                       groupKey: 'BASE',    category: 'EXEC', dataType: 'select' },
  { columnKey: 'order_number',               labelAr: 'امر العمل',                        groupKey: 'BASE',    category: 'EXEC', dataType: 'text' },
  { columnKey: 'client',                     labelAr: 'العميل',                           groupKey: 'BASE',    category: 'EXEC', dataType: 'text' },
  { columnKey: 'assignment_date',            labelAr: 'تاريخ الاسناد',                   groupKey: 'BASE',    category: 'EXEC', dataType: 'date' },
  { columnKey: 'district',                   labelAr: 'الحي',                             groupKey: 'BASE',    category: 'EXEC', dataType: 'text' },
  { columnKey: 'project_type',               labelAr: 'نوعية المشروع',                   groupKey: 'BASE',    category: 'EXEC', dataType: 'select' },
  { columnKey: 'station',                    labelAr: 'المحطة',                           groupKey: 'BASE',    category: 'EXEC', dataType: 'text' },
  { columnKey: 'length',                     labelAr: 'الطول',                            groupKey: 'BASE',    category: 'EXEC', dataType: 'number' },
  { columnKey: 'consultant',                 labelAr: 'الاستشاري',                       groupKey: 'BASE',    category: 'EXEC', dataType: 'text' },
  // OPS
  { columnKey: 'survey_date',                labelAr: 'تاريخ المسح',                     groupKey: 'OPS',     category: 'EXEC', dataType: 'date' },
  { columnKey: 'drilling_team',              labelAr: 'فريق الحفر',                      groupKey: 'OPS',     category: 'EXEC', dataType: 'text' },
  { columnKey: 'drilling_date',              labelAr: 'تاريخ الحفر',                     groupKey: 'OPS',     category: 'EXEC', dataType: 'date' },
  { columnKey: 'shutdown_date',              labelAr: 'تاريخ التطفئة',                  groupKey: 'OPS',     category: 'EXEC', dataType: 'date' },
  { columnKey: 'procedure',                  labelAr: 'الاجراء',                         groupKey: 'OPS',     category: 'EXEC', dataType: 'select' },
  { columnKey: 'hold_reason',                labelAr: 'سبب تعليق الإجراء',              groupKey: 'OPS',     category: 'EXEC', dataType: 'text' },
  { columnKey: 'notes',                      labelAr: 'ملاحظات',                         groupKey: 'OPS',     category: 'EXEC', dataType: 'text' },
  // COORD
  { columnKey: 'coordination_date',          labelAr: 'تاريخ التنسيق',                  groupKey: 'COORD',   category: 'EXEC', dataType: 'date' },
  { columnKey: 'coordination_cert_number',   labelAr: 'رقم شهادة التنسيق',             groupKey: 'COORD',   category: 'EXEC', dataType: 'text' },
  { columnKey: 'material_sheet_date',        labelAr: 'تاريخ استلام ورقة المواد',       groupKey: 'COORD',   category: 'EXEC', dataType: 'date' },
  { columnKey: 'check_sheets_date',          labelAr: 'تاريخ استلام اوراق تشيك',       groupKey: 'COORD',   category: 'EXEC', dataType: 'date' },
  { columnKey: 'completion_cert_confirm',    labelAr: 'تأكيد شهادة إنجاز',             groupKey: 'COORD',   category: 'EXEC', dataType: 'boolean' },
  // GIS_155
  { columnKey: 'metering_sheet_date',        labelAr: 'تاريخ تجهيز ورقة التمتير',      groupKey: 'GIS_155', category: 'EXEC', dataType: 'date' },
  { columnKey: 'gis_completion_date',        labelAr: 'تاريخ الانتهاء من GIS',         groupKey: 'GIS_155', category: 'EXEC', dataType: 'date' },
  { columnKey: 'proc_155_close_date',        labelAr: 'تاريخ اقفال اجراء 155',         groupKey: 'GIS_155', category: 'EXEC', dataType: 'date' },
  // FINANCE
  { columnKey: 'estimated_value',            labelAr: 'القيمة التقديرية',               groupKey: 'FINANCE', category: 'FIN',  dataType: 'currency', isSensitive: true },
  { columnKey: 'invoice_number',             labelAr: 'رقم المستخلص',                   groupKey: 'FINANCE', category: 'FIN',  dataType: 'text' },
  { columnKey: 'actual_invoice_value',       labelAr: 'القيمة الفعلية للفاتورة',        groupKey: 'FINANCE', category: 'FIN',  dataType: 'currency', isSensitive: true },
  { columnKey: 'invoice_type',               labelAr: 'نوع المستخلص',                   groupKey: 'FINANCE', category: 'FIN',  dataType: 'select' },
  { columnKey: 'invoice_1',                  labelAr: 'مستخلص 1',                       groupKey: 'FINANCE', category: 'FIN',  dataType: 'currency', isSensitive: true },
  { columnKey: 'invoice_2',                  labelAr: 'مستخلص 2',                       groupKey: 'FINANCE', category: 'FIN',  dataType: 'currency', isSensitive: true },
  { columnKey: 'collected_amount',           labelAr: 'القيمة المحصلة',                 groupKey: 'FINANCE', category: 'FIN',  dataType: 'currency', isSensitive: true },
  { columnKey: 'remaining_amount',           labelAr: 'المتبقي',                         groupKey: 'FINANCE', category: 'FIN',  dataType: 'currency', isSensitive: true },
  // DELAY CLASSIFICATION — تصنيف التأخير
  { columnKey: 'exec_delay_justified',       labelAr: 'هل التأخير التنفيذي مسبب؟',     groupKey: 'OPS',     category: 'EXEC', dataType: 'boolean' },
  { columnKey: 'exec_delay_reason',          labelAr: 'سبب التأخير التنفيذي',           groupKey: 'OPS',     category: 'EXEC', dataType: 'text' },
  { columnKey: 'fin_delay_justified',        labelAr: 'هل التأخير المالي مسبب؟',        groupKey: 'FINANCE', category: 'FIN',  dataType: 'boolean' },
  { columnKey: 'fin_delay_reason',           labelAr: 'سبب التأخير المالي',             groupKey: 'FINANCE', category: 'FIN',  dataType: 'text' },
  // EXECUTION STATUS CLASSIFICATION — حالة التنفيذ (يدوي)
  { columnKey: 'work_status_classification', labelAr: 'حالة التنفيذ',                   groupKey: 'OPS',     category: 'EXEC', dataType: 'select' },
];

// ─── 3. ROLES ────────────────────────────────────────────────────────────────

const ALL_ROLES = ['ADMIN', 'MANAGER', 'OPERATOR', 'COORDINATOR', 'GIS', 'FINANCE'];

// ─── 4. SECTORS ──────────────────────────────────────────────────────────────

const SECTORS = [
  { nameAr: 'قطاع الشمال',  nameEn: 'North Sector' },
  { nameAr: 'قطاع الجنوب',  nameEn: 'South Sector' },
  { nameAr: 'قطاع الشرق',   nameEn: 'East Sector'  },
  { nameAr: 'قطاع الغرب',   nameEn: 'West Sector'  },
  { nameAr: 'قطاع الوسط',   nameEn: 'Central Sector' },
];

// ─── 5. STAGES ───────────────────────────────────────────────────────────────

const STAGES = [
  { nameAr: 'استلام الأمر',       category: 'EXEC', seq: 1,  isTerminal: false, isCancelled: false },
  { nameAr: 'المسح الميداني',      category: 'EXEC', seq: 2,  isTerminal: false, isCancelled: false },
  { nameAr: 'التنسيق',             category: 'EXEC', seq: 3,  isTerminal: false, isCancelled: false },
  { nameAr: 'الحفر',               category: 'EXEC', seq: 4,  isTerminal: false, isCancelled: false },
  { nameAr: 'التنفيذ',             category: 'EXEC', seq: 5,  isTerminal: false, isCancelled: false },
  { nameAr: 'GIS & 155',           category: 'EXEC', seq: 6,  isTerminal: false, isCancelled: false },
  { nameAr: 'مكتمل',               category: 'EXEC', seq: 7,  isTerminal: true,  isCancelled: false },
  { nameAr: 'ملغي',                category: 'EXEC', seq: 8,  isTerminal: false, isCancelled: true  },
  { nameAr: 'إعداد المستخلص',     category: 'FIN',  seq: 1,  isTerminal: false, isCancelled: false },
  { nameAr: 'مراجعة المستخلص',    category: 'FIN',  seq: 2,  isTerminal: false, isCancelled: false },
  { nameAr: 'اعتماد المستخلص',    category: 'FIN',  seq: 3,  isTerminal: false, isCancelled: false },
  { nameAr: 'تحصيل المستخلص',     category: 'FIN',  seq: 4,  isTerminal: true,  isCancelled: false },
];

// ─── 6. KPI TEMPLATES ────────────────────────────────────────────────────────

const KPI_TEMPLATES = [
  { nameAr: 'مدة التنسيق',    category: 'EXEC', defaultSlaDays: 14, seq: 1 },
  { nameAr: 'مدة التنفيذ',    category: 'EXEC', defaultSlaDays: 60, seq: 2 },
  { nameAr: 'مدة GIS',        category: 'EXEC', defaultSlaDays: 7,  seq: 3 },
  { nameAr: 'مدة الحفر',      category: 'EXEC', defaultSlaDays: 10, seq: 4 },
  { nameAr: 'نسبة التحصيل',   category: 'FIN',  defaultSlaDays: 0,  seq: 5 },
  { nameAr: 'المتبقي المالي', category: 'FIN',  defaultSlaDays: 0,  seq: 6 },
];

// ─── MAIN SEED ───────────────────────────────────────────────────────────────

async function main() {
  console.log('\n====== STARTING FULL SEED ======\n');

  // ── Column Groups ──────────────────────────────────────────────────────────
  console.log('Seeding column_groups...');
  for (const g of COLUMN_GROUPS) {
    await db.insert(schema.columnGroups)
      .values({ key: g.key, nameAr: g.nameAr, nameEn: g.nameEn, sortOrder: g.sortOrder, active: true })
      .onConflictDoUpdate({ target: schema.columnGroups.key, set: { nameAr: g.nameAr, nameEn: g.nameEn, sortOrder: g.sortOrder } });
  }
  console.log(`  ✓ ${COLUMN_GROUPS.length} groups`);

  // ── Column Catalog ─────────────────────────────────────────────────────────
  console.log('Seeding column_catalog...');
  for (const col of COLUMNS) {
    await db.insert(schema.columnCatalog)
      .values({
        tableName: 'work_orders',
        columnKey: col.columnKey,
        labelAr: col.labelAr,
        groupKey: col.groupKey,
        category: col.category,
        dataType: col.dataType,
        isSensitive: (col as any).isSensitive || false,
        isCustom: false,
        isEnabled: true,
      })
      .onConflictDoUpdate({
        target: [schema.columnCatalog.tableName, schema.columnCatalog.columnKey],
        set: { labelAr: col.labelAr, groupKey: col.groupKey, category: col.category, dataType: col.dataType },
      });
  }
  console.log(`  ✓ ${COLUMNS.length} columns`);

  // ── Role Column Permissions ────────────────────────────────────────────────
  console.log('Seeding role_column_permissions...');
  const allColKeys = COLUMNS.map(c => c.columnKey);
  let permCount = 0;

  for (const role of ALL_ROLES) {
    for (const colKey of allColKeys) {
      const isAdmin    = role === 'ADMIN';
      const isManager  = role === 'MANAGER';
      const isFinance  = role === 'FINANCE';
      const col        = COLUMNS.find(c => c.columnKey === colKey)!;
      const isFinCol   = col.category === 'FIN';

      // Read rules:
      // ADMIN/MANAGER → read all
      // FINANCE → read all
      // Others → read non-sensitive FIN + all EXEC
      let canRead = isAdmin || isManager || isFinance
        ? true
        : !(isFinCol && (col as any).isSensitive);

      // Write rules:
      // ADMIN → write all
      // MANAGER → write EXEC only
      // FINANCE → write FIN only
      // COORDINATOR → write COORD group only
      // GIS → write GIS_155 group only
      // OPERATOR → write OPS + BASE groups only
      let canWrite = false;
      if (isAdmin) {
        canWrite = true;
      } else if (isManager) {
        canWrite = !isFinCol;
      } else if (isFinance) {
        canWrite = isFinCol;
      } else if (role === 'COORDINATOR') {
        canWrite = col.groupKey === 'COORD' || col.groupKey === 'BASE';
      } else if (role === 'GIS') {
        canWrite = col.groupKey === 'GIS_155' || col.groupKey === 'BASE';
      } else if (role === 'OPERATOR') {
        canWrite = col.groupKey === 'OPS' || col.groupKey === 'BASE';
      }

      await db.insert(schema.roleColumnPermissions)
        .values({ role, tableName: 'work_orders', columnKey: colKey, canRead, canWrite })
        .onConflictDoUpdate({
          target: [schema.roleColumnPermissions.role, schema.roleColumnPermissions.tableName, schema.roleColumnPermissions.columnKey],
          set: { canRead, canWrite },
        });
      permCount++;
    }
  }
  console.log(`  ✓ ${permCount} permissions (${ALL_ROLES.length} roles × ${allColKeys.length} columns)`);

  // ── Delay-classification permission overrides ──────────────────────────────
  // The general loop above cannot grant canWrite to COORDINATOR/MANAGER/OPERATOR
  // for these cross-category columns, so we upsert precise overrides here.
  const DELAY_OVERRIDES: { role: string; columnKey: string; canRead: boolean; canWrite: boolean }[] = [
    // ADMIN — already handled above, but upsert again for clarity
    { role: 'ADMIN',       columnKey: 'exec_delay_justified', canRead: true, canWrite: true },
    { role: 'ADMIN',       columnKey: 'exec_delay_reason',    canRead: true, canWrite: true },
    { role: 'ADMIN',       columnKey: 'fin_delay_justified',  canRead: true, canWrite: true },
    { role: 'ADMIN',       columnKey: 'fin_delay_reason',     canRead: true, canWrite: true },
    // MANAGER — needs write on fin delay (general loop blocks FIN for MANAGER)
    { role: 'MANAGER',     columnKey: 'exec_delay_justified', canRead: true, canWrite: true },
    { role: 'MANAGER',     columnKey: 'exec_delay_reason',    canRead: true, canWrite: true },
    { role: 'MANAGER',     columnKey: 'fin_delay_justified',  canRead: true, canWrite: true },
    { role: 'MANAGER',     columnKey: 'fin_delay_reason',     canRead: true, canWrite: true },
    // OPERATOR — needs write on fin delay (general loop blocks FINANCE group for OPERATOR)
    { role: 'OPERATOR',    columnKey: 'exec_delay_justified', canRead: true, canWrite: true },
    { role: 'OPERATOR',    columnKey: 'exec_delay_reason',    canRead: true, canWrite: true },
    { role: 'OPERATOR',    columnKey: 'fin_delay_justified',  canRead: true, canWrite: true },
    { role: 'OPERATOR',    columnKey: 'fin_delay_reason',     canRead: true, canWrite: true },
    // COORDINATOR — needs write on all 4 (general loop gives COORD/BASE only)
    { role: 'COORDINATOR', columnKey: 'exec_delay_justified', canRead: true, canWrite: true },
    { role: 'COORDINATOR', columnKey: 'exec_delay_reason',    canRead: true, canWrite: true },
    { role: 'COORDINATOR', columnKey: 'fin_delay_justified',  canRead: true, canWrite: true },
    { role: 'COORDINATOR', columnKey: 'fin_delay_reason',     canRead: true, canWrite: true },
    // GIS — read only
    { role: 'GIS',         columnKey: 'exec_delay_justified', canRead: true, canWrite: false },
    { role: 'GIS',         columnKey: 'exec_delay_reason',    canRead: true, canWrite: false },
    { role: 'GIS',         columnKey: 'fin_delay_justified',  canRead: true, canWrite: false },
    { role: 'GIS',         columnKey: 'fin_delay_reason',     canRead: true, canWrite: false },
    // FINANCE — write fin delay only
    { role: 'FINANCE',     columnKey: 'exec_delay_justified', canRead: true, canWrite: false },
    { role: 'FINANCE',     columnKey: 'exec_delay_reason',    canRead: true, canWrite: false },
    { role: 'FINANCE',     columnKey: 'fin_delay_justified',  canRead: true, canWrite: true  },
    { role: 'FINANCE',     columnKey: 'fin_delay_reason',     canRead: true, canWrite: true  },
    // VIEWER — read only
    { role: 'VIEWER',      columnKey: 'exec_delay_justified', canRead: true, canWrite: false },
    { role: 'VIEWER',      columnKey: 'exec_delay_reason',    canRead: true, canWrite: false },
    { role: 'VIEWER',      columnKey: 'fin_delay_justified',  canRead: true, canWrite: false },
    { role: 'VIEWER',      columnKey: 'fin_delay_reason',     canRead: true, canWrite: false },
  ];
  for (const o of DELAY_OVERRIDES) {
    await db.insert(schema.roleColumnPermissions)
      .values({ role: o.role, tableName: 'work_orders', columnKey: o.columnKey, canRead: o.canRead, canWrite: o.canWrite })
      .onConflictDoUpdate({
        target: [schema.roleColumnPermissions.role, schema.roleColumnPermissions.tableName, schema.roleColumnPermissions.columnKey],
        set: { canRead: o.canRead, canWrite: o.canWrite },
      });
  }
  console.log(`  ✓ ${DELAY_OVERRIDES.length} delay-classification permission overrides applied`);

  // ── Sectors ────────────────────────────────────────────────────────────────
  console.log('Seeding sectors...');
  const sectorIds: Record<string, string> = {};
  for (const s of SECTORS) {
    const existing = await db.select().from(schema.sectors).where(eq(schema.sectors.nameAr, s.nameAr));
    if (existing.length > 0) {
      sectorIds[s.nameAr] = existing[0].id;
    } else {
      const [inserted] = await db.insert(schema.sectors)
        .values({ nameAr: s.nameAr, nameEn: s.nameEn, active: true })
        .returning({ id: schema.sectors.id });
      sectorIds[s.nameAr] = inserted.id;
    }
  }
  console.log(`  ✓ ${SECTORS.length} sectors`);

  // ── Regions ────────────────────────────────────────────────────────────────
  console.log('Seeding regions...');
  const REGIONS = [
    { nameAr: 'منطقة الرياض',     nameEn: 'Riyadh Region',   sector: 'قطاع الوسط' },
    { nameAr: 'منطقة جدة',        nameEn: 'Jeddah Region',   sector: 'قطاع الغرب' },
    { nameAr: 'منطقة مكة',        nameEn: 'Makkah Region',   sector: 'قطاع الغرب' },
    { nameAr: 'منطقة الدمام',     nameEn: 'Dammam Region',   sector: 'قطاع الشرق' },
    { nameAr: 'منطقة الأحساء',    nameEn: 'Ahsa Region',     sector: 'قطاع الشرق' },
    { nameAr: 'منطقة المدينة',    nameEn: 'Madinah Region',  sector: 'قطاع الشمال' },
    { nameAr: 'منطقة تبوك',       nameEn: 'Tabuk Region',    sector: 'قطاع الشمال' },
    { nameAr: 'منطقة أبها',       nameEn: 'Abha Region',     sector: 'قطاع الجنوب' },
    { nameAr: 'منطقة جازان',      nameEn: 'Jazan Region',    sector: 'قطاع الجنوب' },
  ];
  const regionIds: Record<string, string> = {};
  for (const r of REGIONS) {
    const existing = await db.select().from(schema.regions).where(eq(schema.regions.nameAr, r.nameAr));
    if (existing.length > 0) {
      regionIds[r.nameAr] = existing[0].id;
    } else {
      const [inserted] = await db.insert(schema.regions)
        .values({ nameAr: r.nameAr, nameEn: r.nameEn, sectorId: sectorIds[r.sector], active: true })
        .returning({ id: schema.regions.id });
      regionIds[r.nameAr] = inserted.id;
    }
  }
  console.log(`  ✓ ${REGIONS.length} regions`);

  // ── Stages ─────────────────────────────────────────────────────────────────
  console.log('Seeding stages...');
  const stageIds: string[] = [];
  for (const s of STAGES) {
    const existing = await db.select().from(schema.stages).where(eq(schema.stages.nameAr, s.nameAr));
    if (existing.length > 0) {
      stageIds.push(existing[0].id);
    } else {
      const [inserted] = await db.insert(schema.stages)
        .values({ nameAr: s.nameAr, category: s.category, seq: s.seq, isTerminal: s.isTerminal, isCancelled: s.isCancelled, active: true })
        .returning({ id: schema.stages.id });
      stageIds.push(inserted.id);
    }
  }
  console.log(`  ✓ ${STAGES.length} stages`);

  // ── KPI Templates & Rules ──────────────────────────────────────────────────
  console.log('Seeding kpi_templates and kpi_rules...');
  // Template→startCol→endCol mapping
  const KPI_RULES_DEF = [
    { tpl: 'مدة التنسيق',    startCol: 'survey_date',          endCol: 'coordination_date',    calcMode: 'DATES', slaDays: 14 },
    { tpl: 'مدة التنفيذ',    startCol: 'assignment_date',      endCol: 'proc_155_close_date',  calcMode: 'DATES', slaDays: 60 },
    { tpl: 'مدة GIS',        startCol: 'metering_sheet_date',  endCol: 'gis_completion_date',  calcMode: 'DATES', slaDays: 7  },
    { tpl: 'مدة الحفر',      startCol: 'drilling_date',        endCol: 'shutdown_date',        calcMode: 'DATES', slaDays: 10 },
    { tpl: 'نسبة التحصيل',   startCol: 'collected_amount',     endCol: 'actual_invoice_value', calcMode: 'RATIO', slaDays: 0  },
    { tpl: 'المتبقي المالي', startCol: 'actual_invoice_value', endCol: 'collected_amount',     calcMode: 'DIFF',  slaDays: 0  },
  ];

  for (const tplDef of KPI_TEMPLATES) {
    const existing = await db.select().from(schema.kpiTemplates).where(eq(schema.kpiTemplates.nameAr, tplDef.nameAr));
    let tplId: string;
    if (existing.length > 0) {
      tplId = existing[0].id;
    } else {
      const [inserted] = await db.insert(schema.kpiTemplates)
        .values({ nameAr: tplDef.nameAr, category: tplDef.category, defaultSlaDays: tplDef.defaultSlaDays, seq: tplDef.seq, active: true })
        .returning({ id: schema.kpiTemplates.id });
      tplId = inserted.id;
    }

    // Insert KPI rule
    const ruleDef = KPI_RULES_DEF.find(r => r.tpl === tplDef.nameAr)!;
    const existingRule = await db.select().from(schema.kpiRules).where(eq(schema.kpiRules.templateId, tplId));
    if (existingRule.length === 0) {
      await db.insert(schema.kpiRules).values({
        templateId: tplId,
        category: tplDef.category,
        startColumnKey: ruleDef.startCol,
        endMode: 'COLUMN_DATE',
        endColumnKey: ruleDef.endCol,
        calcMode: ruleDef.calcMode,
        slaDaysOverride: ruleDef.slaDays,
        alertEnabled: true,
        warnThresholdPercent: 80,
        showOnDashboard: true,
        active: true,
      });
    }
  }
  console.log(`  ✓ ${KPI_TEMPLATES.length} KPI templates with rules`);

  // ── Demo Work Orders ───────────────────────────────────────────────────────
  console.log('Seeding demo work_orders...');
  const adminUser = await db.select().from(schema.users).where(eq(schema.users.username, 'admin'));
  const adminId   = adminUser[0]?.id;

  // Fetch real IDs from DB so regions/stages match correctly
  const allSectorsDB  = await db.select().from(schema.sectors);
  const allRegionsDB  = await db.select().from(schema.regions);
  const allStagesDB   = await db.select().from(schema.stages);

  const sec  = (nameAr: string) => allSectorsDB.find(s => s.nameAr === nameAr)?.id ?? allSectorsDB[0]?.id;
  const reg  = (nameAr: string) => allRegionsDB.find(r => r.nameAr === nameAr)?.id ?? allRegionsDB[0]?.id;
  const stg  = (nameAr: string) => allStagesDB.find(s => s.nameAr === nameAr)?.id  ?? allStagesDB[0]?.id;

  const demoOrders = [
    {
      orderNumber: 'WO-2024-001', workType: 'كهرباء', client: 'شركة الكهرباء السعودية',
      district: 'الرياض - حي النزهة', projectType: 'مد كابل', station: 'محطة A-101',
      assignmentDate: new Date('2024-01-15'), surveyDate: new Date('2024-01-20'),
      coordinationDate: new Date('2024-02-01'), drillingDate: new Date('2024-02-10'),
      shutdownDate: new Date('2024-02-15'), proc155CloseDate: new Date('2024-03-01'),
      estimatedValue: '120000', actualInvoiceValue: '115000', collectedAmount: '90000',
      status: 'ACTIVE', procedure: 'حفر', holdReason: null,
      sectorId: sec('قطاع المنطقة الوسطى'), regionId: reg('منطقة الشمال'),
      stageId: stg('المسح الميداني'),
    },
    {
      orderNumber: 'WO-2024-002', workType: 'اتصالات', client: 'شركة STC',
      district: 'جدة - حي الشاطئ', projectType: 'شبكة ألياف', station: 'محطة B-205',
      assignmentDate: new Date('2024-02-01'), surveyDate: new Date('2024-02-05'),
      coordinationDate: new Date('2024-02-20'), drillingDate: new Date('2024-03-01'),
      estimatedValue: '85000', actualInvoiceValue: '82000', collectedAmount: '82000',
      status: 'ACTIVE', procedure: 'دفع أنابيب', holdReason: null,
      sectorId: sec('قطاع المنطقة الشرقية'), regionId: reg('منطقة الدمام'),
      stageId: stg('التنسيق'),
    },
    {
      orderNumber: 'WO-2024-003', workType: 'كهرباء', client: 'أرامكو السعودية',
      district: 'الدمام - المنطقة الصناعية', projectType: 'ترقية شبكة', station: 'محطة C-310',
      assignmentDate: new Date('2024-03-10'), surveyDate: new Date('2024-03-15'),
      estimatedValue: '250000', status: 'PENDING', procedure: 'معلق',
      holdReason: 'انتظار تصاريح البلدية',
      sectorId: sec('قطاع القصيم'), regionId: reg('منطقة بريدة'),
      stageId: stg('استلام الأمر'),
    },
    {
      orderNumber: 'WO-2024-004', workType: 'مياه', client: 'شركة المياه الوطنية',
      district: 'المدينة المنورة', projectType: 'خط مياه', station: 'محطة D-415',
      assignmentDate: new Date('2024-04-01'), surveyDate: new Date('2024-04-08'),
      coordinationDate: new Date('2024-04-20'), drillingDate: new Date('2024-05-01'),
      shutdownDate: new Date('2024-05-10'), gisCompletionDate: new Date('2024-05-20'),
      proc155CloseDate: new Date('2024-06-01'), meteringSheetDate: new Date('2024-05-15'),
      estimatedValue: '175000', actualInvoiceValue: '170000', collectedAmount: '150000',
      status: 'COMPLETED', procedure: 'حفر', holdReason: null,
      sectorId: sec('قطاع الجنوب'), regionId: reg('منطقة الجنوب'),
      stageId: stg('مكتمل'),
    },
    {
      orderNumber: 'WO-2024-005', workType: 'كهرباء', client: 'شركة الكهرباء السعودية',
      district: 'تبوك - المركز', projectType: 'تنفيذ الجهد المنخفض', station: 'محطة E-520',
      assignmentDate: new Date('2024-05-15'), estimatedValue: '95000',
      status: 'PENDING', procedure: 'معلق', holdReason: 'نقص في مواد الكابل',
      sectorId: sec('قطاع الغرب'), regionId: reg('منطقة الشرق'),
      stageId: stg('استلام الأمر'),
    },
    {
      orderNumber: 'WO-2024-006', workType: 'اتصالات', client: 'موبايلي',
      district: 'أبها - التلال', projectType: 'برج اتصالات', station: 'محطة F-601',
      assignmentDate: new Date('2024-06-01'), surveyDate: new Date('2024-06-07'),
      coordinationDate: new Date('2024-06-25'), drillingDate: new Date('2024-07-05'),
      shutdownDate: new Date('2024-07-15'), meteringSheetDate: new Date('2024-07-20'),
      gisCompletionDate: new Date('2024-07-30'), proc155CloseDate: new Date('2024-08-10'),
      estimatedValue: '145000', actualInvoiceValue: '142000', collectedAmount: '100000',
      status: 'ACTIVE', procedure: 'حفر يدوي', holdReason: null,
      sectorId: sec('قطاع القصيم'), regionId: reg('منطقة غرب القصيم'),
      stageId: stg('الحفر'),
    },
    {
      orderNumber: 'WO-2024-007', workType: 'غاز', client: 'أرامكو السعودية',
      district: 'الأحساء', projectType: 'خط غاز', station: 'محطة G-705',
      assignmentDate: new Date('2024-07-10'), surveyDate: new Date('2024-07-18'),
      estimatedValue: '310000', status: 'PENDING', procedure: 'معلق',
      holdReason: 'تعارض مع مشروع طريق',
      sectorId: sec('قطاع المنطقة الشرقية'), regionId: reg('منطقة الخبر'),
      stageId: stg('التنفيذ'),
    },
    {
      orderNumber: 'WO-2024-008', workType: 'كهرباء', client: 'شركة الكهرباء السعودية',
      district: 'جازان - الميناء', projectType: 'توصيل طاقة', station: 'محطة H-810',
      assignmentDate: new Date('2024-08-01'), surveyDate: new Date('2024-08-10'),
      coordinationDate: new Date('2024-08-28'), drillingDate: new Date('2024-09-10'),
      estimatedValue: '190000', actualInvoiceValue: '185000', collectedAmount: '185000',
      status: 'COMPLETED', procedure: 'دفع أنابيب', holdReason: null,
      sectorId: sec('قطاع المنطقة الوسطى'), regionId: reg('منطقة خريص'),
      stageId: stg('GIS & 155'),
    },
  ];

  for (const order of demoOrders) {
    const existing = await db.select().from(schema.workOrders).where(eq(schema.workOrders.orderNumber, order.orderNumber));
    if (existing.length === 0) {
      await db.insert(schema.workOrders).values({
        ...order,
        createdBy: adminId,
        updatedBy: adminId,
      } as any);
    }
  }
  console.log(`  ✓ ${demoOrders.length} demo work orders`);

  // ── Select Options ─────────────────────────────────────────────────────────
  console.log('Seeding column_options...');
  const OPTIONS: { columnKey: string, value: string, labelAr: string, sortOrder: number }[] = [
    // work_type
    { columnKey: 'work_type', value: 'كهرباء',    labelAr: 'كهرباء',    sortOrder: 1 },
    { columnKey: 'work_type', value: 'اتصالات',   labelAr: 'اتصالات',   sortOrder: 2 },
    { columnKey: 'work_type', value: 'مياه',      labelAr: 'مياه',      sortOrder: 3 },
    { columnKey: 'work_type', value: 'غاز',       labelAr: 'غاز',       sortOrder: 4 },
    { columnKey: 'work_type', value: 'مدني',      labelAr: 'مدني',      sortOrder: 5 },
    // project_type
    { columnKey: 'project_type', value: 'مد كابل',      labelAr: 'مد كابل',      sortOrder: 1 },
    { columnKey: 'project_type', value: 'ترقية شبكة',   labelAr: 'ترقية شبكة',   sortOrder: 2 },
    { columnKey: 'project_type', value: 'شبكة ألياف',   labelAr: 'شبكة ألياف',   sortOrder: 3 },
    { columnKey: 'project_type', value: 'برج اتصالات',  labelAr: 'برج اتصالات',  sortOrder: 4 },
    { columnKey: 'project_type', value: 'خط مياه',      labelAr: 'خط مياه',      sortOrder: 5 },
    { columnKey: 'project_type', value: 'خط غاز',       labelAr: 'خط غاز',       sortOrder: 6 },
    { columnKey: 'project_type', value: 'توصيل طاقة',   labelAr: 'توصيل طاقة',   sortOrder: 7 },
    // procedure
    { columnKey: 'procedure', value: 'حفر',        labelAr: 'حفر',        sortOrder: 1 },
    { columnKey: 'procedure', value: 'حفر يدوي',   labelAr: 'حفر يدوي',   sortOrder: 2 },
    { columnKey: 'procedure', value: 'دفع أنابيب', labelAr: 'دفع أنابيب', sortOrder: 3 },
    { columnKey: 'procedure', value: 'معلق',       labelAr: 'معلق',       sortOrder: 4 },
    // invoice_type
    { columnKey: 'invoice_type', value: 'جزئي',     labelAr: 'جزئي',     sortOrder: 1 },
    { columnKey: 'invoice_type', value: 'نهائي',    labelAr: 'نهائي',    sortOrder: 2 },
    { columnKey: 'invoice_type', value: 'مرحلي',    labelAr: 'مرحلي',    sortOrder: 3 },
  ];

  for (const opt of OPTIONS) {
    const existing = await db.select().from(schema.columnOptions)
      .where(sql`${schema.columnOptions.columnKey} = ${opt.columnKey} AND ${schema.columnOptions.value} = ${opt.value}`);
    if (existing.length === 0) {
      await db.insert(schema.columnOptions).values(opt);
    }
  }
  console.log(`  ✓ ${OPTIONS.length} select options`);

  console.log('\n====== SEED COMPLETE ======\n');

  // Print summary
  const counts = await pool.query(`
    SELECT 'column_groups' as t, COUNT(*) as n FROM column_groups
    UNION ALL SELECT 'column_catalog', COUNT(*) FROM column_catalog
    UNION ALL SELECT 'role_column_permissions', COUNT(*) FROM role_column_permissions
    UNION ALL SELECT 'sectors', COUNT(*) FROM sectors
    UNION ALL SELECT 'regions', COUNT(*) FROM regions
    UNION ALL SELECT 'stages', COUNT(*) FROM stages
    UNION ALL SELECT 'kpi_templates', COUNT(*) FROM kpi_templates
    UNION ALL SELECT 'kpi_rules', COUNT(*) FROM kpi_rules
    UNION ALL SELECT 'work_orders', COUNT(*) FROM work_orders
    ORDER BY t
  `);
  console.table(counts.rows);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
