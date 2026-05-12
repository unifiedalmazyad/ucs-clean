import React, { useState, useMemo } from 'react';
import { X, SlidersHorizontal, Download, FileText, RefreshCw } from 'lucide-react';
import type ExcelJS from 'exceljs';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KpiCol {
  key: string;
  dataKey?: string;  // physical row key — camelCase(physicalKey || columnKey)
  labelAr: string;
  labelEn: string;
  dataType?: string;
  virtual?: boolean;
}

export interface ReportHeader {
  logoRightUrl:        string | null;
  logoLeftUrl:         string | null;
  companyNameAr:       string | null;
  companyNameEn:       string | null;
  logoRightWidthExcel: number;
  logoLeftWidthExcel:  number;
  logoRightWidthPdf:   number;
  logoLeftWidthPdf:    number;
}

export interface KpiDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;       // Arabic
  titleEn?: string;    // English
  icon?: React.ElementType;
  iconColorCls?: string;
  rows: any[];
  loading: boolean;
  availableCols: KpiCol[];
  colKeys: string[];
  onColKeysChange: (keys: string[]) => void;
  maxCols?: number;
  lang: string;
  /** Column key whose values are summed for a footer total row */
  totalKey?: string;
  totalLabel?: string;
  totalLabelEn?: string;
  /** Pre-computed total (used when totalKey is provided) */
  totalValue?: number;
  /** Custom cell renderer — return null to fall back to default */
  renderCell?: (row: any, col: KpiCol) => React.ReactNode | null;
  /** Company branding for PDF/Excel exports */
  reportHeader?: ReportHeader;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NUM_TYPES = new Set(['numeric', 'integer', 'float', 'decimal', 'number']);
const DATE_TYPES = new Set(['date', 'timestamp', 'timestamp with time zone']);

export function isNumCol(col: KpiCol) { return NUM_TYPES.has(col.dataType ?? ''); }
export function isDateCol(col: KpiCol) { return DATE_TYPES.has(col.dataType ?? ''); }

function toSnake(s: string) { return s.replace(/([A-Z])/g, '_$1').toLowerCase(); }
export function getVal(row: any, key: string) { return row[key] ?? row[toSnake(key)]; }
export function fmtNum(v: any) {
  return v != null && v !== '' ? Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';
}
export function fmtDate(v: any) {
  try { return v ? new Date(v).toLocaleDateString('en-CA') : '—'; } catch { return '—'; }
}
export function fmtCell(v: any, col: KpiCol) {
  if (isDateCol(col)) return fmtDate(v);
  if (isNumCol(col))  return fmtNum(v);
  return String(v ?? '—');
}

// Built-in labels for generalStatus virtual column
const STATUS_LABELS: Record<string, { ar: string; en: string; cls: string }> = {
  EXEC_OVERDUE:  { ar: 'متأخر (تنفيذ)',  en: 'Overdue (Exec)',  cls: 'bg-red-100 text-red-700' },
  FIN_OVERDUE:   { ar: 'متأخر (مالي)',   en: 'Overdue (Fin)',   cls: 'bg-red-100 text-red-700' },
  EXEC_WARNING:  { ar: 'تنبيه (تنفيذ)',  en: 'Warning (Exec)',  cls: 'bg-amber-100 text-amber-700' },
  FIN_WARNING:   { ar: 'تنبيه (مالي)',   en: 'Warning (Fin)',   cls: 'bg-amber-100 text-amber-700' },
  EXEC_ON_TIME:  { ar: 'منتظم (تنفيذ)',  en: 'On Time (Exec)',  cls: 'bg-emerald-100 text-emerald-700' },
  FIN_ON_TIME:   { ar: 'منتظم (مالي)',   en: 'On Time (Fin)',   cls: 'bg-emerald-100 text-emerald-700' },
  EXEC_COMPLETED:{ ar: 'منجز (تنفيذ)',   en: 'Done (Exec)',     cls: 'bg-indigo-100 text-indigo-700' },
  FIN_COMPLETED: { ar: 'منجز (مالي)',    en: 'Done (Fin)',      cls: 'bg-indigo-100 text-indigo-700' },
};

