import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';
import { useLang } from '../contexts/LangContext';
import { exportReport } from '../utils/reportExporter';
import {
  FileSpreadsheet, Plus, Trash2, Edit2, Share2, Download,
  ChevronRight, BarChart2, Clock, Users, CalendarDays,
  Loader2, Check, X, RefreshCw, BookMarked, Save, Eye, Sparkles,
  FileText as FilePdf,
} from 'lucide-react';

function getCurrentUsername(): string {
  try { const u = JSON.parse(localStorage.getItem('user') || '{}'); return u.fullName || u.username || ''; } catch { return ''; }
}

const STATUS_META: Record<string, { label: string; labelEn: string }> = {
  OK:             { label: 'منتظم',      labelEn: 'On Track'   },
  WARN:           { label: 'تنبيه',      labelEn: 'Warning'    },
  OVERDUE:        { label: 'متأخر',      labelEn: 'Overdue'    },
  COMPLETED:      { label: 'منجز',       labelEn: 'Done'       },
  COMPLETED_LATE: { label: 'منجز متأخر', labelEn: 'Late Done'  },
  CANCELLED:      { label: 'ملغى',       labelEn: 'Cancelled'  },
  CLOSED:         { label: 'مغلق',       labelEn: 'Closed'     },
  NONE:           { label: '—',          labelEn: '—'          },
};
const STATUS_CLS: Record<string, string> = {
  OK:             'bg-emerald-100 text-emerald-700',
  WARN:           'bg-amber-100 text-amber-700',
  OVERDUE:        'bg-red-100 text-red-700',
  COMPLETED:      'bg-blue-100 text-blue-700',
  COMPLETED_LATE: 'bg-purple-100 text-purple-700',
  CANCELLED:      'bg-slate-100 text-slate-500',
  CLOSED:         'bg-teal-100 text-teal-700',
  NONE:           'bg-slate-50 text-slate-400',
};

function StatusBadge({ status }: { status: string }) {
  const { lang } = useLang();
  const m = STATUS_META[status] ?? STATUS_META.NONE;
  const cls = STATUS_CLS[status] ?? STATUS_CLS.NONE;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {lang === 'en' ? m.labelEn : m.label}
    </span>
  );
}

function formatDate(v: any) {
  if (!v) return '—';
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch { return String(v); }
}

interface RcHeader { key: string; label: string; labelEn?: string }

async function doTabExport(
  format: 'excel' | 'pdf',
  rows: any[],
  headers: RcHeader[],
  lang: 'ar' | 'en',
  sheetTitle: string,
  filename: string,
): Promise<void> {
  const columns = headers.map(h => ({ key: h.key, labelAr: h.label, labelEn: h.labelEn }));
  await exportReport({
    data: rows,
    columns,
    lang,
    username: getCurrentUsername(),
    format,
    filename: `${filename}.${format === 'pdf' ? 'pdf' : 'xlsx'}`,
    sheetTitle,
  });
}

type Tab = 'templates' | 'overdue' | 'new-orders' | 'by-sector' | 'monthly';

export default function ReportCenter() {
  const { lang } = useLang();
  const [activeTab, setActiveTab] = useState<Tab>('templates');

  const tabs: { key: Tab; labelAr: string; labelEn: string; icon: any }[] = [
    { key: 'templates',  labelAr: 'قوالب محفوظة',       labelEn: 'Saved Templates', icon: BookMarked   },
    { key: 'new-orders', labelAr: 'الأوامر الجديدة',    labelEn: 'New Orders',      icon: Sparkles     },
    { key: 'overdue',    labelAr: 'تقرير المتأخرة',     labelEn: 'Overdue Report',  icon: Clock        },
    { key: 'by-sector',  labelAr: 'تقرير القطاعات',     labelEn: 'By Sector',       icon: Users        },
    { key: 'monthly',    labelAr: 'التقرير الشهري',     labelEn: 'Monthly Report',  icon: CalendarDays },
  ];

  return (
    <div className="flex flex-col h-full bg-slate-50" dir={lang === 'en' ? 'ltr' : 'rtl'}>
      <header className="bg-white border-b border-slate-200 px-4 md:px-6 py-4 flex items-center gap-3">
        <FileSpreadsheet className="w-5 h-5 text-indigo-600" />
        <div>
          <h1 className="text-lg font-bold text-slate-800">{lang === 'en' ? 'Report Center' : 'مركز التقارير'}</h1>
          <p className="text-xs text-slate-500">{lang === 'en' ? 'Saved templates, fixed reports, and Excel exports' : 'قوالب محفوظة، تقارير ثابتة، وتصدير Excel'}</p>
        </div>
      </header>

      {/* Tabs */}
      <div className="bg-white border-b border-slate-200 px-4 flex gap-1 overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === t.key
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {lang === 'en' ? t.labelEn : t.labelAr}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-x-hidden overflow-y-auto p-4 md:p-6">
        {activeTab === 'templates'  && <TemplatesPanel />}
        {activeTab === 'new-orders' && <NewOrdersReport />}
        {activeTab === 'overdue'    && <OverdueReport />}
        {activeTab === 'by-sector'  && <BySectorReport />}
        {activeTab === 'monthly'    && <MonthlyReport />}
      </div>
    </div>
  );
}

