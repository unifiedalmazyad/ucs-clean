import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import api from '../services/api';
import { useLang } from '../contexts/LangContext';
import MultiSelectDropdown from '../components/MultiSelectDropdown';
import { exportReport } from '../utils/reportExporter';
import {
  FileSpreadsheet, Filter, History, Download, RefreshCw,
  ChevronDown, ChevronUp, CheckSquare, Square, Loader2, X,
  Clock, User, FileText, Search, Calendar, SlidersHorizontal,
  FileText as FilePdf,
} from 'lucide-react';

// ─── Status maps ──────────────────────────────────────────────────────────────
const STATUS_META: Record<string, { label: string; labelEn: string; cls: string }> = {
  OK:             { label: 'منتظم',      labelEn: 'On Track',  cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  WARN:           { label: 'تنبيه',      labelEn: 'Warning',   cls: 'bg-amber-100   text-amber-700   border-amber-200'   },
  OVERDUE:        { label: 'متأخر',      labelEn: 'Overdue',   cls: 'bg-red-100     text-red-700     border-red-200'     },
  COMPLETED:      { label: 'منجز',       labelEn: 'Done',      cls: 'bg-blue-100    text-blue-700    border-blue-200'    },
  COMPLETED_LATE: { label: 'منجز متأخر', labelEn: 'Late Done', cls: 'bg-purple-100  text-purple-700  border-purple-200'  },
  CANCELLED:      { label: 'ملغى',       labelEn: 'Cancelled', cls: 'bg-slate-100   text-slate-600   border-slate-300'   },
  CLOSED:         { label: 'مغلق',       labelEn: 'Closed',    cls: 'bg-teal-100    text-teal-700    border-teal-200'    },
  NONE:           { label: '—',          labelEn: '—',         cls: 'bg-slate-50    text-slate-400   border-slate-200'   },
};

const STATUS_OPTIONS = [
  { value: '',               label: 'الكل',        labelEn: 'All'        },
  { value: 'OK',             label: 'منتظم',       labelEn: 'On Track'   },
  { value: 'WARN',           label: 'تنبيه',       labelEn: 'Warning'    },
  { value: 'OVERDUE',        label: 'متأخر',       labelEn: 'Overdue'    },
  { value: 'COMPLETED',      label: 'منجز',        labelEn: 'Done'       },
  { value: 'COMPLETED_LATE', label: 'منجز متأخر',  labelEn: 'Late Done'  },
  { value: 'CANCELLED',      label: 'ملغى',        labelEn: 'Cancelled'  },
  { value: 'CLOSED',         label: 'مغلق',        labelEn: 'Closed'     },
  { value: 'NONE',           label: 'بدون بيانات', labelEn: 'No data'    },
];

function StatusBadge({ status }: { status: string }) {
  const { lang } = useLang();
  const m = STATUS_META[status] ?? STATUS_META.NONE;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${m.cls}`}>
      {lang === 'en' ? m.labelEn : m.label}
    </span>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface ColDef { columnKey: string; dataKey: string; labelAr: string; labelEn?: string; groupKey: string; dataType?: string; sortOrder?: number | null }
interface ColGroup { labelAr: string; labelEn?: string; columns: ColDef[] }
interface MetaResponse {
  columnGroups: Record<string, ColGroup>;
  regions: { id: string; nameAr: string; nameEn?: string; sectorId?: string | null }[];
  sectors: { id: string; nameAr: string; nameEn?: string; }[];
}
interface ExportLog {
  id: string; fileName: string; rowCount: number; actorRole: string;
  username: string | null; columns: string[]; filters: Record<string, string>;
  createdAt: string;
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function Reports() {
  const { lang } = useLang();
  const dir = lang === 'en' ? 'ltr' : 'rtl';

  // Server-side filters
  const [filterRegion,  setFilterRegion]  = useState('');
  const [filterSector,  setFilterSector]  = useState('');
  const [filterExec,        setFilterExec]        = useState<string[]>([]);
  const [filterFin,         setFilterFin]         = useState<string[]>([]);
  const [filterOverall,     setFilterOverall]     = useState<string[]>([]);
  const [filterWorkStatus,  setFilterWorkStatus]  = useState<string[]>([]);

  // Client-side filters
  const [filterProjectTypes, setFilterProjectTypes] = useState<string[]>([]);
  const [filterProcedures,   setFilterProcedures]   = useState<string[]>([]);
  const [filterDelays,       setFilterDelays]       = useState<string[]>([]);
  const [filterSearch,   setFilterSearch]   = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo,   setFilterDateTo]   = useState('');

  // Data
  const [meta,      setMeta]      = useState<MetaResponse | null>(null);
  const [rows,      setRows]      = useState<any[]>([]);
  const [exportLog, setExportLog] = useState<ExportLog[]>([]);
  const [total,     setTotal]     = useState(0);

  // Loading
  const [metaLoading, setMetaLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(true);
  const [logLoading,  setLogLoading]  = useState(false);

  // Current user (from local storage)
  const currentUser = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; }
  }, []);

  // Export state
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);

  // UI panels
  const [colPickerOpen, setColPickerOpen] = useState(false);
  const [historyOpen,   setHistoryOpen]   = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedCols,   setSelectedCols]  = useState<Set<string>>(new Set());

  const colPickerRef = useRef<HTMLDivElement>(null);
  const colPickerBtnRef = useRef<HTMLButtonElement>(null);

  // Close col picker on outside click
  useEffect(() => {
    if (!colPickerOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        colPickerRef.current && !colPickerRef.current.contains(e.target as Node) &&
        colPickerBtnRef.current && !colPickerBtnRef.current.contains(e.target as Node)
      ) {
        setColPickerOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [colPickerOpen]);

  // ── Fetch meta once ───────────────────────────────────────────────────────
  useEffect(() => {
    setMetaLoading(true);
    api.get('/reports/meta')
      .then(r => setMeta(r.data))
      .catch(console.error)
      .finally(() => setMetaLoading(false));
  }, []);

  // ── Fetch rows when server-side filters change ────────────────────────────
  const fetchData = useCallback(() => {
    const params: Record<string, string> = {};
    if (filterRegion)           params.regionId      = filterRegion;
    if (filterSector)           params.sectorId      = filterSector;
    if (filterExec.length > 0)    params.execStatus    = filterExec.join(',');
    if (filterFin.length > 0)     params.finStatus     = filterFin.join(',');
    if (filterOverall.length > 0) params.overallStatus = filterOverall.join(',');

    setDataLoading(true);
    api.get('/reports/data', { params })
      .then(r => { setRows(r.data.rows ?? []); setTotal(r.data.total ?? 0); })
      .catch(console.error)
      .finally(() => setDataLoading(false));
  }, [filterRegion, filterSector, filterExec, filterFin, filterOverall]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Fetch export log when history panel opens ─────────────────────────────
  useEffect(() => {
    if (!historyOpen) return;
    setLogLoading(true);
    api.get('/reports/export-log')
      .then(r => setExportLog(r.data))
      .catch(console.error)
      .finally(() => setLogLoading(false));
  }, [historyOpen]);

  // ── Column groups ─────────────────────────────────────────────────────────
  const allGroups: [string, ColGroup][] = useMemo(() => {
    if (!meta) return [];
    const extra = ['__status', 'PERMITS'];
    const regular = Object.keys(meta.columnGroups).filter(k => !extra.includes(k));
    const order = [...regular, ...extra];
    return order.filter(k => meta.columnGroups[k]).map(k => [k, meta.columnGroups[k]]);
  }, [meta]);

  const allColKeys = useMemo(() => allGroups.flatMap(([, g]) => g.columns.map(c => c.columnKey)), [allGroups]);

  const colLabelMap: Record<string, string> = useMemo(() => {
    const m: Record<string, string> = {};
    allGroups.forEach(([, g]) => g.columns.forEach(c => {
      m[c.columnKey] = (lang === 'en' && c.labelEn) ? c.labelEn : c.labelAr;
    }));
    return m;
  }, [allGroups, lang]);

  const dataKeyMap: Record<string, string> = useMemo(() => {
    const m: Record<string, string> = {};
    allGroups.forEach(([, g]) => g.columns.forEach(c => { m[c.columnKey] = c.dataKey ?? c.columnKey; }));
    return m;
  }, [allGroups]);

  const dataTypeMap: Record<string, string> = useMemo(() => {
    const m: Record<string, string> = {};
    allGroups.forEach(([, g]) => g.columns.forEach(c => { if (c.dataType) m[c.columnKey] = c.dataType; }));
    return m;
  }, [allGroups]);

  const colMetaFull: Record<string, { labelAr: string; labelEn?: string }> = useMemo(() => {
    const m: Record<string, { labelAr: string; labelEn?: string }> = {};
    allGroups.forEach(([, g]) => g.columns.forEach(c => {
      m[c.columnKey] = { labelAr: c.labelAr, labelEn: c.labelEn };
    }));
    return m;
  }, [allGroups]);

  // Lookup maps
  const sectorMap = useMemo(() => new Map((meta?.sectors ?? []).map(s => [s.id, (lang === 'en' && s.nameEn) ? s.nameEn : s.nameAr])), [meta, lang]);
  const regionMap = useMemo(() => new Map((meta?.regions ?? []).map(r => [r.id, (lang === 'en' && r.nameEn) ? r.nameEn : r.nameAr])), [meta, lang]);

  const DEFAULT_COLS = ['orderNumber', 'client', 'district', 'execStatus', 'finStatus', 'overallStatus', 'regionId', 'sectorId'];

  const effectiveCols: string[] = useMemo(() => {
    const active = selectedCols.size > 0
      ? selectedCols
      : new Set(DEFAULT_COLS.filter(k => allColKeys.includes(k)));
    return allColKeys.filter(k => active.has(k));
  }, [selectedCols, allColKeys]);

  const displayedRegions = useMemo(() => {
    if (!meta) return [];
    if (!filterSector) return meta.regions;
    return meta.regions.filter(r => r.sectorId === filterSector);
  }, [meta, filterSector]);

  const projectTypeOptions = useMemo(() => {
    const seen = new Set<string>();
    rows.forEach(r => { const v = r.projectType ?? r.project_type; if (v) seen.add(v); });
    return Array.from(seen).sort().map(v => ({ value: v, labelAr: v, labelEn: v }));
  }, [rows]);

  const procedureOptions = useMemo(() => {
    const seen = new Set<string>();
    rows.forEach(r => { const v = r.procedure; if (v) seen.add(v); });
    return Array.from(seen).sort().map(v => ({ value: v, labelAr: v, labelEn: v }));
  }, [rows]);

  // ── Display helpers ───────────────────────────────────────────────────────
  function rowVal(row: any, columnKey: string): any {
    const dk = dataKeyMap[columnKey] ?? columnKey;
    return row[dk] ?? row[columnKey];
  }

  function formatDateValue(v: any, locale: string): string {
    try {
      const d = new Date(v);
      if (isNaN(d.getTime())) return String(v);
      return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch { return String(v); }
  }

  function getDisplayValue(row: any, columnKey: string): string {
    const v = rowVal(row, columnKey);
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? (lang === 'en' ? 'Yes' : 'نعم') : (lang === 'en' ? 'No' : 'لا');
    if (columnKey === 'sectorId') return sectorMap.get(String(v)) ?? String(v);
    if (columnKey === 'regionId') return regionMap.get(String(v)) ?? String(v);
    const dk = dataKeyMap[columnKey] ?? columnKey;
    const dt = dataTypeMap[columnKey] ?? '';
    const isDate = dt === 'date' || dt === 'timestamp' || dk.toLowerCase().includes('date') || ['createdAt', 'updatedAt', 'assignmentDate'].includes(dk);
    if (isDate) {
      return formatDateValue(v, lang === 'en' ? 'en-GB' : 'ar-EG');
    }
    return String(v);
  }

  function getExcelValue(row: any, columnKey: string): string {
    if (['execStatus', 'finStatus', 'overallStatus'].includes(columnKey)) {
      const sm = STATUS_META[rowVal(row, columnKey)];
      return (lang === 'en' ? sm?.labelEn : sm?.label) ?? rowVal(row, columnKey) ?? '';
    }
    const dk = dataKeyMap[columnKey] ?? columnKey;
    const dt = dataTypeMap[columnKey] ?? '';
    const isDate = dt === 'date' || dt === 'timestamp' || dk.toLowerCase().includes('date') || ['createdAt', 'updatedAt', 'assignmentDate'].includes(dk);
    if (isDate) {
      const v = rowVal(row, columnKey);
      if (v === null || v === undefined || v === '') return '';
      return formatDateValue(v, 'en-CA');
    }
    return getDisplayValue(row, columnKey);
  }

  // ── Client-side filtered rows ─────────────────────────────────────────────
  const filteredRows = useMemo(() => {
    let r = rows;
    if (filterSearch.trim()) {
      const q = filterSearch.trim().toLowerCase();
      r = r.filter(row => effectiveCols.some(k => getDisplayValue(row, k).toLowerCase().includes(q)));
    }
    if (filterDateFrom) {
      const from = new Date(filterDateFrom).getTime();
      r = r.filter(row => {
        const d = row.assignmentDate ?? row.assignment_date;
        if (!d) return false;
        return new Date(d).getTime() >= from;
      });
    }
    if (filterDateTo) {
      const to = new Date(filterDateTo + 'T23:59:59').getTime();
      r = r.filter(row => {
        const d = row.assignmentDate ?? row.assignment_date;
        if (!d) return false;
        return new Date(d).getTime() <= to;
      });
    }
    if (filterWorkStatus.length > 0) {
      r = r.filter(row => {
        const v = row.workStatusClassification ?? row.work_status_classification ?? '';
        return filterWorkStatus.includes(v);
      });
    }
    if (filterProjectTypes.length > 0) {
      r = r.filter(row => filterProjectTypes.includes(row.projectType ?? row.project_type ?? ''));
    }
    if (filterProcedures.length > 0) {
      r = r.filter(row => filterProcedures.includes(row.procedure ?? ''));
    }
    if (filterDelays.length > 0) {
      r = r.filter(row => {
        const execDelayed = row.execStatus === 'OVERDUE' || row.execStatus === 'COMPLETED_LATE';
        const finDelayed  = row.finStatus  === 'OVERDUE' || row.finStatus  === 'COMPLETED_LATE';
        return filterDelays.some(d => {
          if (d === 'EXEC_JUSTIFIED')   return execDelayed && row.execDelayJustified === true;
          if (d === 'EXEC_UNJUSTIFIED') return execDelayed && row.execDelayJustified !== true;
          if (d === 'FIN_JUSTIFIED')    return finDelayed  && row.finDelayJustified  === true;
          if (d === 'FIN_UNJUSTIFIED')  return finDelayed  && row.finDelayJustified  !== true;
          return false;
        });
      });
    }
    return r;
  }, [rows, filterSearch, filterDateFrom, filterDateTo, effectiveCols, filterWorkStatus, filterProjectTypes, filterProcedures, filterDelays]);

  // ── Column picker helpers ─────────────────────────────────────────────────
  function isColChecked(key: string) {
    return selectedCols.size === 0 ? DEFAULT_COLS.includes(key) : selectedCols.has(key);
  }

  function toggleCol(key: string) {
    setSelectedCols(prev => {
      const base = prev.size === 0 ? new Set(DEFAULT_COLS.filter(k => allColKeys.includes(k))) : new Set(prev);
      if (base.has(key)) base.delete(key); else base.add(key);
      return new Set(base);
    });
  }

  function toggleGroup(gKey: string, cols: ColDef[]) {
    const keys = cols.map(c => c.columnKey);
    setSelectedCols(prev => {
      const base = prev.size === 0 ? new Set(DEFAULT_COLS.filter(k => allColKeys.includes(k))) : new Set(prev);
      const allIn = keys.every(k => base.has(k));
      keys.forEach(k => allIn ? base.delete(k) : base.add(k));
      return new Set(base);
    });
  }

  function selectAll() { setSelectedCols(new Set(allColKeys)); }
  function clearAll()  { setSelectedCols(new Set()); }

  function resetFilters() {
    setFilterRegion(''); setFilterSector('');
    setFilterExec([]); setFilterFin([]); setFilterOverall([]); setFilterWorkStatus([]);
    setFilterProjectTypes([]); setFilterProcedures([]); setFilterDelays([]);
    setFilterSearch(''); setFilterDateFrom(''); setFilterDateTo('');
  }

  // ── Export to Excel ───────────────────────────────────────────────────────
  async function doExport(format: 'excel' | 'pdf') {
    if (exporting) return;
    setExporting(format);
    try {
      const now    = new Date();
      const dateTag = now.toLocaleDateString('en-CA');
      const filename = lang === 'en'
        ? `Work_Order_Report_${dateTag}.${format === 'pdf' ? 'pdf' : 'xlsx'}`
        : `تقرير_أوامر_العمل_${dateTag}.${format === 'pdf' ? 'pdf' : 'xlsx'}`;

      const exportData = filteredRows.map(row => {
        const out: any = {};
        effectiveCols.forEach(k => { out[k] = getExcelValue(row, k); });
        return out;
      });

      const exportColumns = effectiveCols.map(k => ({
        key:     k,
        labelAr: colMetaFull[k]?.labelAr ?? k,
        labelEn: colMetaFull[k]?.labelEn,
      }));

      await exportReport({
        data:       exportData,
        columns:    exportColumns,
        lang,
        filters: {
          regionName: filterRegion ? regionMap.get(filterRegion) : undefined,
          sectorName: filterSector ? sectorMap.get(filterSector) : undefined,
        },
        username: currentUser.fullName || currentUser.username,
        format,
        filename,
        sheetTitle: lang === 'en' ? 'Report' : 'تقرير',
      });

      const logFilters: Record<string, string> = {};
      if (filterRegion)             logFilters.regionId      = filterRegion;
      if (filterSector)             logFilters.sectorId      = filterSector;
      if (filterExec.length > 0)    logFilters.execStatus    = filterExec.join(',');
      if (filterFin.length > 0)     logFilters.finStatus     = filterFin.join(',');
      if (filterOverall.length > 0) logFilters.overallStatus = filterOverall.join(',');
      if (filterSearch)                    logFilters.search             = filterSearch;
      if (filterDateFrom)                  logFilters.dateFrom           = filterDateFrom;
      if (filterDateTo)                    logFilters.dateTo             = filterDateTo;
      if (filterWorkStatus.length > 0)     logFilters.workStatusClass    = filterWorkStatus.join(',');
      if (filterProjectTypes.length > 0)   logFilters.projectTypes       = filterProjectTypes.join(',');
      if (filterProcedures.length > 0)     logFilters.procedures         = filterProcedures.join(',');
      if (filterDelays.length > 0)         logFilters.delays             = filterDelays.join(',');

      api.post('/reports/export-log', { fileName: filename, rowCount: filteredRows.length, columns: effectiveCols, filters: logFilters })
        .catch(console.error);
    } catch (err) {
      console.error('[Export error]', err);
      alert(lang === 'en' ? 'Export failed. Please try again.' : 'فشل التصدير. حاول مرة أخرى.');
    } finally {
      setExporting(null);
    }
  }

  const hasFilters = !!(filterRegion || filterSector || filterExec.length || filterFin.length || filterOverall.length || filterWorkStatus.length || filterProjectTypes.length || filterProcedures.length || filterDelays.length || filterSearch || filterDateFrom || filterDateTo);
  const isLoading  = metaLoading || dataLoading;

  // ── Label helpers ─────────────────────────────────────────────────────────
  const t = (ar: string, en: string) => lang === 'en' ? en : ar;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col min-h-full lg:h-full bg-slate-50" dir={dir}>

      {/* ── Top command bar ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 md:px-6 py-3 bg-white border-b border-slate-200 shadow-sm flex-shrink-0 gap-2 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <FileSpreadsheet className="w-6 h-6 text-emerald-600 flex-shrink-0" />
          <div className="min-w-0">
            <h1 className="text-base md:text-lg font-bold text-slate-800 leading-tight">{t('التقارير', 'Reports')}</h1>
            <p className="text-xs text-slate-400 hidden sm:block">{t('تصدير بيانات أوامر العمل إلى Excel', 'Export work order data to Excel')}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* History */}
          <button
            onClick={() => setHistoryOpen(true)}
            data-testid="button-export-history"
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <History className="w-4 h-4" />
            <span className="hidden sm:inline">{t('سجل التقارير', 'History')}</span>
          </button>

          {/* Column picker button */}
          <div className="relative">
            <button
              ref={colPickerBtnRef}
              onClick={() => setColPickerOpen(p => !p)}
              data-testid="button-column-picker"
              className={`flex items-center gap-1.5 px-3 py-2 text-sm border rounded-lg transition-colors ${
                colPickerOpen ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span className="hidden sm:inline">{t('الأعمدة', 'Columns')}</span>
              <span className="bg-indigo-100 text-indigo-700 text-xs font-bold px-1.5 py-0.5 rounded-full">
                {effectiveCols.length}
              </span>
              {colPickerOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>

            {/* Column picker dropdown */}
            {colPickerOpen && (
              <div
                ref={colPickerRef}
                className={`absolute top-full mt-2 z-50 bg-white border border-slate-200 rounded-xl shadow-xl w-72 max-h-[70vh] flex flex-col overflow-hidden ${lang === 'en' ? 'left-0' : 'right-0'}`}
                data-testid="col-picker-panel"
              >
                {/* Picker header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50 flex-shrink-0">
                  <span className="text-sm font-bold text-slate-700">{t('تخصيص الأعمدة', 'Customize Columns')}</span>
                  <div className="flex items-center gap-3 text-xs">
                    <button onClick={selectAll} className="text-indigo-600 hover:underline" data-testid="button-select-all-cols">{t('الكل', 'All')}</button>
                    <span className="text-slate-300">|</span>
                    <button onClick={clearAll} className="text-slate-500 hover:underline" data-testid="button-clear-all-cols">{t('مسح', 'Clear')}</button>
                    <button onClick={() => setColPickerOpen(false)} className="text-slate-400 hover:text-slate-600 mr-1">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Groups */}
                <div className="overflow-y-auto flex-1 px-3 py-2 space-y-1">
                  {allGroups.map(([gKey, group]) => {
                    const isExpanded = expandedGroups.has(gKey);
                    const groupCols  = group.columns;
                    if (groupCols.length === 0) return null;
                    const checkedCount = groupCols.filter(c => isColChecked(c.columnKey)).length;
                    const allChecked   = checkedCount === groupCols.length;

                    return (
                      <div key={gKey} className="border border-slate-100 rounded-lg overflow-hidden">
                        <button
                          className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors"
                          onClick={() => setExpandedGroups(prev => {
                            const next = new Set(prev);
                            isExpanded ? next.delete(gKey) : next.add(gKey);
                            return next;
                          })}
                          data-testid={`button-group-${gKey}`}
                        >
                          <div className="flex items-center gap-2">
                            <span
                              role="button"
                              tabIndex={0}
                              className="flex-shrink-0 cursor-pointer"
                              onClick={e => { e.stopPropagation(); toggleGroup(gKey, groupCols); }}
                              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); toggleGroup(gKey, groupCols); } }}
                              data-testid={`button-group-toggle-${gKey}`}
                            >
                              {allChecked
                                ? <CheckSquare className="w-4 h-4 text-indigo-600" />
                                : checkedCount > 0
                                ? <CheckSquare className="w-4 h-4 text-indigo-400 opacity-60" />
                                : <Square className="w-4 h-4 text-slate-400" />}
                            </span>
                            <span className="text-xs font-semibold text-slate-700 truncate">
                              {lang === 'en' && group.labelEn ? group.labelEn : group.labelAr}
                            </span>
                            <span className="text-xs text-slate-400">({checkedCount}/{groupCols.length})</span>
                          </div>
                          {isExpanded ? <ChevronUp className="w-3 h-3 text-slate-400 flex-shrink-0" /> : <ChevronDown className="w-3 h-3 text-slate-400 flex-shrink-0" />}
                        </button>

                        {isExpanded && (
                          <div className="px-3 py-2 grid grid-cols-1 gap-1 bg-white">
                            {groupCols.map(col => (
                              <label
                                key={col.columnKey}
                                className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 px-1.5 py-1 rounded transition-colors"
                                data-testid={`col-check-${col.columnKey}`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isColChecked(col.columnKey)}
                                  onChange={() => toggleCol(col.columnKey)}
                                  className="w-3.5 h-3.5 accent-indigo-600 flex-shrink-0"
                                />
                                <span className="text-xs text-slate-700 truncate">
                                  {lang === 'en' && col.labelEn ? col.labelEn : col.labelAr}
                                </span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Export buttons */}
          <button
            onClick={() => doExport('excel')}
            disabled={filteredRows.length === 0 || exporting !== null}
            data-testid="button-export-excel"
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 rounded-lg transition-colors"
          >
            {exporting === 'excel' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {t('Excel', 'Excel')}
            {filteredRows.length > 0 && exporting === null && (
              <span className="bg-emerald-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
                {filteredRows.length}
              </span>
            )}
          </button>
          <button
            onClick={() => doExport('pdf')}
            disabled={filteredRows.length === 0 || exporting !== null}
            data-testid="button-export-pdf"
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 rounded-lg transition-colors"
          >
            {exporting === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FilePdf className="w-4 h-4" />}
            {t('PDF', 'PDF')}
          </button>
        </div>
      </div>

      {/* ── Horizontal filter bar ────────────────────────────────────────── */}
      <div className="flex-shrink-0 bg-white border-b border-slate-200 px-4 md:px-6 py-3">
        <div className="flex flex-wrap gap-2 items-end">

          {/* Sector */}
          {meta && meta.sectors.length > 1 && (
            <div className="flex flex-col gap-1 min-w-[130px]">
              <label className="text-xs font-medium text-slate-500">{t('القطاع', 'Sector')}</label>
              <select
                value={filterSector}
                onChange={e => { setFilterSector(e.target.value); setFilterRegion(''); }}
                className="h-9 text-sm border border-slate-200 rounded-lg px-2.5 bg-white focus:ring-2 focus:ring-indigo-300 outline-none"
                data-testid="select-filter-sector"
              >
                <option value="">{t('الكل', 'All')}</option>
                {meta.sectors.map(s => <option key={s.id} value={s.id}>{lang === 'en' && s.nameEn ? s.nameEn : s.nameAr}</option>)}
              </select>
            </div>
          )}

          {/* Region */}
          {meta && meta.regions.length > 1 && (
            <div className="flex flex-col gap-1 min-w-[140px]">
              <label className="text-xs font-medium text-slate-500">{t('المنطقة', 'Region')}</label>
              <select
                value={filterRegion}
                onChange={e => setFilterRegion(e.target.value)}
                className="h-9 text-sm border border-slate-200 rounded-lg px-2.5 bg-white focus:ring-2 focus:ring-indigo-300 outline-none"
                data-testid="select-filter-region"
              >
                <option value="">{t('الكل', 'All')}</option>
                {displayedRegions.map(r => <option key={r.id} value={r.id}>{lang === 'en' && r.nameEn ? r.nameEn : r.nameAr}</option>)}
              </select>
            </div>
          )}

          {/* Project Types */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">{t('أنواع المشاريع', 'Project Types')}</label>
            <MultiSelectDropdown
              options={projectTypeOptions}
              selected={filterProjectTypes}
              onChange={setFilterProjectTypes}
              placeholder="كل أنواع المشاريع"
              placeholderEn="All Types"
              lang={lang as 'ar' | 'en'}
              data-testid="select-filter-project-types"
            />
          </div>

          {/* Procedures */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">{t('الإجراءات', 'Procedures')}</label>
            <MultiSelectDropdown
              options={procedureOptions}
              selected={filterProcedures}
              onChange={setFilterProcedures}
              placeholder="كل الإجراءات"
              placeholderEn="All Procedures"
              lang={lang as 'ar' | 'en'}
              data-testid="select-filter-procedures"
            />
          </div>

          {/* Delays */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">{t('التأخيرات', 'Delays')}</label>
            <MultiSelectDropdown
              options={[
                { value: 'EXEC_UNJUSTIFIED', labelAr: 'متأخر تنفيذي',       labelEn: 'Exec Overdue'             },
                { value: 'EXEC_JUSTIFIED',   labelAr: 'متأخر تنفيذي مسبب', labelEn: 'Exec Overdue — Justified' },
                { value: 'FIN_UNJUSTIFIED',  labelAr: 'متأخر مالي',         labelEn: 'Fin Overdue'              },
                { value: 'FIN_JUSTIFIED',    labelAr: 'متأخر مالي مسبب',   labelEn: 'Fin Overdue — Justified'  },
              ]}
              selected={filterDelays}
              onChange={setFilterDelays}
              placeholder="كل التأخيرات"
              placeholderEn="All Delays"
              lang={lang as 'ar' | 'en'}
              data-testid="select-filter-delays"
            />
          </div>

          {/* ── فاصل بين مجموعتي الفلاتر ── */}
          <div className="w-px h-6 bg-slate-200 mx-0.5 self-end mb-1.5 flex-shrink-0" />

          {/* Exec status — multi-select */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">{t('حالة التنفيذ', 'Exec Status')}</label>
            <MultiSelectDropdown
              options={STATUS_OPTIONS.filter(o => o.value !== '').map(o => ({ value: o.value, labelAr: o.label, labelEn: o.labelEn }))}
              selected={filterExec}
              onChange={setFilterExec}
              placeholder="الكل"
              placeholderEn="All"
              lang={lang as 'ar' | 'en'}
              data-testid="select-filter-exec"
            />
          </div>

          {/* Fin status — multi-select */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">{t('الحالة المالية', 'Fin Status')}</label>
            <MultiSelectDropdown
              options={STATUS_OPTIONS.filter(o => o.value !== '').map(o => ({ value: o.value, labelAr: o.label, labelEn: o.labelEn }))}
              selected={filterFin}
              onChange={setFilterFin}
              placeholder="الكل"
              placeholderEn="All"
              lang={lang as 'ar' | 'en'}
              data-testid="select-filter-fin"
            />
          </div>

          {/* Overall status — multi-select */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">{t('الحالة العامة', 'Overall')}</label>
            <MultiSelectDropdown
              options={STATUS_OPTIONS.filter(o => o.value !== '').map(o => ({ value: o.value, labelAr: o.label, labelEn: o.labelEn }))}
              selected={filterOverall}
              onChange={setFilterOverall}
              placeholder="الكل"
              placeholderEn="All"
              lang={lang as 'ar' | 'en'}
              data-testid="select-filter-overall"
            />
          </div>

          {/* Work status classification — client-side multi-select */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">{t('حالة التنفيذ الميداني', 'Field Status')}</label>
            <MultiSelectDropdown
              options={[
                { value: 'EXECUTED', labelAr: 'تم التنفيذ', labelEn: 'Executed'   },
                { value: 'ONGOING',  labelAr: 'قائم',       labelEn: 'Ongoing'    },
              ]}
              selected={filterWorkStatus}
              onChange={setFilterWorkStatus}
              placeholder="الكل"
              placeholderEn="All"
              lang={lang as 'ar' | 'en'}
              data-testid="select-filter-work-status"
            />
          </div>

          {/* Date from — based on assignment date */}
          <div className="flex flex-col gap-1 min-w-[140px]">
            <label className="text-xs font-medium text-slate-500 flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {t('إسناد من', 'Assigned From')}
            </label>
            <input
              type="date"
              value={filterDateFrom}
              onChange={e => setFilterDateFrom(e.target.value)}
              className="h-9 text-sm border border-slate-200 rounded-lg px-2.5 bg-white focus:ring-2 focus:ring-indigo-300 outline-none"
              data-testid="input-filter-date-from"
            />
          </div>

          {/* Date to — based on assignment date */}
          <div className="flex flex-col gap-1 min-w-[140px]">
            <label className="text-xs font-medium text-slate-500 flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {t('إسناد إلى', 'Assigned To')}
            </label>
            <input
              type="date"
              value={filterDateTo}
              onChange={e => setFilterDateTo(e.target.value)}
              className="h-9 text-sm border border-slate-200 rounded-lg px-2.5 bg-white focus:ring-2 focus:ring-indigo-300 outline-none"
              data-testid="input-filter-date-to"
            />
          </div>

          {/* Search */}
          <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
            <label className="text-xs font-medium text-slate-500">{t('بحث', 'Search')}</label>
            <div className="relative">
              <Search className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none ${lang === 'en' ? 'left-2.5' : 'right-2.5'}`} />
              <input
                type="text"
                value={filterSearch}
                onChange={e => setFilterSearch(e.target.value)}
                placeholder={t('ابحث في النتائج...', 'Search results...')}
                className={`w-full h-9 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-indigo-300 outline-none ${lang === 'en' ? 'pl-8 pr-3' : 'pr-8 pl-3'}`}
                data-testid="input-filter-search"
              />
              {filterSearch && (
                <button
                  onClick={() => setFilterSearch('')}
                  className={`absolute top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 ${lang === 'en' ? 'right-2' : 'left-2'}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Actions: refresh + clear */}
          <div className="flex items-end gap-1.5 pb-0">
            <button
              onClick={fetchData}
              className="h-9 w-9 flex items-center justify-center text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              data-testid="button-refresh-data"
              title={t('تحديث', 'Refresh')}
            >
              <RefreshCw className={`w-4 h-4 ${dataLoading ? 'animate-spin' : ''}`} />
            </button>
            {hasFilters && (
              <button
                onClick={resetFilters}
                className="h-9 flex items-center gap-1 px-2.5 text-sm text-red-500 border border-red-100 rounded-lg hover:bg-red-50 transition-colors"
                data-testid="button-reset-filters"
              >
                <X className="w-3.5 h-3.5" />
                {t('مسح', 'Clear')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Table area ───────────────────────────────────────────────────── */}
      <div className="flex-1 lg:overflow-hidden flex flex-col">

        {/* Table info bar */}
        <div className="flex items-center justify-between px-4 md:px-6 py-2 bg-white border-b border-slate-100 flex-shrink-0">
          <span className="text-sm text-slate-500">
            {isLoading ? (
              <span className="flex items-center gap-1.5 text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                {t('جاري التحميل...', 'Loading...')}
              </span>
            ) : (
              <span>
                <strong className="text-slate-800 font-semibold">{filteredRows.length.toLocaleString('en-US')}</strong>
                {' '}{t('نتيجة', 'results')}
                {filteredRows.length !== total && (
                  <span className="text-slate-400 text-xs mr-2 ml-2">
                    {t(`من أصل ${total.toLocaleString('en-US')}`, `of ${total.toLocaleString('en-US')} total`)}
                  </span>
                )}
              </span>
            )}
          </span>
          <span className="text-xs text-slate-400">
            {effectiveCols.length} {t('عمود', 'columns')}
          </span>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {!isLoading && filteredRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400">
              <FileSpreadsheet className="w-12 h-12 mb-3 opacity-25" />
              <p className="text-sm">{t('لا توجد بيانات تطابق الفلاتر المحددة', 'No data matches the selected filters')}</p>
            </div>
          ) : (
            <table className="w-full text-sm border-collapse min-w-max">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-100">
                  <th className={`border-b border-slate-200 px-3 py-2.5 text-${lang === 'en' ? 'left' : 'right'} text-xs font-semibold text-slate-500 whitespace-nowrap w-10`}>
                    #
                  </th>
                  {effectiveCols.map(k => (
                    <th
                      key={k}
                      className={`border-b border-slate-200 px-3 py-2.5 text-${lang === 'en' ? 'left' : 'right'} text-xs font-semibold text-slate-600 whitespace-nowrap`}
                    >
                      {colLabelMap[k] ?? k}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, i) => (
                  <tr
                    key={row.id ?? i}
                    className="hover:bg-indigo-50/40 border-b border-slate-100 transition-colors"
                    data-testid={`row-report-${row.id ?? i}`}
                  >
                    <td className="px-3 py-2 text-xs text-slate-400 font-mono">{i + 1}</td>
                    {effectiveCols.map(k => {
                      const isStatus      = ['execStatus', 'finStatus', 'overallStatus'].includes(k);
                      const isPermitStatus = k === 'permitStatus';
                      return (
                        <td key={k} className="px-3 py-2 whitespace-nowrap">
                          {isStatus ? (
                            <StatusBadge status={rowVal(row, k) ?? 'NONE'} />
                          ) : isPermitStatus ? (() => {
                            const v = rowVal(row, k);
                            if (!v) return <span className="text-xs text-slate-400">—</span>;
                            const label = lang === 'en'
                              ? (v === 'ساري' ? 'Valid' : v === 'شارف على الانتهاء' ? 'Expiring' : v === 'منتهي' ? 'Expired' : v)
                              : v;
                            const cls = v === 'ساري' ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                              : v === 'شارف على الانتهاء' ? 'bg-amber-100 text-amber-700 border-amber-200'
                              : v === 'منتهي' ? 'bg-red-100 text-red-700 border-red-200'
                              : 'bg-slate-100 text-slate-500 border-slate-200';
                            return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${cls}`}>{label}</span>;
                          })() : (
                            <span className="text-xs text-slate-700">{getDisplayValue(row, k)}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Export History Drawer ────────────────────────────────────────── */}
      {historyOpen && (
        <div className="fixed inset-0 z-50 flex" dir={dir}>
          <div className="flex-1 bg-black/30" onClick={() => setHistoryOpen(false)} />
          <div className="w-96 bg-white shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 flex-shrink-0">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-indigo-500" />
                <h2 className="font-bold text-slate-800">{t('سجل التقارير المُصدَّرة', 'Exported Reports History')}</h2>
              </div>
              <button
                onClick={() => setHistoryOpen(false)}
                className="text-slate-400 hover:text-slate-600"
                data-testid="button-close-history"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {logLoading ? (
                <div className="flex items-center justify-center h-32 text-slate-400">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : exportLog.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-slate-400">
                  <FileText className="w-10 h-10 mb-2 opacity-30" />
                  <p className="text-sm">{t('لا توجد تقارير مُصدَّرة بعد', 'No reports exported yet')}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {exportLog.map(log => (
                    <div
                      key={log.id}
                      className="border border-slate-100 rounded-xl p-4 hover:bg-slate-50 transition-colors"
                      data-testid={`log-entry-${log.id}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileSpreadsheet className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                          <span className="text-sm font-medium text-slate-700 truncate">{log.fileName}</span>
                        </div>
                        <span className="text-xs text-slate-400 flex-shrink-0 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(log.createdAt).toLocaleString('en-GB')}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <User className="w-3 h-3" />
                          {log.username ?? log.actorRole}
                        </span>
                        <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                          {log.rowCount} {t('صف', 'rows')}
                        </span>
                        <span className="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">
                          {Array.isArray(log.columns) ? log.columns.length : 0} {t('عمود', 'columns')}
                        </span>
                        {log.filters && Object.keys(log.filters).length > 0 && (
                          <span className="bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full">
                            {Object.keys(log.filters).length} {t('فلتر', 'filters')}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
