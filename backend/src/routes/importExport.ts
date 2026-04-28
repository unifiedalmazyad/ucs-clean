import express from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { db, pool } from '../db';
import {
  workOrders, users, sectors, regions, importRuns,
  columnCatalog, columnOptions, columnGroups, excavationPermits, stages,
} from '../db/schema';
import { authenticate, AuthRequest } from '../middleware/auth';
import { eq, asc, sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { DRIZZLE_WO_COLS } from '../services/permissionService';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const ENABLED = process.env.IMPORT_EXPORT_ENABLED !== 'false';

const adminOnly = (req: AuthRequest, res: express.Response, next: express.NextFunction) => {
  if (!ENABLED) return res.status(404).json({ error: 'Feature disabled' });
  if (req.user?.role !== 'ADMIN') return res.status(403).json({ error: 'Admin only' });
  next();
};

// ── Physical DB columns for work_orders (can be written via import) ──────────
const WO_WRITABLE = new Set([
  'order_number','work_type','project_type','client','district','station',
  'length','consultant','procedure','hold_reason','drilling_team','notes',
  'estimated_value','invoice_number','actual_invoice_value','invoice_type',
  'invoice_1','invoice_2','collected_amount','remaining_amount',
  'coordination_cert_number','assignment_date','survey_date',
  'coordination_date','drilling_date','shutdown_date','material_sheet_date',
  'check_sheets_date','metering_sheet_date','gis_completion_date',
  'proc_155_close_date','completion_cert_date','completion_cert_confirm','sector_id','region_id',
  'exec_delay_justified','exec_delay_reason','fin_delay_justified','fin_delay_reason',
  'work_status_classification',
]);

// ── Lookup tables ─────────────────────────────────────────────────────────────
async function getLookups() {
  const [allSectors, allRegions, allColOpts, allCatalogRaw, allStages] = await Promise.all([
    db.select().from(sectors),
    db.select().from(regions),
    db.select().from(columnOptions as any).where(eq((columnOptions as any).active, true)).orderBy(asc((columnOptions as any).sortOrder)),
    // Order by group sort_order first, then column sort_order — matches column page order
    db.execute(sql`
      SELECT cc.id, cc.column_key as "columnKey", cc.physical_key as "physicalKey",
             cc.label_ar as "labelAr", cc.data_type as "dataType",
             cc.sort_order as "sortOrder", cc.group_key as "groupKey",
             cc.is_custom as "isCustom",
             cg.sort_order as "groupSortOrder", cg.name_ar as "groupNameAr"
      FROM column_catalog cc
      JOIN column_groups cg ON cc.group_key = cg.key
      WHERE cc.is_enabled = true
      ORDER BY cg.sort_order, cc.sort_order
    `),
    db.select().from(stages).orderBy(asc(stages.seq)),
  ]);
  const allCatalog = (allCatalogRaw as any).rows ?? allCatalogRaw;
  return { allSectors, allRegions, allColOpts, allCatalog, allStages };
}

// ── Build options map: columnKey → [displayLabel, ...]  ──────────────────────
function buildOptMap(allColOpts: any[], allSectors: any[], allRegions: any[], allStages: any[] = []) {
  const map: Record<string, string[]> = {};
  for (const o of allColOpts) {
    if (!map[o.columnKey]) map[o.columnKey] = [];
    map[o.columnKey].push(o.labelAr || o.value);
  }
  map['sector_id'] = allSectors.map((s: any) => s.nameAr || s.name).filter(Boolean);
  map['region_id'] = allRegions.map((r: any) => r.nameAr || r.name).filter(Boolean);
  map['procedure']  = allStages.map((s: any) => s.nameAr).filter(Boolean);
  // All boolean columns get نعم/لا dropdown
  map['completion_cert_confirm'] = ['نعم', 'لا'];
  map['exec_delay_justified']    = ['نعم', 'لا'];
  map['fin_delay_justified']     = ['نعم', 'لا'];
  return map;
}

// ── Camel-case helper ─────────────────────────────────────────────────────────
const toCamel = (s: string) =>
  s.replace(/_(\d+)/g, (_, n) => n).replace(/_([a-z])/g, (_, c) => c.toUpperCase());

// ── Number to Excel column letter (1→A, 2→B …) ───────────────────────────────
function colLetter(n: number): string {
  let s = '';
  while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
  return s;
}

// ── Escape XML special chars ──────────────────────────────────────────────────
function xmlEscape(s: string) {
  return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Inject data validation XML + RTL into an xlsx buffer ─────────────────────
interface DvEntry { sqref: string; formula: string; }

async function injectXlsxFeatures(buf: Buffer, validations: DvEntry[]): Promise<Buffer> {
  const zip  = await JSZip.loadAsync(buf);
  const path = 'xl/worksheets/sheet1.xml';
  let xml   = await zip.file(path)!.async('string');

  // 1. Enable RTL view (sheetView with rightToLeft="1")
  if (xml.includes('rightToLeft=')) {
    // already set
  } else if (xml.includes('<sheetView ')) {
    xml = xml.replace(/<sheetView /g, '<sheetView rightToLeft="1" ');
  } else if (xml.includes('<sheetViews>')) {
    xml = xml.replace('<sheetViews>', '<sheetViews><sheetView rightToLeft="1" workbookViewId="0"/>');
    // Then remove any duplicate empty sheetView block if any
  }

  // 2. Build dataValidations XML
  if (validations.length > 0) {
    const dvXml = [
      `<dataValidations count="${validations.length}">`,
      ...validations.map(v =>
        `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${v.sqref}"><formula1>${xmlEscape(v.formula)}</formula1></dataValidation>`
      ),
      `</dataValidations>`,
    ].join('');

    // Remove any existing dataValidations block first
    xml = xml.replace(/<dataValidations[\s\S]*?<\/dataValidations>/g, '');

    // In OOXML, dataValidations MUST come BEFORE ignoredErrors/hyperlinks/print elements
    // Insert before <ignoredErrors> if present, otherwise before </worksheet>
    if (xml.includes('<ignoredErrors')) {
      xml = xml.replace('<ignoredErrors', dvXml + '<ignoredErrors');
    } else if (xml.includes('<hyperlinks')) {
      xml = xml.replace('<hyperlinks', dvXml + '<hyperlinks');
    } else if (xml.includes('<printOptions')) {
      xml = xml.replace('<printOptions', dvXml + '<printOptions');
    } else if (xml.includes('<pageMargins')) {
      xml = xml.replace('<pageMargins', dvXml + '<pageMargins');
    } else {
      xml = xml.replace('</worksheet>', dvXml + '</worksheet>');
    }
  }

  zip.file(path, xml);

  // 3. Hide the '_data' lookup sheet in workbook.xml (if it exists)
  const wbFile = zip.file('xl/workbook.xml');
  if (wbFile) {
    let wbXml = await wbFile.async('string');
    // Mark the _data sheet as hidden
    wbXml = wbXml.replace(/ name="_data"([^/]*\/)/, ' name="_data" state="hidden"$1');
    zip.file('xl/workbook.xml', wbXml);
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ── Build the xlsx buffer (plain headers, no styles) using xlsx lib ───────────
function buildXlsxBuffer(
  sheetName: string,
  headers: string[],
  metaRows: string[][],
  metaSheetName: string,
  lookupColumns: string[][] = [],  // Each item = array of values for one column in the lookup sheet
): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([headers]);
  ws['!cols'] = headers.map(h => ({ wch: Math.max(h.replace(/\s*\(.*?\)/g, '').length + 6, 18) }));

  const metaWs = XLSX.utils.aoa_to_sheet([['العمود', 'القيم المسموحة'], ...metaRows]);
  metaWs['!cols'] = [{ wch: 30 }, { wch: 90 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.utils.book_append_sheet(wb, metaWs, metaSheetName);

  // Build hidden lookup sheet for long dropdown lists
  if (lookupColumns.length > 0) {
    const maxRows = Math.max(...lookupColumns.map(c => c.length));
    const aoa: (string | null)[][] = Array.from({ length: maxRows }, (_, i) =>
      lookupColumns.map(col => col[i] ?? null)
    );
    const lookupWs = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, lookupWs, '_data');
  }

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// ────────────────────────────────────────────────────────────────────────────
// GET /api/import/work_orders/template
// ────────────────────────────────────────────────────────────────────────────
router.get('/work_orders/template', authenticate, adminOnly, async (_req, res) => {
  try {
    const { allSectors, allRegions, allColOpts, allCatalog, allStages } = await getLookups();
    const optMap = buildOptMap(allColOpts as any[], allSectors as any[], allRegions as any[], allStages as any[]);

    // All enabled catalog columns are now physical — include all of them
    const cols = allCatalog as any[];

    // Build headers
    const headers = cols.map((c: any) => {
      const hint = (c.dataType === 'date' || c.dataType === 'timestamp') ? ' (YYYY-MM-DD)' : '';
      return c.labelAr + hint;
    });

    // Build validations and metadata
    const validations: DvEntry[] = [];
    const metaRows: string[][] = [];
    const lookupColumns: string[][] = [];  // Columns for the hidden _data sheet

    cols.forEach((c: any, idx: number) => {
      const opts = optMap[c.columnKey] || optMap[c.physicalKey];
      if (opts?.length) {
        const cleanOpts = opts.map((v: string) => v.replace(/,/g, '،'));
        const joined = cleanOpts.join(',');
        let formula: string;
        if (joined.length <= 250) {
          // Short enough for inline formula
          formula = `"${joined}"`;
        } else {
          // Too long for inline — use hidden lookup sheet column
          const lColIdx = lookupColumns.length;
          lookupColumns.push(opts);  // raw values (no comma replacement needed)
          const lLetter = colLetter(lColIdx + 1);
          formula = `_data!$${lLetter}$1:$${lLetter}$${opts.length}`;
        }
        validations.push({ sqref: `${colLetter(idx + 1)}2:${colLetter(idx + 1)}10000`, formula });
        metaRows.push([c.labelAr, opts.join(' | ')]);
      }
    });

    // Add permit columns to the main work_orders sheet (no separate sheet)
    const permitTemplateHeaders = [
      'رقم التصريح',
      'تاريخ بداية التصريح (YYYY-MM-DD)',
      'تاريخ نهاية التصريح (YYYY-MM-DD)',
    ];
    headers.push(...permitTemplateHeaders);

    const rawBuf = buildXlsxBuffer('أوامر العمل', headers, metaRows, 'القوائم', lookupColumns);
    const finalBuf = await injectXlsxFeatures(rawBuf, validations);

    res.setHeader('Content-Disposition', 'attachment; filename="work_orders_template.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(finalBuf);
  } catch (err) {
    console.error('[TEMPLATE WO ERROR]', err);
    res.status(500).json({ error: 'فشل في إنشاء القالب' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/import/users/template
// ────────────────────────────────────────────────────────────────────────────
router.get('/users/template', authenticate, adminOnly, async (_req, res) => {
  try {
    const { allSectors, allRegions } = await getLookups();
    const ROLES = ['ADMIN','MANAGER','OPERATOR','COORDINATOR','GIS','FINANCE','ASSISTANT','VIEWER','REGION_MANAGER','SECTOR_MANAGER','COR'];
    const sectorNames = allSectors.map((s: any) => s.nameAr || s.name).filter(Boolean);
    const regionNames = allRegions.map((r: any) => r.nameAr || r.name).filter(Boolean);

    const userCols = [
      { key: 'username',     label: 'اسم المستخدم *', opts: null },
      { key: 'full_name',    label: 'الاسم الكامل',   opts: null },
      { key: 'role',         label: 'الدور',           opts: ROLES },
      { key: 'sector_id',    label: 'القطاع',          opts: sectorNames },
      { key: 'region_id',    label: 'المنطقة',         opts: regionNames },
      { key: 'active',       label: 'نشط',             opts: ['نعم', 'لا'] },
      { key: 'employee_id',  label: 'الرقم الوظيفي',  opts: null },
      { key: 'phone_number', label: 'رقم الهاتف',      opts: null },
      { key: 'email',        label: 'البريد الإلكتروني', opts: null },
    ];

    const headers = userCols.map(c => c.label);
    const validations: DvEntry[] = [];
    const metaRows: string[][] = [];

    userCols.forEach((c, idx) => {
      if (c.opts?.length) {
        const joined = (c.opts as string[]).map(v => v.replace(/,/g, '،')).join(',');
        const formula = joined.length <= 250 ? `"${joined}"` : `"${(c.opts as string[]).slice(0,10).join(',')}"`;
        validations.push({ sqref: `${colLetter(idx + 1)}2:${colLetter(idx + 1)}10000`, formula });
        metaRows.push([c.label, (c.opts as string[]).join(' | ')]);
      }
    });

    const rawBuf = buildXlsxBuffer('المستخدمين', headers, metaRows, 'القوائم');
    const finalBuf = await injectXlsxFeatures(rawBuf, validations);

    res.setHeader('Content-Disposition', 'attachment; filename="users_template.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(finalBuf);
  } catch (err) {
    console.error('[TEMPLATE USERS ERROR]', err);
    res.status(500).json({ error: 'فشل في إنشاء القالب' });
  }
});

// ── Parse uploaded Excel → array of objects ───────────────────────────────────
function parseExcel(buffer: Buffer): { headers: string[]; rows: Record<string, any>[] } {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '', raw: false });
  const headers = raw.length > 0 ? Object.keys(raw[0]) : [];
  return { headers, rows: raw };
}

// ── Resolve WO payload from a row using catalog label→field mapping ───────────
function buildWoPayload(
  row: Record<string, any>,
  allCatalog: any[],
  optMap: Record<string, string[]>,
  allColOpts: any[],
  sectorMap: Map<string, string>,
  regionMap: Map<string, string>,
  stageMap?: Map<string, string>, // stage nameAr (lowercase) → stage UUID
): Record<string, any> {
  const payload: Record<string, any> = {};

  const labelIndex: Record<string, any> = {};
  for (const c of allCatalog) {
    labelIndex[c.labelAr] = c;
    labelIndex[c.labelAr.replace(/\s*\(.*?\)\s*$/, '').trim()] = c;
  }

  const optValueMap: Record<string, Map<string, string>> = {};
  for (const o of allColOpts) {
    if (!optValueMap[o.columnKey]) optValueMap[o.columnKey] = new Map();
    optValueMap[o.columnKey].set((o.labelAr || o.value).trim(), o.value);
  }

  const parseDate = (v: any): Date | null => {
    if (!v) return null;
    if (v instanceof Date) return v;
    const d = new Date(String(v));
    return isNaN(d.getTime()) ? null : d;
  };
  const toNum = (v: any): number | null => {
    const n = parseFloat(String(v).replace(/,/g, ''));
    return isNaN(n) ? null : n;
  };

  // dynamicFields: columns that exist as physical ALTER TABLE columns but are
  // not in the Drizzle schema. Kept separately so commit can run raw SQL UPDATE.
  const dynamicFields: Record<string, any> = {};

  for (const [header, rawVal] of Object.entries(row)) {
    const headerClean = header.replace(/\s*\(.*?\)\s*$/, '').trim();
    const catEntry = labelIndex[header] || labelIndex[headerClean];
    if (!catEntry) continue;

    const physKey = catEntry.physicalKey || catEntry.columnKey;
    const camelKey = toCamel(physKey);
    const val = typeof rawVal === 'string' ? rawVal.trim() : rawVal;

    // Skip empty cells — do not overwrite existing DB values with null
    if (val === '' || val === null || val === undefined) continue;

    let converted: any;
    if (physKey === 'sector_id') {
      const id = sectorMap.get(String(val).toLowerCase());
      if (!id) throw new Error(`القطاع غير معرّف في النظام: "${val}"`);
      converted = id;
    } else if (physKey === 'region_id') {
      const id = regionMap.get(String(val).toLowerCase());
      if (!id) throw new Error(`المنطقة غير معرّفة في النظام: "${val}"`);
      converted = id;
    } else if (catEntry.dataType === 'date' || catEntry.dataType === 'timestamp') {
      converted = parseDate(val);
    } else if (catEntry.dataType === 'currency' || catEntry.dataType === 'number' || catEntry.dataType === 'numeric') {
      converted = toNum(val);
    } else if (catEntry.dataType === 'boolean') {
      converted = val === 'نعم' || val === 'true' || val === 'yes' || val === true;
    } else if (catEntry.dataType === 'select') {
      const vMap = optValueMap[catEntry.columnKey];
      converted = vMap?.get(String(val)) ?? (val !== '' ? String(val) : null);
    } else {
      converted = val !== '' ? String(val) : null;
    }

    // All catalog columns are now physical. Route by Drizzle knowledge:
    // - DRIZZLE_WO_COLS → payload (Drizzle ORM handles it)
    // - otherwise → dynamicFields (raw SQL UPDATE after Drizzle op)
    if (DRIZZLE_WO_COLS.has(camelKey)) {
      payload[camelKey] = converted;
      if (physKey === 'procedure' && converted && stageMap) {
        const stageId = stageMap.get(String(converted).trim().toLowerCase());
        if (!stageId) throw new Error(`المرحلة غير معرّفة في النظام: "${converted}"`);
        payload['stageId'] = stageId;
      }
    } else {
      dynamicFields[physKey] = converted;
    }
  }

  // __dynamicFields: for commit to run raw SQL UPDATE for dynamic physical cols
  // __customFields:  same data as __dynamicFields, kept for customFields JSONB sync
  payload.__dynamicFields = dynamicFields;
  payload.__customFields  = dynamicFields; // backward-compat JSONB sync
  return payload;
}

// ────────────────────────────────────────────────────────────────────────────
// POST /api/import/work_orders/preview
// ────────────────────────────────────────────────────────────────────────────
router.post('/work_orders/preview', authenticate, adminOnly, upload.single('file'), async (req: AuthRequest, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'لم يتم رفع ملف' });
    const { rows } = parseExcel(req.file.buffer);
    if (!rows.length) return res.status(400).json({ error: 'الملف فارغ' });

    const { allCatalog } = await getLookups();
    const existingResult = await pool.query(`SELECT order_number, work_type FROM work_orders WHERE status != 'CANCELLED'`);
    const existingSet = new Set(existingResult.rows.map((r: any) =>
      `${(r.order_number || '').trim().toLowerCase()}|${(r.work_type || '').trim().toLowerCase()}`
    ));

    let insertCount = 0, updateCount = 0;
    const errors: { row: number; message: string }[] = [];
    const orderNoLabel  = (allCatalog as any[]).find((c: any) => c.columnKey === 'order_number')?.labelAr || 'امر العمل';
    const workTypeLabel = (allCatalog as any[]).find((c: any) => c.columnKey === 'work_type')?.labelAr   || 'نوع العمل';

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;
      const orderNumber = String(row[orderNoLabel] || row['امر العمل'] || row['order_number'] || '').trim();
      if (!orderNumber) { errors.push({ row: rowNum, message: 'رقم الأمر مطلوب' }); continue; }
      const workType = String(row[workTypeLabel] || row['نوع العمل'] || row['work_type'] || '').trim();
      if (!workType) { errors.push({ row: rowNum, message: 'نوع العمل مطلوب (المفتاح: رقم الأمر + نوع العمل)' }); continue; }
      const compositeKey = `${orderNumber.toLowerCase()}|${workType.toLowerCase()}`;
      existingSet.has(compositeKey) ? updateCount++ : insertCount++;
    }

    // Count rows with inline permit data (from main sheet columns)
    const validPermitRows = rows.filter(r => {
      const pn = String(r['رقم التصريح'] || '').trim();
      return pn !== '';
    }).length;

    res.json({
      insertCount, updateCount, errorCount: errors.length, errors, totalRows: rows.length,
      permitRows: validPermitRows,
    });
  } catch (err) {
    console.error('[PREVIEW WO ERROR]', err);
    res.status(500).json({ error: 'فشل في قراءة الملف' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/import/work_orders/commit
// ────────────────────────────────────────────────────────────────────────────
router.post('/work_orders/commit', authenticate, adminOnly, upload.single('file'), async (req: AuthRequest, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'لم يتم رفع ملف' });
    const { rows } = parseExcel(req.file.buffer);

    const { allSectors, allRegions, allColOpts, allCatalog, allStages } = await getLookups();
    const optMap = buildOptMap(allColOpts as any[], allSectors as any[], allRegions as any[], allStages as any[]);
    const sectorMap = new Map<string, string>(allSectors.map((s: any) => [String(s.nameAr || s.name).trim().toLowerCase(), s.id]));
    const regionMap = new Map<string, string>(allRegions.map((r: any) => [String(r.nameAr || r.name).trim().toLowerCase(), r.id]));
    const stageMapCommit = new Map<string, string>((allStages as any[]).map((s: any) => [String(s.nameAr || '').trim().toLowerCase(), s.id]));

    const existingResult = await pool.query(`SELECT id, order_number, work_type FROM work_orders WHERE status != 'CANCELLED'`);
    const existingMap = new Map(existingResult.rows.map((r: any) => [
      `${(r.order_number || '').trim().toLowerCase()}|${(r.work_type || '').trim().toLowerCase()}`,
      r.id as string,
    ]));

    const orderNoLabel  = (allCatalog as any[]).find((c: any) => c.columnKey === 'order_number')?.labelAr || 'امر العمل';
    const workTypeLabel = (allCatalog as any[]).find((c: any) => c.columnKey === 'work_type')?.labelAr   || 'نوع العمل';

    let inserted = 0, updated = 0, failed = 0;
    let permitInserted = 0;
    const errors: { row: number; message: string }[] = [];

    const parseDate = (v: any): Date | null => {
      if (!v || String(v).trim() === '') return null;
      if (v instanceof Date) return v;
      const d = new Date(String(v));
      return isNaN(d.getTime()) ? null : d;
    };

    const ISO_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]+)?$/;

    // Each row gets its own transaction — a single row failure never aborts the rest
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;

      // Validate required fields before entering transaction
      const orderNumber = String(row[orderNoLabel] || row['امر العمل'] || row['order_number'] || '').trim();
      if (!orderNumber) { errors.push({ row: rowNum, message: 'رقم الأمر مطلوب' }); failed++; continue; }
      const workType = String(row[workTypeLabel] || row['نوع العمل'] || row['work_type'] || '').trim();
      if (!workType) { errors.push({ row: rowNum, message: 'نوع العمل مطلوب (المفتاح: رقم الأمر + نوع العمل)' }); failed++; continue; }

      let rowDynamic: { woId: string; payload: Record<string, any> } | null = null;

      try {
        await db.transaction(async (tx) => {
          const rawPayload = buildWoPayload(row, allCatalog as any[], optMap, allColOpts as any[], sectorMap, regionMap, stageMapCommit);
          const { __dynamicFields: dynamicPayload, __customFields: customPayload, ...corePayload } = rawPayload;
          corePayload.orderNumber = orderNumber;
          corePayload.updatedAt   = new Date();

          // ── Normalize invoice_type to canonical values only ────────────────
          const INVOICE_TYPE_MAP: Record<string, string> = {
            'مرحلي':      'جزئي',
            'جزئي نهائي': 'جزئي',
            'جزئي اولى':  'جزئي',
          };
          if (corePayload.invoiceType) {
            corePayload.invoiceType = INVOICE_TYPE_MAP[corePayload.invoiceType] ?? corePayload.invoiceType;
          }

          // ── Auto-compute financial fields ──────────────────────────────────
          if (corePayload.invoiceType) {
            const inv1 = Number(corePayload.invoice1)        || 0;
            const inv2 = Number(corePayload.invoice2)        || 0;
            const est  = Number(corePayload.estimatedValue)  || 0;
            const totalInvoiced = inv1 + inv2;
            corePayload.collectedAmount = totalInvoiced;
            corePayload.remainingAmount = est - totalInvoiced;
          }

          let woId: string | null = null;
          const compositeKey = `${orderNumber.toLowerCase()}|${workType.toLowerCase()}`;
          const existingId = existingMap.get(compositeKey);
          if (existingId) {
            const [existing] = await tx.select({ customFields: workOrders.customFields })
              .from(workOrders).where(eq(workOrders.id, existingId));
            const mergedCustom = { ...(existing?.customFields ?? {}), ...customPayload };
            await tx.update(workOrders)
              .set({ ...corePayload, customFields: mergedCustom })
              .where(eq(workOrders.id, existingId));
            woId = existingId as string;
            updated++;
          } else {
            const [newWo] = await tx.insert(workOrders).values({
              ...corePayload,
              customFields: customPayload,
              createdAt: new Date(),
              status: 'PENDING',
            }).returning({ id: workOrders.id });
            woId = newWo?.id ?? null;
            inserted++;
          }

          // ── Handle inline permit data (from same row columns) ──────────────
          const permitNo    = String(row['رقم التصريح'] || '').trim();
          const permitStart = String(row['تاريخ بداية التصريح (YYYY-MM-DD)'] || row['تاريخ بداية التصريح'] || '').trim();
          const permitEnd   = String(row['تاريخ نهاية التصريح (YYYY-MM-DD)'] || row['تاريخ نهاية التصريح'] || '').trim();

          if (woId && permitNo) {
            const [existingPermit] = await tx.select({ id: excavationPermits.id })
              .from(excavationPermits)
              .where(sql`work_order_id = ${woId} AND permit_no = ${permitNo}`)
              .limit(1);
            if (existingPermit) {
              await tx.update(excavationPermits)
                .set({ startDate: parseDate(permitStart), endDate: parseDate(permitEnd) })
                .where(eq(excavationPermits.id, existingPermit.id));
            } else {
              await tx.insert(excavationPermits).values({
                workOrderId: woId, permitNo,
                startDate: parseDate(permitStart), endDate: parseDate(permitEnd),
                isExtension: false, extensionNumber: 0,
              });
            }
            permitInserted++;
          }

          // Capture dynamic payload — executed after tx commits (avoids pool deadlock)
          if (woId && dynamicPayload && Object.keys(dynamicPayload).length > 0) {
            rowDynamic = { woId, payload: dynamicPayload };
          }
        });

        // Execute dynamic physical-column updates for this row after its transaction commits
        if (rowDynamic) {
          const { woId, payload: dynPayload } = rowDynamic as { woId: string; payload: Record<string, any> };
          const entries = Object.entries(dynPayload).filter(([, v]) => v !== undefined);
          if (entries.length > 0) {
            const setClauses = entries.map(([k], idx) => `"${k}" = $${idx + 2}`).join(', ');
            const vals = entries.map(([, v]) => {
              if (typeof v === 'string' && ISO_RE.test(v)) {
                const d = new Date(v); return isNaN(d.getTime()) ? v : d;
              }
              return v;
            });
            await pool.query(`UPDATE work_orders SET ${setClauses} WHERE id = $1`, [woId, ...vals]);
          }
        }
      } catch (rowErr: any) {
        errors.push({ row: rowNum, message: rowErr?.message || 'خطأ غير محدد' });
        failed++;
      }
    }

    await db.insert(importRuns).values({
      module: 'work_orders', uploadedBy: req.user!.id,
      status: failed > 0 && inserted + updated === 0 ? 'FAILED' : 'DONE',
      inserted, updated, failed, errorsJson: errors,
    });

    res.json({ inserted, updated, failed, errors, permitInserted, permitFailed: 0, permitErrors: [] });
  } catch (err) {
    console.error('[COMMIT WO ERROR]', err);
    res.status(500).json({ error: 'فشل في استيراد البيانات' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/import/users/preview
// ────────────────────────────────────────────────────────────────────────────
router.post('/users/preview', authenticate, adminOnly, upload.single('file'), async (req: AuthRequest, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'لم يتم رفع ملف' });
    const { rows } = parseExcel(req.file.buffer);
    if (!rows.length) return res.status(400).json({ error: 'الملف فارغ أو لا يحتوي على بيانات — تأكد من استخدام قالب المستخدمين الصحيح' });

    const existing = await db.select({ username: users.username }).from(users);
    const existingSet = new Set(existing.map(u => (u.username || '').trim().toLowerCase()));

    let insertCount = 0, updateCount = 0;
    const errors: { row: number; message: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;
      const username = String(row['اسم المستخدم *'] || row['اسم المستخدم'] || row['username'] || '').trim();
      if (!username) { errors.push({ row: rowNum, message: 'اسم المستخدم مطلوب (تأكد أن رأس العمود: "اسم المستخدم *")' }); continue; }
      existingSet.has(username.toLowerCase()) ? updateCount++ : insertCount++;
    }

    const allBlank = insertCount === 0 && updateCount === 0 && errors.length === rows.length;
    res.json({ insertCount, updateCount, errorCount: errors.length, errors, totalRows: rows.length, allBlank });
  } catch (err) {
    console.error('[PREVIEW USERS ERROR]', err);
    res.status(500).json({ error: 'فشل في قراءة الملف' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/import/users/commit
// ────────────────────────────────────────────────────────────────────────────
router.post('/users/commit', authenticate, adminOnly, upload.single('file'), async (req: AuthRequest, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'لم يتم رفع ملف' });
    const { rows } = parseExcel(req.file.buffer);

    const { allSectors, allRegions } = await getLookups();
    const sectorMap = new Map<string, string>(allSectors.map((s: any) => [String(s.nameAr || s.name).trim().toLowerCase(), s.id]));
    const regionMap = new Map<string, string>(allRegions.map((r: any) => [String(r.nameAr || r.name).trim().toLowerCase(), r.id]));

    const existing = await db.select({ id: users.id, username: users.username }).from(users);
    const existingMap = new Map(existing.map(u => [(u.username || '').trim().toLowerCase(), u.id]));

    let inserted = 0, updated = 0, failed = 0;
    const errors: { row: number; message: string }[] = [];
    const DEFAULT_PASS = await bcrypt.hash('Welcome@123', 10);

    await db.transaction(async (tx) => {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2;
        try {
          const username = String(row['اسم المستخدم *'] || row['اسم المستخدم'] || row['username'] || '').trim();
          if (!username) { errors.push({ row: rowNum, message: 'اسم المستخدم مطلوب (تأكد أن رأس العمود: "اسم المستخدم *")' }); failed++; continue; }

          const activeRaw = String(row['نشط'] || row['active'] || 'نعم').trim();
          const active = activeRaw === 'نعم' || activeRaw.toLowerCase() === 'true';
          const sectorName = String(row['القطاع'] || row['sector_id'] || '').trim().toLowerCase();
          const regionName = String(row['المنطقة'] || row['region_id'] || '').trim().toLowerCase();

          const payload: Record<string, any> = {
            username,
            fullName:    String(row['الاسم الكامل']       || row['full_name']    || '').trim() || null,
            role:        String(row['الدور']               || row['role']         || 'OPERATOR').trim() || 'OPERATOR',
            sectorId:    sectorMap.get(sectorName) ?? null,
            regionId:    regionMap.get(regionName) ?? null,
            active,
            employeeId:  String(row['الرقم الوظيفي']      || row['employee_id']  || '').trim() || null,
            phoneNumber: String(row['رقم الهاتف']          || row['phone_number'] || '').trim() || null,
            email:       String(row['البريد الإلكتروني']   || row['email']        || '').trim() || null,
          };

          const existingId = existingMap.get(username.toLowerCase());
          if (existingId) {
            await tx.update(users).set(payload).where(eq(users.id, existingId));
            updated++;
          } else {
            await tx.insert(users).values({ ...payload, passwordHash: DEFAULT_PASS, createdAt: new Date() });
            inserted++;
          }
        } catch (rowErr: any) {
          errors.push({ row: rowNum, message: rowErr?.message || 'خطأ غير محدد' });
          failed++;
        }
      }
    });

    await db.insert(importRuns).values({
      module: 'users', uploadedBy: req.user!.id,
      status: failed > 0 && inserted + updated === 0 ? 'FAILED' : 'DONE',
      inserted, updated, failed, errorsJson: errors,
    });

    res.json({ inserted, updated, failed, errors, note: 'كلمة المرور الافتراضية للمستخدمين الجدد: Welcome@123' });
  } catch (err) {
    console.error('[COMMIT USERS ERROR]', err);
    res.status(500).json({ error: 'فشل في استيراد المستخدمين' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/import/export/users  — export all users to XLSX
// ────────────────────────────────────────────────────────────────────────────
router.get('/export/users', authenticate, adminOnly, async (_req, res) => {
  try {
    const { allSectors, allRegions } = await getLookups();
    const sectorNameMap = new Map(allSectors.map((s: any) => [s.id, s.nameAr || s.name]));
    const regionNameMap = new Map(allRegions.map((r: any) => [r.id, r.nameAr || r.name]));

    const allUsers: any[] = await db.select().from(users).orderBy(asc(users.createdAt)) as any;

    const headers = ['اسم المستخدم *', 'الاسم الكامل', 'الدور', 'القطاع', 'المنطقة', 'نشط', 'الرقم الوظيفي', 'رقم الهاتف', 'البريد الإلكتروني'];
    const data = allUsers.map(u => [
      u.username ?? '',
      u.fullName ?? '',
      u.role ?? '',
      sectorNameMap.get(u.sectorId) ?? '',
      regionNameMap.get(u.regionId) ?? '',
      u.active ? 'نعم' : 'لا',
      u.employeeId ?? '',
      u.phoneNumber ?? '',
      u.email ?? '',
    ]);

    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length + 4, 18) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'المستخدمين');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', `attachment; filename="users_export_${new Date().toISOString().slice(0,10)}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    console.error('[EXPORT USERS ERROR]', err);
    res.status(500).json({ error: 'فشل في تصدير المستخدمين' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/import/export/work_orders  — export all work orders + permits to XLSX
// ────────────────────────────────────────────────────────────────────────────
router.get('/export/work_orders', authenticate, adminOnly, async (_req, res) => {
  try {
    const { allCatalog, allSectors, allRegions, allStages } = await getLookups();
    // Use raw SQL (SELECT *) so physical columns added via ALTER TABLE (not in Drizzle schema) are included
    const allWosResult = await pool.query('SELECT * FROM work_orders ORDER BY created_at ASC');
    const allWos: Record<string, any>[] = allWosResult.rows;
    const allPerms: any[] = await db.select().from(excavationPermits).orderBy(asc(excavationPermits.createdAt)) as any;

    // Build latest-permit map: workOrderId → latest permit
    const latestPermitMap = new Map<string, any>();
    // allPerms is ordered by createdAt asc; iterate in reverse to keep latest
    for (const p of [...allPerms].reverse()) {
      if (!latestPermitMap.has(p.workOrderId)) latestPermitMap.set(p.workOrderId, p);
    }

    // FK resolution maps: UUID → Arabic name
    const sectorMap = new Map<string, string>(allSectors.map((s: any) => [s.id, s.nameAr || s.name || '']));
    const regionMap = new Map<string, string>(allRegions.map((r: any) => [r.id, r.nameAr || r.name || '']));
    const stageMap  = new Map<string, string>((allStages as any[]).map((s: any) => [s.id, s.nameAr || '']));

    // All catalog columns are now physical — include all of them in the export
    const woCols = allCatalog as any[];
    const woHeaders = [
      ...woCols.map((c: any) => c.labelAr),
      'رقم التصريح',
      'تاريخ بداية التصريح (YYYY-MM-DD)',
      'تاريخ نهاية التصريح (YYYY-MM-DD)',
    ];

    const toCamelKey = (s: string) => s.replace(/_(\d+)/g, (_: string, n: string) => n).replace(/_([a-z])/g, (_: string, l: string) => l.toUpperCase());

    const woData = allWos.map(wo => {
      const coreVals = woCols.map((c: any) => {
        const physKey = c.physicalKey || c.columnKey;
        const camel = toCamelKey(physKey);
        // Check camelCase (Drizzle ORM result) then snake_case (raw SQL SELECT * result) then customFields fallback
        let val = (wo as any)[camel] ?? (wo as any)[physKey] ?? (wo.customFields?.[physKey] ?? '');
        if (val instanceof Date) val = val.toISOString().slice(0, 10);
        // Resolve FK UUIDs → Arabic names
        if (physKey === 'sector_id' && val) val = sectorMap.get(val) ?? val;
        else if (physKey === 'region_id' && val) val = regionMap.get(val) ?? val;
        else if (physKey === 'stage_id'  && val) val = stageMap.get(val)  ?? val;
        return val ?? '';
      });
      const perm = latestPermitMap.get(wo.id);
      coreVals.push(
        perm?.permitNo || '',
        perm?.startDate ? new Date(perm.startDate).toISOString().slice(0, 10) : '',
        perm?.endDate   ? new Date(perm.endDate).toISOString().slice(0, 10)   : '',
      );
      return coreVals;
    });

    const woWs = XLSX.utils.aoa_to_sheet([woHeaders, ...woData]);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, woWs, 'أوامر العمل');
    const buf = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));

    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="export_work_orders_${dateStr}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    console.error('[EXPORT WO ERROR]', err);
    res.status(500).json({ error: 'فشل في تصدير البيانات' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/import/runs
// ────────────────────────────────────────────────────────────────────────────
router.get('/runs', authenticate, adminOnly, async (_req, res) => {
  try {
    const runs = await db
      .select({
        id: importRuns.id,
        module: importRuns.module,
        uploadedAt: importRuns.uploadedAt,
        status: importRuns.status,
        inserted: importRuns.inserted,
        updated: importRuns.updated,
        failed: importRuns.failed,
        errorsJson: importRuns.errorsJson,
        uploaderUsername: users.username,
        uploaderFullName: users.fullName,
      })
      .from(importRuns)
      .leftJoin(users, eq(importRuns.uploadedBy, users.id))
      .orderBy(sql`${importRuns.uploadedAt} DESC`)
      .limit(50);
    res.json(runs);
  } catch (err) {
    console.error('[RUNS ERROR]', err);
    res.status(500).json({ error: 'فشل في جلب السجلات' });
  }
});

export default router;