function defaultRenderCell(row: any, col: KpiCol, lang: string): React.ReactNode {
  const v = getVal(row, col.dataKey ?? col.key);

  // generalStatus → colored badge
  if (col.key === 'generalStatus') {
    const info = STATUS_LABELS[v as string];
    if (info) {
      return (
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${info.cls}`}>
          {lang === 'en' ? info.en : info.ar}
        </span>
      );
    }
    return <span className="text-slate-400">—</span>;
  }

  // metricDays → "X يوم"
  if (col.key === 'metricDays') {
    return v != null
      ? <span dir="ltr" className="text-indigo-700 font-semibold">{v} <span className="text-slate-400 font-normal">{lang === 'en' ? 'd' : 'يوم'}</span></span>
      : '—';
  }

  return null; // use default
}

// ─── Inline Column Picker ─────────────────────────────────────────────────────

function ColPicker({
  availableCols, selectedKeys, onSave, onClose, maxCols = 10, lang,
}: {
  availableCols: KpiCol[]; selectedKeys: string[];
  onSave: (keys: string[]) => void; onClose: () => void;
  maxCols?: number; lang: string;
}) {
  const [selected, setSelected] = useState<string[]>(
    selectedKeys.filter(k => availableCols.some(c => c.key === k))
  );
  const atMax = selected.length >= maxCols;

  const toggle = (key: string) => setSelected(prev => {
    if (prev.includes(key)) return prev.filter(k => k !== key);
    if (prev.length >= maxCols) return prev;
    return [...prev, key];
  });

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" dir={lang === 'en' ? 'ltr' : 'rtl'}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="font-bold text-slate-800">{lang === 'en' ? 'Select Columns' : 'اختيار الأعمدة'}</h2>
            <p className={`text-xs mt-0.5 ${atMax ? 'text-amber-600 font-medium' : 'text-slate-400'}`}>
              {selected.length}/{maxCols} {lang === 'en' ? 'columns' : 'أعمدة'}
              {atMax && (lang === 'en' ? ' — Max reached' : ' — الحد الأقصى')}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 max-h-96 overflow-y-auto space-y-1">
          {availableCols.map(col => {
            const isChecked = selected.includes(col.key);
            const isDisabled = !isChecked && atMax;
            return (
              <label
                key={col.key}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                  isDisabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-slate-50 cursor-pointer'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  disabled={isDisabled}
                  onChange={() => toggle(col.key)}
                  className="w-4 h-4 accent-indigo-600"
                />
                <span className="text-sm text-slate-700 flex-1">
                  {lang === 'en' ? col.labelEn : col.labelAr}
                </span>
                {col.virtual && (
                  <span className="text-xs text-slate-400 bg-slate-100 px-1.5 rounded">
                    {lang === 'en' ? 'Calc' : 'محسوب'}
                  </span>
                )}
              </label>
            );
          })}
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-slate-200">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-slate-600 text-sm hover:bg-slate-50"
          >
            {lang === 'en' ? 'Cancel' : 'إلغاء'}
          </button>
          <button
            onClick={() => { onSave(selected); onClose(); }}
            className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700"
          >
            {lang === 'en' ? 'Save' : 'حفظ'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── KpiDrawer ────────────────────────────────────────────────────────────────

export default function KpiDrawer({
  open, onClose,
  title, titleEn,
  icon: Icon,
  iconColorCls = 'text-indigo-500',
  rows, loading,
  availableCols, colKeys, onColKeysChange,
  maxCols = 10,
  lang,
  totalKey, totalLabel = 'الإجمالي', totalLabelEn = 'Total', totalValue,
  renderCell,
  reportHeader,
}: KpiDrawerProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const isAr = lang !== 'en';

  const visibleCols = useMemo(
    () => colKeys
      .map(k => availableCols.find(c => c.key === k))
      .filter(Boolean) as KpiCol[],
    [colKeys, availableCols]
  );

  const totalColVisible = totalKey ? colKeys.includes(totalKey) : false;

  const computedTotal = useMemo(() => {
    if (totalValue != null) return totalValue;
    if (!totalKey) return 0;
    return rows.reduce((s, r) => s + (Number(getVal(r, totalKey)) || 0), 0);
  }, [rows, totalKey, totalValue]);

  const handleExcel = async () => {
    try {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const sheetName = (isAr ? title : (titleEn ?? title)).replace(/[*?:\\/\[\]]/g, '').slice(0, 31);
    const ws = wb.addWorksheet(sheetName);
    ws.views = [{ rightToLeft: isAr }];
    const nc = visibleCols.length;

    const setCenter = (rowNum: number, val: string, bold: boolean, size: number, color: string) => {
      if (nc > 1) ws.mergeCells(rowNum, 1, rowNum, nc);
      const row = ws.getRow(rowNum);
      row.height = bold ? 28 : 16;
      const cell = row.getCell(1);
      cell.value = val;
      cell.font = { bold, size, color: { argb: color } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    };

    const companyName = (isAr ? reportHeader?.companyNameAr : reportHeader?.companyNameEn) ?? '';
    const displayTitle = isAr ? title : (titleEn ?? title);
    let rowPtr = 1;
    if (companyName) setCenter(rowPtr++, companyName, true, 14, 'FF334155');
    setCenter(rowPtr++, displayTitle, true, 12, 'FF334155');
    setCenter(rowPtr++, `${isAr ? 'التاريخ:' : 'Date:'} ${new Date().toLocaleDateString(isAr ? 'ar-SA' : 'en-CA')}`, false, 10, 'FF64748b');
    ws.getRow(rowPtr++).height = 6;

    const HR = ws.getRow(rowPtr);
    HR.height = 22;
    visibleCols.forEach((col, i) => {
      const cell = HR.getCell(i + 1);
      cell.value = isAr ? col.labelAr : col.labelEn;
      cell.font  = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top:    { style: 'thin', color: { argb: 'FFFFFFFF' } },
        left:   { style: 'thin', color: { argb: 'FFFFFFFF' } },
        bottom: { style: 'thin', color: { argb: 'FFFFFFFF' } },
        right:  { style: 'thin', color: { argb: 'FFFFFFFF' } },
      };
    });
    const dataStartRow = ++rowPtr;

    const bdrStyle: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FFcbd5e1' } };
    const allBdr = { top: bdrStyle, left: bdrStyle, bottom: bdrStyle, right: bdrStyle };
    rows.forEach((r, ri) => {
      const row = ws.getRow(dataStartRow + ri);
      row.height = 17;
      visibleCols.forEach((col, ci) => {
        const cell = row.getCell(ci + 1);
        const v = getVal(r, col.dataKey ?? col.key);
        if (isDateCol(col)) cell.value = fmtDate(v);
        else if (isNumCol(col)) cell.value = v != null && v !== '' ? Number(v) : '';
        else cell.value = v ?? '';
        cell.alignment = { horizontal: isAr ? 'right' : 'left', vertical: 'middle' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ri % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF' } };
        cell.border = allBdr as ExcelJS.Borders;
      });
    });

    if (totalColVisible && totalKey) {
      const totalColIdx = visibleCols.findIndex(c => c.key === totalKey);
      if (totalColIdx >= 0) {
        const totalsBdr: Partial<ExcelJS.Border> = { style: 'medium', color: { argb: 'FF334155' } };
        const totalsRow = ws.getRow(dataStartRow + rows.length);
        totalsRow.height = 18;
        visibleCols.forEach((_col, ci) => {
          const cell = totalsRow.getCell(ci + 1);
          if (ci === totalColIdx) cell.value = computedTotal;
          else if (ci === totalColIdx - 1) cell.value = isAr ? totalLabel : totalLabelEn;
          else cell.value = '';
          cell.font = { bold: true, color: { argb: 'FF334155' }, size: 11 };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFe2e8f0' } };
          cell.alignment = { horizontal: isAr ? 'right' : 'left', vertical: 'middle' };
          cell.border = {
            top:    totalsBdr as ExcelJS.Border,
            left:   bdrStyle  as ExcelJS.Border,
            bottom: bdrStyle  as ExcelJS.Border,
            right:  bdrStyle  as ExcelJS.Border,
          };
        });
      }
    }

    ws.columns = visibleCols.map(col => {
      const lbl = isAr ? col.labelAr : col.labelEn;
      return { width: Math.min(Math.max(lbl.length + 4, 12), 42) };
    });

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `${isAr ? title : (titleEn ?? title)}.xlsx`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (err) {
      console.error('[KpiDrawer] Excel export failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      alert((isAr ? 'فشل تصدير Excel:\n' : 'Excel export failed:\n') + msg);
    }
  };

  const handlePdf = () => {
    const headers = visibleCols.map(c => isAr ? c.labelAr : c.labelEn);
    const tableRows = rows.map((r, i) => {
      const cells = visibleCols.map(c => {
        const v = getVal(r, c.dataKey ?? c.key);
        const isN = isNumCol(c); const isD = isDateCol(c);
        return `<td style="text-align:${isN ? 'left' : 'right'};direction:${isN || isD ? 'ltr' : 'rtl'}">${fmtCell(v, c)}</td>`;
      }).join('');
      return `<tr style="background:${i % 2 === 0 ? '#fff' : '#f9fafb'}">${cells}</tr>`;
    }).join('');

    let footerRow = '';
    if (totalColVisible && totalKey) {
      const totalColIdx = visibleCols.findIndex(c => c.key === totalKey);
      if (totalColIdx >= 0) {
        footerRow = `<tfoot><tr style="border-top:2px solid #334155">${visibleCols.map((_: KpiCol, i: number) =>
          i < totalColIdx - 1
            ? '<td></td>'
            : i === totalColIdx - 1
              ? `<td style="text-align:right">${isAr ? totalLabel : totalLabelEn}</td>`
              : `<td style="text-align:left;direction:ltr">${fmtNum(computedTotal)}</td>`
        ).join('')}</tr></tfoot>`;
      }
    }

    const displayTitle = isAr ? title : (titleEn ?? title);
    const hdr = reportHeader;
    const companyName = (isAr ? hdr?.companyNameAr : hdr?.companyNameEn) ?? '';
    const lw = hdr?.logoLeftWidthPdf ?? 120;
    const rw = hdr?.logoRightWidthPdf ?? 120;
    const leftLogo  = hdr?.logoLeftUrl  ? `<img src="${hdr.logoLeftUrl}"  style="width:${lw}px;max-height:60px;object-fit:contain" />` : '';
    const rightLogo = hdr?.logoRightUrl ? `<img src="${hdr.logoRightUrl}" style="width:${rw}px;max-height:60px;object-fit:contain" />` : '';

    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html dir="${isAr ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">
      <title>${displayTitle}</title>
      <style>
        body{font-family:Arial,sans-serif;font-size:11px;direction:${isAr ? 'rtl' : 'ltr'};margin:0;padding:16px}
        .sub{color:#666;margin-bottom:12px;font-size:11px}
        table{border-collapse:collapse;width:100%}
        th,td{border:1px solid #ddd;padding:4px 7px;white-space:nowrap}
        th{background:#334155;color:#fff;font-weight:bold}
        tfoot td{font-weight:bold;background:#e2e8f0;color:#334155}
        @page{size:landscape;margin:12mm}
      </style></head><body>
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 8px;background:#f8fafc;border-bottom:3px solid #334155;margin-bottom:12px;">
        <div style="width:${lw}px;display:flex;align-items:center;justify-content:center">${leftLogo}</div>
        <div style="flex:1;text-align:center;padding:0 12px;direction:${isAr ? 'rtl' : 'ltr'}">
          ${companyName ? `<div style="font-size:13px;font-weight:bold;color:#334155;margin-bottom:4px">${companyName}</div>` : ''}
          <div style="font-size:11px;color:#334155">${displayTitle}</div>
          <div style="font-size:10px;color:#64748b;margin-top:2px">${new Date().toLocaleDateString(isAr ? 'ar-SA' : 'en-CA')}</div>
        </div>
        <div style="width:${rw}px;display:flex;align-items:center;justify-content:center">${rightLogo}</div>
      </div>
      <div class="sub">${rows.length} ${isAr ? 'أمر' : 'orders'}</div>
      <table>
        <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${tableRows}</tbody>
        ${footerRow}
      </table>
      <script>window.addEventListener('load',function(){window.focus();window.print();});<\/script>
      </body></html>`);
    w.document.close();
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed top-0 right-0 h-full w-full max-w-5xl bg-white shadow-2xl z-50 flex flex-col" dir="rtl">
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0 gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            {Icon && <Icon className={`w-5 h-5 ${iconColorCls}`} />}
            <span className="font-semibold text-slate-800 text-sm">
              {isAr ? title : (titleEn ?? title)}
            </span>
            {!loading && (
              <span className="text-xs bg-indigo-100 text-indigo-700 rounded-full px-2 py-0.5 font-medium">
                {rows.length} {isAr ? 'أمر' : 'orders'}
                {totalColVisible && computedTotal > 0 && (
                  <span className="mr-1">
                    · ~{computedTotal.toLocaleString('en-US', { maximumFractionDigits: 0 })} {isAr ? 'ر.س' : 'SAR'}
                  </span>
                )}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Column picker */}
            <button
              onClick={() => setPickerOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-50 text-slate-600 border border-slate-200 text-xs font-medium hover:border-indigo-400 hover:text-indigo-600 transition-colors"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              {isAr ? 'الأعمدة' : 'Columns'}
            </button>
            {/* Excel */}
            <button
              onClick={handleExcel}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-medium hover:bg-emerald-100 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Excel
            </button>
            {/* PDF */}
            <button
              onClick={handlePdf}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 text-xs font-medium hover:bg-rose-100 transition-colors"
            >
              <FileText className="w-3.5 h-3.5" />
              PDF
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-slate-400 text-sm gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" />
              {isAr ? 'جارٍ التحميل...' : 'Loading...'}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-slate-400 text-sm">
              {isAr ? 'لا توجد سجلات.' : 'No records found.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-indigo-50 text-indigo-800">
                    {visibleCols.map(col => (
                      <th
                        key={col.key}
                        className={`px-3 py-2 font-semibold border-b border-indigo-200 whitespace-nowrap ${isNumCol(col) ? 'text-left' : 'text-right'}`}
                      >
                        {isAr ? col.labelAr : col.labelEn}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={row.orderNumber ?? i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                      {visibleCols.map(col => {
                        const v = getVal(row, col.dataKey ?? col.key);
                        const isNum  = isNumCol(col);
                        const isDate = isDateCol(col);
                        const isOrder = col.key === 'orderNumber';

                        // 1. Custom renderer (parent override)
                        const custom = renderCell ? renderCell(row, col) : null;
                        // 2. Built-in virtual renderer
                        const builtIn = custom === null || custom === undefined
                          ? defaultRenderCell(row, col, lang)
                          : null;
                        // 3. Default formatted value
                        const content = custom ?? builtIn ?? fmtCell(v, col);

                        return (
                          <td
                            key={col.key}
                            className={`px-3 py-2 whitespace-nowrap ${
                              isOrder
                                ? 'font-medium text-indigo-700'
                                : isNum
                                  ? 'text-slate-700 text-left'
                                  : 'text-slate-600'
                            }`}
                            dir={isNum || isDate ? 'ltr' : undefined}
                          >
                            {content}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
                {totalColVisible && totalKey && (
                  <tfoot>
                    <tr className="bg-indigo-50 font-semibold border-t-2 border-indigo-200">
                      <td colSpan={visibleCols.length - 1} className="px-3 py-2 text-right text-slate-600">
                        {isAr ? totalLabel : totalLabelEn}
                      </td>
                      <td className="px-3 py-2 text-indigo-700 text-left" dir="ltr">
                        {fmtNum(computedTotal)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Column Picker Modal ── */}
      {pickerOpen && (
        <ColPicker
          availableCols={availableCols}
          selectedKeys={colKeys}
          onSave={onColKeysChange}
          onClose={() => setPickerOpen(false)}
          maxCols={maxCols}
          lang={lang}
        />
      )}
    </>
  );
}
