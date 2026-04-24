import React, { useState, useMemo } from 'react';
import { X, SlidersHorizontal, Download, FileText, RefreshCw } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KpiCol {
  key: string;
  labelAr: string;
  labelEn: string;
  dataType?: string;
  virtual?: boolean;
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
  const v = getVal(row, col.key);

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
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const sheetName = (isAr ? title : (titleEn ?? title)).slice(0, 31);
    const ws = wb.addWorksheet(sheetName);
    ws.addRow(visibleCols.map(c => isAr ? c.labelAr : c.labelEn)).font = { bold: true };
    rows.forEach(r => {
      ws.addRow(visibleCols.map(c => {
        const v = getVal(r, c.key);
        if (isDateCol(c)) return fmtDate(v);
        if (isNumCol(c))  return v != null && v !== '' ? Number(v) : '';
        return v ?? '';
      }));
    });
    if (totalColVisible && totalKey) {
      const totalColIdx = visibleCols.findIndex(c => c.key === totalKey);
      if (totalColIdx >= 0) {
        ws.addRow([]);
        const totRow = ws.addRow(visibleCols.map((_, i) =>
          i === totalColIdx
            ? computedTotal
            : (i === totalColIdx - 1 ? (isAr ? totalLabel : totalLabelEn) : '')
        ));
        totRow.font = { bold: true };
      }
    }
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${isAr ? title : (titleEn ?? title)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePdf = () => {
    const headers = visibleCols.map(c => isAr ? c.labelAr : c.labelEn);
    const tableRows = rows.map((r, i) => {
      const cells = visibleCols.map(c => {
        const v = getVal(r, c.key);
        const isN = isNumCol(c); const isD = isDateCol(c);
        return `<td style="text-align:${isN ? 'left' : 'right'};direction:${isN || isD ? 'ltr' : 'rtl'}">${fmtCell(v, c)}</td>`;
      }).join('');
      return `<tr style="background:${i % 2 === 0 ? '#fff' : '#f9fafb'}">${cells}</tr>`;
    }).join('');

    let footerRow = '';
    if (totalColVisible && totalKey) {
      const totalColIdx = visibleCols.findIndex(c => c.key === totalKey);
      if (totalColIdx >= 0) {
        footerRow = `<tfoot><tr>${visibleCols.map((_, i) =>
          i < totalColIdx - 1
            ? '<td></td>'
            : i === totalColIdx - 1
              ? `<td style="text-align:right">${isAr ? totalLabel : totalLabelEn}</td>`
              : `<td style="text-align:left;direction:ltr">${fmtNum(computedTotal)}</td>`
        ).join('')}</tr></tfoot>`;
      }
    }

    const displayTitle = isAr ? title : (titleEn ?? title);
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html dir="${isAr ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">
      <title>${displayTitle}</title>
      <style>
        body{font-family:Arial,sans-serif;font-size:11px;direction:${isAr ? 'rtl' : 'ltr'}}
        h2{font-size:14px;margin-bottom:4px}.sub{color:#666;margin-bottom:12px;font-size:11px}
        table{border-collapse:collapse;width:100%}
        th,td{border:1px solid #ddd;padding:4px 7px;white-space:nowrap}
        th{background:#4f46e5;color:#fff;font-weight:bold}
        tfoot td{font-weight:bold;background:#eef2ff}
        @page{size:landscape;margin:12mm}
      </style></head><body>
      <h2>${displayTitle}</h2>
      <div class="sub">${rows.length} ${isAr ? 'أمر' : 'orders'}</div>
      <table>
        <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${tableRows}</tbody>
        ${footerRow}
      </table></body></html>`);
    w.document.close();
    w.print();
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
                        const v = getVal(row, col.key);
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
