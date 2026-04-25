import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useLang } from '../contexts/LangContext';
import api from '../services/api';
import { 
  LayoutDashboard,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Clock,
  DollarSign,
  X,
  ChevronDown,
  RefreshCw,
  Calendar,
  Filter,
  Maximize2,
  ClipboardList,
  Target,
  Save,
  XCircle,
  Building2,
  MapPin,
  Layers,
  Scale,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  PieChart, 
  Pie, 
  Cell, 
  ComposedChart, 
  Area,
  LabelList
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import { exportReport } from '../utils/reportExporter';

const COLORS = {
  navy:    '#1E3A5F',
  blue:    '#2563EB',
  teal:    '#0D9488',
  amber:   '#D97706',
  emerald: '#059669',
  red:     '#DC2626',
  sky:     '#0284C7',
  slate:   '#475569',
  indigo:  '#4F46E5',
  violet:  '#7C3AED',
  orange:  '#EA580C',
};

// Professional brand-aligned palette — dark navy as primary
const CHART_COLORS = [
  '#1E3A5F',  // deep navy
  '#2563EB',  // royal blue
  '#0D9488',  // teal
  '#D97706',  // amber
  '#059669',  // emerald
  '#7C3AED',  // violet
  '#EA580C',  // orange
  '#0284C7',  // sky
];

// Abbreviate large numbers: 18,904,693 → 18.9M
function abbrevNum(v: number, curr?: string): string {
  const s = curr ? ` ${curr}` : '';
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M' + s;
  if (v >= 1_000)     return (v / 1_000).toFixed(0) + 'K' + s;
  return v.toLocaleString('en-US') + s;
}

// Truncate long Arabic labels so they don't overflow the chart
function truncLabel(s: string, max = 14): string {
  return s && s.length > max ? s.slice(0, max) + '…' : (s ?? '');
}

function InfoBadge({ text }: { text: string }) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLSpanElement>(null);

  const show = () => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ left: r.left, top: r.top });
  };
  const hide = () => setPos(null);

  const tooltipWidth = 240;
  const leftPos = pos ? Math.min(
    Math.max(8, pos.left - tooltipWidth / 2),
    window.innerWidth - tooltipWidth - 8
  ) : 0;

  return (
    <>
      <span
        ref={btnRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        className="w-3.5 h-3.5 rounded-full bg-slate-200 text-slate-500 text-[9px] font-bold flex items-center justify-center cursor-help select-none leading-none hover:bg-blue-100 hover:text-blue-600 transition-colors flex-shrink-0"
      >!</span>
      {pos && (
        <div
          className="fixed z-[9999] pointer-events-none"
          style={{ top: pos.top - 8, left: leftPos, transform: 'translateY(-100%)' }}
        >
          <div
            className="bg-slate-800 text-white text-[11px] leading-relaxed rounded-xl px-3 py-2.5 shadow-2xl text-right whitespace-normal"
            style={{ width: tooltipWidth }}
            dir="rtl"
          >
            {text}
          </div>
          <div className="w-2.5 h-2.5 bg-slate-800 rotate-45 absolute -bottom-1" style={{ left: tooltipWidth / 2 - 5 }} />
        </div>
      )}
    </>
  );
}