// ─── Templates Panel ──────────────────────────────────────────────────────────
function TemplatesPanel() {
  const { lang } = useLang();
  const [templates, setTemplates]     = useState<any[]>([]);
  const [loading, setLoading]         = useState(true);
  const [showNew, setShowNew]         = useState(false);
  const [editTarget, setEditTarget]   = useState<any>(null);
  const [activeRun, setActiveRun]     = useState<any>(null); // template currently being run

  const load = useCallback(() => {
    setLoading(true);
    api.get('/reports/templates').then(r => setTemplates(r.data)).catch(console.error).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const del = async (id: string) => {
    if (!confirm(lang === 'en' ? 'Delete this template?' : 'هل تريد حذف هذا القالب؟')) return;
    await api.delete(`/reports/templates/${id}`);
    if (activeRun?.id === id) setActiveRun(null);
    load();
  };

  const FILTER_LABELS: Record<string, string> = {
    regionId: 'المنطقة', sectorId: 'القطاع',
    execStatus: 'حالة التنفيذ', finStatus: 'حالة المالي', overallStatus: 'الحالة الكاملة',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-700">
          {lang === 'en' ? 'Saved Report Templates' : 'قوالب التقارير المحفوظة'}
        </h2>
        <button
          onClick={() => { setEditTarget(null); setShowNew(true); setActiveRun(null); }}
          className="flex items-center gap-2 bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {lang === 'en' ? 'New Template' : 'قالب جديد'}
        </button>
      </div>

      {(showNew || editTarget) && (
        <TemplateForm
          initial={editTarget}
          onSaved={() => { setShowNew(false); setEditTarget(null); load(); }}
          onCancel={() => { setShowNew(false); setEditTarget(null); }}
        />
      )}

      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      ) : templates.length === 0 ? (
        <div className="py-16 text-center text-slate-400 text-sm">
          {lang === 'en' ? 'No templates yet. Create one to save your filters and columns.' : 'لا توجد قوالب بعد. أنشئ قالباً لحفظ الفلاتر والأعمدة.'}
        </div>
      ) : (
        <div className="grid gap-3">
          {templates.map(t => {
            const isRunning = activeRun?.id === t.id;
            return (
              <div key={t.id} className={`bg-white rounded-xl border transition-all min-w-0 ${isRunning ? 'border-indigo-400 shadow-md' : 'border-slate-200'}`}>
                {/* Template card header */}
                <div className="p-4 flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-800 text-sm">{t.name}</span>
                      {t.isShared && (
                        <span className="flex items-center gap-1 text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">
                          <Share2 className="w-3 h-3" />
                          {lang === 'en' ? 'Shared' : 'مشترك'}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      {lang === 'en' ? `${(t.columns ?? []).length} columns` : `${(t.columns ?? []).length} عمود`}
                      {(t.fullName || t.username) && ` · ${t.fullName || t.username}`}
                      {' · '}{new Date(t.updatedAt).toLocaleDateString('en-GB')}
                    </p>
                    {Object.keys(t.filters ?? {}).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {Object.entries(t.filters).map(([k, v]) => (
                          <span key={k} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                            {FILTER_LABELS[k] ?? k}: {String(v)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {/* Run report button */}
                    <button
                      onClick={() => setActiveRun(isRunning ? null : t)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        isRunning
                          ? 'bg-indigo-600 text-white'
                          : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200'
                      }`}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      {isRunning
                        ? (lang === 'en' ? 'Hide' : 'إخفاء')
                        : (lang === 'en' ? 'Run Report' : 'عرض التقرير')}
                    </button>
                    <button
                      onClick={() => { setEditTarget(t); setActiveRun(null); }}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                      title={lang === 'en' ? 'Edit' : 'تعديل'}
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => del(t.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      title={lang === 'en' ? 'Delete' : 'حذف'}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Inline report results */}
                {isRunning && (
                  <div className="border-t border-indigo-100 bg-indigo-50/30 rounded-b-xl p-4">
                    <TemplateResultPanel template={t} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Template Result Panel ────────────────────────────────────────────────────
// dataKey resolution: some columns (regionId, sectorId) store UUIDs in the DB
// but the API already resolves them to names (regionName, sectorName) in the flat row.
const NAME_OVERRIDES: Record<string, string> = {
  regionId: 'regionName',
  sectorId: 'sectorName',
};

// Columns that are genuinely numeric/quantitative and safe to sum.
// Keys must be camelCase — the /reports/meta endpoint converts all columnKeys via toCamel().
// Only these 7 columns will ever appear in the totals row.
const SUMMABLE_COLS = new Set([
  'length',
  'estimatedValue',
  'actualInvoiceValue',
  'invoice1',
  'invoice2',
  'collectedAmount',
  'remainingAmount',
]);

function TemplateResultPanel({ template }: { template: any }) {
  const { lang } = useLang();
  const [rows, setRows]       = useState<any[]>([]);
  const [colMeta, setColMeta] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState('');

  const templateCols: string[] = template.columns ?? [];
  const filters: Record<string, string> = template.filters ?? {};

  useEffect(() => {
    setLoading(true);
    setErr('');
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });

    Promise.all([
      api.get(`/reports/data?${params.toString()}`),
      api.get('/reports/meta'),
    ]).then(([dataRes, metaRes]) => {
      setRows(dataRes.data.rows ?? []);
      const allCols: any[] = Object.values(metaRes.data.columnGroups as Record<string, any>)
        .flatMap((g: any) => g.columns);
      const map: Record<string, any> = {};
      allCols.forEach((c: any) => { map[c.columnKey] = c; });
      setColMeta(map);
    }).catch(() => setErr(lang === 'en' ? 'Failed to load report data.' : 'فشل تحميل بيانات التقرير.')).finally(() => setLoading(false));
  }, [template.id]);

  // Columns to show — if template has no columns saved, show first 10
  const visibleCols = templateCols.length > 0
    ? templateCols
    : Object.keys(colMeta).slice(0, 10);

  // Resolve the correct data field from the flat row for a given columnKey
  const resolveField = (colKey: string): string => {
    const meta = colMeta[colKey];
    const dataKey: string = meta?.dataKey ?? colKey;
    return NAME_OVERRIDES[dataKey] ?? dataKey;
  };

  const resolveRaw = (row: any, colKey: string): any => {
    const field = resolveField(colKey);
    return row[field] ?? row[colKey] ?? null;
  };

  // قاموس ترجمة القيم الخاصة بحالة التنفيذ وغيرها
  const VALUE_LABELS: Record<string, { ar: string; en: string }> = {
    EXECUTED:       { ar: 'تم التنفيذ', en: 'Executed'   },
    ONGOING:        { ar: 'قائم',       en: 'Ongoing'    },
    PENDING:        { ar: 'معلق',       en: 'Pending'    },
    IN_PROGRESS:    { ar: 'جاري',       en: 'In Progress'},
    REJECTED:       { ar: 'مرفوض',      en: 'Rejected'   },
    EXPIRED:        { ar: 'منتهي',      en: 'Expired'    },
    ACTIVE:         { ar: 'ساري',       en: 'Active'     },
  };

  const cellValue = (row: any, colKey: string) => {
    const v = resolveRaw(row, colKey);
    if (v === null || v === undefined || v === '') return '—';
    // بوليان → نعم / لا
    if (v === true  || v === 'true')  return lang === 'en' ? 'Yes' : 'نعم';
    if (v === false || v === 'false') return lang === 'en' ? 'No'  : 'لا';
    const str = String(v);
    // حالات KPI معروفة
    const sm = STATUS_META[str];
    if (sm) return <StatusBadge status={str} />;
    // قيم خاصة مثل حالة التنفيذ
    const vl = VALUE_LABELS[str];
    if (vl) return lang === 'en' ? vl.en : vl.ar;
    const meta = colMeta[colKey];
    const dataKey: string = meta?.dataKey ?? colKey;
    if ((meta?.dataType === 'date' || dataKey.toLowerCase().includes('date')) && typeof v === 'string') {
      return formatDate(v);
    }
    return str;
  };

  // Compute column totals for summable columns
  const columnTotals: Record<string, number> = {};
  if (rows.length > 0) {
    visibleCols.forEach(k => {
      if (!SUMMABLE_COLS.has(k)) return;
      columnTotals[k] = rows.reduce((sum, row) => {
        const v = resolveRaw(row, k);
        const n = typeof v === 'number' ? v : Number(v);
        return sum + (isFinite(n) ? n : 0);
      }, 0);
    });
  }
  const hasSummableCols = visibleCols.some(k => SUMMABLE_COLS.has(k));

  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);

  const doExport = async (format: 'excel' | 'pdf') => {
    if (exporting) return;
    setExporting(format);
    const dateTag = new Date().toLocaleDateString('en-CA');
    try {
      const exportRows = rows.map(r => {
        const out: Record<string, any> = { ...r };
        visibleCols.forEach(k => {
          const field = resolveField(k);
          out[`__export_${k}`] = r[field] ?? r[k] ?? '';
        });
        return out;
      });
      const columns = visibleCols.map(k => ({
        key:     `__export_${k}`,
        labelAr: colMeta[k]?.labelAr ?? k,
        labelEn: colMeta[k]?.labelEn,
      }));
      // Remap totals keys to match the prefixed export keys
      const exportTotals: Record<string, number> = {};
      Object.entries(columnTotals).forEach(([k, v]) => {
        exportTotals[`__export_${k}`] = v;
      });
      const filename = lang === 'en'
        ? `${template.name}_${dateTag}`
        : `${template.name}-${dateTag}`;
      await exportReport({
        data:      exportRows,
        columns,
        lang,
        username:  getCurrentUsername(),
        format,
        filename:  `${filename}.${format === 'pdf' ? 'pdf' : 'xlsx'}`,
        sheetTitle: template.name,
        totals:    Object.keys(exportTotals).length > 0 ? exportTotals : undefined,
      });
    } catch (e) { console.error(e); } finally { setExporting(null); }
  };

  return (
    <div className="space-y-3">
      {/* Toolbar — always visible, outside scrollable area */}
      <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-lg px-4 py-2.5 flex-wrap">
        <p className="text-sm font-medium text-slate-700 flex-1">
          {loading
            ? (lang === 'en' ? 'Loading…' : 'جار التحميل…')
            : err
              ? (lang === 'en' ? 'Error loading data' : 'خطأ في تحميل البيانات')
              : (lang === 'en' ? `${rows.length.toLocaleString('en-US')} result(s)` : `${rows.length.toLocaleString('en-US')} نتيجة`)}
        </p>
        <button onClick={() => doExport('excel')} disabled={rows.length === 0 || loading || !!exporting}
          data-testid="btn-template-export-excel"
          className="flex items-center gap-1.5 bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-40 transition-colors shadow-sm">
          {exporting === 'excel' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Excel
        </button>
        <button onClick={() => doExport('pdf')} disabled={rows.length === 0 || loading || !!exporting}
          data-testid="btn-template-export-pdf"
          className="flex items-center gap-1.5 bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-40 transition-colors shadow-sm">
          {exporting === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FilePdf className="w-4 h-4" />}
          PDF
        </button>
      </div>

      {loading ? (
        <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-indigo-400" /></div>
      ) : err ? (
        <p className="text-sm text-red-500 py-4 text-center">{err}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-400 py-8 text-center">
          {lang === 'en' ? 'No rows match the saved filters.' : 'لا توجد نتائج تطابق فلاتر هذا القالب.'}
        </p>
      ) : (
        <div className="bg-white rounded-lg border border-slate-200 overflow-auto max-h-[450px]">
          <table className="w-full text-xs min-w-max">
            <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
              <tr>
                {visibleCols.map(k => (
                  <th key={k} className="px-3 py-2.5 text-right font-semibold text-slate-600 whitespace-nowrap">
                    {(lang === 'en' && colMeta[k]?.labelEn) ? colMeta[k].labelEn : (colMeta[k]?.labelAr ?? k)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={`border-b border-slate-100 hover:bg-indigo-50/30 ${i % 2 === 0 ? '' : 'bg-slate-50/50'}`}>
                  {visibleCols.map(k => (
                    <td key={k} className="px-3 py-2 text-slate-700 whitespace-nowrap">
                      {cellValue(r, k)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {hasSummableCols && (
              <tfoot>
                <tr className="border-t-2" style={{ borderColor: '#334155', backgroundColor: '#e2e8f0' }}>
                  {visibleCols.map((k, i) => {
                    if (SUMMABLE_COLS.has(k) && columnTotals[k] !== undefined) {
                      return (
                        <td key={k} className="px-3 py-2 font-bold whitespace-nowrap" style={{ color: '#334155' }}>
                          {columnTotals[k].toLocaleString('en-US')}
                        </td>
                      );
                    }
                    return (
                      <td key={k} className="px-3 py-2 font-semibold whitespace-nowrap" style={{ color: '#334155' }}>
                        {i === 0 ? (lang === 'en' ? 'Total' : 'المجموع') : ''}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}

function TemplateForm({ initial, onSaved, onCancel }: { initial: any; onSaved: () => void; onCancel: () => void }) {
  const { lang } = useLang();
  const [name, setName] = useState(initial?.name ?? '');
  const [isShared, setIsShared] = useState(initial?.isShared ?? false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [meta, setMeta] = useState<any>(null);
  const [selectedCols, setSelectedCols] = useState<Set<string>>(new Set(initial?.columns ?? []));
  const [filters, setFilters] = useState<Record<string, string>>(initial?.filters ?? {});

  useEffect(() => {
    api.get('/reports/meta').then(r => setMeta(r.data)).catch(console.error);
  }, []);

  const allCols: any[] = meta
    ? Object.values(meta.columnGroups as Record<string, any>).flatMap((g: any) => g.columns)
    : [];

  const toggleCol = (key: string) => {
    setSelectedCols(prev => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  };

  const save = async () => {
    setErr('');
    if (!name.trim()) { setErr(lang === 'en' ? 'Name is required' : 'الاسم مطلوب'); return; }
    setSaving(true);
    try {
      const payload = { name, isShared, columns: [...selectedCols], filters };
      if (initial?.id) {
        await api.put(`/reports/templates/${initial.id}`, payload);
      } else {
        await api.post('/reports/templates', payload);
      }
      onSaved();
    } catch { setErr(lang === 'en' ? 'Save failed' : 'فشل الحفظ'); }
    finally { setSaving(false); }
  };

  return (
    <div className="bg-white border border-indigo-200 rounded-xl p-5 space-y-4">
      <h3 className="font-semibold text-slate-700 text-sm">
        {initial ? (lang === 'en' ? 'Edit Template' : 'تعديل القالب') : (lang === 'en' ? 'New Template' : 'قالب جديد')}
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">{lang === 'en' ? 'Template Name' : 'اسم القالب'}</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={lang === 'en' ? 'e.g. Overdue Summary' : 'مثال: ملخص المتأخرة'}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
          />
        </div>
        <div className="flex items-end gap-3">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={isShared} onChange={e => setIsShared(e.target.checked)} className="rounded" />
            <span className="text-sm text-slate-600">{lang === 'en' ? 'Share with all users' : 'مشاركة مع الجميع'}</span>
          </label>
        </div>
      </div>

      {/* Column selection */}
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-2">{lang === 'en' ? 'Columns to include' : 'الأعمدة المضمّنة'}</label>
        <div className="border border-slate-200 rounded-lg p-3 max-h-48 overflow-y-auto grid grid-cols-2 md:grid-cols-3 gap-1.5">
          {allCols.map((c: any) => (
            <label key={c.columnKey} className="flex items-center gap-1.5 cursor-pointer text-xs text-slate-600 hover:text-slate-800">
              <input
                type="checkbox"
                checked={selectedCols.has(c.columnKey)}
                onChange={() => toggleCol(c.columnKey)}
                className="rounded"
              />
              {lang === 'en' && c.labelEn ? c.labelEn : c.labelAr}
            </label>
          ))}
          {allCols.length === 0 && <span className="text-xs text-slate-400 col-span-3">{lang === 'en' ? 'Loading columns...' : 'جار تحميل الأعمدة...'}</span>}
        </div>
      </div>

      {err && <p className="text-xs text-red-500">{err}</p>}

      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-4 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">
          {lang === 'en' ? 'Cancel' : 'إلغاء'}
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {lang === 'en' ? 'Save' : 'حفظ'}
        </button>
      </div>
    </div>
  );
}

// ─── New Orders Report (configurable window, default 7 days) ─────────────────
const DAY_OPTIONS = [7, 14, 30, 60, 90];

function NewOrdersReport() {
  const { lang } = useLang();
  const [rows, setRows]       = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays]       = useState(7);

  const load = useCallback((d: number) => {
    setLoading(true);
    api.get(`/reports/fixed/new-orders?days=${d}`)
      .then(r => setRows(r.data.rows ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(days); }, [days, load]);

  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);

  const headers: RcHeader[] = [
    { key: 'orderNumber',    label: 'رقم الأمر',       labelEn: 'Order No.'        },
    { key: 'client',         label: 'العميل',           labelEn: 'Client'           },
    { key: 'district',       label: 'الموقع',           labelEn: 'Location'         },
    { key: 'workType',       label: 'نوع العمل',       labelEn: 'Work Type'        },
    { key: 'projectType',    label: 'نوعية المشروع',   labelEn: 'Project Type'     },
    { key: 'assignmentDate', label: 'تاريخ الإسناد',   labelEn: 'Assignment Date'  },
    { key: 'daysOld',        label: 'منذ (أيام)',       labelEn: 'Days Ago'         },
    { key: 'procedure',      label: 'الإجراء الحالي',  labelEn: 'Current Stage'    },
    { key: 'execStatus',     label: 'حالة التنفيذ',    labelEn: 'Exec Status'      },
  ];

  const doExport = async (format: 'excel' | 'pdf') => {
    if (exporting) return;
    setExporting(format);
    const dateTag = new Date().toLocaleDateString('en-CA');
    try {
      await doTabExport(format, rows, headers, lang, lang === 'en' ? 'New Orders' : 'الأوامر الجديدة',
        lang === 'en' ? `New_Orders_${dateTag}` : `تقرير-الأوامر-الجديدة-${dateTag}`);
    } catch (e) { console.error(e); } finally { setExporting(null); }
  };

  // colour the age pill relative to chosen window
  const ageCls = (d: number) => {
    const pct = d / days;
    if (pct <= 0.3) return 'bg-emerald-100 text-emerald-700';
    if (pct <= 0.7) return 'bg-amber-100 text-amber-700';
    return 'bg-red-100 text-red-700';
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-700">
            {lang === 'en' ? 'New Orders' : 'الأوامر الجديدة'}
          </h2>
          <p className="text-xs text-slate-400">
            {lang === 'en'
              ? `Orders assigned within the last ${days} days — ${rows.length} order(s)`
              : `أوامر إسنادها خلال آخر ${days} يوم — ${rows.length} أمر`}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Day window selector */}
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
            {DAY_OPTIONS.map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  days === d
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-white hover:shadow-sm'
                }`}
              >
                {d}{lang === 'en' ? 'd' : 'ي'}
              </button>
            ))}
          </div>

          <button onClick={() => load(days)} className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => doExport('excel')} disabled={rows.length === 0 || !!exporting}
            data-testid="btn-new-orders-export-excel"
            className="flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-emerald-700 disabled:opacity-40 transition-colors">
            {exporting === 'excel' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Excel
          </button>
          <button onClick={() => doExport('pdf')} disabled={rows.length === 0 || !!exporting}
            data-testid="btn-new-orders-export-pdf"
            className="flex items-center gap-1.5 bg-red-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-red-700 disabled:opacity-40 transition-colors">
            {exporting === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FilePdf className="w-4 h-4" />}
            PDF
          </button>
        </div>
      </div>

      {/* Info banner when window > 7 */}
      {days > 7 && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-xs text-amber-700">
          <span className="mt-0.5">⚠️</span>
          <span>
            {lang === 'en'
              ? `Showing orders from the last ${days} days. In production, this report defaults to 7 days.`
              : `تعرض الأوامر خلال آخر ${days} يوم. في الاستخدام الفعلي يُظهر التقرير آخر 7 أيام فقط.`}
          </span>
        </div>
      )}

      {/* Age legend */}
      <div className="flex items-center gap-3 flex-wrap text-xs">
        <span className="font-medium text-slate-500">{lang === 'en' ? 'Age:' : 'العمر:'}</span>
        <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
          {lang === 'en' ? 'Recent (0–30%)' : 'حديث (0–30%)'}
        </span>
        <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
          {lang === 'en' ? 'Mid (30–70%)' : 'متوسط (30–70%)'}
        </span>
        <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-100 text-red-700">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
          {lang === 'en' ? 'Near expiry (70–100%)' : 'قرب الانتهاء (70–100%)'}
        </span>
      </div>

      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center text-slate-400 space-y-2">
          <Sparkles className="w-10 h-10 mx-auto text-slate-300" />
          <p className="font-medium">
            {lang === 'en'
              ? `No orders assigned in the last ${days} days.`
              : `لا توجد أوامر أُسندت خلال آخر ${days} يوم.`}
          </p>
          <p className="text-xs">
            {lang === 'en'
              ? 'Try increasing the day window using the selector above.'
              : 'جرّب توسيع نافذة الأيام من الأزرار أعلاه.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-auto">
          <table className="w-full text-sm min-w-[750px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {headers.map(h => (
                  <th key={h.key} className="px-3 py-2.5 text-right text-xs font-semibold text-slate-600 whitespace-nowrap">{h.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono font-bold text-indigo-700">{r.orderNumber}</td>
                  <td className="px-3 py-2 text-slate-700">{r.client || '—'}</td>
                  <td className="px-3 py-2 text-slate-700">{r.district || '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{r.workType || '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{r.projectType || '—'}</td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{formatDate(r.assignmentDate)}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${ageCls(r.daysOld)}`}>
                      {r.daysOld === 0
                        ? (lang === 'en' ? 'Today' : 'اليوم')
                        : `${r.daysOld} ${lang === 'en' ? 'd' : 'ي'}`}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{r.procedure || '—'}</td>
                  <td className="px-3 py-2"><StatusBadge status={r.execStatus} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Overdue Report ───────────────────────────────────────────────────────────
function OverdueReport() {
  const { lang } = useLang();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get('/reports/fixed/overdue').then(r => setRows(r.data.rows ?? [])).catch(console.error).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);

  const headers: RcHeader[] = [
    { key: 'orderNumber',    label: 'رقم الأمر',      labelEn: 'Order No.'       },
    { key: 'client',         label: 'العميل',          labelEn: 'Client'          },
    { key: 'district',       label: 'الموقع',          labelEn: 'Location'        },
    { key: 'workType',       label: 'نوع العمل',      labelEn: 'Work Type'       },
    { key: 'projectType',    label: 'نوعية المشروع',  labelEn: 'Project Type'    },
    { key: 'assignmentDate', label: 'تاريخ الإسناد',  labelEn: 'Assignment Date' },
    { key: 'procedure',      label: 'الإجراء الحالي', labelEn: 'Current Stage'   },
    { key: 'execStatus',     label: 'حالة التنفيذ',   labelEn: 'Exec Status'     },
    { key: 'finStatus',      label: 'حالة المالي',    labelEn: 'Fin Status'      },
  ];

  const doExport = async (format: 'excel' | 'pdf') => {
    if (exporting) return;
    setExporting(format);
    const dateTag = new Date().toLocaleDateString('en-CA');
    try {
      await doTabExport(format, rows, headers, lang, lang === 'en' ? 'Overdue Orders' : 'أوامر متأخرة',
        lang === 'en' ? `Overdue_Orders_${dateTag}` : `تقرير-المتأخرة-${dateTag}`);
    } catch (e) { console.error(e); } finally { setExporting(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-700">{lang === 'en' ? 'Overdue Work Orders' : 'أوامر العمل المتأخرة'}</h2>
          <p className="text-xs text-slate-400">{rows.length} {lang === 'en' ? 'orders overdue' : 'أمر متأخر'}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => doExport('excel')} disabled={rows.length === 0 || !!exporting}
            data-testid="btn-overdue-export-excel"
            className="flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-emerald-700 disabled:opacity-40 transition-colors">
            {exporting === 'excel' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Excel
          </button>
          <button onClick={() => doExport('pdf')} disabled={rows.length === 0 || !!exporting}
            data-testid="btn-overdue-export-pdf"
            className="flex items-center gap-1.5 bg-red-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-red-700 disabled:opacity-40 transition-colors">
            {exporting === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FilePdf className="w-4 h-4" />}
            PDF
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center text-slate-400">
          <Check className="w-10 h-10 mx-auto mb-2 text-emerald-400" />
          <p>{lang === 'en' ? 'No overdue orders!' : 'لا توجد أوامر متأخرة!'}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {headers.map(h => (
                  <th key={h.key} className="px-3 py-2.5 text-right text-xs font-semibold text-slate-600 whitespace-nowrap">{h.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono font-bold text-indigo-700">{r.orderNumber}</td>
                  <td className="px-3 py-2 text-slate-700">{r.client || '—'}</td>
                  <td className="px-3 py-2 text-slate-700">{r.district || '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{r.workType || '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{r.projectType || '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{formatDate(r.assignmentDate)}</td>
                  <td className="px-3 py-2 text-slate-600">{r.procedure || '—'}</td>
                  <td className="px-3 py-2"><StatusBadge status={r.execStatus} /></td>
                  <td className="px-3 py-2"><StatusBadge status={r.finStatus} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── By Sector Report ─────────────────────────────────────────────────────────
function BySectorReport() {
  const { lang } = useLang();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get('/reports/fixed/by-sector').then(r => setRows(r.data.rows ?? [])).catch(console.error).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);

  const headers: RcHeader[] = [
    { key: 'name',      label: 'القطاع',   labelEn: 'Sector'    },
    { key: 'total',     label: 'الإجمالي', labelEn: 'Total'     },
    { key: 'overdue',   label: 'متأخر',    labelEn: 'Overdue'   },
    { key: 'warn',      label: 'تنبيه',    labelEn: 'Warning'   },
    { key: 'ok',        label: 'منتظم',    labelEn: 'On Track'  },
    { key: 'completed', label: 'منجز',     labelEn: 'Completed' },
  ];

  const doExport = async (format: 'excel' | 'pdf') => {
    if (exporting) return;
    setExporting(format);
    const dateTag = new Date().toLocaleDateString('en-CA');
    try {
      await doTabExport(format, rows, headers, lang, lang === 'en' ? 'By Sector' : 'القطاعات',
        lang === 'en' ? `By_Sector_${dateTag}` : `تقرير-القطاعات-${dateTag}`);
    } catch (e) { console.error(e); } finally { setExporting(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-700">{lang === 'en' ? 'Report by Sector' : 'تقرير حسب القطاعات'}</h2>
          <p className="text-xs text-slate-400">{lang === 'en' ? 'Summary per sector' : 'ملخص لكل قطاع'}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => doExport('excel')} disabled={rows.length === 0 || !!exporting}
            data-testid="btn-sector-export-excel"
            className="flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-emerald-700 disabled:opacity-40 transition-colors">
            {exporting === 'excel' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Excel
          </button>
          <button onClick={() => doExport('pdf')} disabled={rows.length === 0 || !!exporting}
            data-testid="btn-sector-export-pdf"
            className="flex items-center gap-1.5 bg-red-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-red-700 disabled:opacity-40 transition-colors">
            {exporting === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FilePdf className="w-4 h-4" />}
            PDF
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {headers.map(h => (
                  <th key={h.key} className="px-4 py-3 text-right text-xs font-semibold text-slate-600">{h.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{r.name}</td>
                  <td className="px-4 py-3 font-bold text-indigo-700">{r.total}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${r.overdue > 0 ? 'bg-red-100 text-red-700' : 'text-slate-400'}`}>{r.overdue}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${r.warn > 0 ? 'bg-amber-100 text-amber-700' : 'text-slate-400'}`}>{r.warn}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${r.ok > 0 ? 'bg-emerald-100 text-emerald-700' : 'text-slate-400'}`}>{r.ok}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${r.completed > 0 ? 'bg-blue-100 text-blue-700' : 'text-slate-400'}`}>{r.completed}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Monthly Report ───────────────────────────────────────────────────────────
function MonthlyReport() {
  const { lang } = useLang();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get('/reports/fixed/monthly').then(r => setRows(r.data.rows ?? [])).catch(console.error).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);

  const headers: RcHeader[] = [
    { key: 'month',     label: 'الشهر',         labelEn: 'Month'       },
    { key: 'total',     label: 'إجمالي الإسناد', labelEn: 'Total'       },
    { key: 'completed', label: 'منجز',           labelEn: 'Completed'   },
    { key: 'overdue',   label: 'متأخر',          labelEn: 'Overdue'     },
  ];

  const monthLabel = (m: string) => {
    try {
      const [y, mo] = m.split('-');
      return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    } catch { return m; }
  };

  const doExport = async (format: 'excel' | 'pdf') => {
    if (exporting) return;
    setExporting(format);
    const dateTag = new Date().toLocaleDateString('en-CA');
    const exportRows = rows.map(r => ({ ...r, month: monthLabel(r.month) }));
    try {
      await doTabExport(format, exportRows, headers, lang, lang === 'en' ? 'Monthly Report' : 'التقرير الشهري',
        lang === 'en' ? `Monthly_Report_${dateTag}` : `تقرير-شهري-${dateTag}`);
    } catch (e) { console.error(e); } finally { setExporting(null); }
  };

  const maxTotal = Math.max(1, ...rows.map(r => r.total));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-700">{lang === 'en' ? 'Monthly Report (Last 12 Months)' : 'التقرير الشهري (آخر 12 شهر)'}</h2>
          <p className="text-xs text-slate-400">{lang === 'en' ? 'Based on assignment date' : 'حسب تاريخ الإسناد'}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => doExport('excel')} disabled={rows.length === 0 || !!exporting}
            data-testid="btn-monthly-export-excel"
            className="flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-emerald-700 disabled:opacity-40 transition-colors">
            {exporting === 'excel' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Excel
          </button>
          <button onClick={() => doExport('pdf')} disabled={rows.length === 0 || !!exporting}
            data-testid="btn-monthly-export-pdf"
            className="flex items-center gap-1.5 bg-red-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-red-700 disabled:opacity-40 transition-colors">
            {exporting === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FilePdf className="w-4 h-4" />}
            PDF
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center text-slate-400">{lang === 'en' ? 'No data' : 'لا توجد بيانات'}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Chart-like bars */}
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-600 mb-4">{lang === 'en' ? 'Assignment Volume' : 'حجم الإسناد'}</h3>
            <div className="space-y-2">
              {rows.map(r => (
                <div key={r.month} className="flex items-center gap-3">
                  <span className="text-xs text-slate-500 w-24 shrink-0">{monthLabel(r.month)}</span>
                  <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 rounded-full flex items-center justify-end pr-2 transition-all"
                      style={{ width: `${(r.total / maxTotal) * 100}%` }}
                    >
                      <span className="text-[10px] text-white font-bold">{r.total}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {headers.map(h => (
                    <th key={h.key} className="px-4 py-3 text-right text-xs font-semibold text-slate-600">{h.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-slate-700 font-medium">{monthLabel(r.month)}</td>
                    <td className="px-4 py-2.5 font-bold text-indigo-700">{r.total}</td>
                    <td className="px-4 py-2.5">
                      <span className="text-blue-700 font-medium">{r.completed}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={r.overdue > 0 ? 'text-red-600 font-medium' : 'text-slate-400'}>{r.overdue}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