function MetricRow({ label, value, sub, target, colors, barPct, tooltip }: {
  label: string; value: string; sub?: string; target?: string | null;
  colors: { dot: string; text: string; bg: string }; barPct: number | null;
  tooltip?: string;
}) {
  const barColor = '#334155';
  const pct = Math.min(100, barPct ?? 0);
  return (
    <div>
      {/* اسم المؤشر + نقطة الحالة */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-[11px] text-slate-500 font-medium leading-none truncate">{label}</span>
          {tooltip && <InfoBadge text={tooltip} />}
        </div>
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${colors.dot}`} />
      </div>
      {/* الرقم الرئيسي */}
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <span className={`text-base font-bold leading-none tabular-nums ${colors.text}`}>{value}</span>
        {target ? (
          <div className="flex items-center gap-1 flex-shrink-0">
            <span className="text-[10px] text-slate-400 leading-none">المستهدف</span>
            <span className="text-sm font-bold text-slate-600 leading-none tabular-nums">{target}</span>
          </div>
        ) : (
          <span className="text-[10px] text-slate-300 leading-none">—</span>
        )}
      </div>
      {/* شريط التقدم */}
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: barColor }} />
      </div>
      {/* معلومة تكميلية */}
      {sub && <span className="text-[10px] text-slate-400 block mt-1 leading-none">{sub}</span>}
    </div>
  );
}

function FinancialGroupedBar({ data, lang }: { data: any[]; lang: string }) {
  if (!data || data.length === 0) {
    return <div className="text-slate-400 text-sm text-center py-8">{lang === 'en' ? 'No data' : 'لا توجد بيانات'}</div>;
  }
  const maxVal = Math.max(...data.map(d => d.estimated || 0), 1);
  const bars = [
    { key: 'estimated', labelAr: 'التقديري', labelEn: 'Estimated', color: COLORS.slate },
    { key: 'invoiced',  labelAr: 'المفوتر',  labelEn: 'Invoiced',  color: COLORS.sky },
    { key: 'collected', labelAr: 'المحصّل',  labelEn: 'Collected', color: COLORS.emerald },
  ];
  return (
    <div>
      <div className="flex flex-wrap gap-4 mb-4">
        {bars.map(b => (
          <span key={b.key} className="flex items-center gap-1 text-xs font-semibold">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: b.color }} />
            {lang === 'en' ? b.labelEn : b.labelAr}
          </span>
        ))}
      </div>
      <div className="space-y-4">
        {data.map((item, idx) => {
          const name = lang === 'en' && item.nameEn ? item.nameEn : item.nameAr;
          return (
            <div key={idx}>
              <div className="text-xs font-bold text-slate-700 mb-1 truncate">{name}</div>
              <div className="space-y-1">
                {bars.map(b => {
                  const val = item[b.key] || 0;
                  const pct = Math.max((val / maxVal) * 100, val > 0 ? 2 : 0);
                  return (
                    <div key={b.key} className="flex items-center gap-2">
                      <div className="w-16 text-right shrink-0">
                        <span className="text-[10px] font-semibold" style={{ color: b.color }}>
                          {lang === 'en' ? b.labelEn : b.labelAr}
                        </span>
                      </div>
                      <div className="flex-1 h-4 bg-slate-100 rounded-sm overflow-hidden">
                        <div
                          style={{ width: `${pct}%`, background: b.color }}
                          className="h-full rounded-sm transition-all duration-700"
                        />
                      </div>
                      <span className="text-[10px] font-bold tabular-nums w-14 shrink-0" style={{ color: b.color }}>
                        {abbrevNum(val)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── مكوّن قائمة منسدلة متعددة الاختيار ─────────────────────────────────────
function MultiDropdown({ label, icon, options, selected, onToggle, maxSelect, allLabel }: {
  label: string; icon?: React.ReactNode;
  options: { id: string; nameAr: string; nameEn?: string }[];
  selected: string[]; onToggle: (id: string) => void;
  maxSelect?: number; allLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const isAll = selected.length === 0;
  const btnLabel = isAll ? allLabel : `${label} (${selected.length})`;
  return (
    <div className="relative">
      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
          !isAll ? 'bg-indigo-50 border-indigo-300 text-indigo-800' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
        }`}
        data-testid={`dropdown-${label}`}
      >
        {icon}
        <span>{btnLabel}</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute top-full mt-1 z-50 bg-white rounded-xl shadow-xl border border-slate-200 min-w-52 py-1.5 max-h-72 overflow-y-auto">
          <button
            onClick={() => { onToggle('ALL'); setOpen(false); }}
            className={`w-full text-start px-4 py-2 text-sm flex items-center gap-2 hover:bg-slate-50 transition-colors ${isAll ? 'text-indigo-700 font-bold' : 'text-slate-700'}`}
          >
            <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${isAll ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300'}`}>
              {isAll && <span className="w-2 h-2 bg-white rounded-sm block" />}
            </span>
            {allLabel}
          </button>
          <div className="h-px bg-slate-100 my-1" />
          {options.map(o => {
            const sel = selected.includes(o.id);
            const disabled = !sel && maxSelect != null && selected.length >= maxSelect;
            return (
              <button key={o.id} disabled={disabled}
                onClick={() => { onToggle(o.id); if (maxSelect == null) return; }}
                className={`w-full text-start px-4 py-2 text-sm flex items-center gap-2 transition-colors ${disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-slate-50'} ${sel ? 'text-indigo-700 font-semibold' : 'text-slate-700'}`}
              >
                <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${sel ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300'}`}>
                  {sel && <span className="w-2 h-2 bg-white rounded-sm block" />}
                </span>
                {o.nameAr}
                {disabled && <span className="text-[10px] text-slate-400 me-auto">(الحد الأقصى)</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── قائمة منسدلة أحادية الاختيار ────────────────────────────────────────────
function SingleDropdown({ label, icon, options, value, onChange, allLabel }: {
  label?: string; icon?: React.ReactNode;
  options: { value: string; label: string }[];
  value: string; onChange: (v: string) => void; allLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find(o => o.value === value);
  const btnLabel = value === '' ? allLabel : (current?.label ?? allLabel);
  return (
    <div className="relative">
      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
          value !== '' ? 'bg-indigo-50 border-indigo-300 text-indigo-800' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
        }`}
      >
        {icon}
        <span>{btnLabel}</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute top-full mt-1 z-50 bg-white rounded-xl shadow-xl border border-slate-200 min-w-52 py-1.5 max-h-72 overflow-y-auto">
          <button
            onClick={() => { onChange(''); setOpen(false); }}
            className={`w-full text-start px-4 py-2 text-sm flex items-center gap-2 hover:bg-slate-50 transition-colors ${value === '' ? 'text-indigo-700 font-bold' : 'text-slate-700'}`}
          >
            <span className={`w-4 h-4 rounded-full border flex-shrink-0 ${value === '' ? 'border-indigo-600 ring-2 ring-indigo-600 ring-offset-1' : 'border-slate-300'}`} />
            {allLabel}
          </button>
          <div className="h-px bg-slate-100 my-1" />
          {options.map(o => (
            <button key={o.value}
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={`w-full text-start px-4 py-2 text-sm flex items-center gap-2 hover:bg-slate-50 transition-colors ${value === o.value ? 'text-indigo-700 font-semibold' : 'text-slate-700'}`}
            >
              <span className={`w-4 h-4 rounded-full border flex-shrink-0 ${value === o.value ? 'border-indigo-600 ring-2 ring-indigo-600 ring-offset-1' : 'border-slate-300'}`} />
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DashboardExecutive() {
  const { lang, isRtl } = useLang();
  const [sectorWarning, setSectorWarning] = useState(false);
  const today = new Date().toISOString().split('T')[0];
  const defaultDateFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const [periodMode, setPeriodMode] = useState<'MONTH' | 'QUARTER' | 'YEAR' | 'CUSTOM'>('MONTH');
  const [customFrom, setCustomFrom] = useState(defaultDateFrom);
  const [customTo, setCustomTo] = useState(today);

  const [filters, setFilters] = useState({
    sectors: [] as string[],
    regionIds: [] as string[],
    projectType: '',
    period: 'MONTH' as string,
    dateFrom: defaultDateFrom,
    dateTo: today,
  });
  const [granularity, setGranularity] = useState<'WEEK' | 'MONTH' | 'QUARTER'>('MONTH');

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDelay, setSelectedDelay] = useState<any>(null);
  const [configData, setConfigData] = useState<{ sectors: any[], regions: any[] } | null>(null);
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  // Targets state — percentage-based per-sector
  const currentYear = new Date().getFullYear();
  const canManageTargets = (() => { try { const u = JSON.parse(localStorage.getItem('user') || '{}'); return u.role === 'ADMIN' || !!u.canManageTargets; } catch { return false; } })();
  const [sectorTargets, setSectorTargets] = useState<any[]>([]);
  const [sectorTargetsForm, setSectorTargetsForm] = useState<any[]>([]);
  const [showTargetsEdit, setShowTargetsEdit] = useState(false);
  const [targetsSaving, setTargetsSaving] = useState(false);
  const [targetsSaved, setTargetsSaved] = useState(false);
  const [targetsSaveError, setTargetsSaveError] = useState<string | null>(null);
  const [targetsYear, setTargetsYear] = useState(currentYear);

  // Financial card drill-down
  const [activeFinCard, setActiveFinCard] = useState<'estimated'|'invoiced'|'remaining'|'gap'|null>(null);
  const [detailPage, setDetailPage]       = useState(1);
  const [detailData, setDetailData]       = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [exportingDetail, setExportingDetail] = useState<'excel' | 'pdf' | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.sectors.length > 0) params.append('sectors', filters.sectors.join(','));
      if (filters.regionIds.length > 0) params.append('regionIds', filters.regionIds.join(','));
      if (filters.projectType) params.append('projectType', filters.projectType);
      params.append('period', filters.period);
      params.append('dateFrom', filters.dateFrom);
      params.append('dateTo', filters.dateTo);
      params.append('granularity', granularity);

      const res = await api.get(`/dashboard/executive?${params.toString()}`);
      setData(res.data);
      setAuthorized(true);
    } catch (e: any) {
      if (e.response?.status === 403) {
        setAuthorized(false);
      } else {
        setError(lang === 'en' ? 'Failed to fetch dashboard data' : 'فشل في جلب بيانات لوحة القيادة');
      }
    } finally {
      setLoading(false);
    }
  }, [filters, granularity, lang]);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await api.get('/dashboard/executive/config');
      setConfigData(res.data);
    } catch (e: any) {
      if (e.response?.status === 403) setAuthorized(false);
    }
  }, []);

  const fetchSectorTargets = useCallback(async (year?: number) => {
    try {
      const res = await api.get(`/dashboard/executive/sector-targets?year=${year ?? currentYear}`);
      setSectorTargets(res.data.sectors);
      setSectorTargetsForm(res.data.sectors.map((s: any) => ({
        sectorId:             s.sectorId,
        nameAr:               s.nameAr,
        nameEn:               s.nameEn,
        // التنفيذي
        execComplianceTarget: s.execComplianceTarget != null ? String(s.execComplianceTarget) : '',
        closureRateTarget:    s.closureRateTarget    != null ? String(s.closureRateTarget)    : '',
        // المالي
        salesAmountTarget:    s.salesAmountTarget    != null ? String(s.salesAmountTarget)    : '',
        collectionRateTarget: s.collectionRateTarget != null ? String(s.collectionRateTarget) : '',
        finComplianceTarget:  s.finComplianceTarget  != null ? String(s.finComplianceTarget)  : '',
      })));
    } catch {}
  }, [currentYear]);

  const fetchDetail = useCallback(async (card: string, page: number) => {
    setDetailLoading(true);
    try {
      const params = new URLSearchParams({ card, page: String(page), limit: '20' });
      if (filters.sectors.length > 0)  params.append('sectors',    filters.sectors.join(','));
      if (filters.regionIds.length > 0) params.append('regionIds',  filters.regionIds.join(','));
      if (filters.projectType)          params.append('projectType', filters.projectType);
      const res = await api.get(`/dashboard/executive/financial-detail?${params.toString()}`);
      setDetailData(res.data);
    } catch { setDetailData(null); }
    finally   { setDetailLoading(false); }
  }, [filters]);

  const exportDetail = useCallback(async (format: 'excel' | 'pdf') => {
    if (!activeFinCard) return;
    setExportingDetail(format);
    try {
      const allRows: any[] = [];
      let page = 1;
      let totalPages = 1;
      let cardTotal: number | null = null;

      do {
        const params = new URLSearchParams({ card: activeFinCard, page: String(page), limit: '100' });
        if (filters.sectors.length > 0)   params.append('sectors',     filters.sectors.join(','));
        if (filters.regionIds.length > 0)  params.append('regionIds',   filters.regionIds.join(','));
        if (filters.projectType)           params.append('projectType', filters.projectType);
        const res = await api.get(`/dashboard/executive/financial-detail?${params.toString()}`);
        if (page === 1) cardTotal = res.data.cardTotal ?? null;
        allRows.push(...res.data.rows);
        totalPages = res.data.pagination.totalPages;
        page++;
      } while (page <= totalPages);

      const cols = DETAIL_COLS[activeFinCard];
      const cardLabel = lang === 'en' ? CARD_LABELS[activeFinCard].en : CARD_LABELS[activeFinCard].ar;
      const dateTag   = new Date().toISOString().split('T')[0];
      const filename  = lang === 'en'
        ? `Executive_${CARD_LABELS[activeFinCard].en.replace(/\s+/g, '_')}_${dateTag}.${format === 'pdf' ? 'pdf' : 'xlsx'}`
        : `تنفيذي_${CARD_LABELS[activeFinCard].ar}_${dateTag}.${format === 'pdf' ? 'pdf' : 'xlsx'}`;

      // Pre-format values to match table display
      const exportData = allRows.map(row => {
        const out: Record<string, string> = {};
        cols.forEach(col => {
          const val = row[col.key];
          if (val == null) {
            out[col.key] = '—';
          } else if (col.pct) {
            out[col.key] = Number(val).toFixed(1) + '%';
          } else if (col.numeric) {
            out[col.key] = Number(val).toLocaleString('en-US', { maximumFractionDigits: 0 });
          } else {
            out[col.key] = String(val);
          }
        });
        return out;
      });

      // Columns: derive alignment from numeric/pct flags
      const exportColumns = cols.map(col => ({
        key:     col.key,
        labelAr: col.labelAr,
        labelEn: col.labelEn,
        align:   (col.numeric || col.pct) ? 'center' as const : 'right' as const,
      }));

      // Totals row: highlight numeric column only (not pct)
      const totals: Record<string, number> = {};
      if (cardTotal != null) {
        const highlightCol = cols.find(c => c.highlight && c.numeric);
        if (highlightCol) totals[highlightCol.key] = Math.round(cardTotal);
      }

      const username = (() => { try { return JSON.parse(localStorage.getItem('user') || '{}').username as string | undefined; } catch { return undefined; } })();

      await exportReport({
        data:       exportData,
        columns:    exportColumns,
        lang:       lang as 'ar' | 'en',
        format,
        filename,
        sheetTitle: cardLabel,
        totals:     Object.keys(totals).length > 0 ? totals : undefined,
        username,
      });
    } catch (e) {
      console.error('[exportDetail]', e);
    } finally {
      setExportingDetail(null);
    }
  }, [activeFinCard, filters, lang]);

  // Fetch detail whenever card / page / filters change
  useEffect(() => {
    if (!activeFinCard) { setDetailData(null); return; }
    fetchDetail(activeFinCard, detailPage);
  }, [activeFinCard, detailPage, fetchDetail]);

  // Reset to page 1 when the active card changes
  useEffect(() => { setDetailPage(1); }, [activeFinCard]);

  const saveSectorTargets = async () => {
    setTargetsSaving(true);
    setTargetsSaveError(null);
    try {
      const n = (v: string) => v !== '' ? Number(v) : null;
      await api.put('/dashboard/executive/sector-targets', {
        year: targetsYear,
        sectors: sectorTargetsForm.map(s => ({
          sectorId:             s.sectorId,
          execComplianceTarget: n(s.execComplianceTarget),
          closureRateTarget:    n(s.closureRateTarget),
          salesAmountTarget:    n(s.salesAmountTarget),
          collectionRateTarget: n(s.collectionRateTarget),
          finComplianceTarget:  n(s.finComplianceTarget),
        })),
      });
      // تحديث فوري لـ data state بالمستهدفات الجديدة (لتعكس على البطاقات مباشرة دون انتظار شبكة)
      const newTargetsBySectorId: Record<string, any> = Object.fromEntries(
        sectorTargetsForm.map((s: any) => [s.sectorId, s])
      );
      setData((prev: any) => {
        if (!prev?.sectorPerformance) return prev;
        return {
          ...prev,
          sectorPerformance: prev.sectorPerformance.map((sector: any) => {
            const t = newTargetsBySectorId[sector.sectorId];
            if (!t) return sector;
            const newAnnualSales = t.salesAmountTarget !== '' && t.salesAmountTarget != null
              ? Number(t.salesAmountTarget)
              : null;
            return {
              ...sector,
              annualSalesTarget:    newAnnualSales,
              execComplianceTarget: t.execComplianceTarget !== '' && t.execComplianceTarget != null ? Number(t.execComplianceTarget) : null,
              closureRateTarget:    t.closureRateTarget    !== '' && t.closureRateTarget    != null ? Number(t.closureRateTarget)    : null,
              collectionRateTarget: t.collectionRateTarget !== '' && t.collectionRateTarget != null ? Number(t.collectionRateTarget) : null,
              finComplianceTarget:  t.finComplianceTarget  !== '' && t.finComplianceTarget  != null ? Number(t.finComplianceTarget)  : null,
            };
          }),
        };
      });
      // ثم إعادة جلب البيانات من الخادم لضمان التزامن الكامل
      await Promise.all([fetchSectorTargets(targetsYear), fetchData()]);
      setShowTargetsEdit(false);
      setTargetsSaved(true);
      setTimeout(() => setTargetsSaved(false), 3000);
    } catch (e: any) {
      console.error('save sector targets error', e);
      if (e?.response?.status === 403) {
        setTargetsSaveError(lang === 'en' ? 'Permission denied: you cannot save targets.' : 'لا تملك صلاحية حفظ المستهدفات.');
      } else {
        setTargetsSaveError(lang === 'en' ? 'Failed to save. Please try again.' : 'فشل الحفظ، يرجى المحاولة مرة أخرى.');
      }
      setTimeout(() => setTargetsSaveError(null), 4000);
    } finally {
      setTargetsSaving(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  useEffect(() => {
    fetchSectorTargets();
  }, [fetchSectorTargets]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSectorToggle = (id: string) => {
    if (id === 'ALL') {
      setFilters(prev => ({ ...prev, sectors: [] }));
      return;
    }

    setFilters(prev => {
      const exists = prev.sectors.includes(id);
      if (exists) {
        return { ...prev, sectors: prev.sectors.filter(s => s !== id) };
      } else {
        if (prev.sectors.length >= 2) {
          setSectorWarning(true);
          setTimeout(() => setSectorWarning(false), 3000);
          return prev;
        }
        return { ...prev, sectors: [...prev.sectors, id] };
      }
    });
  };

  const handleRegionToggle = (id: string) => {
    if (id === 'ALL') { setFilters(prev => ({ ...prev, regionIds: [] })); return; }
    setFilters(prev => {
      const exists = prev.regionIds.includes(id);
      return { ...prev, regionIds: exists ? prev.regionIds.filter(r => r !== id) : [...prev.regionIds, id] };
    });
  };

  const applyPeriodMode = (mode: 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR' | 'CUSTOM') => {
    setPeriodMode(mode as any);
    if (mode === 'CUSTOM') return;
    const now = new Date();
    let fromDate: Date;
    if      (mode === 'WEEK')    fromDate = new Date(now.getTime() - 7   * 86400000);
    else if (mode === 'MONTH')   fromDate = new Date(now.getTime() - 30  * 86400000);
    else if (mode === 'QUARTER') fromDate = new Date(now.getTime() - 90  * 86400000);
    else                         fromDate = new Date(now.getFullYear(), 0, 1); // YEAR = YTD
    const from = fromDate.toISOString().split('T')[0];
    const to   = now.toISOString().split('T')[0];
    setCustomFrom(from);
    setCustomTo(to);
    setFilters(prev => ({ ...prev, period: mode, dateFrom: from, dateTo: to }));
  };

  const applyCustomRange = () => {
    if (customFrom && customTo && customFrom <= customTo) {
      setFilters(prev => ({ ...prev, dateFrom: customFrom, dateTo: customTo }));
    }
  };

  // legacy helper (kept for compat)
  const setDatePreset = (days: number | 'YTD') => {
    if (days === 'YTD') applyPeriodMode('YEAR');
    else if (days === 30) applyPeriodMode('MONTH');
    else if (days === 90) applyPeriodMode('QUARTER');
  };

  if (authorized === false) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 text-center max-w-md">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-900 mb-2">
            {lang === 'en' ? 'Unauthorized Access' : 'وصول غير مصرح به'}
          </h2>
          <p className="text-slate-500">
            {lang === 'en' ? "You don't have permission to view the executive dashboard." : "ليس لديك صلاحية لعرض لوحة الإدارة التنفيذية."}
          </p>
        </div>
      </div>
    );
  }

  const formatCurrency = (val: number) => {
    return (val ?? 0).toLocaleString('en-US') + ' ' + (lang === 'en' ? 'SAR' : 'ر.س');
  };

  const formatNumber = (val: number) => {
    return (val ?? 0).toLocaleString('en-US');
  };

  const formatDate = (val: any) => {
    if (!val) return '—';
    try {
      return new Date(val).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch { return String(val); }
  };

  const sectorComparisonData = useMemo(() =>
    (data?.sectorComparison ?? []).map((d: any) => ({
      ...d,
      name: (lang === 'en' && d.nameEn) ? d.nameEn : d.nameAr,
    })), [data?.sectorComparison, lang]);

  const regionComparisonData = useMemo(() =>
    (data?.regionComparison ?? []).map((d: any) => ({
      ...d,
      name: (lang === 'en' && d.nameEn) ? d.nameEn : d.nameAr,
    })), [data?.regionComparison, lang]);

  const stageBottlenecksData = useMemo(() =>
    (data?.stageBottlenecks ?? []).map((d: any) => ({
      ...d,
      name: (lang === 'en' && d.nameEn) ? d.nameEn : d.nameAr,
    })), [data?.stageBottlenecks, lang]);

  const dir = isRtl ? 'rtl' : 'ltr';

  // Traffic light helper: returns color class set based on actual vs target
  // hi/lo = عتبات الضوء الأخضر والأصفر (للوضع الأوتوماتيكي)
  const tl = (value: number | null, target: number | null, isCompliance = false, hi = 85, lo = 70): { dot: string; text: string; bg: string } => {
    const GREEN  = { dot: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' };
    const YELLOW = { dot: 'bg-amber-400',   text: 'text-amber-700',   bg: 'bg-amber-50 border-amber-200' };
    const RED    = { dot: 'bg-red-500',     text: 'text-red-700',     bg: 'bg-red-50 border-red-200' };
    const GRAY   = { dot: 'bg-slate-300',   text: 'text-slate-400',   bg: 'bg-slate-50 border-slate-200' };
    if (value === null) return GRAY;
    if (isCompliance) {
      if (value >= hi) return GREEN;
      if (value >= lo) return YELLOW;
      return RED;
    }
    if (target === null) return GRAY;
    if (value >= target) return GREEN;
    if (value >= target - 10) return YELLOW;
    return RED;
  };

  return (
    <div dir={dir} className="min-h-screen bg-slate-50 pb-12">
      {/* Page header */}
      <div className="bg-white border-b px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <LayoutDashboard className="w-6 h-6 text-indigo-600" />
            {lang === 'en' ? 'Executive Dashboard' : 'لوحة الإدارة التنفيذية'}
          </h1>
          <p className="text-xs text-slate-500">
            {lang === 'en' ? 'Enterprise performance metrics and financial analysis' : 'مقاييس الأداء المؤسسي والتحليل المالي'}
          </p>
        </div>
        <button 
          onClick={fetchData}
          disabled={loading}
          className="p-2 hover:bg-slate-100 rounded-full transition-colors disabled:opacity-50"
          data-testid="button-refresh"
        >
          <RefreshCw className={`w-5 h-5 text-slate-600 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Sector warning toast */}
      {sectorWarning && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-amber-50 border border-amber-300 text-amber-800 text-sm px-4 py-2 rounded-xl shadow-lg">
          {lang === 'en' ? 'You can select up to 2 sectors only' : 'يمكنك اختيار قطاعين فقط بحد أقصى'}
        </div>
      )}

      {/* ── شريط الفلاتر (مجموعتان) ──────────────────────────────── */}
      <div className="bg-white border-b px-6 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">

        {/* ── مجموعة الفترة ── */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest hidden sm:block">
            {lang === 'en' ? 'Period' : 'الفترة'}
          </span>
          <SingleDropdown
            icon={<Calendar className="w-4 h-4 text-slate-400" />}
            options={[
              { value: 'WEEK',    label: lang === 'en' ? 'Last week'          : 'آخر أسبوع'             },
              { value: 'MONTH',   label: lang === 'en' ? 'Last month (30d)'   : 'آخر شهر (30 يوم)'     },
              { value: 'QUARTER', label: lang === 'en' ? 'Last 3 months (90d)': 'آخر 3 أشهر (90 يوم)' },
              { value: 'YEAR',    label: lang === 'en' ? 'Year to date'       : 'منذ بداية العام'       },
              { value: 'CUSTOM',  label: lang === 'en' ? 'Custom range'       : 'فترة مخصصة'            },
            ]}
            value={periodMode}
            onChange={v => applyPeriodMode(v as any)}
            allLabel={lang === 'en' ? 'Period' : 'الفترة'}
          />
          {/* ملخص التواريخ */}
          <span className="text-[10px] text-slate-400 hidden md:block tabular-nums">
            {filters.dateFrom} → {filters.dateTo}
          </span>
        </div>

        {/* فاصل عمودي */}
        <div className="h-6 w-px bg-slate-200 hidden sm:block" />

        {/* ── مجموعة العرض ── */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest hidden sm:block">
            {lang === 'en' ? 'Display' : 'العرض'}
          </span>
          {/* تجميع الرسوم */}
          <SingleDropdown
            icon={<Layers className="w-4 h-4 text-slate-400" />}
            options={[
              { value: 'WEEK',    label: lang === 'en' ? 'Weekly'    : 'أسبوعي' },
              { value: 'MONTH',   label: lang === 'en' ? 'Monthly'   : 'شهري'   },
              { value: 'QUARTER', label: lang === 'en' ? 'Quarterly' : 'ربعي'   },
            ]}
            value={granularity}
            onChange={v => setGranularity(v as any)}
            allLabel={lang === 'en' ? 'Grouping' : 'التجميع'}
          />
          {/* القطاعات */}
          <MultiDropdown
            label={lang === 'en' ? 'Sectors' : 'القطاعات'}
            icon={<Building2 className="w-4 h-4 text-slate-400" />}
            options={(configData?.sectors ?? []).map(s => ({ id: s.id.toString(), nameAr: (lang === 'en' && s.nameEn) ? s.nameEn : s.nameAr }))}
            selected={filters.sectors}
            onToggle={handleSectorToggle}
            maxSelect={2}
            allLabel={lang === 'en' ? 'All Sectors' : 'جميع القطاعات'}
          />
          {/* المناطق */}
          <MultiDropdown
            label={lang === 'en' ? 'Regions' : 'المناطق'}
            icon={<MapPin className="w-4 h-4 text-slate-400" />}
            options={(configData?.regions ?? []).map(r => ({ id: r.id.toString(), nameAr: (lang === 'en' && r.nameEn) ? r.nameEn : r.nameAr }))}
            selected={filters.regionIds}
            onToggle={handleRegionToggle}
            allLabel={lang === 'en' ? 'All Regions' : 'جميع المناطق'}
          />
          {/* نوع المشروع */}
          <SingleDropdown
            icon={<Filter className="w-4 h-4 text-slate-400" />}
            options={(data?.typeDistribution ?? []).map((t: any) => ({ value: t.name, label: t.name }))}
            value={filters.projectType}
            onChange={v => setFilters(prev => ({ ...prev, projectType: v }))}
            allLabel={lang === 'en' ? 'All Types' : 'جميع الأنواع'}
          />
        </div>

        {/* زر مسح كل الفلاتر */}
        {(filters.sectors.length > 0 || filters.regionIds.length > 0 || filters.projectType || periodMode !== 'MONTH' || granularity !== 'MONTH') && (
          <button
            onClick={() => {
              applyPeriodMode('MONTH');
              setGranularity('MONTH');
              setFilters(prev => ({ ...prev, sectors: [], regionIds: [], projectType: '' }));
            }}
            className="ms-auto text-xs text-slate-400 hover:text-red-500 transition-colors px-2 py-1 rounded-lg hover:bg-red-50 border border-transparent hover:border-red-200"
          >
            {lang === 'en' ? 'Clear' : 'مسح الكل'}
          </button>
        )}
      </div>

      {/* صف التاريخ المخصص — يظهر فقط عند اختيار "مخصص" */}
      {periodMode === 'CUSTOM' && (
        <div className="bg-indigo-50 border-b border-indigo-100 px-6 py-3 flex flex-wrap items-center gap-3">
          <span className="text-xs font-bold text-indigo-700">{lang === 'en' ? 'Custom Range:' : 'الفترة المخصصة:'}</span>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500">{lang === 'en' ? 'From' : 'من'}</label>
            <input type="date" value={customFrom} max={customTo}
              onChange={e => setCustomFrom(e.target.value)}
              className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500">{lang === 'en' ? 'To' : 'إلى'}</label>
            <input type="date" value={customTo} min={customFrom} max={today}
              onChange={e => setCustomTo(e.target.value)}
              className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
          </div>
          <button onClick={applyCustomRange}
            className="px-4 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 transition-colors"
          >
            {lang === 'en' ? 'Apply' : 'تطبيق'}
          </button>
        </div>
      )}

      {/* KPI Summary Bar */}
      <div className="px-6 pt-4">
        <KpiSummaryBar kpis={data?.kpis} loading={loading} lang={lang} />
      </div>

      {/* Financial Cards */}
      <div className="px-6 pt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <FinanceCard
          label={lang === 'en' ? 'Estimated Value' : 'القيمة التقديرية'}
          value={formatCurrency(data?.financial?.estimated)}
          icon={DollarSign}
          loading={loading}
          active={activeFinCard === 'estimated'}
          onClick={() => !loading && setActiveFinCard(activeFinCard === 'estimated' ? null : 'estimated')}
          tooltip={lang === 'en'
            ? 'Total expected value of all work orders in the selected period. Represents the baseline for comparison.'
            : 'إجمالي القيمة المتوقعة لجميع أوامر العمل ضمن الفترة المحددة. تمثل خط الأساس للمقارنة.'}
        />
        <FinanceCard
          label={lang === 'en' ? 'Total Invoiced' : 'إجمالي المفوتر'}
          value={formatCurrency(data?.financial?.invoiced)}
          icon={ClipboardList}
          loading={loading}
          active={activeFinCard === 'invoiced'}
          onClick={() => !loading && setActiveFinCard(activeFinCard === 'invoiced' ? null : 'invoiced')}
          pct={data?.financial?.estimated ? (data.financial.invoiced / data.financial.estimated) * 100 : null}
          tooltip={lang === 'en'
            ? 'Total invoiced so far (Invoice 1 + Invoice 2) across all work orders.'
            : 'مجموع ما تم إصداره من فواتير حتى الآن (مستخلص 1 + مستخلص 2) لجميع أوامر العمل.'}
        />
        <FinanceCard
          label={lang === 'en' ? 'Expected Remaining' : 'المتبقي المتوقع'}
          value={formatCurrency(data?.financial?.expectedRemaining)}
          icon={Clock}
          loading={loading}
          active={activeFinCard === 'remaining'}
          onClick={() => !loading && setActiveFinCard(activeFinCard === 'remaining' ? null : 'remaining')}
          tooltip={lang === 'en'
            ? 'Approximate remaining amount to be invoiced based on current work order status. For partial orders, Invoice 2 is assumed ≈ Invoice 1 when only Invoice 1 exists. For final orders, the estimate is used when no invoice exists.'
            : 'تقدير تقريبي للمبلغ المتبقي فوترته بناءً على حالة أوامر العمل الحالية. في الأعمال الجزئية قد يُفترض أن المستخلص الثاني قريب من الأول، أما في الأعمال النهائية فيُستخدم التقدير عند عدم وجود فاتورة.'}
        />
        <FinanceCard
          label={lang === 'en' ? 'Completed Invoicing Gap' : 'الفرق للمفوتر المكتمل'}
          value={formatCurrency(data?.financial?.completedDiffValue ?? 0)}
          subValue={data?.financial?.completedDiffPct != null
            ? `${(data.financial.completedDiffPct as number).toFixed(1)}%`
            : null}
          icon={Scale}
          loading={loading}
          active={activeFinCard === 'gap'}
          onClick={() => !loading && setActiveFinCard(activeFinCard === 'gap' ? null : 'gap')}
          tooltip={lang === 'en'
            ? 'Actual difference between estimated and total invoiced for fully-invoiced orders only. Partial: both invoices exist. Final: invoice 1 exists. Shown as value and percentage.'
            : 'الفرق الفعلي بين القيمة التقديرية وإجمالي المفوتر للأوامر المكتملة فوترة فقط. يُحسب فقط بعد اكتمال الفوترة (جزئي: مستخلصين، نهائي: مستخلص واحد)، ويُعرض كقيمة ونسبة.'}
        />
      </div>

      {/* ── Financial Drill-down Detail ── */}
      <AnimatePresence>
        {activeFinCard && (
          <motion.div
            key="fin-detail"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            className="px-6 pt-3"
          >
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">

              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3 bg-slate-50 border-b border-slate-100 flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-slate-800">
                    {lang === 'en' ? CARD_LABELS[activeFinCard].en : CARD_LABELS[activeFinCard].ar}
                  </span>
                  {detailData && (
                    <span className="text-xs text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded-full">
                      {lang === 'en'
                        ? `${detailData.pagination.total} orders`
                        : `${detailData.pagination.total} أمر`}
                    </span>
                  )}
                  {detailData && (
                    <span className="text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full tabular-nums">
                      {formatCurrency(detailData.cardTotal)}
                    </span>
                  )}
                  {detailLoading && (
                    <RefreshCw className="w-3.5 h-3.5 text-slate-400 animate-spin" />
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {detailData && !detailLoading && (
                    <>
                      <button
                        onClick={() => exportDetail('excel')}
                        disabled={exportingDetail !== null}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors disabled:opacity-50"
                      >
                        {exportingDetail === 'excel'
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Download className="w-3.5 h-3.5" />}
                        Excel
                      </button>
                      <button
                        onClick={() => exportDetail('pdf')}
                        disabled={exportingDetail !== null}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50"
                      >
                        {exportingDetail === 'pdf'
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Download className="w-3.5 h-3.5" />}
                        PDF
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => { setActiveFinCard(null); setDetailData(null); }}
                    className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center hover:bg-slate-300 transition-colors"
                  >
                    <X className="w-3.5 h-3.5 text-slate-600" />
                  </button>
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                {detailLoading && !detailData ? (
                  <div className="flex items-center justify-center py-14">
                    <RefreshCw className="w-6 h-6 text-slate-300 animate-spin" />
                  </div>
                ) : detailData?.rows?.length > 0 ? (
                  <table className="w-full text-xs" dir={isRtl ? 'rtl' : 'ltr'}>
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100">
                        {DETAIL_COLS[activeFinCard].map((col: ColDef) => (
                          <th key={col.key}
                            className={`px-3 py-2.5 font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap ${col.numeric || col.pct ? 'text-center' : 'text-right'}`}>
                            {lang === 'en' ? col.labelEn : col.labelAr}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {detailData.rows.map((row: any, idx: number) => (
                        <tr key={row.id ?? idx} className="hover:bg-slate-50 transition-colors">
                          {DETAIL_COLS[activeFinCard].map((col: ColDef) => {
                            const val = row[col.key];
                            return (
                              <td key={col.key}
                                className={`px-3 py-2.5 whitespace-nowrap ${col.numeric || col.pct ? 'tabular-nums text-center' : 'text-right'}`}>
                                {col.link ? (
                                  <a
                                    href={`/work-orders/${row.id}/edit`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="font-bold text-indigo-600 hover:text-indigo-800 hover:underline inline-flex items-center gap-1"
                                  >
                                    {val || '-'}
                                    <ExternalLink className="w-3 h-3 flex-shrink-0" />
                                  </a>
                                ) : col.pct ? (
                                  <span className={`font-bold ${val >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                    {val != null ? val.toFixed(1) + '%' : '-'}
                                  </span>
                                ) : col.numeric ? (
                                  <span className={col.highlight
                                    ? (val >= 0 ? 'text-emerald-600 font-bold' : 'text-red-600 font-bold')
                                    : 'text-slate-700'}>
                                    {val != null ? Number(val).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '-'}
                                  </span>
                                ) : (
                                  <span className="text-slate-700">{val || '-'}</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="py-12 text-center text-slate-400 text-sm">
                    {lang === 'en' ? 'No data available' : 'لا توجد بيانات'}
                  </div>
                )}
              </div>

              {/* Pagination */}
              {detailData && detailData.pagination.totalPages > 1 && (
                <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-slate-50 flex-wrap gap-2">
                  <span className="text-xs text-slate-500">
                    {lang === 'en'
                      ? `Page ${detailData.pagination.page} of ${detailData.pagination.totalPages} · ${detailData.pagination.total} total`
                      : `صفحة ${detailData.pagination.page} من ${detailData.pagination.totalPages} · ${detailData.pagination.total} أمر`}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setDetailPage(Math.max(1, detailPage - 1))}
                      disabled={detailPage === 1}
                      className="w-7 h-7 rounded-lg border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {isRtl ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                    </button>
                    {(() => {
                      const total   = detailData.pagination.totalPages;
                      const current = detailPage;
                      const start   = Math.max(1, Math.min(current - 2, total - 4));
                      const end     = Math.min(total, start + 4);
                      return Array.from({ length: end - start + 1 }, (_, i) => start + i).map(pg => (
                        <button key={pg} onClick={() => setDetailPage(pg)}
                          className={`w-7 h-7 rounded-lg text-xs font-bold transition-colors ${
                            pg === current
                              ? 'bg-slate-700 text-white'
                              : 'border border-slate-200 text-slate-600 hover:bg-slate-100'
                          }`}
                        >{pg}</button>
                      ));
                    })()}
                    <button
                      onClick={() => setDetailPage(Math.min(detailData.pagination.totalPages, detailPage + 1))}
                      disabled={detailPage === detailData.pagination.totalPages}
                      className="w-7 h-7 rounded-lg border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {isRtl ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}

            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── أداء القطاعات ── */}
      <div className="px-6 pt-4">
        {/* Section Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-indigo-600" />
            <span className="text-sm font-bold text-slate-800">
              {lang === 'en' ? 'Sector Performance' : 'أداء القطاعات'}
            </span>
            {targetsSaved && (
              <span className="text-xs text-emerald-600 font-medium bg-emerald-50 px-2 py-0.5 rounded-full">
                {lang === 'en' ? '✓ Saved' : '✓ تم الحفظ'}
              </span>
            )}
          </div>
          {canManageTargets && (
            <button
              data-testid="button-edit-targets"
              onClick={() => setShowTargetsEdit(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-indigo-600 hover:bg-indigo-50 border border-indigo-200 transition-colors"
            >
              {showTargetsEdit ? <XCircle className="w-3.5 h-3.5" /> : <Target className="w-3.5 h-3.5" />}
              {showTargetsEdit
                ? (lang === 'en' ? 'Cancel' : 'إلغاء')
                : (lang === 'en' ? 'Set Targets' : 'تحديد المستهدفات')}
            </button>
          )}
        </div>

        {/* Target Editor (collapsible) */}
        {showTargetsEdit && (
          <div className="bg-white rounded-2xl border border-indigo-200 shadow-sm mb-4 overflow-hidden">
            <div className="px-5 py-3 bg-indigo-50 border-b border-indigo-100 flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-indigo-800">
                  {lang === 'en' ? 'Annual Targets by Sector' : 'المستهدفات السنوية بالقطاع'}
                </span>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-500">{lang === 'en' ? 'Year' : 'السنة'}</label>
                  <input
                    type="number"
                    data-testid="input-targets-year"
                    value={targetsYear}
                    onChange={e => {
                      const y = Number(e.target.value);
                      setTargetsYear(y);
                      fetchSectorTargets(y);
                    }}
                    className="w-24 text-xs border border-indigo-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white"
                  />
                  {targetsYear !== currentYear && (
                    <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                      {lang === 'en' ? 'Cards show current year only' : 'البطاقات تعرض السنة الحالية فقط'}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {targetsSaveError && (
                  <span className="text-xs font-medium text-red-600 bg-red-50 border border-red-200 px-3 py-1.5 rounded-lg">
                    {targetsSaveError}
                  </span>
                )}
                <button
                  data-testid="button-save-targets"
                  onClick={saveSectorTargets}
                  disabled={targetsSaving}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  {targetsSaving
                    ? (lang === 'en' ? 'Saving...' : 'جاري الحفظ...')
                    : (lang === 'en' ? 'Save Targets' : 'حفظ المستهدفات')}
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <th className="text-start px-4 py-2.5 font-bold text-slate-600 min-w-[120px]">{lang === 'en' ? 'Sector' : 'القطاع'}</th>
                    {/* التنفيذي */}
                    <th colSpan={2} className="text-center px-2 py-1 font-bold text-indigo-600 border-s border-indigo-100 bg-indigo-50/40">
                      {lang === 'en' ? 'Executive' : 'التنفيذي'}
                    </th>
                    {/* المالي */}
                    <th colSpan={3} className="text-center px-2 py-1 font-bold text-sky-600 border-s border-sky-100 bg-sky-50/40">
                      {lang === 'en' ? 'Financial' : 'المالي'}
                    </th>
                  </tr>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[10px]">
                    <th className="px-4 py-1.5"></th>
                    <th className="text-center px-2 py-1.5 text-indigo-500 border-s border-indigo-100 font-semibold">{lang === 'en' ? 'Exec Compliance %' : 'الالتزام التنفيذي %'}</th>
                    <th className="text-center px-2 py-1.5 text-indigo-400 font-semibold">{lang === 'en' ? 'Closure %' : 'الإنجاز %'}</th>
                    <th className="text-center px-2 py-1.5 text-sky-500 border-s border-sky-100 font-semibold">{lang === 'en' ? 'Sales (SAR)' : 'المبيعات (ريال)'}</th>
                    <th className="text-center px-2 py-1.5 text-sky-400 font-semibold">{lang === 'en' ? 'Collection %' : 'التحصيل %'}</th>
                    <th className="text-center px-2 py-1.5 text-sky-400 font-semibold">{lang === 'en' ? 'Fin Compliance %' : 'الالتزام المالي %'}</th>
                  </tr>
                </thead>
                <tbody>
                  {sectorTargetsForm.map((s, idx) => {
                    const rowBg = idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50';
                    const mkPct = (field: string, ringClass: string) => (
                      <td className={`px-2 py-2 text-center ${rowBg}`}>
                        <div className="flex items-center justify-center gap-0.5">
                          <input type="number" min={0} max={100} placeholder="—"
                            value={(s as any)[field]}
                            onChange={e => setSectorTargetsForm(prev => prev.map((r, i) => i === idx ? { ...r, [field]: e.target.value } : r))}
                            className={`w-14 text-center border border-slate-200 rounded-md px-1 py-1 focus:outline-none focus:ring-1 ${ringClass} text-xs`}
                          />
                          <span className="text-slate-400 text-[10px]">%</span>
                        </div>
                      </td>
                    );
                    return (
                      <tr key={s.sectorId} className="border-b border-slate-50">
                        <td className={`px-4 py-2 font-semibold text-slate-700 ${rowBg}`}>{lang === 'en' ? (s.nameEn || s.nameAr) : s.nameAr}</td>
                        {/* التنفيذي */}
                        <td className={`px-2 py-2 text-center border-s border-indigo-50 ${rowBg}`}>
                          <div className="flex items-center justify-center gap-0.5">
                            <input type="number" min={0} max={100} placeholder="—"
                              data-testid={`input-exec-compliance-${s.sectorId}`}
                              value={s.execComplianceTarget}
                              onChange={e => setSectorTargetsForm(prev => prev.map((r, i) => i === idx ? { ...r, execComplianceTarget: e.target.value } : r))}
                              className="w-14 text-center border border-slate-200 rounded-md px-1 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400 text-xs"
                            />
                            <span className="text-slate-400 text-[10px]">%</span>
                          </div>
                        </td>
                        {mkPct('closureRateTarget', 'focus:ring-indigo-400')}
                        {/* المالي */}
                        <td className={`px-2 py-2 text-center border-s border-sky-50 ${rowBg}`}>
                          <input type="number" min={0} placeholder="—"
                            data-testid={`input-sales-amount-${s.sectorId}`}
                            value={s.salesAmountTarget}
                            onChange={e => setSectorTargetsForm(prev => prev.map((r, i) => i === idx ? { ...r, salesAmountTarget: e.target.value } : r))}
                            className="w-24 text-center border border-slate-200 rounded-md px-1 py-1 focus:outline-none focus:ring-1 focus:ring-sky-400 text-xs"
                          />
                        </td>
                        {mkPct('collectionRateTarget', 'focus:ring-sky-400')}
                        {mkPct('finComplianceTarget', 'focus:ring-sky-400')}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Sector Performance Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1,2,3].map(i => (
              <div key={i} className="bg-white rounded-2xl border border-slate-200 h-52 animate-pulse" />
            ))}
          </div>
        ) : (data?.sectorPerformance ?? []).length > 0 ? (() => {
          const sectorList = data.sectorPerformance as any[];
          const sectorCount = sectorList.length;
          const isSingle = sectorCount === 1;
          const gridCls = isSingle
            ? 'grid grid-cols-1 gap-4'
            : sectorCount === 2
            ? 'grid grid-cols-1 sm:grid-cols-2 gap-4'
            : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4';
          return (
          <div className={gridCls}>
            {sectorList.map((s) => {
              // حساب المستهدف الوحدوي بناءً على العرض (أسبوعي/شهري/ربعي)
              const granDivisor    = granularity === 'WEEK' ? 52 : granularity === 'QUARTER' ? 4 : 12;
              const granUnitLabel  = granularity === 'WEEK'
                ? (lang === 'en' ? 'weekly' : 'أسبوعي')
                : granularity === 'QUARTER'
                ? (lang === 'en' ? 'quarterly' : 'ربعي')
                : (lang === 'en' ? 'monthly' : 'شهري');
              const unitSalesTarget = s.annualSalesTarget != null
                ? s.annualSalesTarget / granDivisor
                : (s.salesAmountTarget ?? null);
              const unitSalesPct = unitSalesTarget && unitSalesTarget > 0
                ? Math.min((s.invoiced / unitSalesTarget) * 100, 999)
                : s.salesProgressPct;

              // المبيعات: تقدم = مفوتر / مستهدف الوحدة × 100 (عتبات 90/70)
              const salesTL   = tl(unitSalesPct,           null,                      true,  90, 70);
              // الالتزام التنفيذي: له الآن مستهدف يضبطه المدير
              const execTL    = tl(s.execComplianceRate,  s.execComplianceTarget,    false);
              // التحصيل: نسبة مستهدف %
              const collTL    = tl(s.collectionRate,      s.collectionRateTarget,    false);
              // الإغلاق: أوتوماتيكي (بدون مستهدف مدير) — عتبات 80/60
              const closureTL = tl(s.closureRate,         null,                      true,  80, 60);
              // الالتزام المالي: أوتوماتيكي
              const finTL     = tl(s.finComplianceRate,   null,                      true);

              const priority  = (c: { dot: string }) =>
                c.dot === 'bg-red-500' ? 0 : c.dot === 'bg-amber-400' ? 1 : c.dot === 'bg-slate-300' ? 2 : 3;
              const overallTL = [salesTL, execTL, collTL, closureTL, finTL]
                .reduce((worst, cur) => priority(cur) < priority(worst) ? cur : worst);
              const fmtPct = (v: number | null) => v !== null ? v.toFixed(1) + '%' : '—';
              const name = lang === 'en' ? (s.nameEn || s.nameAr) : s.nameAr;
              const statusLabel = overallTL.dot === 'bg-emerald-500'
                ? (lang === 'en' ? 'On Track' : 'ملتزم')
                : overallTL.dot === 'bg-amber-400'
                ? (lang === 'en' ? 'Needs Attention' : 'يحتاج متابعة')
                : overallTL.dot === 'bg-red-500'
                ? (lang === 'en' ? 'Delayed' : 'متأخر')
                : (lang === 'en' ? 'No Data' : 'لا بيانات');

              return (
                <div key={s.sectorId} data-testid={`card-sector-${s.sectorId}`}
                  className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow flex flex-col">

                  {/* ===== هيدر البطاقة ===== */}
                  <div className="px-5 py-3.5 border-b border-slate-100 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className={isSingle ? 'font-bold text-slate-800 leading-snug block truncate text-lg' : 'font-bold text-slate-800 leading-snug block truncate text-[15px]'}>{name}</span>
                      <span className="text-[11px] text-slate-400 font-medium">
                        {s.totalOrders.toLocaleString('en-US')} {lang === 'en' ? 'orders' : 'أمر عمل'}
                      </span>
                    </div>
                    {/* Badge الحالة العامة */}
                    <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold whitespace-nowrap flex-shrink-0 border ${overallTL.bg} ${overallTL.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${overallTL.dot}`} />
                      {statusLabel}
                    </div>
                  </div>

                  {/* ===== جسم البطاقة: جانبي عند قطاع واحد، عمودي عند متعدد ===== */}
                  <div className={isSingle ? 'flex flex-col md:flex-row flex-1' : 'flex flex-col flex-1'}>

                  {/* ===== القسم التنفيذي ===== */}
                  <div className={isSingle ? 'px-5 pt-4 pb-4 bg-slate-50/60 md:w-1/2 md:border-l border-slate-200' : 'px-5 pt-4 pb-4 bg-slate-50/60'}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-3 h-3 rounded-sm bg-indigo-500 flex-shrink-0" />
                      <span className="text-[11px] font-bold text-slate-700 tracking-wide">
                        {lang === 'en' ? 'Executive Performance' : 'الأداء التنفيذي'}
                      </span>
                    </div>
                    <div className="space-y-4">
                      <MetricRow
                        label={lang === 'en' ? 'Exec Compliance' : 'الالتزام التنفيذي'}
                        value={fmtPct(s.execComplianceRate)}
                        target={s.execComplianceTarget !== null ? s.execComplianceTarget + '%' : null}
                        colors={execTL}
                        barPct={s.execComplianceRate}
                        tooltip={lang === 'en'
                          ? 'Percentage of work orders completed within the executive SLA timeframe. Cancelled orders are excluded.'
                          : 'نسبة الأوامر التي أُنجز تنفيذها الميداني ضمن المدة المحددة في اتفاقية مستوى الخدمة (SLA). الأوامر الملغاة لا تُحتسب.'}
                      />
                      <MetricRow
                        label={lang === 'en' ? 'Closure (Completion)' : 'الإنجاز (الإغلاق)'}
                        value={fmtPct(s.closureRate)}
                        sub={`${s.completedOrders.toLocaleString('en-US')} / ${s.totalOrders.toLocaleString('en-US')} ${lang === 'en' ? 'orders' : 'أمر'}`}
                        target={s.closureRateTarget !== null ? s.closureRateTarget + '%' : null}
                        colors={closureTL}
                        barPct={s.closureRate}
                        tooltip={lang === 'en'
                          ? 'Percentage of work orders that reached the final closure stage out of all orders in the selected period.'
                          : 'نسبة أوامر العمل التي وصلت إلى مرحلة الإغلاق النهائي من إجمالي أوامر الفترة المحددة.'}
                      />
                    </div>
                  </div>

                  {/* فاصل: أفقي في العمودي، لا شيء في الجانبي (الحد يعمل border-l) */}
                  {!isSingle && <div className="h-px bg-slate-200" />}

                  {/* ===== القسم المالي ===== */}
                  <div className={isSingle ? 'px-5 pt-4 pb-4 bg-white flex-1 md:w-1/2' : 'px-5 pt-4 pb-4 bg-white flex-1'}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-3 h-3 rounded-sm bg-emerald-500 flex-shrink-0" />
                      <span className="text-[11px] font-bold text-slate-700 tracking-wide">
                        {lang === 'en' ? 'Financial Performance' : 'الأداء المالي'}
                      </span>
                    </div>
                    <div className="space-y-4">
                      <MetricRow
                        label={lang === 'en' ? 'Sales (Invoiced)' : 'المبيعات (مفوتر)'}
                        value={abbrevNum(s.invoiced) + ' ر.س'}
                        sub={[
                          unitSalesPct !== null ? `${fmtPct(unitSalesPct)} ${lang === 'en' ? 'of target' : 'من المستهدف'}` : null,
                          s.annualSalesTarget != null ? `${lang === 'en' ? 'Annual' : 'سنوي'}: ${abbrevNum(s.annualSalesTarget)} ر.س` : null,
                        ].filter(Boolean).join(' · ') || undefined}
                        target={unitSalesTarget != null ? `${abbrevNum(unitSalesTarget)} ر.س (${granUnitLabel})` : null}
                        colors={salesTL}
                        barPct={unitSalesPct}
                        tooltip={lang === 'en'
                          ? 'Progress toward the period revenue target = Total invoiced ÷ Target set for this sector. Target is configured by the manager in sector settings.'
                          : 'نسبة تحقق مستهدف الإيرادات للفترة = إجمالي المفوتر ÷ المستهدف المحدد للقطاع. المستهدف يضبطه المدير من إعدادات القطاعات.'}
                      />
                      <MetricRow
                        label={lang === 'en' ? 'Collection Rate' : 'نسبة التحصيل'}
                        value={fmtPct(s.collectionRate)}
                        sub={`${lang === 'en' ? 'Collected' : 'محصّل'}: ${abbrevNum(s.collected)} ر.س`}
                        target={s.collectionRateTarget !== null ? s.collectionRateTarget + '%' : null}
                        colors={collTL}
                        barPct={s.collectionRate}
                        tooltip={lang === 'en'
                          ? 'Percentage of invoiced amounts actually collected. Example: invoices of 100,000 with 75,000 collected = 75% collection rate.'
                          : 'نسبة ما تم تحصيله فعلياً من إجمالي المبالغ المفوترة. مثال: فواتير بـ 100,000 وتحصيل 75,000 = نسبة تحصيل 75%.'}
                      />
                      <MetricRow
                        label={lang === 'en' ? 'Financial Compliance' : 'الالتزام المالي'}
                        value={fmtPct(s.finComplianceRate)}
                        target={s.finComplianceTarget !== null ? s.finComplianceTarget + '%' : null}
                        colors={finTL}
                        barPct={s.finComplianceRate}
                        tooltip={lang === 'en'
                          ? 'Percentage of work orders that met their financial requirements (invoicing & collection) within the SLA timeframe. Cancelled orders are excluded.'
                          : 'نسبة الأوامر التي استُوفيت متطلباتها المالية (فوترة وتحصيل) ضمن المدة المحددة في اتفاقية الخدمة. الأوامر الملغاة لا تُحتسب.'}
                      />
                    </div>
                  </div>

                  </div>{/* end body wrapper */}
                </div>
              );
            })}
          </div>
          );
        })() : !loading && (
          <div className="bg-white rounded-2xl border border-slate-200 py-12 text-center text-slate-400 text-sm">
            {lang === 'en' ? 'No sector data available' : 'لا توجد بيانات للقطاعات'}
          </div>
        )}

      </div>


      {/* Charts Grid — single column for readability */}
      <div className="px-6 pt-6 grid grid-cols-1 gap-6">
        {/* 1. Assignment Trend */}
        <ChartContainer title={lang === 'en' ? 'Work Order Assignment Trend' : 'اتجاه إسناد أوامر العمل'} loading={loading}>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChartComponent data={data?.assignmentTrend} gradientId="colorAssign" />
          </ResponsiveContainer>
        </ChartContainer>

        {/* 1b. Executive Closure Trend */}
        <ChartContainer title={lang === 'en' ? 'Executive Closure Trend (Proc. 155)' : 'اتجاه الإغلاق التنفيذي (إجراء 155)'} loading={loading}>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChartComponent data={data?.execClosureTrend} color="#6366F1" gradientId="colorExecClose" />
          </ResponsiveContainer>
        </ChartContainer>

        {/* 1c. Financial Closure Trend */}
        <ChartContainer title={lang === 'en' ? 'Financial Closure Trend' : 'اتجاه الإغلاق المالي'} loading={loading}>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChartComponent data={data?.finClosureTrend} color="#10B981" gradientId="colorFinClose" />
          </ResponsiveContainer>
        </ChartContainer>

        {/* 2. Assignment Mix */}
        <ChartContainer title={lang === 'en' ? 'Project Type Mix' : 'مزيج أنواع المشاريع'} loading={loading}>
          <ResponsiveContainer width="100%" height={280}>
            <BarChartComponent data={data?.assignmentStacked} stacked />
          </ResponsiveContainer>
        </ChartContainer>

        {/* 3. Type Distribution */}
        <ChartContainer title={lang === 'en' ? 'Volume by Project Type' : 'التوزيع حسب نوع المشروع'} loading={loading}>
          <ResponsiveContainer width="100%" height={340}>
            <DonutChartComponent data={data?.typeDistribution} />
          </ResponsiveContainer>
        </ChartContainer>

        {/* 4. Sector Comparison */}
        <ChartContainer title={lang === 'en' ? 'Comparison by Sector' : 'مقارنة حسب القطاع'} loading={loading}>
          <SimpleBarChartComponent data={sectorComparisonData} layout="vertical" />
        </ChartContainer>

        {/* 5. Region Comparison */}
        <ChartContainer title={lang === 'en' ? 'Top 12 Regions by Volume' : 'أعلى 12 منطقة من حيث الحجم'} loading={loading}>
          <SimpleBarChartComponent data={regionComparisonData} layout="vertical" color={COLORS.blue} />
        </ChartContainer>

        {/* 6. Stage Bottlenecks */}
        <ChartContainer title={lang === 'en' ? 'Stages Bottlenecks' : 'عنق الزجاجة في المراحل'} loading={loading}>
          <SimpleBarChartComponent data={stageBottlenecksData} layout="vertical" color={COLORS.amber} />
        </ChartContainer>

        {/* 7. Financial Funnel */}
        <ChartContainer title={lang === 'en' ? 'Financial Funnel' : 'القمع المالي'} loading={loading}>
          <FinancialFunnelChart data={data?.financial} />
        </ChartContainer>

        {/* 8. Financial Breakdown by Sector */}
        <ChartContainer title={lang === 'en' ? 'Financial Breakdown by Sector' : 'التوزيع المالي حسب القطاع'} loading={loading}>
          <FinancialGroupedBar data={data?.financialBySector || []} lang={lang} />
        </ChartContainer>

        {/* 9. Financial Breakdown by Region */}
        <ChartContainer title={lang === 'en' ? 'Financial Breakdown by Region (Top 10)' : 'التوزيع المالي حسب المنطقة (أعلى 10)'} loading={loading}>
          <FinancialGroupedBar data={data?.financialByRegion || []} lang={lang} />
        </ChartContainer>

        {/* 10. Top Delays */}
        <ChartContainer title={lang === 'en' ? 'Top Critical Delays (Days)' : 'أعلى التأخيرات الحرجة (بالأيام)'} loading={loading}>
          <div className="space-y-3">
            {data?.topDelays?.map((item: any, idx: number) => {
              const isExecJustified = item.execDelayJustified === true;
              const isFinJustified  = item.finDelayJustified  === true;
              const isJustified = isExecJustified || isFinJustified;
              const rowBg = isJustified
                ? 'bg-orange-50 hover:bg-orange-100 border border-orange-100'
                : 'bg-red-50 hover:bg-red-100 border border-red-100';
              return (
              <div 
                key={idx}
                onClick={() => setSelectedDelay(item)}
                className={`flex items-center gap-3 p-3 rounded-xl transition-colors cursor-pointer group ${rowBg}`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs flex-shrink-0 ${isJustified ? 'bg-orange-100 text-orange-600' : 'bg-red-100 text-red-600'}`}>
                  {idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-700 truncate">{lang === 'en' ? item.orderNumber : item.order_number}</span>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {isJustified ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-orange-100 text-orange-700 border border-orange-200">
                          {lang === 'en' ? 'Justified' : 'مسبب'}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-red-100 text-red-700 border border-red-200">
                          {lang === 'en' ? 'Unjustified' : 'غير مسبب'}
                        </span>
                      )}
                      <span className={`text-xs font-bold ${isJustified ? 'text-orange-600' : 'text-red-600'}`}>{item.delayedDays} {lang === 'en' ? 'days' : 'يوم'}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] text-slate-500">{lang === 'en' ? item.sectorNameEn : item.sectorNameAr}</span>
                    <span className="text-[10px] text-slate-400">{formatDate(item.assignmentDate)}</span>
                  </div>
                  {isJustified && (item.execDelayReason || item.finDelayReason) && (
                    <div className="mt-1 text-[10px] text-orange-700 bg-orange-100 rounded px-2 py-0.5 truncate">
                      {item.execDelayReason || item.finDelayReason}
                    </div>
                  )}
                </div>
                <Maximize2 className="w-4 h-4 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
              </div>
              );
            })}
            {!data?.topDelays?.length && (
              <div className="h-64 flex items-center justify-center text-slate-400 text-sm italic">
                {lang === 'en' ? 'No delayed orders found' : 'لا توجد أوامر متأخرة'}
              </div>
            )}
          </div>
        </ChartContainer>
      </div>

      {/* Delay Detail Modal */}
      <AnimatePresence>
        {selectedDelay && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden"
              dir={dir}
            >
              <div className="px-6 py-4 border-b flex items-center justify-between bg-slate-50">
                <h3 className="font-bold text-slate-900">
                  {lang === 'en' ? 'Work Order Details' : 'تفاصيل أمر العمل'}
                </h3>
                <button 
                  onClick={() => setSelectedDelay(null)}
                  className="p-1 hover:bg-slate-200 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>
              <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                <DetailItem label={lang === 'en' ? 'Order Number' : 'رقم الأمر'} value={selectedDelay.order_number || selectedDelay.orderNumber} />
                <DetailItem label={lang === 'en' ? 'Sector' : 'القطاع'} value={lang === 'en' ? selectedDelay.sectorNameEn : selectedDelay.sectorNameAr} />
                <DetailItem label={lang === 'en' ? 'Region' : 'المنطقة'} value={lang === 'en' ? selectedDelay.regionNameEn : selectedDelay.regionNameAr} />
                <DetailItem label={lang === 'en' ? 'Type' : 'النوع'} value={selectedDelay.projectType} />
                <DetailItem label={lang === 'en' ? 'Stage' : 'المرحلة'} value={lang === 'en' ? selectedDelay.stageNameEn : selectedDelay.stageNameAr} />
                <DetailItem label={lang === 'en' ? 'Assignment Date' : 'تاريخ التعميد'} value={formatDate(selectedDelay.assignmentDate)} />
                <DetailItem label={lang === 'en' ? 'Delayed Days' : 'أيام التأخير'} value={selectedDelay.delayedDays} highlight />

                {/* Delay Justification */}
                <div className="col-span-full">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-xl border bg-slate-50 space-y-1">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{lang === 'en' ? 'Exec Delay Justified?' : 'التأخير التنفيذي مسبب؟'}</p>
                      {selectedDelay.execDelayJustified === true ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-orange-100 text-orange-700">
                          {lang === 'en' ? 'Yes — Justified' : 'نعم — مسبب'}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">
                          {lang === 'en' ? 'No — Unjustified' : 'لا — غير مسبب'}
                        </span>
                      )}
                      {selectedDelay.execDelayJustified === true && selectedDelay.execDelayReason && (
                        <p className="text-xs text-slate-600 pt-1">{selectedDelay.execDelayReason}</p>
                      )}
                    </div>
                    <div className="p-3 rounded-xl border bg-slate-50 space-y-1">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{lang === 'en' ? 'Fin Delay Justified?' : 'التأخير المالي مسبب؟'}</p>
                      {selectedDelay.finDelayJustified === true ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-orange-100 text-orange-700">
                          {lang === 'en' ? 'Yes — Justified' : 'نعم — مسبب'}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">
                          {lang === 'en' ? 'No — Unjustified' : 'لا — غير مسبب'}
                        </span>
                      )}
                      {selectedDelay.finDelayJustified === true && selectedDelay.finDelayReason && (
                        <p className="text-xs text-slate-600 pt-1">{selectedDelay.finDelayReason}</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="col-span-full h-px bg-slate-100 my-2" />
                
                <DetailItem label={lang === 'en' ? 'Estimated' : 'التقديري'} value={formatCurrency(selectedDelay.estimated_value)} />
                <DetailItem label={lang === 'en' ? 'Total Invoiced' : 'إجمالي المفوتر'} value={formatCurrency(selectedDelay.collected_amount)} />
              </div>
              <div className="px-6 py-4 bg-slate-50 border-t flex justify-end">
                <button 
                  onClick={() => setSelectedDelay(null)}
                  className="px-6 py-2 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 transition-colors"
                >
                  {lang === 'en' ? 'Close' : 'إغلاق'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── KPI Summary Bar: one card, flat cells ── */
function KpiSummaryBar({ kpis, loading, lang }: any) {
  const t = (ar: string, en: string) => lang === 'en' ? en : ar;
  const fmt = (v: any) => v == null ? '—' : Number(v).toLocaleString('en-US');
  const pct = `${(kpis?.completionRate ?? 0).toFixed(1)}%`;

  const cells = [
    { label: t('إجمالي الأوامر','Total Orders'),       value: fmt(kpis?.total),                   icon: ClipboardList, iconBg: 'bg-indigo-50',  iconColor: 'text-indigo-600' },
    { label: t('نسبة الإنجاز','Completion Rate'),      value: pct,                                icon: TrendingUp,    iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600' },
    { label: t('منجز','Completed'),                    value: fmt(kpis?.execCompleted),            icon: CheckCircle2,  iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600' },
    { label: t('قيد الانتظار','Pending'),              value: fmt(kpis?.execPending),              icon: Clock,         iconBg: 'bg-amber-50',   iconColor: 'text-amber-600' },
    { label: t('متأخر تنفيذي','Exec Overdue'),         value: fmt(kpis?.execDelayedUnjustified),   icon: AlertTriangle, iconBg: 'bg-red-50',     iconColor: 'text-red-500' },
    { label: t('متأخر تنفيذي مسبب','Exec Justified'),  value: fmt(kpis?.execDelayedJustified),     icon: AlertTriangle, iconBg: 'bg-orange-50',  iconColor: 'text-orange-500' },
    { label: t('متأخر مالي','Fin Overdue'),            value: fmt(kpis?.finDelayedUnjustified),    icon: AlertTriangle, iconBg: 'bg-red-50',     iconColor: 'text-red-400' },
    { label: t('متأخر مالي مسبب','Fin Justified'),     value: fmt(kpis?.finDelayedJustified),      icon: AlertTriangle, iconBg: 'bg-purple-50',  iconColor: 'text-purple-500' },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
    >
      <div className="flex flex-wrap divide-x divide-x-reverse divide-slate-100">
        {cells.map((c, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-0.5 px-3 py-3 min-w-[80px]">
            {loading ? (
              <div className="animate-pulse space-y-1.5 w-full flex flex-col items-center">
                <div className="w-7 h-7 bg-slate-100 rounded-full" />
                <div className="h-5 bg-slate-100 rounded w-10" />
                <div className="h-2.5 bg-slate-100 rounded w-14" />
              </div>
            ) : (
              <>
                <div className={`w-7 h-7 rounded-full ${c.iconBg} flex items-center justify-center`}>
                  <c.icon className={`w-3.5 h-3.5 ${c.iconColor}`} />
                </div>
                <div className="text-xl font-black leading-none mt-1 text-slate-900">{c.value}</div>
                <div className="text-[10px] text-slate-400 text-center leading-tight mt-0.5 font-medium">{c.label}</div>
              </>
            )}
          </div>
        ))}
      </div>
    </motion.div>
  );
}

/* ── Column definitions for financial drill-down ── */
type ColDef = { key: string; labelAr: string; labelEn: string; numeric?: boolean; link?: boolean; pct?: boolean; highlight?: boolean };
const DETAIL_COLS: Record<string, ColDef[]> = {
  estimated: [
    { key: 'orderNumber',   labelAr: 'رقم الأمر',       labelEn: 'Order #',      link: true },
    { key: 'client',        labelAr: 'العميل',           labelEn: 'Client' },
    { key: 'workType',      labelAr: 'نوع العمل',        labelEn: 'Work Type' },
    { key: 'projectType',   labelAr: 'نوع المشروع',      labelEn: 'Project Type' },
    { key: 'sectorNameAr',  labelAr: 'القطاع',           labelEn: 'Sector' },
    { key: 'regionNameAr',  labelAr: 'المنطقة',          labelEn: 'Region' },
    { key: 'stageNameAr',   labelAr: 'المرحلة',          labelEn: 'Stage' },
    { key: 'estimatedValue',labelAr: 'القيمة التقديرية', labelEn: 'Estimated',    numeric: true },
  ],
  invoiced: [
    { key: 'orderNumber',     labelAr: 'رقم الأمر',   labelEn: 'Order #',     link: true },
    { key: 'client',          labelAr: 'العميل',       labelEn: 'Client' },
    { key: 'sectorNameAr',    labelAr: 'القطاع',       labelEn: 'Sector' },
    { key: 'regionNameAr',    labelAr: 'المنطقة',      labelEn: 'Region' },
    { key: 'invoiceType',     labelAr: 'نوع الفاتورة', labelEn: 'Type' },
    { key: 'invoice1',        labelAr: 'مستخلص 1',     labelEn: 'Invoice 1',   numeric: true },
    { key: 'invoice2',        labelAr: 'مستخلص 2',     labelEn: 'Invoice 2',   numeric: true },
    { key: 'collectedAmount', labelAr: 'المحصّل',      labelEn: 'Collected',   numeric: true, highlight: true },
  ],
  remaining: [
    { key: 'orderNumber',      labelAr: 'رقم الأمر',       labelEn: 'Order #',      link: true },
    { key: 'client',           labelAr: 'العميل',           labelEn: 'Client' },
    { key: 'sectorNameAr',     labelAr: 'القطاع',           labelEn: 'Sector' },
    { key: 'regionNameAr',     labelAr: 'المنطقة',          labelEn: 'Region' },
    { key: 'invoiceType',      labelAr: 'نوع الفاتورة',     labelEn: 'Type' },
    { key: 'invoice1',         labelAr: 'مستخلص 1',         labelEn: 'Invoice 1',    numeric: true },
    { key: 'invoice2',         labelAr: 'مستخلص 2',         labelEn: 'Invoice 2',    numeric: true },
    { key: 'expectedRemaining',labelAr: 'المتبقي المتوقع',  labelEn: 'Exp. Rem.',    numeric: true, highlight: true },
  ],
  gap: [
    { key: 'orderNumber',   labelAr: 'رقم الأمر',         labelEn: 'Order #',         link: true },
    { key: 'client',        labelAr: 'العميل',             labelEn: 'Client' },
    { key: 'sectorNameAr',  labelAr: 'القطاع',             labelEn: 'Sector' },
    { key: 'regionNameAr',  labelAr: 'المنطقة',            labelEn: 'Region' },
    { key: 'invoiceType',   labelAr: 'نوع الفاتورة',       labelEn: 'Type' },
    { key: 'estimatedValue',labelAr: 'التقديري',           labelEn: 'Estimated',       numeric: true },
    { key: 'totalInvoiced', labelAr: 'إجمالي الفواتير',    labelEn: 'Total Invoiced',  numeric: true },
    { key: 'diffValue',     labelAr: 'الفرق (ر.س)',        labelEn: 'Gap (SAR)',        numeric: true, highlight: true },
    { key: 'diffPct',       labelAr: 'الفرق (%)',          labelEn: 'Gap (%)',          pct: true,     highlight: true },
  ],
};
const CARD_LABELS: Record<string, { ar: string; en: string }> = {
  estimated: { ar: 'القيمة التقديرية',       en: 'Estimated Value' },
  invoiced:  { ar: 'إجمالي المفوتر',         en: 'Total Invoiced' },
  remaining: { ar: 'المتبقي المتوقع',        en: 'Expected Remaining' },
  gap:       { ar: 'الفرق للمفوتر المكتمل', en: 'Completed Invoicing Gap' },
};

/* ── Finance card — theme color only ── */
const THEME = '#334155';

function FinanceCard({ label, value, icon: Icon, loading, pct, tooltip, subValue, onClick, active }: any) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-all ${
        onClick ? 'cursor-pointer hover:shadow-md' : ''
      } ${active ? 'border-slate-400 ring-2 ring-slate-300 ring-offset-1' : 'border-slate-200'}`}
    >
      <div className="h-1.5" style={{ background: THEME }} />
      <div className="p-4">
        {loading ? (
          <div className="animate-pulse space-y-2">
            <div className="h-3 bg-slate-100 rounded w-1/2" />
            <div className="h-7 bg-slate-100 rounded w-3/4" />
            <div className="h-2 bg-slate-100 rounded w-full" />
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-1 min-w-0">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-tight">{label}</div>
                {tooltip && <InfoBadge text={tooltip} />}
              </div>
              <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 bg-indigo-50">
                <Icon className="w-4 h-4" style={{ color: THEME }} />
              </div>
            </div>
            <div className="text-xl font-black text-slate-900 leading-none">{value}</div>
            {subValue != null && (
              <div className="text-xs font-semibold text-slate-500 mt-1">{subValue}</div>
            )}
            {pct != null && (
              <div className="mt-3">
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(pct, 100)}%`, background: THEME }} />
                </div>
                <div className="text-[10px] text-slate-400 mt-1">{pct.toFixed(1)}%</div>
              </div>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}

function ChartContainer({ title, children, loading }: any) {
  return (
    <div className="bg-white rounded-3xl border border-slate-100 p-6 shadow-sm">
      <h3 className="text-sm font-black text-slate-800 mb-6 uppercase tracking-wider flex items-center gap-2">
        <div className="w-1.5 h-5 rounded-full" style={{ background: 'linear-gradient(180deg,#334155,#1E293B)' }} />
        {title}
      </h3>
      {loading ? (
        <div className="animate-pulse bg-slate-50 rounded-2xl h-64 flex items-center justify-center">
           <RefreshCw className="w-8 h-8 text-slate-200 animate-spin" />
        </div>
      ) : (
        <div dir="ltr">{children}</div>
      )}
    </div>
  );
}

function DetailItem({ label, value, highlight, highlightColor = 'text-red-600' }: any) {
  return (
    <div className="p-3 bg-slate-50 rounded-2xl">
      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-sm font-bold ${highlight ? highlightColor : 'text-slate-800'}`}>{value || '-'}</div>
    </div>
  );
}

// Recharts Components

function AreaChartComponent({ data, color, gradientId }: { data: any[]; color?: string; gradientId?: string }) {
  const { lang } = useLang();
  const lineColor = color || COLORS.navy;
  const gId = gradientId || 'colorValDefault';
  if (!data || data.length === 0) return (
    <div className="h-40 flex items-center justify-center text-slate-400 text-sm italic">—</div>
  );
  return (
    <ComposedChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
      <defs>
        <linearGradient id={gId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor={lineColor} stopOpacity={0.2}/>
          <stop offset="95%" stopColor={lineColor} stopOpacity={0}/>
        </linearGradient>
      </defs>
      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
      <XAxis
        dataKey="name"
        axisLine={false}
        tickLine={false}
        tick={{ fontSize: 10, fill: '#64748B', fontWeight: 600 }}
      />
      <YAxis
        axisLine={false}
        tickLine={false}
        tick={{ fontSize: 10, fill: '#64748B', fontWeight: 600 }}
        width={36}
        allowDecimals={false}
      />
      <Tooltip
        contentStyle={{ borderRadius: '12px', border: '1px solid #E2E8F0', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.08)', fontSize: '12px' }}
        labelStyle={{ fontWeight: 'bold', marginBottom: '4px' }}
      />
      <Area
        type="monotone"
        dataKey="value"
        name={lang === 'en' ? 'Orders' : 'الأوامر'}
        stroke={lineColor}
        strokeWidth={2.5}
        fillOpacity={1}
        fill={`url(#${gId})`}
        dot={{ r: 3, fill: lineColor, strokeWidth: 0 }}
        activeDot={{ r: 5 }}
        animationDuration={1500}
      />
    </ComposedChart>
  );
}

function BarChartComponent({ data, stacked }: { data: any[], stacked?: boolean }) {
  if (!data || data.length === 0) return (
    <div className="h-40 flex items-center justify-center text-slate-400 text-sm italic">—</div>
  );

  const keys = [...new Set(data.flatMap((d: any) => Object.keys(d).filter(k => k !== 'name')))];

  return (
    <BarChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
      <XAxis
        dataKey="name"
        axisLine={false}
        tickLine={false}
        tick={{ fontSize: 10, fill: '#64748B', fontWeight: 600 }}
      />
      <YAxis
        axisLine={false}
        tickLine={false}
        tick={{ fontSize: 10, fill: '#64748B', fontWeight: 600 }}
        width={36}
      />
      <Tooltip
        cursor={{ fill: '#F1F5F9' }}
        contentStyle={{ borderRadius: '12px', border: '1px solid #E2E8F0', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.08)', fontSize: '12px' }}
        formatter={(v: number) => v.toLocaleString('en-US')}
      />
      <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', paddingTop: '10px', fontWeight: 600 }} />
      {keys.map((key, i) => (
        <Bar
          key={key}
          dataKey={key}
          stackId={stacked ? "a" : undefined}
          fill={CHART_COLORS[i % CHART_COLORS.length]}
          radius={stacked ? (i === keys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]) : [4, 4, 0, 0]}
          animationDuration={1500}
        />
      ))}
    </BarChart>
  );
}

function DonutChartComponent({ data }: { data: any[] }) {
  if (!data || data.length === 0) return (
    <div className="h-40 flex items-center justify-center text-slate-400 text-sm italic">—</div>
  );
  return (
    <PieChart>
      <Pie
        data={data}
        cx="50%"
        cy="40%"
        innerRadius={65}
        outerRadius={100}
        paddingAngle={4}
        dataKey="value"
        animationDuration={1500}
        label={({ percent }) => `${(percent * 100).toFixed(0)}%`}
        labelLine={false}
      >
        {data.map((entry, index) => (
          <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
        ))}
      </Pie>
      <Tooltip
        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', fontSize: '12px' }}
        formatter={(value: number, name: string) => [value.toLocaleString('en-US'), name]}
      />
      <Legend
        verticalAlign="bottom"
        align="center"
        layout="horizontal"
        iconType="circle"
        iconSize={8}
        wrapperStyle={{ fontSize: '11px', fontWeight: 600, paddingTop: '8px', lineHeight: '22px' }}
      />
    </PieChart>
  );
}

function SimpleBarChartComponent({ data, layout = 'horizontal', color = COLORS.navy }: any) {
  const { lang } = useLang();
  if (!data || data.length === 0) return (
    <div className="h-40 flex items-center justify-center text-slate-400 text-sm italic">—</div>
  );

  const ordersLabel = lang === 'en' ? 'Orders' : 'الأوامر';
  // 44px per row — compact but readable
  const dynamicHeight = Math.max(300, data.length * 44);
  const maxVal = Math.max(...data.map((d: any) => d.value || 0), 1);

  // Pure HTML/CSS horizontal bars — fully responsive on any screen width
  // No SVG sizing issues, no Arabic label overflow
  return (
    <div style={{ minHeight: dynamicHeight }} className="space-y-1 py-1">
      {data.map((item: any, idx: number) => {
        const pct = Math.max((item.value / maxVal) * 100, 2);
        return (
          <div key={idx} className="flex items-center gap-2 group">
            {/* Label */}
            <div
              className="text-xs font-bold text-slate-700 text-end shrink-0 leading-tight break-words"
              style={{ width: 160, minWidth: 160, wordBreak: 'break-word', overflowWrap: 'break-word' }}
              title={item.name}
            >
              {item.name}
            </div>
            {/* Bar track */}
            <div className="flex-1 h-7 bg-slate-100 rounded-md overflow-hidden relative">
              <div
                className="h-full rounded-md transition-all duration-700 flex items-center"
                style={{ width: `${pct}%`, background: color, minWidth: 4 }}
              />
            </div>
            {/* Value */}
            <span className="text-xs font-black text-slate-800 shrink-0 tabular-nums" style={{ minWidth: 28, textAlign: 'start' }}>
              {item.value?.toLocaleString('en-US')}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function FinancialFunnelChart({ data }: { data: any }) {
  const { lang } = useLang();
  const curr = lang === 'en' ? 'SAR' : 'ر.س';
  const estimated = data?.estimated || 0;

  const items = [
    {
      label: lang === 'en' ? 'Estimated'  : 'القيمة التقديرية',
      value: estimated,
      pct: estimated > 0 ? 100 : 0,
      color: COLORS.slate,
      bg: '#F1F5F9',
    },
    {
      label: lang === 'en' ? 'Invoiced'   : 'المفوتر',
      value: data?.invoiced  || 0,
      pct: estimated ? Math.min(100, ((data?.invoiced  || 0) / estimated) * 100) : 0,
      color: COLORS.sky,
      bg: '#E0F2FE',
    },
    {
      label: lang === 'en' ? 'Collected'  : 'المحصّل',
      value: data?.collected || 0,
      pct: estimated ? Math.min(100, ((data?.collected || 0) / estimated) * 100) : 0,
      color: COLORS.emerald,
      bg: '#DCFCE7',
    },
  ];

  return (
    <div className="space-y-4 py-2 px-1">
      {items.map(item => {
        const showInside = item.pct >= 18;
        return (
          <div key={item.label}>
            {/* Row header */}
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-xs font-black" style={{ color: item.color }}>{item.label}</span>
              <span className="text-xs font-bold text-slate-600 tabular-nums">
                {abbrevNum(item.value, curr)}
                <span className="text-slate-400 font-normal ms-1">({item.pct.toFixed(1)}%)</span>
              </span>
            </div>
            {/* Bar track */}
            <div className="h-8 rounded-xl overflow-hidden relative" style={{ background: item.bg }}>
              <div
                className="h-full rounded-xl flex items-center justify-end transition-all duration-700"
                style={{ width: `${item.pct > 0 ? Math.max(item.pct, 3) : 0}%`, background: item.color }}
              >
                {showInside && (
                  <span className="text-white text-[11px] font-black pe-2 tabular-nums">
                    {item.pct.toFixed(1)}%
                  </span>
                )}
              </div>
              {!showInside && item.pct > 0 && (
                <span
                  className="absolute top-1/2 -translate-y-1/2 text-slate-600 text-[11px] font-bold tabular-nums"
                  style={{ [lang === 'en' ? 'left' : 'left']: `calc(${item.pct}% + 6px)` }}
                >
                  {item.pct.toFixed(1)}%
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
