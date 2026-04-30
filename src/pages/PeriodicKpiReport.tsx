import React, { useEffect, useState, useCallback, useMemo } from 'react';
import api from '../services/api';
import { useLang } from '../contexts/LangContext';
import {
  RefreshCw, ChevronDown, BarChart2, Clock, CheckCircle2,
  XCircle, AlertTriangle, TrendingUp, ArrowRight, Search, X,
  EyeOff, Eye, SlidersHorizontal, Download, Printer, Link2, Calendar,
  FileX2, FileText, BadgeAlert, BadgeCheck,
} from 'lucide-react';
import KpiDrawer from '../components/KpiDrawer';
import type { KpiCol } from '../components/KpiDrawer';

// ─── Metric note context ─────────────────────────────────────────────────────

interface MetricCfgCtxVal {
  noteByCode: Record<string, string>;
}
const MetricCfgCtx = React.createContext<MetricCfgCtxVal>({ noteByCode: {} });

function buildMetricNote(
  code: string,
  configMetrics: any[],
  dateColumns: { columnKey: string; labelAr: string; labelEn?: string }[],
  stages: { id: string; nameAr: string; nameEn?: string }[],
  lang: string,
  ptSlaDays?: number | null,
): string | null {
  const m = configMetrics.find((x: any) => x.code === code);
  if (!m || m.metricType === 'NUMERIC_AGG') return null;

  const getLabel = (mode: string, colKey: string | null, stageId: string | null): string => {
    if (mode === 'TODAY') return lang === 'en' ? 'Today' : 'اليوم';
    if (mode === 'COLUMN_DATE' && colKey) {
      const col = dateColumns.find(c => c.columnKey === colKey);
      return col ? (lang === 'en' && col.labelEn ? col.labelEn : col.labelAr) : colKey;
    }
    if (mode === 'STAGE_EVENT' && stageId) {
      const st = stages.find(s => s.id === stageId);
      return st ? (lang === 'en' && st.nameEn ? st.nameEn : st.nameAr) : stageId;
    }
    return '...';
  };

  const startLabel = getLabel(m.startMode, m.startColumnKey, m.startStageId);
  const endLabel   = getLabel(m.endMode,   m.endColumnKey,   m.endStageId);
  let threshold: number | null = null;
  if (m.useExecSla && ptSlaDays) threshold = ptSlaDays;
  else if (m.thresholdDays) threshold = m.thresholdDays;

  if (lang === 'en') {
    return `From ${startLabel} → ${endLabel}${threshold ? ` within ${threshold} d` : ''}`;
  }
  return `من ${startLabel} إلى ${endLabel}${threshold ? ` خلال ${threshold} يوم` : ''}`;
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface ReportHeader {
  logoRightUrl: string | null; logoLeftUrl: string | null;
  companyNameAr: string | null; companyNameEn: string | null;
  logoRightWidthPdf: number; logoLeftWidthPdf: number;
  logoRightWidthExcel: number; logoLeftWidthExcel: number;
}

interface DateBasisOption { type: string; labelAr: string; labelEn: string; columnKey: string | null }
interface MetricResult { code: string; nameAr: string; nameEn?: string; metricType?: 'DATE_DIFF' | 'NUMERIC_AGG'; aggFunction?: string | null; avgDays: number | null; totalDays: number; count: number; thresholdDays: number | null; statusColor: 'red' | 'amber' | 'green' | null; activeTotal?: number | null; completedTotal?: number | null; activeCount?: number; completedCount?: number; }
interface Config {
  execRules: any[]; finRule: any | null; settings: any | null; stages: any[];
  projectTypes: { value: string; labelAr: string; labelEn?: string }[];
  sectors: { id: string; nameAr: string; nameEn?: string }[];
  regions: { id: string; nameAr: string; nameEn?: string; sectorId: string | null }[];
  dateColumns: { columnKey: string; labelAr: string; labelEn?: string; dataType: string }[];
  dateBasisOptions: DateBasisOption[];
  metrics: any[];
  userScope: { sectorId: string | null; regionId: string | null; role: string };
}
interface FinSumCounts { total: number; completed: number; overdue: number; warning: number; onTime: number; }
interface PendingAlert { count: number; avgDays: number | null; thresholdDays: number | null; statusColor: 'red' | 'amber' | 'green' | null; }
interface KpiAlerts { closedNotInvoiced: number; invoicedNoCert: number; closedNotInvoicedValue: number; invoicedNoCertValue: number; completedWithCert?: number; completedWithCertValue?: number; unSurveyed?: PendingAlert; unCoordinated?: PendingAlert; }
interface ExecBreakdown { overdue: number; warning: number; onTime: number; completed: number; }
interface Summary {
  total: number; active: number; completed: number;
  overdue: number; warning: number; onTime: number; unconfigured: number;
  avgDays: number | null; metricsAverages: MetricResult[]; from: string; to: string;
  billingCounts?: { partialBilled: number; notFullyBilled: number };
  finEnabled?: boolean;
  finCounts?: FinSumCounts | null;     // fin phase breakdown (informational)
  execBreakdown?: ExecBreakdown | null; // exec phase breakdown (informational)
  kpiAlerts?: KpiAlerts | null;
}
interface RegionCard {
  id: string; nameAr: string; nameEn?: string; sectorId: string | null; sectorNameAr: string | null; sectorNameEn?: string | null;
  total: number; active: number; completed: number;
  overdue: number; warning: number; onTime: number; avgDays: number | null;
  metricsAverages: MetricResult[];
  execDelayedJustified: number; execDelayedUnjustified: number;
  finDelayedJustified: number; finDelayedUnjustified: number;
}
interface FinCounts { total: number; completed: number; overdue: number; warning: number; onTime: number; slaDays?: number; }
interface PtStat {
  projectTypeValue: string; projectTypeLabelAr: string; projectTypeLabelEn?: string; configured: boolean;
  slaDays?: number; warningDays?: number;
  total: number; active?: number; completed?: number;
  overdue?: number; warning?: number; onTime?: number; avgDays?: number | null;
  metricsAverages?: MetricResult[];
  finCounts?: FinCounts | null;
}
interface RegionDetails {
  projectTypeStats: PtStat[];
  overdueWOs: any[]; onTimeWOs: any[];
  reasonWOs: any[];
  finOverdueWOs: any[]; finOnTimeWOs: any[];
  finStats: FinCounts | null;
  finEnabled: boolean;
  metricsAverages: MetricResult[];
}
interface Filters {
  sectorId: string; regionId: string; projectType: string;
  from: string; to: string;
  dateBasisType: string; dateBasisColumnKey: string;
}

// ─── Column definitions for WO tables ────────────────────────────────────────

const DEFAULT_EXEC_COLS = ['orderNumber', 'projectType', 'district', 'client', '_status', 'assignmentDate'];
const ALL_WO_COLS: { key: string; labelAr: string; labelEn: string; virtual?: boolean }[] = [
  { key: 'orderNumber',       labelAr: 'أمر العمل', labelEn: 'Work Order' },
  { key: 'projectType',       labelAr: 'نوع المشروع', labelEn: 'Project Type' },
  { key: 'district',          labelAr: 'الحي', labelEn: 'District' },
  { key: 'client',            labelAr: 'العميل', labelEn: 'Client' },
  { key: '_status',           labelAr: 'الحالة', labelEn: 'Status', virtual: true },
  { key: 'workType',          labelAr: 'نوع العمل', labelEn: 'Work Type' },
  { key: 'assignmentDate',    labelAr: 'تاريخ الإسناد', labelEn: 'Assignment Date' },
  { key: 'surveyDate',        labelAr: 'تاريخ المسح', labelEn: 'Survey Date' },
  { key: 'coordinationDate',  labelAr: 'تاريخ التنسيق', labelEn: 'Coordination Date' },
  { key: 'drillingDate',      labelAr: 'تاريخ الحفر', labelEn: 'Drilling Date' },
  { key: 'shutdownDate',      labelAr: 'تاريخ التطفئة', labelEn: 'Shutdown Date' },
  { key: 'materialSheetDate', labelAr: 'ورقة المواد', labelEn: 'Material Sheet' },
  { key: 'proc155CloseDate',  labelAr: 'إقفال 155', labelEn: '155 Close' },
  { key: 'gisCompletionDate',    labelAr: 'إنجاز GIS', labelEn: 'GIS Completion' },
  { key: 'stage',                labelAr: 'المرحلة', labelEn: 'Stage' },
  { key: 'execDelayJustified',   labelAr: 'تأخير تنفيذ مسبب؟', labelEn: 'Exec Delay Justified?', virtual: true },
  { key: 'execDelayReason',      labelAr: 'سبب التأخير التنفيذي', labelEn: 'Exec Delay Reason' },
];
const ALL_FIN_COLS: { key: string; labelAr: string; labelEn: string; virtual?: boolean }[] = [
  { key: 'orderNumber',        labelAr: 'أمر العمل', labelEn: 'Work Order' },
  { key: 'projectType',        labelAr: 'نوع المشروع', labelEn: 'Project Type' },
  { key: 'client',             labelAr: 'العميل', labelEn: 'Client' },
  { key: '_finStatus',         labelAr: 'الحالة المالية', labelEn: 'Financial Status', virtual: true },
  { key: 'assignmentDate',     labelAr: 'تاريخ الإسناد', labelEn: 'Assignment Date' },
  { key: 'invoiceNumber',      labelAr: 'رقم المستخلص', labelEn: 'Invoice No.' },
  { key: 'estimatedValue',     labelAr: 'القيمة التقديرية', labelEn: 'Estimated Value' },
  { key: 'actualInvoiceValue', labelAr: 'القيمة الفعلية (تاريخي)', labelEn: 'Actual Value (Historical)' },
  { key: 'collectedAmount',    labelAr: 'المحصّل', labelEn: 'Collected' },
  { key: 'remainingAmount',    labelAr: 'المتبقى', labelEn: 'Remaining' },
  { key: 'finDelayJustified',  labelAr: 'تأخير مالي مسبب؟', labelEn: 'Fin Delay Justified?', virtual: true },
  { key: 'finDelayReason',     labelAr: 'سبب التأخير المالي', labelEn: 'Fin Delay Reason' },
];
const ALL_REASONS_COLS: { key: string; labelAr: string; labelEn: string }[] = [
  { key: 'orderNumber', labelAr: 'أمر العمل', labelEn: 'Work Order' },
  { key: 'projectType', labelAr: 'نوع المشروع', labelEn: 'Project Type' },
  { key: 'district',    labelAr: 'الحي', labelEn: 'District' },
  { key: 'client',      labelAr: 'العميل', labelEn: 'Client' },
  { key: 'holdReason',  labelAr: 'سبب التعليق', labelEn: 'Hold Reason' },
  { key: 'stage',       labelAr: 'المرحلة', labelEn: 'Stage' },
];
const DEFAULT_REASONS_COLS = ['orderNumber', 'projectType', 'district', 'holdReason', 'stage'];

const STATUS_MAP: Record<string, { label: string; labelEn: string; color: string; bg: string; border: string }> = {
  OVERDUE:   { label: 'متأخر', labelEn: 'Overdue',  color: 'text-red-700',     bg: 'bg-red-50',     border: 'border-red-200' },
  WARNING:   { label: 'تنبيه', labelEn: 'Warning',  color: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-200' },
  ON_TIME:   { label: 'منتظم', labelEn: 'On Time',  color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  COMPLETED: { label: 'منجز', labelEn: 'Completed', color: 'text-indigo-700',  bg: 'bg-indigo-50',  border: 'border-indigo-200' },
  CANCELLED: { label: 'ملغي', labelEn: 'Cancelled', color: 'text-slate-500',   bg: 'bg-slate-50',   border: 'border-slate-200' },
};

const METRIC_COLOR = { red: 'text-red-600 bg-red-50', amber: 'text-amber-600 bg-amber-50', green: 'text-emerald-600 bg-emerald-50', null: 'text-slate-600 bg-slate-50' };

// ─── Utilities ───────────────────────────────────────────────────────────────

const PRESETS: { value: string; labelAr: string; labelEn: string }[] = [
  { value: 'week',      labelAr: 'هذا الأسبوع', labelEn: 'This Week' },
  { value: 'lastweek',  labelAr: 'الأسبوع الماضي', labelEn: 'Last Week' },
  { value: 'month',     labelAr: 'هذا الشهر', labelEn: 'This Month' },
  { value: 'lastmonth', labelAr: 'الشهر الماضي', labelEn: 'Last Month' },
  { value: 'ytd',       labelAr: 'من بداية السنة حتى اليوم', labelEn: 'Year to Date' },
  { value: 'year',      labelAr: 'السنة كاملة', labelEn: 'Full Year' },
  { value: 'custom',    labelAr: 'مخصص', labelEn: 'Custom' },
];

const VIEW_MODES: { value: string; labelAr: string; labelEn: string }[] = [
  { value: 'all',       labelAr: 'الكل', labelEn: 'All' },
  { value: 'active',    labelAr: 'النشط فقط', labelEn: 'Active Only' },
  { value: 'overdue',   labelAr: 'المتأخر فقط', labelEn: 'Overdue Only' },
  { value: 'warning',   labelAr: 'التنبيه فقط', labelEn: 'Warning Only' },
  { value: 'ontime',    labelAr: 'المنتظم فقط', labelEn: 'On Time Only' },
  { value: 'completed', labelAr: 'المنجز فقط', labelEn: 'Completed Only' },
];

function presetDateRange(p: string): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const fmt = (dt: Date) => dt.toISOString().slice(0, 10);
  const today = fmt(now);
  switch (p) {
    case 'week': {
      // Week: Sunday → Saturday  (getDay: 0=Sun, 6=Sat)
      const dow = now.getDay();
      const sun = new Date(now); sun.setDate(d - dow);
      const sat = new Date(sun); sat.setDate(sun.getDate() + 6);
      return { from: fmt(sun), to: fmt(sat) };
    }
    case 'lastweek': {
      const dow = now.getDay();
      const sun = new Date(now); sun.setDate(d - dow - 7);
      const sat = new Date(sun); sat.setDate(sun.getDate() + 6);
      return { from: fmt(sun), to: fmt(sat) };
    }
    case 'month':     return { from: fmt(new Date(y, m, 1)), to: fmt(new Date(y, m + 1, 0)) };
    case 'lastmonth': return { from: fmt(new Date(y, m - 1, 1)), to: fmt(new Date(y, m, 0)) };
    case 'ytd':       return { from: `${y}-01-01`, to: today };
    case 'year':      return { from: `${y}-01-01`, to: `${y}-12-31` };
    default:          return { from: '', to: '' };
  }
}

// kept for config defaultDateRangeMode resolution
function defaultDateRange(mode?: string): { from: string; to: string } {
  if (mode === 'week') return presetDateRange('week');
  if (mode === 'ytd')  return presetDateRange('ytd');
  return presetDateRange('month');
}

function fmtDate(val: any): string {
  if (!val) return '—';
  const s = String(val);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return '—';
}

function toCamelCase(s: string): string {
  return s.replace(/_([a-z0-9])/g, (_, c) => /\d/.test(c) ? c : c.toUpperCase());
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, colorCls, subLabel, execVal, finVal, onClick }: {
  label: string; value: number | string | null; icon?: any; colorCls?: string; subLabel?: string;
  execVal?: number | null; finVal?: number | null; onClick?: () => void;
}) {
  const { lang } = useLang();
  const showDetail = execVal != null && finVal != null;
  return (
    <div
      className={`rounded-xl border p-4 flex flex-col gap-1 bg-white shadow-sm ${colorCls ?? 'border-slate-200'} ${onClick ? 'cursor-pointer hover:ring-2 hover:ring-indigo-300 transition-shadow' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        {Icon && <Icon className="w-4 h-4 text-slate-300" />}
      </div>
      <div className="text-2xl font-bold text-slate-800">{value ?? '—'}</div>
      {showDetail && (
        <div className="flex flex-col gap-0.5 mt-1 border-t border-slate-100 pt-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-500 font-medium">{lang === 'en' ? 'Exec' : 'تنفيذي'}</span>
            <span className="text-[11px] font-semibold text-slate-600">{execVal}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-500 font-medium">{lang === 'en' ? 'Fin' : 'مالي'}</span>
            <span className="text-[11px] font-semibold text-slate-600">{finVal}</span>
          </div>
        </div>
      )}
      {subLabel && <div className="text-xs text-slate-400">{subLabel}</div>}
    </div>
  );
}

function MetricCard({ m, onClick }: { m: MetricResult; onClick?: () => void }) {
  const { lang } = useLang();
  const { noteByCode } = React.useContext(MetricCfgCtx);
  const isNumeric = m.metricType === 'NUMERIC_AGG';
  const colorKey = m.statusColor ?? null;
  const cls = METRIC_COLOR[colorKey as keyof typeof METRIC_COLOR] ?? METRIC_COLOR.null;
  const displayVal = m.avgDays != null
    ? (isNumeric ? m.avgDays.toLocaleString('en-US', { maximumFractionDigits: 2 }) : m.avgDays)
    : '—';
  const note = noteByCode[m.code] ?? null;
  return (
    <div
      className={`rounded-xl border bg-white shadow-sm p-4 flex flex-col gap-1 w-full h-full ${isNumeric ? 'border-violet-100' : 'border-slate-200'} ${onClick ? 'cursor-pointer hover:ring-2 hover:ring-indigo-300 transition-shadow' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-xs font-medium text-slate-500 truncate">{lang === 'en' && m.nameEn ? m.nameEn : m.nameAr}</span>
          {note && (
            <span className="relative group shrink-0">
              <svg className="w-3.5 h-3.5 text-slate-300 hover:text-indigo-400 cursor-help transition-colors" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              <span className={`pointer-events-none absolute z-50 bottom-full mb-2 ${lang === 'en' ? 'left-0' : 'right-0'} w-56 bg-slate-800 text-white text-[11px] leading-snug rounded-lg px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity shadow-xl whitespace-normal`} dir="rtl">
                {note}
                <span className={`absolute top-full ${lang === 'en' ? 'left-2' : 'right-2'} border-4 border-transparent border-t-slate-800`} />
              </span>
            </span>
          )}
        </div>
        {isNumeric
          ? <BarChart2 className="w-3.5 h-3.5 text-violet-300 shrink-0" />
          : <Clock className="w-3.5 h-3.5 text-slate-300 shrink-0" />}
      </div>
      <div className={`text-2xl font-bold ${cls.split(' ')[0]}`}>
        {displayVal}
        {m.avgDays != null && !isNumeric && <span className="text-sm font-normal text-slate-400 mr-1">{lang === 'en' ? 'days' : 'يوم'}</span>}
      </div>
      {/* Always render threshold row to keep uniform card height */}
      <div className={`text-xs font-medium px-2 py-0.5 rounded-full self-start transition-opacity ${m.thresholdDays ? cls : 'opacity-0 pointer-events-none'}`}>
        {lang === 'en' ? 'Limit: ' : 'الحد: '}{m.thresholdDays ?? '—'}{isNumeric ? '' : (lang === 'en' ? ' d' : ' يوم')}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-slate-400">
        <span>{m.count} {lang === 'en' ? 'transactions' : 'معاملة'}</span>
        {isNumeric && m.aggFunction && (
          <span className="px-1.5 py-0.5 bg-violet-50 text-violet-600 rounded font-mono text-[10px]">{m.aggFunction}</span>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { lang } = useLang();
  const s = STATUS_MAP[status] ?? STATUS_MAP.ON_TIME;
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.bg} ${s.color} ${s.border} border`}>
      {lang === 'en' ? s.labelEn : s.label}
    </span>
  );
}

function HealthBar({ overdue, warning, onTime, completed, total }: {
  overdue: number; warning: number; onTime: number; completed: number; total: number;
}) {
  if (!total) return <div className="h-1.5 bg-slate-100 rounded-full" />;
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`;
  return (
    <div className="flex h-1.5 rounded-full overflow-hidden gap-px">
      {overdue > 0 && <div style={{ width: pct(overdue) }} className="bg-red-400" />}
      {warning > 0 && <div style={{ width: pct(warning) }} className="bg-amber-400" />}
      {onTime > 0 && <div style={{ width: pct(onTime) }} className="bg-emerald-400" />}
      {completed > 0 && <div style={{ width: pct(completed) }} className="bg-indigo-300" />}
    </div>
  );
}

// ─── Column Picker Modal ──────────────────────────────────────────────────────

const MAX_COLS = 10;

function ColumnPickerModal({
  tableKey, availableCols, selectedKeys, onSave, onClose, maxCols = MAX_COLS,
}: {
  tableKey: string;
  availableCols: { key: string; labelAr: string; labelEn?: string; virtual?: boolean }[];
  selectedKeys: string[];
  onSave: (keys: string[]) => void;
  onClose: () => void;
  maxCols?: number;
}) {
  const { lang } = useLang();
  const validKeys = useMemo(
    () => selectedKeys.filter(k => availableCols.some(c => c.key === k)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const [selected, setSelected] = useState<string[]>(validKeys);
  const atMax = selected.length >= maxCols;
  const toggle = (key: string) => setSelected(prev => {
    if (prev.includes(key)) return prev.filter(k => k !== key);
    if (prev.length >= maxCols) return prev;
    return [...prev, key];
  });
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" dir={lang === 'en' ? 'ltr' : 'rtl'}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="font-bold text-slate-800">{lang === 'en' ? 'Select Columns' : 'اختيار الأعمدة'}</h2>
            <p className={`text-xs mt-0.5 ${atMax ? 'text-amber-600 font-medium' : 'text-slate-400'}`}>
              {selected.length}/{maxCols} {lang === 'en' ? 'columns' : 'أعمدة'} {atMax && (lang === 'en' ? '— Max reached' : '— الحد الأقصى')}
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
                <span className="text-sm text-slate-700 flex-1">{lang === 'en' ? col.labelEn : col.labelAr}</span>
                {col.virtual && <span className="text-xs text-slate-400 bg-slate-100 px-1.5 rounded">{lang === 'en' ? 'Calc' : 'محسوب'}</span>}
              </label>
            );
          })}
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-slate-200">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-slate-600 text-sm hover:bg-slate-50">{lang === 'en' ? 'Cancel' : 'إلغاء'}</button>
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

// ─── WO Table with column picker ─────────────────────────────────────────────

function WOTable({
  wos, title, tableKey, selectedColKeys, allCols, onOpenPicker, searchable = true,
}: {
  wos: any[]; title: string; tableKey: 'EXEC' | 'FIN' | 'REASONS';
  selectedColKeys: string[]; allCols: { key: string; labelAr: string; labelEn?: string; virtual?: boolean }[];
  onOpenPicker: () => void; searchable?: boolean;
}) {
  const { lang } = useLang();
  const [search, setSearch] = useState('');
  const activeCols = useMemo(() => {
    const defaultCols = tableKey === 'FIN' ? ALL_FIN_COLS : tableKey === 'REASONS' ? ALL_REASONS_COLS : ALL_WO_COLS;
    const keys = selectedColKeys.length ? selectedColKeys : defaultCols.slice(0, 6).map(c => c.key);
    return allCols.filter(c => keys.includes(c.key));
  }, [selectedColKeys, allCols, tableKey]);

  const filtered = useMemo(() => {
    const sortByAssignment = (a: any, b: any) => {
      const da = a.assignmentDate ? new Date(a.assignmentDate).getTime() : 0;
      const db = b.assignmentDate ? new Date(b.assignmentDate).getTime() : 0;
      return da - db;
    };
    if (!search) return [...wos].sort(sortByAssignment);
    const q = search.toLowerCase();
    return wos
      .filter(w =>
        (w.orderNumber ?? '').toLowerCase().includes(q) ||
        (w.district ?? '').toLowerCase().includes(q) ||
        (w.client ?? '').toLowerCase().includes(q)
      )
      .sort(sortByAssignment);
  }, [wos, search]);

  const renderCell = (wo: any, colKey: string) => {
    if (colKey === '_status') return <StatusBadge status={wo._status ?? 'ON_TIME'} />;
    if (colKey === '_finStatus') return <StatusBadge status={wo._finStatus ?? 'ON_TIME'} />;
    if (colKey === 'execDelayJustified' || colKey === 'finDelayJustified') {
      const justified = wo[colKey] === true;
      return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${justified ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {justified ? (lang === 'en' ? 'Justified' : 'مسبب') : (lang === 'en' ? 'Unjustified' : 'غير مسبب')}
        </span>
      );
    }
    let val = wo[colKey];
    if (val == null && wo.customFields) {
      const snakeKey = colKey.replace(/([A-Z])/g, '_$1').toLowerCase();
      val = wo.customFields[snakeKey] ?? wo.customFields[colKey] ?? null;
    }
    if (val == null) return '—';
    if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) return fmtDate(val);
    if (val instanceof Date || (typeof val === 'string' && colKey.toLowerCase().includes('date'))) return fmtDate(val);
    return String(val);
  };

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
      <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-700">{title}</span>
          <span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full font-medium">{wos.length}</span>
        </div>
        <div className="flex items-center gap-2">
          {searchable && (
            <div className="relative">
              <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={lang === 'en' ? 'Search...' : 'بحث...'}
                className="pr-8 pl-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white w-40 focus:ring-2 focus:ring-indigo-400 outline-none"
              />
            </div>
          )}
          <button
            data-testid={`button-col-picker-${tableKey}`}
            onClick={onOpenPicker}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white hover:border-indigo-400 hover:text-indigo-600 text-slate-500 transition-colors"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            {lang === 'en' ? 'Columns' : 'الأعمدة'}
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              {activeCols.map(col => (
                <th key={col.key} className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 whitespace-nowrap">
                  {lang === 'en' ? col.labelEn : col.labelAr}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filtered.map(wo => (
              <tr key={wo.id} className="hover:bg-slate-50/50 transition-colors">
                {activeCols.map(col => (
                  <td key={col.key} className="px-4 py-2.5 text-xs text-slate-600 whitespace-nowrap">
                    {col.key === 'orderNumber'
                      ? <span className="font-mono text-indigo-700">{wo.orderNumber ?? '—'}</span>
                      : renderCell(wo, col.key)}
                  </td>
                ))}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={activeCols.length} className="text-center py-4 text-slate-400 text-xs">{lang === 'en' ? 'No results' : 'لا توجد نتائج'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Financial Closure Card ───────────────────────────────────────────────────

function FinClosureCard({ finStats }: { finStats: FinCounts }) {
  const { lang } = useLang();
  const total = finStats.total;
  const pct = (n: number) => total > 0 ? `${Math.round((n / total) * 100)}%` : '0%';
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow w-full">
      {/* Header */}
      <div className="flex items-start justify-between mb-2.5 gap-2">
        <div className="text-sm font-semibold text-slate-700 leading-snug">{lang === 'en' ? 'Financial Closure' : 'الإغلاق المالي'}</div>
        {finStats.slaDays && (
          <span className="text-[11px] shrink-0 px-2 py-0.5 rounded-full font-medium" style={{ background: '#f1f5f9', color: '#1e293b', border: '1px solid #cbd5e1' }}>
            SLA {finStats.slaDays} {lang === 'en' ? 'days' : 'يوم'}
          </span>
        )}
      </div>

      {/* Mini health bar */}
      <div className="h-2 rounded-full overflow-hidden bg-slate-100 flex mb-3">
        {finStats.overdue  > 0 && <div style={{ width: pct(finStats.overdue)  }} className="bg-red-400" />}
        {finStats.warning  > 0 && <div style={{ width: pct(finStats.warning)  }} className="bg-amber-400" />}
        {finStats.onTime   > 0 && <div style={{ width: pct(finStats.onTime)   }} className="bg-emerald-400" />}
        {finStats.completed > 0 && <div style={{ width: pct(finStats.completed) }} className="bg-emerald-600" />}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-5 gap-0.5 text-center divide-x divide-x-reverse divide-slate-100">
        <div>
          <div className={`text-sm font-bold ${finStats.overdue > 0 ? 'text-red-600' : 'text-slate-300'}`}>{finStats.overdue}</div>
          <div className="text-[10px] text-slate-400">{lang === 'en' ? 'Overdue' : 'متأخر'}</div>
        </div>
        <div>
          <div className={`text-sm font-bold ${finStats.warning > 0 ? 'text-amber-500' : 'text-slate-300'}`}>{finStats.warning}</div>
          <div className="text-[10px] text-slate-400">{lang === 'en' ? 'Warning' : 'تنبيه'}</div>
        </div>
        <div>
          <div className="text-sm font-bold text-emerald-500">{finStats.onTime}</div>
          <div className="text-[10px] text-slate-400">{lang === 'en' ? 'On Track' : 'منتظم'}</div>
        </div>
        <div>
          <div className="text-sm font-bold text-emerald-700">{finStats.completed}</div>
          <div className="text-[10px] text-slate-400">{lang === 'en' ? 'Done' : 'منجز'}</div>
        </div>
        <div>
          <div className="text-sm font-bold text-slate-700">{total}</div>
          <div className="text-[10px] text-slate-400">{lang === 'en' ? 'Total' : 'إجمالي'}</div>
        </div>
      </div>

      {total === 0 && (
        <p className="text-[10px] text-slate-400 text-center mt-2">{lang === 'en' ? 'No work orders completed executionally' : 'لا توجد أوامر منجزة تنفيذياً'}</p>
      )}
    </div>
  );
}

// ─── Project Type Mini Card ───────────────────────────────────────────────────

const PtMiniCard = React.memo(function PtMiniCard({ stat, showMetrics }: { stat: PtStat; showMetrics: boolean }) {
  const { lang } = useLang();
  const { noteByCode } = React.useContext(MetricCfgCtx);
  const total = stat.total;
  if (!stat.configured) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4">
        <div className="text-sm font-semibold text-slate-400 mb-1">{lang === 'en' ? stat.projectTypeLabelEn : stat.projectTypeLabelAr}</div>
        <div className="text-xs text-slate-400">{lang === 'en' ? `Not Configured — ${total} orders` : `غير مهيأ — ${total} أمر`}</div>
      </div>
    );
  }
  const dateDiffMetrics   = stat.metricsAverages?.filter(m => m.avgDays != null && m.metricType !== 'NUMERIC_AGG') ?? [];
  const numericAggMetrics = stat.metricsAverages?.filter(m => m.avgDays != null && m.metricType === 'NUMERIC_AGG') ?? [];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between mb-2.5 gap-2">
        <div className="text-sm font-semibold text-slate-700 leading-snug">{lang === 'en' ? stat.projectTypeLabelEn : stat.projectTypeLabelAr}</div>
        <span className="text-[11px] shrink-0 bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-0.5 rounded-full font-medium">
          SLA {stat.slaDays} {lang === 'en' ? 'days' : 'يوم'}
        </span>
      </div>

      {/* Health bar */}
      <HealthBar overdue={stat.overdue ?? 0} warning={stat.warning ?? 0} onTime={stat.onTime ?? 0} completed={stat.completed ?? 0} total={total} />

      {/* Stats grid — 5 columns */}
      <div className="grid grid-cols-5 gap-0.5 mt-3 text-center divide-x divide-x-reverse divide-slate-100">
        <div>
          <div className={`text-sm font-bold ${(stat.overdue ?? 0) > 0 ? 'text-red-600' : 'text-slate-300'}`}>{stat.overdue ?? 0}</div>
          <div className="text-[10px] text-slate-400">{lang === 'en' ? 'Overdue' : 'متأخر'}</div>
        </div>
        <div>
          <div className={`text-sm font-bold ${(stat.warning ?? 0) > 0 ? 'text-amber-500' : 'text-slate-300'}`}>{stat.warning ?? 0}</div>
          <div className="text-[10px] text-slate-400">{lang === 'en' ? 'Warning' : 'تنبيه'}</div>
        </div>
        <div>
          <div className="text-sm font-bold text-emerald-500">{stat.onTime ?? 0}</div>
          <div className="text-[10px] text-slate-400">{lang === 'en' ? 'On Track' : 'منتظم'}</div>
        </div>
        <div>
          <div className="text-sm font-bold text-emerald-700">{stat.completed ?? 0}</div>
          <div className="text-[10px] text-slate-400">{lang === 'en' ? 'Done' : 'منجز'}</div>
        </div>
        <div>
          <div className="text-sm font-bold text-slate-700">{total}</div>
          <div className="text-[10px] text-slate-400">{lang === 'en' ? 'Total' : 'إجمالي'}</div>
        </div>
      </div>

      {/* Metrics */}
      {showMetrics && (dateDiffMetrics.length > 0 || numericAggMetrics.length > 0) && (
        <div className="mt-3 pt-2.5 border-t border-slate-100 space-y-1.5">
          {dateDiffMetrics.map(m => {
            const cls = METRIC_COLOR[m.statusColor as keyof typeof METRIC_COLOR] ?? METRIC_COLOR.null;
            const note = noteByCode[m.code];
            return (
              <div key={m.code} className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1 min-w-0">
                  <span className="text-[10px] text-slate-500 truncate">{lang === 'en' && m.nameEn ? m.nameEn : m.nameAr}</span>
                  {note && (
                    <span className="relative group shrink-0">
                      <svg className="w-3 h-3 text-slate-300 hover:text-indigo-400 cursor-help transition-colors" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                      </svg>
                      <span className={`pointer-events-none absolute z-50 bottom-full mb-1.5 ${lang === 'en' ? 'left-0' : 'right-0'} w-48 bg-slate-800 text-white text-[10px] leading-snug rounded-lg px-2.5 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-lg whitespace-normal`} dir="rtl">
                        {note}
                        <span className={`absolute top-full ${lang === 'en' ? 'left-2' : 'right-2'} border-4 border-transparent border-t-slate-800`} />
                      </span>
                    </span>
                  )}
                </div>
                <span className={`font-semibold text-[10px] px-1.5 py-0.5 rounded shrink-0 ${cls}`}>{m.avgDays} {lang === 'en' ? 'days' : 'يوم'}</span>
              </div>
            );
          })}
          {numericAggMetrics.map(m => (
            <div key={m.code} className="flex items-center justify-between text-[10px]">
              <span className="text-slate-500 truncate ml-2">{lang === 'en' && m.nameEn ? m.nameEn : m.nameAr}</span>
              <span className="font-semibold px-1.5 py-0.5 rounded shrink-0 bg-slate-50 text-slate-600">
                {m.avgDays != null ? m.avgDays.toLocaleString('en-US', { maximumFractionDigits: 1 }) : '—'} {lang === 'en' ? 'Q' : 'م'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

// ─── Region Expanded Panel ────────────────────────────────────────────────────

function RegionExpandedPanel({
  region, details, loading, onClose, finEnabled, hideEmpty, includeCompleted,
  execColKeys, finColKeys, reasonsColKeys, onOpenColPicker,
  allExecCols, allFinCols, allReasonsCols,
}: {
  region: RegionCard; details: RegionDetails | null; loading: boolean;
  onClose: () => void; finEnabled: boolean; hideEmpty: boolean; includeCompleted: boolean;
  execColKeys: string[]; finColKeys: string[]; reasonsColKeys: string[];
  onOpenColPicker: (key: 'EXEC' | 'FIN' | 'REASONS') => void;
  allExecCols: { key: string; labelAr: string; labelEn?: string; virtual?: boolean }[];
  allFinCols:  { key: string; labelAr: string; labelEn?: string; virtual?: boolean }[];
  allReasonsCols: { key: string; labelAr: string; labelEn?: string; virtual?: boolean }[];
}) {
  const { lang } = useLang();
  const [activeTab, setActiveTab] = useState<'overdue' | 'exec-justified' | 'ontime' | 'fin' | 'fin-justified' | 'reasons'>('overdue');
  const [showMetrics, setShowMetrics] = useState(true);

  const visibleStats = useMemo(() => {
    if (!details) return [];
    return hideEmpty ? details.projectTypeStats.filter(s => s.total > 0) : details.projectTypeStats;
  }, [details, hideEmpty]);

  // Split overdue WOs into unjustified (متأخر) and justified (متأخر مسبب)
  const unjustifiedWOs   = useMemo(() => (details?.overdueWOs   ?? []).filter((w: any) => w.execDelayJustified !== true), [details]);
  const justifiedWOs     = useMemo(() => (details?.overdueWOs   ?? []).filter((w: any) => w.execDelayJustified === true), [details]);
  const finJustifiedWOs  = useMemo(() => (details?.finOverdueWOs ?? []).filter((w: any) => w.finDelayJustified === true), [details]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-lg overflow-hidden" dir={lang === 'en' ? 'ltr' : 'rtl'}>
      <div className={`bg-gradient-to-l from-indigo-600 to-indigo-700 px-6 py-4 flex items-center justify-between flex-wrap gap-3 ${lang === 'en' ? 'flex-row-reverse' : ''}`}>
        <div className="flex items-center gap-3">
          <button
            data-testid="button-close-region"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <ArrowRight className={`w-4 h-4 ${lang === 'en' ? 'rotate-180' : ''}`} />
          </button>
          <div>
            <h2 className="text-white font-bold text-base">{lang === 'en' && region.nameEn ? region.nameEn : region.nameAr}</h2>
            {(lang === 'en' ? region.sectorNameEn : region.sectorNameAr) && (
              <p className="text-indigo-200 text-xs">{lang === 'en' ? region.sectorNameEn : region.sectorNameAr}</p>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {/* Exec stats row */}
          <div className="flex items-center gap-4 text-sm text-white/80">
            <span className="text-white/40 text-[10px] font-medium">{lang === 'en' ? 'EXEC' : 'تنفيذي'}</span>
            <div className="text-center"><div className="text-xl font-bold text-white">{region.total}</div><div className="text-xs">{lang === 'en' ? 'Total' : 'إجمالي'}</div></div>
            <div className="text-center"><div className="text-xl font-bold text-red-300">{region.execDelayedUnjustified ?? region.overdue}</div><div className="text-xs">{lang === 'en' ? 'Overdue' : 'متأخر'}</div></div>
            <div className="text-center"><div className="text-xl font-bold text-orange-300">{region.execDelayedJustified ?? 0}</div><div className="text-xs">{lang === 'en' ? 'Justified' : 'متأخر مسبب'}</div></div>
            <div className="text-center"><div className="text-xl font-bold text-amber-300">{region.warning}</div><div className="text-xs">{lang === 'en' ? 'Warning' : 'تنبيه'}</div></div>
            <div className="text-center"><div className="text-xl font-bold text-emerald-300">{region.onTime}</div><div className="text-xs">{lang === 'en' ? 'On Track' : 'منتظم'}</div></div>
          </div>
          {/* Fin stats row — same structure as exec, always visible when finEnabled */}
          {details?.finStats && (
            <div className="flex items-center gap-4 bg-white/10 rounded-lg px-3 py-1 text-xs text-white/70">
              <span className="text-white/40 text-[10px] font-medium">{lang === 'en' ? 'FIN' : 'مالي'}</span>
              <div className="text-center"><div className="font-bold text-white">{details.finStats.total}</div><div>{lang === 'en' ? 'Total' : 'إجمالي'}</div></div>
              <div className="text-center"><div className="font-bold text-red-300">{details.finStats.overdue}</div><div>{lang === 'en' ? 'Overdue' : 'متأخر'}</div></div>
              <div className="text-center"><div className="font-bold text-orange-300">{finJustifiedWOs.length}</div><div>{lang === 'en' ? 'Justified' : 'متأخر مسبب'}</div></div>
              <div className="text-center"><div className="font-bold text-amber-300">{details.finStats.warning}</div><div>{lang === 'en' ? 'Warning' : 'تنبيه'}</div></div>
              <div className="text-center"><div className="font-bold text-emerald-300">{details.finStats.onTime}</div><div>{lang === 'en' ? 'On Track' : 'منتظم'}</div></div>
            </div>
          )}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>{lang === 'en' ? 'Loading...' : 'جاري التحميل...'}</span>
        </div>
      )}

      {!loading && details && (
        <div className="p-6 space-y-6">
          {/* Metrics averages for region */}
          {details.metricsAverages && details.metricsAverages.filter(m => m.avgDays != null).length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-indigo-500" />
                  {lang === 'en' ? 'Performance Averages' : 'متوسطات الأداء'}
                </h3>
                <button onClick={() => setShowMetrics(p => !p)} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
                  {showMetrics ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  {showMetrics ? (lang === 'en' ? 'Hide' : 'إخفاء') : (lang === 'en' ? 'Show' : 'عرض')}
                </button>
              </div>
              {showMetrics && (
                <div className="flex gap-3 flex-wrap items-stretch">
                  {details.metricsAverages.filter(m => m.avgDays != null).map(m => (
                    <div key={m.nameAr} style={{ flex: '1 1 150px' }}><MetricCard m={m} /></div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Project type cards */}
          <div>
            <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-indigo-500" />
              {lang === 'en' ? 'Project Types' : 'أنواع المشاريع'}
            </h3>
            {visibleStats.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-sm">{lang === 'en' ? 'No work orders within selected period' : 'لا توجد أوامر عمل ضمن الفترة المحددة'}</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
                {visibleStats.map((stat: PtStat) => (
                  <PtMiniCard key={stat.projectTypeValue} stat={stat} showMetrics={showMetrics as boolean} />
                ))}
                {/* Financial closure card */}
                {details.finEnabled && details.finStats && (
                  <FinClosureCard finStats={details.finStats} />
                )}
              </div>
            )}
          </div>

          {/* Detail tables */}
          {(details.overdueWOs.length > 0 || details.onTimeWOs.length > 0 || details.finEnabled || details.reasonWOs?.length > 0) && (
            <div>
              <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-500" />
                {lang === 'en' ? 'Monitoring Tables' : 'جداول المتابعة'}
              </h3>
              <div className="flex flex-wrap border-b border-slate-200 mb-4 gap-0">
                {[
                  { key: 'overdue',        label: lang === 'en' ? `Overdue (${unjustifiedWOs.length})` : `المتأخرات (${unjustifiedWOs.length})`, color: 'text-red-600' },
                  ...(justifiedWOs.length > 0 ? [{ key: 'exec-justified', label: lang === 'en' ? `Justified Overdue (${justifiedWOs.length})` : `المتأخرات المسببة (${justifiedWOs.length})`, color: 'text-orange-600' } as any] : []),
                  { key: 'ontime',         label: lang === 'en' ? `On Track & Warning (${details.onTimeWOs.length})` : `المنتظم والتنبيه (${details.onTimeWOs.length})`, color: 'text-emerald-600' },
                  ...(details.finEnabled ? [{ key: 'fin', label: lang === 'en' ? `Financial (${details.finOverdueWOs.length + details.finOnTimeWOs.length})` : `المالي (${details.finOverdueWOs.length + details.finOnTimeWOs.length})`, color: 'text-indigo-600' } as any] : []),
                  ...(details.finEnabled && finJustifiedWOs.length > 0 ? [{ key: 'fin-justified', label: lang === 'en' ? `Financial Justified (${finJustifiedWOs.length})` : `المالي المسبب (${finJustifiedWOs.length})`, color: 'text-purple-600' } as any] : []),
                  ...(details.reasonWOs?.length > 0 ? [{ key: 'reasons', label: lang === 'en' ? `Reasons (${details.reasonWOs?.length ?? 0})` : `الأسباب (${details.reasonWOs?.length ?? 0})`, color: 'text-amber-700' } as any] : []),
                ].map(tab => (
                  <button
                    key={tab.key}
                    data-testid={`tab-detail-${tab.key}`}
                    onClick={() => setActiveTab(tab.key as any)}
                    className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === tab.key
                        ? `border-indigo-500 ${tab.color}`
                        : 'border-transparent text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {activeTab === 'overdue' && (
                <WOTable
                  wos={unjustifiedWOs} title={lang === 'en' ? 'Overdue Execution' : 'المتأخرات التنفيذية'}
                  tableKey="EXEC" selectedColKeys={execColKeys} allCols={allExecCols.length ? allExecCols : ALL_WO_COLS}
                  onOpenPicker={() => onOpenColPicker('EXEC')}
                />
              )}
              {activeTab === 'exec-justified' && (
                <WOTable
                  wos={justifiedWOs} title={lang === 'en' ? 'Justified Overdue' : 'المتأخرات المسببة'}
                  tableKey="EXEC" selectedColKeys={execColKeys} allCols={allExecCols.length ? allExecCols : ALL_WO_COLS}
                  onOpenPicker={() => onOpenColPicker('EXEC')}
                />
              )}
              {activeTab === 'ontime' && (
                <WOTable
                  wos={details.onTimeWOs} title={lang === 'en' ? 'On Track & Warning' : 'المنتظم والتنبيه'}
                  tableKey="EXEC" selectedColKeys={execColKeys} allCols={allExecCols.length ? allExecCols : ALL_WO_COLS}
                  onOpenPicker={() => onOpenColPicker('EXEC')}
                />
              )}
              {activeTab === 'fin' && details.finEnabled && (
                <div className="space-y-4">
                  <WOTable
                    wos={details.finOverdueWOs} title={lang === 'en' ? 'Financial Overdue' : 'المتأخرات المالية'}
                    tableKey="FIN" selectedColKeys={finColKeys} allCols={allFinCols.length ? allFinCols : ALL_FIN_COLS}
                    onOpenPicker={() => onOpenColPicker('FIN')}
                  />
                  <WOTable
                    wos={details.finOnTimeWOs} title={lang === 'en' ? 'Financial On Track' : 'المالي المنتظم'}
                    tableKey="FIN" selectedColKeys={finColKeys} allCols={allFinCols.length ? allFinCols : ALL_FIN_COLS}
                    onOpenPicker={() => onOpenColPicker('FIN')}
                  />
                </div>
              )}
              {activeTab === 'fin-justified' && details.finEnabled && (
                <WOTable
                  wos={finJustifiedWOs} title={lang === 'en' ? 'Financial Justified Overdue' : 'المتأخرات المالية المسببة'}
                  tableKey="FIN" selectedColKeys={finColKeys} allCols={allFinCols.length ? allFinCols : ALL_FIN_COLS}
                  onOpenPicker={() => onOpenColPicker('FIN')}
                />
              )}
              {activeTab === 'reasons' && (
                <WOTable
                  wos={details.reasonWOs ?? []} title={lang === 'en' ? 'Hold Reasons' : 'أسباب التعليق'}
                  tableKey="REASONS" selectedColKeys={reasonsColKeys} allCols={allReasonsCols.length ? allReasonsCols : ALL_REASONS_COLS}
                  onOpenPicker={() => onOpenColPicker('REASONS')}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function PeriodicKpiReport() {
  const { lang } = useLang();
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  // ── Report header (branding for exports)
  const [reportHdr, setReportHdr] = useState<ReportHeader | null>(null);

  // ── Server data
  const [config, setConfig] = useState<Config | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [regionCards, setRegionCards] = useState<RegionCard[]>([]);
  const [expandedRegion, setExpandedRegion] = useState<RegionCard | null>(null);
  const [regionDetails, setRegionDetails] = useState<RegionDetails | null>(null);

  const [authorized, setAuthorized] = useState<boolean | null>(null);

  const [loadingConfig, setLoadingConfig]   = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingRegions, setLoadingRegions] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // ── Filter state
  const [preset, setPreset] = useState<string>('month');
  const [filters, setFilters] = useState<Filters>({
    sectorId: user.sectorId ?? '',
    regionId: user.regionId ?? '',
    projectType: '',
    from: '', to: '',
    dateBasisType: 'COLUMN_DATE',
    dateBasisColumnKey: 'assignment_date',
  });
  const [appliedFilters, setAppliedFilters] = useState<Filters | null>(null);

  // ── Client-side display state
  const [hideEmpty,         setHideEmpty]         = useState(false);
  const [viewMode,          setViewMode]          = useState('all');
  const [searchText,        setSearchText]        = useState('');
  const [copySuccess,       setCopySuccess]       = useState(false);
  const [includeCompleted,  setIncludeCompleted]  = useState(true);

  // ── Column picker state
  const [execColKeys,    setExecColKeys]    = useState<string[]>(DEFAULT_EXEC_COLS);
  const [finColKeys,     setFinColKeys]     = useState<string[]>(ALL_FIN_COLS.map(c => c.key));
  const [reasonsColKeys, setReasonsColKeys] = useState<string[]>(DEFAULT_REASONS_COLS);
  const [pickerOpen,     setPickerOpen]     = useState<'EXEC' | 'FIN' | 'REASONS' | null>(null);
  const [catalogCols,    setCatalogCols]    = useState<{ key: string; labelAr: string; labelEn: string; dataType?: string }[]>([]);

  // ── KPI drill-down drawer state (مغلقة لم تُفوتر) ───────────────────────
  const [kpiDrawerOpen,    setKpiDrawerOpen]    = useState(false);
  const [kpiDrawerRows,    setKpiDrawerRows]    = useState<any[]>([]);
  const [kpiDrawerLoading, setKpiDrawerLoading] = useState(false);
  const [kpiDrawerTotal,   setKpiDrawerTotal]   = useState(0);
  const [kpiColKeys,       setKpiColKeys]       = useState<string[]>(['orderNumber','regionNameAr','sectorNameAr','proc155CloseDate','invoiceNumber','estimatedValue','invoiceType','invoice1','invoice2','financialCloseDate','invoice2Number','approxValue']);
  const [kpiPickerOpen,    setKpiPickerOpen]    = useState(false);

  // ── KPI drill-down drawer state (مفوتر ولم يصدر له شهادة إنجاز) ──────────
  const [certDrawerOpen,    setCertDrawerOpen]    = useState(false);
  const [certDrawerRows,    setCertDrawerRows]    = useState<any[]>([]);
  const [certDrawerLoading, setCertDrawerLoading] = useState(false);
  const [certDrawerTotal,   setCertDrawerTotal]   = useState(0);
  const [certColKeys,       setCertColKeys]       = useState<string[]>(['orderNumber','regionNameAr','sectorNameAr','proc155CloseDate','invoiceNumber','invoiceType','invoice1','invoiceBillingDate','approxInvoice2','totalEst']);
  const [certPickerOpen,    setCertPickerOpen]    = useState(false);

  // ── Shared helper: build sorted availableCols for any drawer ────────────
  // catalog: already sort_order-sorted from API
  // nonVirtual: region/sector — inserted right after orderNumber
  // virtual: computed cols — appended at end
  // excluded: keys to remove from catalog (district, raw IDs, special keys)
  const buildDrawerCols = (
    catalog: { key: string; labelAr: string; labelEn: string; dataType?: string; virtual?: boolean }[],
    nonVirtual: { key: string; labelAr: string; labelEn: string; dataType?: string; virtual?: boolean }[],
    virtual: { key: string; labelAr: string; labelEn: string; dataType?: string; virtual?: boolean }[],
    excluded: Set<string>,
  ) => {
    const cats = catalog.filter(c => !excluded.has(c.key));
    const anchorIdx = cats.findIndex(c => c.key === 'orderNumber');
    const insertAt = anchorIdx >= 0 ? anchorIdx + 1 : 0;
    const result = [...cats];
    result.splice(insertAt, 0, ...nonVirtual);
    return [...result, ...virtual];
  };

  // ── KPI drill-down drawer state (شهادات الإنجاز المكتملة) ────────────────
  const COMP_CERT_MAX_COLS = 12;

  // الأعمدة الخاصة بهذا الـ drawer (غير موجودة في columnCatalog)
  const COMP_CERT_SPECIAL: { key: string; labelAr: string; labelEn: string; dataType: string; virtual?: boolean }[] = useMemo(() => [
    { key: 'regionNameAr',  labelAr: 'المنطقة',         labelEn: 'Region',         dataType: 'text' },
    { key: 'sectorNameAr',  labelAr: 'القطاع',           labelEn: 'Sector',         dataType: 'text' },
    { key: 'totalInvoiced', labelAr: 'الإجمالي المفوتر', labelEn: 'Total Invoiced', dataType: 'numeric', virtual: true },
  ], []);

  const compCertAvailableCols = useMemo(() =>
    buildDrawerCols(
      catalogCols,
      COMP_CERT_SPECIAL.filter((c: { virtual?: boolean }) => !c.virtual),
      COMP_CERT_SPECIAL.filter((c: { virtual?: boolean }) => c.virtual),
      new Set([...COMP_CERT_SPECIAL.map((c: { key: string }) => c.key), 'sectorId', 'regionId', 'district']),
    ),
  [catalogCols, COMP_CERT_SPECIAL]);

  const COMP_CERT_DEFAULT_KEYS = [
    'orderNumber', 'regionNameAr', 'sectorNameAr',
    'proc155CloseDate', 'invoiceNumber', 'invoiceType',
    'invoice1', 'invoice2', 'invoice2Number', 'totalInvoiced',
  ];

  const [compCertDrawerOpen,    setCompCertDrawerOpen]    = useState(false);
  const [compCertDrawerRows,    setCompCertDrawerRows]    = useState<any[]>([]);
  const [compCertDrawerLoading, setCompCertDrawerLoading] = useState(false);
  const [compCertDrawerTotal,   setCompCertDrawerTotal]   = useState(0);
  const [compCertColKeys,       setCompCertColKeys]       = useState<string[]>(COMP_CERT_DEFAULT_KEYS);
  const [compCertPickerOpen,    setCompCertPickerOpen]    = useState(false);

  // الأعمدة المرئية — بترتيب compCertColKeys (ترتيب القائمة في المودال)
  const compCertVisibleCols = useMemo(() =>
    compCertColKeys
      .map((key: string) => compCertAvailableCols.find((c: { key: string }) => c.key === key))
      .filter(Boolean) as { key: string; labelAr: string; labelEn: string; dataType?: string }[],
  [compCertColKeys, compCertAvailableCols]);

  // ── Column config: مغلقة لم تُفوتر ──────────────────────────────────────
  const KPI_MAX_COLS = 13;
  const KPI_SPECIAL = useMemo(() => [
    { key: 'regionNameAr', labelAr: 'المنطقة',            labelEn: 'Region',           dataType: 'text' },
    { key: 'sectorNameAr', labelAr: 'القطاع',              labelEn: 'Sector',           dataType: 'text' },
    { key: 'approxValue',  labelAr: 'غير مفوتر (تقريبي)',  labelEn: 'Approx. Unbilled', dataType: 'numeric', virtual: true },
  ], []);
  const kpiAvailableCols = useMemo(() =>
    buildDrawerCols(
      catalogCols,
      KPI_SPECIAL.filter((c: { virtual?: boolean }) => !c.virtual),
      KPI_SPECIAL.filter((c: { virtual?: boolean }) => c.virtual),
      new Set([...KPI_SPECIAL.map((c: { key: string }) => c.key), 'sectorId', 'regionId', 'district']),
    ),
  [catalogCols, KPI_SPECIAL]);
  const kpiVisibleCols = useMemo(() =>
    kpiColKeys
      .map((key: string) => kpiAvailableCols.find((c: { key: string }) => c.key === key))
      .filter(Boolean) as { key: string; labelAr: string; labelEn: string; dataType?: string; virtual?: boolean }[],
  [kpiColKeys, kpiAvailableCols]);

  // ── Column config: مفوتر ولم يصدر له شهادة إنجاز ─────────────────────────
  const CERT_MAX_COLS = 12;
  const CERT_SPECIAL = useMemo(() => [
    { key: 'regionNameAr',   labelAr: 'المنطقة',           labelEn: 'Region',        dataType: 'text' },
    { key: 'sectorNameAr',   labelAr: 'القطاع',             labelEn: 'Sector',        dataType: 'text' },
    { key: 'approxInvoice2', labelAr: 'م.2 (تقديري)',       labelEn: 'Inv.2 (Est.)', dataType: 'numeric', virtual: true },
    { key: 'totalEst',       labelAr: 'الإجمالي (تقديري)',  labelEn: 'Total (Est.)', dataType: 'numeric', virtual: true },
  ], []);
  const certAvailableCols = useMemo(() =>
    buildDrawerCols(
      catalogCols,
      CERT_SPECIAL.filter((c: { virtual?: boolean }) => !c.virtual),
      CERT_SPECIAL.filter((c: { virtual?: boolean }) => c.virtual),
      new Set([...CERT_SPECIAL.map((c: { key: string }) => c.key), 'sectorId', 'regionId', 'district']),
    ),
  [catalogCols, CERT_SPECIAL]);
  const certVisibleCols = useMemo(() =>
    certColKeys
      .map((key: string) => certAvailableCols.find((c: { key: string }) => c.key === key))
      .filter(Boolean) as { key: string; labelAr: string; labelEn: string; dataType?: string; virtual?: boolean }[],
  [certColKeys, certAvailableCols]);

  // ── Shared special cols for new KpiDrawers ───────────────────────────────
  const KD_REGION_SECTOR: KpiCol[] = useMemo(() => [
    { key: 'regionNameAr',  labelAr: 'المنطقة',  labelEn: 'Region',  dataType: 'text' },
    { key: 'sectorNameAr',  labelAr: 'القطاع',   labelEn: 'Sector',  dataType: 'text' },
  ], []);

  const KD_GENERAL_STATUS: KpiCol = { key: 'generalStatus', labelAr: 'الحالة', labelEn: 'Status', dataType: 'text', virtual: true };
  const KD_METRIC_DAYS:    KpiCol = { key: 'metricDays',    labelAr: 'المدة (يوم)', labelEn: 'Days', dataType: 'integer', virtual: true };

  // Base available cols for drawers — catalog sorted, region/sector after orderNumber, district excluded
  const kdBaseCols: KpiCol[] = useMemo(() =>
    buildDrawerCols(
      catalogCols,
      KD_REGION_SECTOR,
      [],
      new Set(['sectorId', 'regionId', 'district']),
    ) as KpiCol[],
  [catalogCols, KD_REGION_SECTOR]);

  // Status drawer
  const [statusDrawer, setStatusDrawer] = useState<{ status: string; rows: any[]; loading: boolean } | null>(null);
  const [statusDrawerColKeys, setStatusDrawerColKeys] = useState<string[]>([
    'orderNumber', 'regionNameAr', 'sectorNameAr', 'projectType', 'assignmentDate', 'generalStatus',
  ]);
  const statusDrawerAvailCols: KpiCol[] = useMemo(() => [
    ...kdBaseCols,
    KD_GENERAL_STATUS,
  ], [kdBaseCols]);

  // Metric drawer
  const [metricDrawer, setMetricDrawer] = useState<{ code: string; nameAr: string; nameEn: string | null; rows: any[]; loading: boolean } | null>(null);
  const [metricDrawerColKeys, setMetricDrawerColKeys] = useState<string[]>([
    'orderNumber', 'regionNameAr', 'sectorNameAr', 'projectType', 'assignmentDate', 'metricDays',
  ]);
  const metricDrawerAvailCols: KpiCol[] = useMemo(() => [
    ...kdBaseCols,
    KD_METRIC_DAYS,
  ], [kdBaseCols]);

  // Billing drawer
  const [billingDrawer, setBillingDrawer] = useState<{ type: 'partialBilled' | 'notFullyBilled'; rows: any[]; loading: boolean } | null>(null);
  const [billingDrawerColKeys, setBillingDrawerColKeys] = useState<string[]>([
    'orderNumber', 'regionNameAr', 'sectorNameAr', 'estimatedValue', 'invoiceType', 'invoice1', 'invoice2', 'collectedAmount',
  ]);
  const billingDrawerAvailCols: KpiCol[] = useMemo(() => kdBaseCols, [kdBaseCols]);

  // Pending survey drawer
  const [pendingSurveyDrawer, setPendingSurveyDrawer] = useState<{ rows: any[]; loading: boolean } | null>(null);
  const [pendingSurveyColKeys, setPendingSurveyColKeys] = useState<string[]>([
    'orderNumber', 'workType', 'sectorNameAr', 'regionNameAr', 'projectType', 'assignmentDate', 'surveyDate', 'coordinationDate', 'metricDays',
  ]);
  const KD_THRESHOLD: KpiCol = { key: 'thresholdDays', labelAr: 'الحد (يوم)', labelEn: 'SLA (d)', dataType: 'integer', virtual: true };
  const KD_STATUS_BADGE: KpiCol = { key: 'statusColor', labelAr: 'حالة التجاوز', labelEn: 'Status', dataType: 'text', virtual: true };
  const pendingSurveyAvailCols: KpiCol[] = useMemo(() => [...kdBaseCols, KD_METRIC_DAYS, KD_THRESHOLD, KD_STATUS_BADGE], [kdBaseCols]);

  // Pending coordination drawer
  const [pendingCoordDrawer, setPendingCoordDrawer] = useState<{ rows: any[]; loading: boolean } | null>(null);
  const [pendingCoordColKeys, setPendingCoordColKeys] = useState<string[]>([
    'orderNumber', 'workType', 'sectorNameAr', 'regionNameAr', 'projectType', 'assignmentDate', 'surveyDate', 'coordinationDate', 'metricDays',
  ]);
  const pendingCoordAvailCols: KpiCol[] = useMemo(() => [...kdBaseCols, KD_METRIC_DAYS, KD_THRESHOLD, KD_STATUS_BADGE], [kdBaseCols]);

  // ── Helper: build common query params from appliedFilters ───────────────
  const buildKdParams = useCallback((af: typeof appliedFilters) => {
    if (!af) return null;
    const p = new URLSearchParams();
    if (af.from) p.set('from', af.from);
    if (af.to)   p.set('to',   af.to);
    if (af.sectorId)    p.set('sectorId',    af.sectorId);
    if (af.regionId)    p.set('regionId',    af.regionId);
    if (af.projectType) p.set('projectType', af.projectType);
    if (af.dateBasisType !== 'CREATED_AT') {
      p.set('dateBasisType', af.dateBasisType);
      if (af.dateBasisColumnKey) p.set('dateBasisColumnKey', af.dateBasisColumnKey);
    }
    p.set('includeCompleted', String(includeCompleted));
    return p;
  }, [appliedFilters, includeCompleted]);

  // ── Open: status drawer ──────────────────────────────────────────────────
  const openStatusDrawer = useCallback(async (status: string) => {
    if (!appliedFilters) return;
    setStatusDrawer({ status, rows: [], loading: true });
    try {
      const p = buildKdParams(appliedFilters)!;
      p.set('status', status);
      const res = await api.get(`/reports/periodic-kpis/kpi-alerts/by-status?${p}`);
      setStatusDrawer({ status, rows: res.data.rows ?? [], loading: false });
    } catch (e) {
      console.error(e);
      setStatusDrawer({ status, rows: [], loading: false });
    }
  }, [appliedFilters, buildKdParams]);

  // ── Open: metric drawer ──────────────────────────────────────────────────
  const openMetricDrawer = useCallback(async (code: string, nameAr: string, nameEn: string | null, filter?: 'active' | 'completed' | 'all') => {
    if (!appliedFilters) return;
    setMetricDrawer({ code, nameAr, nameEn, rows: [], loading: true });
    try {
      const p = buildKdParams(appliedFilters)!;
      p.set('metricCode', code);
      if (filter && filter !== 'all') p.set('filter', filter);
      const res = await api.get(`/reports/periodic-kpis/kpi-alerts/metric-orders?${p}`);
      setMetricDrawer({ code, nameAr, nameEn, rows: res.data.rows ?? [], loading: false });
    } catch (e) {
      console.error(e);
      setMetricDrawer({ code, nameAr, nameEn, rows: [], loading: false });
    }
  }, [appliedFilters, buildKdParams]);

  // ── Open: billing drawer ─────────────────────────────────────────────────
  const openBillingDrawer = useCallback(async (type: 'partialBilled' | 'notFullyBilled') => {
    if (!appliedFilters) return;
    setBillingDrawer({ type, rows: [], loading: true });
    try {
      const p = buildKdParams(appliedFilters)!;
      p.set('type', type);
      const res = await api.get(`/reports/periodic-kpis/kpi-alerts/partial-billed-orders?${p}`);
      setBillingDrawer({ type, rows: res.data.rows ?? [], loading: false });
    } catch (e) {
      console.error(e);
      setBillingDrawer({ type, rows: [], loading: false });
    }
  }, [appliedFilters, buildKdParams]);

  // ── Open: pending survey drawer ─────────────────────────────────────────
  const openPendingSurveyDrawer = useCallback(async () => {
    if (!appliedFilters) return;
    setPendingSurveyDrawer({ rows: [], loading: true });
    try {
      const p = buildKdParams(appliedFilters)!;
      const res = await api.get(`/reports/periodic-kpis/kpi-alerts/pending-survey?${p}`);
      setPendingSurveyDrawer({ rows: res.data.rows ?? [], loading: false });
    } catch (e) {
      console.error(e);
      setPendingSurveyDrawer({ rows: [], loading: false });
    }
  }, [appliedFilters, buildKdParams]);

  // ── Open: pending coordination drawer ───────────────────────────────────
  const openPendingCoordDrawer = useCallback(async () => {
    if (!appliedFilters) return;
    setPendingCoordDrawer({ rows: [], loading: true });
    try {
      const p = buildKdParams(appliedFilters)!;
      const res = await api.get(`/reports/periodic-kpis/kpi-alerts/pending-coordination?${p}`);
      setPendingCoordDrawer({ rows: res.data.rows ?? [], loading: false });
    } catch (e) {
      console.error(e);
      setPendingCoordDrawer({ rows: [], loading: false });
    }
  }, [appliedFilters, buildKdParams]);

  // دوال التنسيق المشتركة بين الجدول والـ export
  const ccToSnake  = (s: string) => s.replace(/([A-Z])/g, '_$1').toLowerCase();
  const ccGetVal   = (row: any, key: string) => row[key] ?? row[ccToSnake(key)];
  const ccIsNum    = (col: { dataType?: string; key?: string }) =>
    ['numeric','integer','float','decimal'].includes(col.dataType ?? '') || col.key === 'totalInvoiced';
  const ccIsDate   = (col: { dataType?: string }) =>
    ['date','timestamp','timestamp with time zone'].includes(col.dataType ?? '');
  const ccFmtNum   = (v: any) => v != null && v !== '' ? Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';
  const ccFmtDate  = (v: any) => { try { return v ? new Date(v).toLocaleDateString('en-CA') : '—'; } catch { return '—'; } };
  const ccFmtCell  = (v: any, col: { dataType?: string; key?: string }) =>
    ccIsDate(col) ? ccFmtDate(v) : ccIsNum(col) ? ccFmtNum(v) : (v ?? '—');
  const certGetVal = (row: any, key: string) =>
    key === 'totalEst' ? (row.invoice1 != null ? row.invoice1 * 2 : null) : ccGetVal(row, key);

  const openCompletedWithCertDrawer = useCallback(async () => {
    if (!appliedFilters) return;
    setCompCertDrawerOpen(true);
    setCompCertDrawerLoading(true);
    try {
      const p = new URLSearchParams();
      if (appliedFilters.from) p.set('from', appliedFilters.from);
      if (appliedFilters.to)   p.set('to',   appliedFilters.to);
      if (appliedFilters.sectorId)    p.set('sectorId',    appliedFilters.sectorId);
      if (appliedFilters.regionId)    p.set('regionId',    appliedFilters.regionId);
      if (appliedFilters.projectType) p.set('projectType', appliedFilters.projectType);
      if (appliedFilters.dateBasisType !== 'CREATED_AT') {
        p.set('dateBasisType', appliedFilters.dateBasisType);
        if (appliedFilters.dateBasisColumnKey) p.set('dateBasisColumnKey', appliedFilters.dateBasisColumnKey);
      }
      const res = await api.get(`/reports/periodic-kpis/kpi-alerts/completed-with-cert?${p}`);
      setCompCertDrawerRows(res.data.rows ?? []);
      setCompCertDrawerTotal(res.data.totalValue ?? 0);
    } catch (e) { console.error(e); }
    finally { setCompCertDrawerLoading(false); }
  }, [appliedFilters]);

  const openInvoicedNoCertDrawer = useCallback(async () => {
    if (!appliedFilters) return;
    setCertDrawerOpen(true);
    setCertDrawerLoading(true);
    try {
      const p = new URLSearchParams();
      if (appliedFilters.from) p.set('from', appliedFilters.from);
      if (appliedFilters.to)   p.set('to',   appliedFilters.to);
      if (appliedFilters.sectorId)    p.set('sectorId',    appliedFilters.sectorId);
      if (appliedFilters.regionId)    p.set('regionId',    appliedFilters.regionId);
      if (appliedFilters.projectType) p.set('projectType', appliedFilters.projectType);
      if (appliedFilters.dateBasisType !== 'CREATED_AT') {
        p.set('dateBasisType', appliedFilters.dateBasisType);
        if (appliedFilters.dateBasisColumnKey) p.set('dateBasisColumnKey', appliedFilters.dateBasisColumnKey);
      }
      const res = await api.get(`/reports/periodic-kpis/kpi-alerts/invoiced-no-cert?${p}`);
      setCertDrawerRows(res.data.rows ?? []);
      setCertDrawerTotal(res.data.totalValue ?? 0);
    } catch (e) { console.error(e); }
    finally { setCertDrawerLoading(false); }
  }, [appliedFilters]);

  const openClosedNotInvoicedDrawer = useCallback(async () => {
    if (!appliedFilters) return;
    setKpiDrawerOpen(true);
    setKpiDrawerLoading(true);
    try {
      const p = new URLSearchParams();
      if (appliedFilters.from) p.set('from', appliedFilters.from);
      if (appliedFilters.to)   p.set('to',   appliedFilters.to);
      if (appliedFilters.sectorId)    p.set('sectorId',    appliedFilters.sectorId);
      if (appliedFilters.regionId)    p.set('regionId',    appliedFilters.regionId);
      if (appliedFilters.projectType) p.set('projectType', appliedFilters.projectType);
      if (appliedFilters.dateBasisType !== 'CREATED_AT') {
        p.set('dateBasisType', appliedFilters.dateBasisType);
        if (appliedFilters.dateBasisColumnKey) p.set('dateBasisColumnKey', appliedFilters.dateBasisColumnKey);
      }
      const res = await api.get(`/reports/periodic-kpis/kpi-alerts/closed-not-invoiced?${p}`);
      setKpiDrawerRows(res.data.rows ?? []);
      setKpiDrawerTotal(res.data.totalValue ?? 0);
    } catch (e) { console.error(e); }
    finally { setKpiDrawerLoading(false); }
  }, [appliedFilters]);

  // ── Load report header once (for PDF/Excel branding) ─────────────────────
  useEffect(() => {
    api.get('/admin/report-header').then(r => {
      const d = r.data;
      setReportHdr({
        logoRightUrl:        d.logoRightUrl        ?? null,
        logoLeftUrl:         d.logoLeftUrl         ?? null,
        companyNameAr:       d.companyNameAr       ?? null,
        companyNameEn:       d.companyNameEn       ?? null,
        logoRightWidthPdf:   d.logoRightWidthPdf   ?? 150,
        logoLeftWidthPdf:    d.logoLeftWidthPdf    ?? 150,
        logoRightWidthExcel: d.logoRightWidthExcel ?? 150,
        logoLeftWidthExcel:  d.logoLeftWidthExcel  ?? 150,
      });
    }).catch(() => {});
  }, []);

  // ── Load config once ─────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setLoadingConfig(true);
      try {
        const [configRes, execPrefs, finPrefs, reasonsPrefs, catalogRes] = await Promise.all([
          api.get('/reports/periodic-kpis/config'),
          api.get('/reports/periodic-kpis/column-prefs?reportKey=PERIODIC_KPI&tableKey=EXEC').catch(() => ({ data: { selectedColumnKeys: null } })),
          api.get('/reports/periodic-kpis/column-prefs?reportKey=PERIODIC_KPI&tableKey=FIN').catch(() => ({ data: { selectedColumnKeys: null } })),
          api.get('/reports/periodic-kpis/column-prefs?reportKey=PERIODIC_KPI&tableKey=REASONS').catch(() => ({ data: { selectedColumnKeys: null } })),
          api.get('/work-orders/table-columns').catch(() => ({ data: [] })),
        ]);
        const rawCatalog: any[] = Array.isArray(catalogRes.data)
          ? catalogRes.data
          : (catalogRes.data?.columns ?? []);
        setCatalogCols(rawCatalog.map(c => ({
          key: toCamelCase(c.columnKey ?? c.key ?? ''),
          labelAr: c.labelAr ?? c.label ?? '',
          labelEn: c.labelEn ?? c.label ?? '',
          dataType: c.dataType ?? c.type ?? '',
        })).filter(c => c.key));
        const cfg: Config = configRes.data;
        setConfig(cfg);
        if (execPrefs.data.selectedColumnKeys)    setExecColKeys(execPrefs.data.selectedColumnKeys);
        if (finPrefs.data.selectedColumnKeys)     setFinColKeys(finPrefs.data.selectedColumnKeys);
        if (reasonsPrefs.data.selectedColumnKeys) setReasonsColKeys(reasonsPrefs.data.selectedColumnKeys);

        const defMode = cfg.settings?.defaultDateRangeMode ?? 'month';
        const initPreset = (['week','lastweek','month','lastmonth','ytd','year'].includes(defMode)) ? defMode : 'month';
        const dr = defaultDateRange(defMode);
        setPreset(initPreset);
        const initial: Filters = {
          sectorId:          cfg.userScope.sectorId ?? user.sectorId ?? '',
          regionId:          cfg.userScope.regionId ?? user.regionId ?? '',
          projectType:       '',
          from:              dr.from,
          to:                dr.to,
          dateBasisType:     'CREATED_AT',
          dateBasisColumnKey:'',
        };
        setFilters(initial);
        setAppliedFilters(initial);
        setAuthorized(true);
      } catch (e: any) {
        if (e?.response?.status === 403) {
          setAuthorized(false);
        } else {
          console.error(e);
        }
      }
      finally { setLoadingConfig(false); }
    })();
  }, []);

  // ── Dynamic column lists built from catalog ───────────────────────────────
  const allExecCols: { key: string; labelAr: string; labelEn: string; virtual?: boolean }[] = useMemo(() => [
    { key: '_status', labelAr: 'الحالة', labelEn: 'Status', virtual: true },
    ...(catalogCols.map(c => ({ ...c, labelEn: c.labelEn || c.labelAr }))),
  ], [catalogCols]);

  const allFinCols: { key: string; labelAr: string; labelEn: string; virtual?: boolean }[] = useMemo(() => [
    { key: '_finStatus', labelAr: 'الحالة المالية', labelEn: 'Financial Status', virtual: true },
    ...(catalogCols.map(c => ({ ...c, labelEn: c.labelEn || c.labelAr }))),
  ], [catalogCols]);

  const allReasonsCols: { key: string; labelAr: string; labelEn: string; virtual?: boolean }[] = useMemo(() => 
    catalogCols.map(c => ({ ...c, labelEn: c.labelEn || c.labelAr })), 
  [catalogCols]);

  // ── Preset handler — updates from/to in filters automatically ────────────
  const handlePresetChange = (p: string) => {
    setPreset(p);
    if (p !== 'custom') {
      const dr = presetDateRange(p);
      setFilters(prev => ({ ...prev, from: dr.from, to: dr.to }));
    }
  };

  // ── Query string builder ──────────────────────────────────────────────────
  const buildQS = (f: Filters, incCompleted: boolean) => {
    const p = new URLSearchParams();
    if (f.sectorId)    p.set('sectorId',    f.sectorId);
    if (f.regionId)    p.set('regionId',    f.regionId);
    if (f.projectType) p.set('projectType', f.projectType);
    if (f.from) p.set('from', f.from);
    if (f.to)   p.set('to',   f.to);
    if (f.dateBasisType && f.dateBasisType !== 'CREATED_AT') {
      p.set('dateBasisType', f.dateBasisType);
      if (f.dateBasisColumnKey) p.set('dateBasisColumnKey', f.dateBasisColumnKey);
    }
    p.set('includeCompleted', String(incCompleted));
    return p.toString();
  };

  const fetchData = useCallback(async (f: Filters, incCompleted: boolean) => {
    const qs = buildQS(f, incCompleted);
    setLoadingSummary(true); setLoadingRegions(true);
    try {
      const [sumRes, regRes] = await Promise.all([
        api.get(`/reports/periodic-kpis/summary?${qs}`),
        api.get(`/reports/periodic-kpis/regions?${qs}`),
      ]);
      setSummary(sumRes.data);
      setRegionCards(regRes.data);
    } catch (e) { console.error(e); }
    finally { setLoadingSummary(false); setLoadingRegions(false); }
  }, []);

  useEffect(() => {
    if (appliedFilters) fetchData(appliedFilters, includeCompleted);
  }, [appliedFilters, fetchData, includeCompleted]);

  const fetchDetails = useCallback(async (region: RegionCard, f: Filters, incCompleted: boolean) => {
    setLoadingDetails(true); setRegionDetails(null);
    try {
      const p = new URLSearchParams();
      if (f.projectType) p.set('projectType', f.projectType);
      if (f.from) p.set('from', f.from);
      if (f.to)   p.set('to',   f.to);
      if (f.dateBasisType !== 'CREATED_AT') {
        p.set('dateBasisType', f.dateBasisType);
        if (f.dateBasisColumnKey) p.set('dateBasisColumnKey', f.dateBasisColumnKey);
      }
      p.set('includeCompleted', String(incCompleted));
      const res = await api.get(`/reports/periodic-kpis/region/${region.id}/details?${p}`);
      setRegionDetails(res.data);
    } catch (e) { console.error(e); }
    finally { setLoadingDetails(false); }
  }, []);

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleRegionClick = (region: RegionCard) => {
    setExpandedRegion(region);
    if (appliedFilters) fetchDetails(region, appliedFilters, includeCompleted);
  };

  const handleApply = () => {
    setExpandedRegion(null); setRegionDetails(null);
    setAppliedFilters({ ...filters });
  };

  const handleReset = () => {
    if (!config) return;
    const defMode = config.settings?.defaultDateRangeMode ?? 'month';
    const dr = defaultDateRange(defMode);
    const p = (['week','lastweek','month','lastmonth','ytd','year'].includes(defMode)) ? defMode : 'month';
    setPreset(p);
    const reset: Filters = {
      sectorId: config.userScope.sectorId ?? '',
      regionId: config.userScope.regionId ?? '',
      projectType: '', from: dr.from, to: dr.to,
      dateBasisType: 'CREATED_AT', dateBasisColumnKey: '',
    };
    setFilters(reset); setAppliedFilters(reset);
    setExpandedRegion(null); setRegionDetails(null);
    setViewMode('all'); setSearchText('');
    setIncludeCompleted(true);
  };

  const saveColPrefs = async (tableKey: 'EXEC' | 'FIN' | 'REASONS', keys: string[]) => {
    if (tableKey === 'EXEC')        setExecColKeys(keys);
    else if (tableKey === 'FIN')    setFinColKeys(keys);
    else                            setReasonsColKeys(keys);
    try {
      await api.put('/reports/periodic-kpis/column-prefs', {
        reportKey: 'PERIODIC_KPI', tableKey, selectedColumnKeys: keys,
      });
    } catch { /* silent */ }
  };

  // ── Export helpers ────────────────────────────────────────────────────────
  const handleExportExcel = () => {
    const en = lang === 'en';
    const rn = (r: RegionCard) => (en && r.nameEn ? r.nameEn : r.nameAr);
    const sn = (r: RegionCard) => (en && r.sectorNameEn ? r.sectorNameEn : r.sectorNameAr ?? '');
    const mn = (m: MetricResult) => (en && m.nameEn ? m.nameEn : m.nameAr);

    const allMetrics = summary?.metricsAverages?.filter(m => m.avgDays != null) ?? [];
    const timeDiff   = allMetrics.filter(m => m.metricType !== 'NUMERIC_AGG');
    const numeric    = allMetrics.filter(m => m.metricType === 'NUMERIC_AGG');

    const rows: (string | number)[][] = [];

    rows.push([en ? 'Periodic Performance Report' : 'تقرير مؤشرات الأداء الدوري']);
    rows.push([en ? 'Period:' : 'الفترة:', `${appliedFilters?.from ?? ''} — ${appliedFilters?.to ?? ''}`]);
    if (appliedFilters?.dateBasisType) rows.push([en ? 'Date Basis:' : 'أساس التاريخ:', appliedFilters.dateBasisType]);
    rows.push([]);

    rows.push([en ? '── SUMMARY ──' : '── الملخص الإجمالي ──']);
    rows.push([en ? 'Total' : 'الإجمالي', en ? 'Overdue' : 'متأخر', en ? 'Warning' : 'تنبيه', en ? 'On Track' : 'منتظم', en ? 'Done' : 'منجز']);
    rows.push([summary?.total ?? '', summary?.overdue ?? '', summary?.warning ?? '', summary?.onTime ?? '', summary?.completed ?? '']);
    rows.push([]);

    if (timeDiff.length > 0) {
      rows.push([en ? '── PERFORMANCE TIME AVERAGES ──' : '── متوسطات الأداء الزمنية ──']);
      rows.push(timeDiff.map(m => mn(m)));
      rows.push(timeDiff.map(m => m.avgDays != null ? `${m.avgDays} ${en ? 'days' : 'يوم'}` : '—'));
      rows.push([]);
    }
    if (numeric.length > 0) {
      rows.push([en ? '── QUANTITY INDICATORS ──' : '── مؤشرات كمية ──']);
      rows.push(numeric.map(m => `${mn(m)} (${m.aggFunction ?? ''})`));
      rows.push(numeric.map(m => m.avgDays != null ? m.avgDays.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'));
      rows.push([]);
    }

    rows.push([en ? '── REGIONS DETAIL ──' : '── تفاصيل المناطق ──']);
    const metricCols = allMetrics.map(m =>
      m.metricType === 'NUMERIC_AGG' ? `${mn(m)} (${m.aggFunction ?? ''})` : `${mn(m)} (${en ? 'days' : 'يوم'})`
    );
    rows.push([
      ...(en
        ? ['Region', 'Sector', 'Total', 'Active', 'Overdue', 'Overdue (Justified)', 'Warning', 'On Track', 'Done']
        : ['المنطقة', 'القطاع', 'الإجمالي', 'نشطة', 'متأخر', 'متأخر مسبب', 'تنبيه', 'منتظم', 'منجز']),
      ...metricCols,
    ]);
    visibleRegionCards.forEach(r => {
      const regionMetrics = allMetrics.map(m => {
        const rm = r.metricsAverages?.find(rm2 => rm2.code === m.code);
        return rm?.avgDays != null ? rm.avgDays : '—';
      });
      rows.push([rn(r), sn(r), r.total, r.active, r.execDelayedUnjustified ?? r.overdue, r.execDelayedJustified ?? 0, r.warning, r.onTime, r.completed, ...regionMetrics]);
    });

    const csv = rows.map(row => row.map(cell => String(cell ?? '')).join('\t')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `${en ? 'Performance_Report' : 'تقرير_الأداء'}_${appliedFilters?.from ?? ''}_${appliedFilters?.to ?? ''}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const handlePrint = () => window.print();

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href).catch(() => {});
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  // ── Derived / filtered data ───────────────────────────────────────────────
  const visibleRegionCards = useMemo(() => {
    let cards = regionCards;
    if (hideEmpty)             cards = cards.filter(r => r.total > 0);
    if (searchText.trim())     cards = cards.filter(r =>
      r.nameAr.includes(searchText) || (r.sectorNameAr ?? '').includes(searchText));
    switch (viewMode) {
      case 'active':    cards = cards.filter(r => r.active    > 0); break;
      case 'overdue':   cards = cards.filter(r => r.overdue   > 0); break;
      case 'warning':   cards = cards.filter(r => r.warning   > 0); break;
      case 'ontime':    cards = cards.filter(r => r.onTime    > 0); break;
      case 'completed': cards = cards.filter(r => r.completed > 0); break;
    }
    return cards;
  }, [regionCards, hideEmpty, searchText, viewMode]);

  const visibleRegions = useMemo(() => {
    if (!config) return [];
    if (filters.sectorId) return config.regions.filter(r => r.sectorId === filters.sectorId);
    return config.regions;
  }, [config, filters.sectorId]);

  const finEnabled = config?.finRule?.isEnabled ?? false;
  const hasMetrics = (summary?.metricsAverages && summary.metricsAverages.some(m => m.avgDays != null)) || !!summary?.kpiAlerts;

  // ── Metric notes — MUST be before any early return ────────────────────────
  const noteByCode: Record<string, string> = React.useMemo(() => {
    if (!config?.metrics?.length) return {};
    const out: Record<string, string> = {};
    for (const m of config.metrics) {
      const note = buildMetricNote(m.code, config.metrics, config.dateColumns ?? [], config.stages ?? [], lang, null);
      if (note) out[m.code] = note;
    }
    return out;
  }, [config, lang]);

  // ── Loading screen ────────────────────────────────────────────────────────
  if (loadingConfig) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 gap-3" dir={lang === 'en' ? 'ltr' : 'rtl'}>
        <RefreshCw className="w-5 h-5 animate-spin" />
        <span>{lang === 'en' ? 'Loading report settings...' : 'جاري تحميل إعدادات التقرير...'}</span>
      </div>
    );
  }

  // ── Unauthorized screen ───────────────────────────────────────────────────
  if (authorized === false) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4" dir={lang === 'en' ? 'ltr' : 'rtl'}>
        <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
          <XCircle className="w-8 h-8 text-red-500" />
        </div>
        <h2 className="text-xl font-bold text-slate-700">
          {lang === 'en' ? 'Unauthorized Access' : 'وصول غير مصرح به'}
        </h2>
        <p className="text-slate-500 text-sm text-center max-w-md">
          {lang === 'en'
            ? 'You do not have permission to view the Periodic KPI Report. Please contact your administrator.'
            : 'ليس لديك صلاحية لعرض تقرير الأداء الدوري. يرجى التواصل مع مشرف النظام.'}
        </p>
      </div>
    );
  }

  // ── Shared input class ────────────────────────────────────────────────────
  const selectCls = 'w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-indigo-400 outline-none';

  return (
    <MetricCfgCtx.Provider value={{ noteByCode }}>
    <div className="min-h-screen bg-slate-50" dir={lang === 'en' ? 'ltr' : 'rtl'}>
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-6 space-y-5">

        {/* ══ PAGE HEADER ════════════════════════════════════════════════════ */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-800">{lang === 'en' ? 'Periodic Performance' : 'مؤشرات الأداء الدوري'}</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {lang === 'en' ? 'Project status report based on periodic SLA settings' : 'تقرير حالات المشاريع بحسب إعدادات SLA الدوري'}
              {appliedFilters?.from && (
                <span className="text-indigo-500 mx-2">
                  · {appliedFilters.from} — {appliedFilters.to}
                </span>
              )}
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              data-testid="button-copy-link"
              onClick={handleCopyLink}
              title={lang === 'en' ? 'Copy report link' : 'نسخ رابط التقرير'}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm border transition-colors ${
                copySuccess
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                  : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-400 hover:text-indigo-600'
              }`}
            >
              <Link2 className="w-4 h-4" />
              {copySuccess ? (lang === 'en' ? 'Copied' : 'تم النسخ') : (lang === 'en' ? 'Copy Link' : 'حفظ الرابط')}
            </button>
            <button
              data-testid="button-print-pdf"
              onClick={handlePrint}
              className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-600 hover:border-rose-400 hover:text-rose-600 transition-colors"
            >
              <Printer className="w-4 h-4" />
              {lang === 'en' ? 'PDF for Meeting' : 'PDF للاجتماع'}
            </button>
            <button
              data-testid="button-export-excel"
              onClick={handleExportExcel}
              disabled={!regionCards.length}
              className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-600 hover:border-emerald-400 hover:text-emerald-600 transition-colors disabled:opacity-40"
            >
              <Download className="w-4 h-4" />
              {lang === 'en' ? 'Export Excel' : 'Excel تصدير'}
            </button>
            <button
              data-testid="button-refresh"
              onClick={() => appliedFilters && fetchData(appliedFilters, includeCompleted)}
              disabled={loadingSummary || loadingRegions}
              className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-600 hover:border-indigo-400 hover:text-indigo-600 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loadingSummary ? 'animate-spin' : ''}`} />
              {lang === 'en' ? 'Refresh' : 'تحديث'}
            </button>
          </div>
        </div>

        {/* ══ FILTER BAR ═════════════════════════════════════════════════════ */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">

          {/* Row 1 — Temporal filters */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 items-end">

            {/* Preset */}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1 flex items-center gap-1">
                <Calendar className="w-3 h-3" /> {lang === 'en' ? 'Period' : 'الفترة'}
              </label>
              <select
                data-testid="filter-preset"
                value={preset}
                onChange={e => handlePresetChange(e.target.value)}
                className={selectCls}
              >
                {PRESETS.map(p => <option key={p.value} value={p.value}>{lang === 'en' ? p.labelEn : p.labelAr}</option>)}
              </select>
            </div>

            {/* From */}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">{lang === 'en' ? 'From' : 'من'}</label>
              <input
                type="date"
                data-testid="filter-from"
                value={filters.from}
                disabled={preset !== 'custom'}
                onChange={e => setFilters(p => ({ ...p, from: e.target.value }))}
                className={`${selectCls} ${preset !== 'custom' ? 'bg-slate-50 text-slate-400 cursor-not-allowed' : ''}`}
              />
            </div>

            {/* To */}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">{lang === 'en' ? 'To' : 'إلى'}</label>
              <input
                type="date"
                data-testid="filter-to"
                value={filters.to}
                disabled={preset !== 'custom'}
                onChange={e => setFilters(p => ({ ...p, to: e.target.value }))}
                className={`${selectCls} ${preset !== 'custom' ? 'bg-slate-50 text-slate-400 cursor-not-allowed' : ''}`}
              />
            </div>

            {/* Date Basis */}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">{lang === 'en' ? 'Date Basis' : 'أساس التاريخ'}</label>
              <select
                data-testid="filter-date-basis"
                value={filters.dateBasisType === 'CREATED_AT' ? '__CREATED_AT' : (filters.dateBasisColumnKey ?? '')}
                onChange={e => {
                  const v = e.target.value;
                  if (v === '__CREATED_AT') {
                    setFilters(p => ({ ...p, dateBasisType: 'CREATED_AT', dateBasisColumnKey: '' }));
                  } else {
                    setFilters(p => ({ ...p, dateBasisType: 'COLUMN_DATE', dateBasisColumnKey: v }));
                  }
                }}
                className={selectCls}
              >
                <option value="__CREATED_AT">{lang === 'en' ? 'Creation Date' : 'تاريخ الإنشاء'}</option>
                {config?.dateColumns.map(c => (
                  <option key={c.columnKey} value={c.columnKey}>{lang === 'en' && c.labelEn ? c.labelEn : c.labelAr}</option>
                ))}
              </select>
            </div>

          </div>

          {/* Row 2 — Scope filters + search + actions */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 items-end">

            {/* Sector */}
            {!config?.userScope.sectorId && (
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">{lang === 'en' ? 'Sector' : 'القطاع'}</label>
                <select
                  data-testid="filter-sector"
                  value={filters.sectorId}
                  onChange={e => setFilters(p => ({ ...p, sectorId: e.target.value, regionId: '' }))}
                  className={selectCls}
                >
                  <option value="">{lang === 'en' ? 'All Sectors' : 'كل القطاعات'}</option>
                  {config?.sectors.map(s => <option key={s.id} value={s.id}>{lang === 'en' && s.nameEn ? s.nameEn : s.nameAr}</option>)}
                </select>
              </div>
            )}

            {/* Region */}
            {!config?.userScope.regionId && (
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">{lang === 'en' ? 'Region' : 'المنطقة'}</label>
                <select
                  data-testid="filter-region"
                  value={filters.regionId}
                  onChange={e => setFilters(p => ({ ...p, regionId: e.target.value }))}
                  className={selectCls}
                >
                  <option value="">{lang === 'en' ? 'All Regions' : 'كل المناطق'}</option>
                  {visibleRegions.map(r => <option key={r.id} value={r.id}>{lang === 'en' && r.nameEn ? r.nameEn : r.nameAr}</option>)}
                </select>
              </div>
            )}

            {/* Project Type */}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">{lang === 'en' ? 'Project Type' : 'نوع المشروع'}</label>
              <select
                data-testid="filter-project-type"
                value={filters.projectType}
                onChange={e => setFilters(p => ({ ...p, projectType: e.target.value }))}
                className={selectCls}
              >
                <option value="">{lang === 'en' ? 'All Types' : 'كل الأنواع'}</option>
                {config?.projectTypes.map(pt => (
                  <option key={pt.value} value={pt.value}>{lang === 'en' && pt.labelEn ? pt.labelEn : pt.labelAr}</option>
                ))}
              </select>
            </div>

            {/* View Mode */}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">{lang === 'en' ? 'Display Mode' : 'طريقة العرض'}</label>
              <select
                data-testid="filter-view-mode"
                value={viewMode}
                onChange={e => setViewMode(e.target.value)}
                className={selectCls}
              >
                {VIEW_MODES.map(v => <option key={v.value} value={v.value}>{lang === 'en' ? v.labelEn : v.labelAr}</option>)}
              </select>
            </div>

            {/* Search */}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">{lang === 'en' ? 'Search' : 'بحث'}</label>
              <div className="relative">
                <Search className={`absolute ${lang === 'en' ? 'left-3' : 'right-3'} top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none`} />
                <input
                  type="text"
                  data-testid="filter-search"
                  value={searchText}
                  onChange={e => setSearchText(e.target.value)}
                  placeholder={lang === 'en' ? 'Region name...' : 'اسم المنطقة...'}
                  className={`w-full ${lang === 'en' ? 'pl-9 pr-3' : 'pr-9 pl-3'} py-2 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-indigo-400 outline-none`}
                />
              </div>
            </div>

            {/* Apply + Reset */}
            <div className="flex gap-2">
              <button
                data-testid="button-apply-filters"
                onClick={handleApply}
                className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm hover:bg-indigo-700 font-medium transition-colors"
              >
                {lang === 'en' ? 'Apply' : 'تطبيق'}
              </button>
              <button
                data-testid="button-reset-filters"
                onClick={handleReset}
                title={lang === 'en' ? 'Reset' : 'إعادة تعيين'}
                className="px-3 py-2 border border-slate-200 text-slate-500 rounded-xl text-sm hover:bg-slate-50 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Row 3 — تضمين الحالات */}
          <div className="flex flex-wrap items-center gap-4 pt-1 border-t border-slate-100">
            <span className="text-xs font-medium text-slate-500 shrink-0">{lang === 'en' ? 'Include Status:' : 'تضمين الحالات:'}</span>
            {[
              { key: 'includeCompleted', label: lang === 'en' ? 'Completed' : 'المنجزة',  value: includeCompleted, set: setIncludeCompleted },
            ].map(({ key, label, value, set }) => (
              <label key={key} data-testid={`checkbox-${key}`}
                className={`flex items-center gap-2 cursor-pointer px-3 py-1.5 rounded-lg border transition-colors text-sm ${
                  value ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                }`}>
                <input
                  type="checkbox"
                  checked={value}
                  onChange={e => set(e.target.checked)}
                  className="w-3.5 h-3.5 accent-indigo-600"
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        {/* ══ SUMMARY CARDS ══════════════════════════════════════════════════ */}
        {loadingSummary ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-slate-200 bg-white h-24 animate-pulse" />
            ))}
          </div>
        ) : summary && (
          <>
            {/* Cards — RTL order (first HTML = rightmost): متأخرة · تنبيه · منتظمة · منجزة · الإجمالي */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {/* Each card shows a unique-WO count (generalStatus). execVal/finVal are informational breakdown only. */}
              <StatCard
                label={lang === 'en' ? 'Overdue' : 'متأخرة'}
                value={summary.overdue}
                icon={AlertTriangle}
                colorCls={summary.overdue > 0 ? 'border-red-200 bg-red-50/30' : 'border-slate-200'}
                execVal={summary.finEnabled ? summary.execBreakdown?.overdue : undefined}
                finVal={summary.finEnabled ? summary.finCounts?.overdue : undefined}
                onClick={() => openStatusDrawer('OVERDUE')}
              />
              <StatCard
                label={lang === 'en' ? 'Warning' : 'تنبيه'}
                value={summary.warning}
                icon={Clock}
                colorCls={summary.warning > 0 ? 'border-amber-200 bg-amber-50/30' : 'border-slate-200'}
                execVal={summary.finEnabled ? summary.execBreakdown?.warning : undefined}
                finVal={summary.finEnabled ? summary.finCounts?.warning : undefined}
                onClick={() => openStatusDrawer('WARNING')}
              />
              <StatCard
                label={lang === 'en' ? 'On Track' : 'منتظمة'}
                value={summary.onTime}
                icon={CheckCircle2}
                colorCls="border-emerald-50"
                execVal={summary.finEnabled ? summary.execBreakdown?.onTime : undefined}
                finVal={summary.finEnabled ? summary.finCounts?.onTime : undefined}
                onClick={() => openStatusDrawer('ON_TIME')}
              />
              <StatCard
                label={lang === 'en' ? 'Done' : 'منجزة'}
                value={summary.completed}
                icon={CheckCircle2}
                colorCls="border-emerald-100"
                execVal={summary.finEnabled ? summary.execBreakdown?.completed : undefined}
                finVal={summary.finEnabled ? summary.finCounts?.completed : undefined}
                onClick={() => openStatusDrawer('COMPLETED')}
              />
              <StatCard
                label={lang === 'en' ? 'Total Period' : 'الإجمالي ضمن الفترة'}
                value={summary.total}
                icon={BarChart2}
                execVal={summary.finEnabled ? summary.total - (summary.finCounts?.total ?? 0) : undefined}
                finVal={summary.finEnabled ? (summary.finCounts?.total ?? 0) : undefined}
                onClick={() => openStatusDrawer('ALL')}
              />
            </div>

            {/* Billing counts badges */}
            {summary.billingCounts && summary.billingCounts.partialBilled > 0 && (
              <div className="flex flex-wrap gap-3">
                <div
                  className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-2.5 shadow-sm cursor-pointer hover:ring-2 hover:ring-indigo-300 transition-shadow"
                  onClick={() => openBillingDrawer('partialBilled')}
                >
                  <span className="text-xl font-bold text-indigo-700">{summary.billingCounts.partialBilled}</span>
                  <span className="text-xs font-medium text-indigo-600">{lang === 'en' ? 'Partially Billed' : 'مفوتر جزئياً'}</span>
                </div>
              </div>
            )}

            {/* Metrics averages — DATE_DIFF and NUMERIC_AGG */}
            {hasMetrics && (() => {
              const dateDiff   = (summary.metricsAverages ?? []).filter(m => m.avgDays != null && m.metricType !== 'NUMERIC_AGG');
              const numericAgg = (summary.metricsAverages ?? []).filter(m => m.avgDays != null && m.metricType === 'NUMERIC_AGG');
              return (
                <div className="space-y-4">
                  {dateDiff.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Clock className="w-3.5 h-3.5 text-indigo-400" />
                        <span className="text-xs font-semibold text-slate-500">{lang === 'en' ? 'Performance Time Averages' : 'متوسطات الأداء الزمنية'}</span>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 items-stretch">
                        {(() => {
                          const cards: React.ReactElement[] = [];
                          for (const m of dateDiff) {
                            cards.push(<div key={m.code}><MetricCard m={m} onClick={() => openMetricDrawer(m.code, m.nameAr, m.nameEn ?? null)} /></div>);
                            if (m.code === 'SURVEY' && summary.kpiAlerts?.unSurveyed && summary.kpiAlerts.unSurveyed.count > 0) {
                              cards.push(<div key="PENDING_SURVEY"><MetricCard
                                m={{ code: 'PENDING_SURVEY', nameAr: 'غير الممسوحة', nameEn: 'Unsurveyed', metricType: 'DATE_DIFF', aggFunction: null, avgDays: summary.kpiAlerts.unSurveyed.avgDays, totalDays: 0, count: summary.kpiAlerts.unSurveyed.count, thresholdDays: summary.kpiAlerts.unSurveyed.thresholdDays, statusColor: summary.kpiAlerts.unSurveyed.statusColor }}
                                onClick={openPendingSurveyDrawer}
                              /></div>);
                            }
                            if (m.code === 'COORDINATION' && summary.kpiAlerts?.unCoordinated && summary.kpiAlerts.unCoordinated.count > 0) {
                              cards.push(<div key="PENDING_COORD"><MetricCard
                                m={{ code: 'PENDING_COORD', nameAr: 'غير المنسقة', nameEn: 'Uncoordinated', metricType: 'DATE_DIFF', aggFunction: null, avgDays: summary.kpiAlerts.unCoordinated.avgDays, totalDays: 0, count: summary.kpiAlerts.unCoordinated.count, thresholdDays: summary.kpiAlerts.unCoordinated.thresholdDays, statusColor: summary.kpiAlerts.unCoordinated.statusColor }}
                                onClick={openPendingCoordDrawer}
                              /></div>);
                            }
                          }
                          return cards;
                        })()}
                      </div>
                    </div>
                  )}
                  {(numericAgg.length > 0 || !!summary.kpiAlerts) && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <BarChart2 className="w-3.5 h-3.5 text-violet-400" />
                        <span className="text-xs font-semibold text-slate-500">{lang === 'en' ? 'Quantity Indicators' : 'مؤشرات كمية'}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-4 items-stretch">
                        {numericAgg.map(m => {
                          // SUM metrics with split data → render two length cards
                          if (m.aggFunction === 'SUM' && m.activeTotal != null && m.completedTotal != null) {
                            const fmtLen = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 1 });
                            const activeName    = lang === 'en' ? 'Incomplete Length (m)' : 'إجمالي الأطوال غير المنجزة';
                            const completedName = lang === 'en' ? 'Completed Length (m)'  : 'إجمالي الأطوال المكتملة';
                            return (
                              <React.Fragment key={m.code}>
                                {/* غير المنجزة — no proc155 */}
                                <div>
                                  <button
                                    onClick={() => openMetricDrawer(m.code, activeName, lang === 'en' ? 'Incomplete Length' : null, 'active')}
                                    className="w-full text-right rounded-xl border border-indigo-200 bg-white shadow-sm p-4 flex flex-col gap-1.5 h-full cursor-pointer hover:ring-2 hover:ring-indigo-300 transition-shadow hover:shadow-md"
                                  >
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-semibold text-slate-600">{activeName}</span>
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        {/* ! tooltip — no proc155 date */}
                                        <span className="relative group">
                                          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-slate-300 bg-slate-100 text-slate-500 text-[10px] font-bold cursor-help leading-none">!</span>
                                          <span className="pointer-events-none absolute z-50 bottom-full mb-2 right-0 w-60 bg-slate-800 text-white text-[11px] leading-snug rounded-lg px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity shadow-xl whitespace-normal" dir="rtl">
                                            {lang === 'en' ? 'Orders without a procedure 155 date' : 'تعني أن أمر العمل لا يحتوي على تاريخ إجراء 155'}
                                            <span className="absolute top-full right-2 border-4 border-transparent border-t-slate-800" />
                                          </span>
                                        </span>
                                        <BarChart2 className="w-3.5 h-3.5 text-indigo-300" />
                                      </div>
                                    </div>
                                    <div className="text-2xl font-bold text-indigo-700">{fmtLen(m.activeTotal)}</div>
                                    <div className="text-xs text-slate-400">{m.activeCount ?? 0} {lang === 'en' ? 'orders' : 'أمر'}</div>
                                    <div className="mt-auto pt-1">
                                      <span className="text-[10px] text-slate-400 underline underline-offset-2">{lang === 'en' ? 'Click to view details' : 'اضغط لعرض التفاصيل'}</span>
                                    </div>
                                  </button>
                                </div>
                                {/* المكتملة — with proc155 */}
                                <div>
                                  <button
                                    onClick={() => openMetricDrawer(m.code, completedName, lang === 'en' ? 'Completed Length' : null, 'completed')}
                                    className="w-full text-right rounded-xl border border-indigo-200 bg-white shadow-sm p-4 flex flex-col gap-1.5 h-full cursor-pointer hover:ring-2 hover:ring-indigo-300 transition-shadow hover:shadow-md"
                                  >
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-semibold text-slate-600">{completedName}</span>
                                      <BarChart2 className="w-3.5 h-3.5 text-indigo-300 shrink-0" />
                                    </div>
                                    <div className="text-2xl font-bold text-indigo-700">{fmtLen(m.completedTotal)}</div>
                                    <div className="text-xs text-slate-400">{m.completedCount ?? 0} {lang === 'en' ? 'orders' : 'أمر'}</div>
                                    <div className="mt-auto pt-1">
                                      <span className="text-[10px] text-slate-400 underline underline-offset-2">{lang === 'en' ? 'Click to view details' : 'اضغط لعرض التفاصيل'}</span>
                                    </div>
                                  </button>
                                </div>
                              </React.Fragment>
                            );
                          }
                          // All other NUMERIC_AGG (AVG, MIN, MAX) → standard card
                          return <div key={m.nameAr}><MetricCard m={m} onClick={() => openMetricDrawer(m.code, m.nameAr, m.nameEn ?? null)} /></div>;
                        })}
                        {/* كرت: مغلقة لم تُفوتر */}
                        {summary.kpiAlerts && (
                          <div>
                            <button
                              onClick={openClosedNotInvoicedDrawer}
                              className={`w-full text-right rounded-xl border p-4 flex flex-col gap-1 bg-white shadow-sm h-full transition-shadow hover:shadow-md cursor-pointer ${
                                summary.kpiAlerts.closedNotInvoiced > 0 ? 'border-indigo-200 bg-indigo-50/30 hover:border-indigo-300' : 'border-slate-200 hover:border-slate-300'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1">
                                  <span className="text-xs font-medium text-slate-500">{lang === 'en' ? 'Closed w/o Invoice' : 'مغلقة لم تُفوتر'}</span>
                                  <span className="relative group shrink-0">
                                    <svg className="w-3.5 h-3.5 text-slate-300 hover:text-indigo-400 cursor-help transition-colors" viewBox="0 0 20 20" fill="currentColor">
                                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                    </svg>
                                    <span className="pointer-events-none absolute z-50 bottom-full mb-2 right-0 w-60 bg-slate-800 text-white text-[11px] leading-snug rounded-lg px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity shadow-xl whitespace-normal" dir="rtl">
                                      {lang === 'en'
                                        ? 'Work orders where: 155 procedure date exists · not cancelled · invoice 1 value is still zero'
                                        : 'أوامر العمل التي:\n• تاريخ إجراء 155 موجود\n• ليست ملغية\n• قيمة م.1 لا تزال صفراً (نهائي وجزئي)'}
                                      <span className="absolute top-full right-2 border-4 border-transparent border-t-slate-800" />
                                    </span>
                                  </span>
                                </div>
                                <FileX2 className={`w-4 h-4 ${summary.kpiAlerts.closedNotInvoiced > 0 ? 'text-indigo-400' : 'text-slate-300'}`} />
                              </div>
                              <div className={`text-2xl font-bold ${summary.kpiAlerts.closedNotInvoiced > 0 ? 'text-indigo-600' : 'text-slate-400'}`}>
                                {summary.kpiAlerts.closedNotInvoiced}
                              </div>
                              <div className="text-xs text-slate-400">{lang === 'en' ? 'work orders' : 'أمر عمل'}</div>
                              {summary.kpiAlerts.closedNotInvoiced > 0 && summary.kpiAlerts.closedNotInvoicedValue > 0 && (
                                <div className="mt-1 pt-1 border-t border-indigo-100">
                                  <span className="text-xs font-semibold text-indigo-500">
                                    ~{summary.kpiAlerts.closedNotInvoicedValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                                  </span>
                                  <span className="text-[10px] text-slate-400 mr-1">{lang === 'en' ? 'SAR (est.)' : 'ر.س (تقريبي)'}</span>
                                </div>
                              )}
                              <div className="mt-auto pt-1">
                                <span className="text-[10px] text-slate-400 underline underline-offset-2">{lang === 'en' ? 'Click to view details' : 'اضغط لعرض التفاصيل'}</span>
                              </div>
                            </button>
                          </div>
                        )}
                        {/* كرت: مفوتر ولم يصدر له شهادة إنجاز */}
                        {summary.kpiAlerts && (
                          <div>
                            <button
                              onClick={openInvoicedNoCertDrawer}
                              className={`w-full text-right rounded-xl border p-4 flex flex-col gap-1 bg-white shadow-sm h-full transition-shadow hover:shadow-md cursor-pointer ${
                                summary.kpiAlerts.invoicedNoCert > 0 ? 'border-indigo-200 bg-indigo-50/30 hover:border-indigo-300' : 'border-slate-200 hover:border-slate-300'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1">
                                  <span className="text-xs font-medium text-slate-500">{lang === 'en' ? 'Invoiced — No Cert' : 'مفوتر ولم يصدر له شهادة إنجاز'}</span>
                                  <span className="relative group shrink-0">
                                    <svg className="w-3.5 h-3.5 text-slate-300 hover:text-indigo-400 cursor-help transition-colors" viewBox="0 0 20 20" fill="currentColor">
                                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                    </svg>
                                    <span className="pointer-events-none absolute z-50 bottom-full mb-2 right-0 w-60 bg-slate-800 text-white text-[11px] leading-snug rounded-lg px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity shadow-xl whitespace-normal" dir="rtl">
                                      {lang === 'en'
                                        ? 'Work orders where: 155 date exists · cert not confirmed · invoice 1 value exists · invoice 2 value is empty'
                                        : 'أوامر العمل التي:\n• تاريخ إجراء 155 موجود\n• شهادة الإنجاز لم تُؤكَّد\n• قيمة م.1 موجودة\n• قيمة م.2 فارغة\nالقيمة = م.2 المتبقي (تقديري = م.1)'}
                                      <span className="absolute top-full right-2 border-4 border-transparent border-t-slate-800" />
                                    </span>
                                  </span>
                                </div>
                                <BadgeAlert className={`w-4 h-4 ${summary.kpiAlerts.invoicedNoCert > 0 ? 'text-indigo-400' : 'text-slate-300'}`} />
                              </div>
                              <div className={`text-2xl font-bold ${summary.kpiAlerts.invoicedNoCert > 0 ? 'text-indigo-600' : 'text-slate-400'}`}>
                                {summary.kpiAlerts.invoicedNoCert}
                              </div>
                              <div className="text-xs text-slate-400">{lang === 'en' ? 'work orders' : 'أمر عمل'}</div>
                              {summary.kpiAlerts.invoicedNoCert > 0 && (summary.kpiAlerts.invoicedNoCertValue ?? 0) > 0 && (
                                <div className="mt-1 pt-1 border-t border-indigo-100">
                                  <span className="text-xs font-semibold text-indigo-500">
                                    ~{(summary.kpiAlerts.invoicedNoCertValue ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                                  </span>
                                  <span className="text-[10px] text-slate-400 mr-1">{lang === 'en' ? 'SAR (est. inv.2)' : 'ر.س (م.2 تقديري)'}</span>
                                </div>
                              )}
                              <div className="mt-auto pt-1">
                                <span className="text-[10px] text-slate-400 underline underline-offset-2">{lang === 'en' ? 'Click to view details' : 'اضغط لعرض التفاصيل'}</span>
                              </div>
                            </button>
                          </div>
                        )}
                        {/* كرت: شهادات الإنجاز المكتملة */}
                        {summary.kpiAlerts && (
                          <div>
                            <button
                              onClick={openCompletedWithCertDrawer}
                              className={`w-full text-right rounded-xl border p-4 flex flex-col gap-1 bg-white shadow-sm h-full transition-shadow hover:shadow-md cursor-pointer ${
                                (summary.kpiAlerts.completedWithCert ?? 0) > 0 ? 'border-indigo-200 bg-indigo-50/30 hover:border-indigo-300' : 'border-slate-200 hover:border-slate-300'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1">
                                  <span className="text-xs font-medium text-slate-500">{lang === 'en' ? 'Completed w/ Cert' : 'شهادات الإنجاز المكتملة'}</span>
                                  <span className="relative group shrink-0">
                                    <svg className="w-3.5 h-3.5 text-slate-300 hover:text-indigo-400 cursor-help transition-colors" viewBox="0 0 20 20" fill="currentColor">
                                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                    </svg>
                                    <span className="pointer-events-none absolute z-50 bottom-full mb-2 right-0 w-60 bg-slate-800 text-white text-[11px] leading-snug rounded-lg px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity shadow-xl whitespace-normal" dir="rtl">
                                      {lang === 'en'
                                        ? 'Work orders where: 155 date exists · cert confirmed · partial: inv.1 & inv.2 both filled · final: inv.1 filled\nValue = total invoiced amount'
                                        : 'أوامر العمل التي:\n• تاريخ إجراء 155 موجود\n• شهادة الإنجاز مؤكدة\n• جزئي: قيمة م.1 وم.2 موجودتان\n• نهائي: قيمة م.1 موجودة\nالقيمة = إجمالي المفوتر'}
                                      <span className="absolute top-full right-2 border-4 border-transparent border-t-slate-800" />
                                    </span>
                                  </span>
                                </div>
                                <BadgeCheck className={`w-4 h-4 ${(summary.kpiAlerts.completedWithCert ?? 0) > 0 ? 'text-indigo-400' : 'text-slate-300'}`} />
                              </div>
                              <div className={`text-2xl font-bold ${(summary.kpiAlerts.completedWithCert ?? 0) > 0 ? 'text-indigo-600' : 'text-slate-400'}`}>
                                {summary.kpiAlerts.completedWithCert ?? 0}
                              </div>
                              <div className="text-xs text-slate-400">{lang === 'en' ? 'work orders' : 'أمر عمل'}</div>
                              {(summary.kpiAlerts.completedWithCert ?? 0) > 0 && (summary.kpiAlerts.completedWithCertValue ?? 0) > 0 && (
                                <div className="mt-1 pt-1 border-t border-indigo-100">
                                  <span className="text-xs font-semibold text-indigo-500">
                                    ~{(summary.kpiAlerts.completedWithCertValue ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                                  </span>
                                  <span className="text-[10px] text-slate-400 mr-1">{lang === 'en' ? 'SAR (invoiced)' : 'ر.س (مفوتر)'}</span>
                                </div>
                              )}
                              <div className="mt-auto pt-1">
                                <span className="text-[10px] text-slate-400 underline underline-offset-2">{lang === 'en' ? 'Click to view details' : 'اضغط لعرض التفاصيل'}</span>
                              </div>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </>
        )}

        {/* ══ REGION TOOLBAR ═════════════════════════════════════════════════ */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <button
              data-testid="button-toggle-hide-empty"
              onClick={() => setHideEmpty(p => !p)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
                hideEmpty
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-400'
              }`}
            >
              {hideEmpty ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {hideEmpty ? (lang === 'en' ? 'Show Empty Types' : 'إظهار الأنواع الفارغة') : (lang === 'en' ? 'Hide Empty Types' : 'إخفاء الأنواع الفارغة')}
            </button>
          </div>
          {summary && (
            <span className="text-xs text-slate-400">
              {lang === 'en' ? `Showing ${visibleRegionCards.length} of ${regionCards.length} regions` : `يُعرض ${visibleRegionCards.length} من ${regionCards.length} منطقة`} ·&nbsp;
              {lang === 'en' ? `${summary.total} total work orders` : `${summary.total} أمر عمل إجمالاً`}
            </span>
          )}
        </div>

        {/* ══ EXPANDED REGION PANEL ══════════════════════════════════════════ */}
        {expandedRegion && (
          <RegionExpandedPanel
            region={expandedRegion}
            details={regionDetails}
            loading={loadingDetails}
            onClose={() => { setExpandedRegion(null); setRegionDetails(null); }}
            finEnabled={finEnabled}
            hideEmpty={hideEmpty}
            includeCompleted={includeCompleted}
            execColKeys={execColKeys}
            finColKeys={finColKeys}
            reasonsColKeys={reasonsColKeys}
            onOpenColPicker={key => setPickerOpen(key)}
            allExecCols={allExecCols}
            allFinCols={allFinCols}
            allReasonsCols={allReasonsCols}
          />
        )}

        {/* ══ REGION GRID ════════════════════════════════════════════════════ */}
        {!expandedRegion && (
          loadingRegions ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-slate-200 bg-white h-32 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {visibleRegionCards.map(region => (
                <button
                  key={region.id}
                  data-testid={`card-region-${region.id}`}
                  onClick={() => handleRegionClick(region)}
                  className={`rounded-xl border border-slate-200 bg-white shadow-sm hover:shadow-md hover:border-indigo-300 transition-all ${lang === 'en' ? 'text-left' : 'text-right'} p-5 group`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-bold text-slate-800 group-hover:text-indigo-700 transition-colors">{lang === 'en' && region.nameEn ? region.nameEn : region.nameAr}</h3>
                      {(lang === 'en' ? region.sectorNameEn : region.sectorNameAr) && (
                        <p className="text-xs text-slate-400 mt-0.5">{lang === 'en' ? region.sectorNameEn : region.sectorNameAr}</p>
                      )}
                    </div>
                    <ChevronDown className={`w-4 h-4 text-slate-300 group-hover:text-indigo-500 transition-colors ${lang === 'en' ? '-rotate-90' : 'rotate-90'}`} />
                  </div>

                  <HealthBar overdue={region.overdue} warning={region.warning} onTime={region.onTime} completed={region.completed} total={region.total} />

                  {/* Counts row */}
                  <div className={`grid ${includeCompleted ? 'grid-cols-5' : 'grid-cols-4'} gap-1 mt-3`}>
                    <div className="text-center">
                      <div className="text-base font-bold text-slate-800">{region.total}</div>
                      <div className="text-[10px] text-slate-400">{lang === 'en' ? 'Total' : 'إجمالي'}</div>
                    </div>
                    <div className="text-center">
                      <div className={`text-base font-bold ${region.overdue > 0 ? 'text-red-600' : 'text-slate-300'}`}>{region.overdue}</div>
                      <div className="text-[10px] text-slate-400">
                        {lang === 'en' ? 'Overdue' : 'متأخر'}
                        {(region.execDelayedJustified ?? 0) > 0 && (
                          <span className="text-orange-400 mr-0.5"> ({region.execDelayedJustified}✓)</span>
                        )}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className={`text-base font-bold ${region.warning > 0 ? 'text-amber-500' : 'text-slate-300'}`}>{region.warning}</div>
                      <div className="text-[10px] text-slate-400">{lang === 'en' ? 'Warning' : 'تنبيه'}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-base font-bold text-emerald-600">{region.onTime}</div>
                      <div className="text-[10px] text-slate-400">{lang === 'en' ? 'On Track' : 'منتظم'}</div>
                    </div>
                    {includeCompleted && (
                      <div className="text-center">
                        <div className={`text-base font-bold ${region.completed > 0 ? 'text-indigo-600' : 'text-slate-300'}`}>{region.completed}</div>
                        <div className="text-[10px] text-slate-400">{lang === 'en' ? 'Done' : 'منجز'}</div>
                      </div>
                    )}
                  </div>

                  {/* Metric mini-badges */}
                  {region.metricsAverages && region.metricsAverages.filter(m => m.avgDays != null && m.metricType !== 'NUMERIC_AGG').length > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-1.5">
                      {region.metricsAverages.filter(m => m.avgDays != null && m.metricType !== 'NUMERIC_AGG').map(m => {
                        const cls = METRIC_COLOR[m.statusColor as keyof typeof METRIC_COLOR] ?? METRIC_COLOR.null;
                        return (
                          <span key={m.code} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cls}`}>
                            {lang === 'en' && m.nameEn ? m.nameEn : m.nameAr}: {m.avgDays} {lang === 'en' ? 'days' : 'يوم'}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </button>
              ))}
              {visibleRegionCards.length === 0 && !loadingRegions && (
                <div className="col-span-3 text-center py-12 text-slate-400 space-y-1">
                  <Search className="w-6 h-6 mx-auto opacity-30" />
                  <div>{lang === 'en' ? 'No regions matching selected filters' : 'لا توجد مناطق تطابق الفلاتر المحددة'}</div>
                </div>
              )}
            </div>
          )
        )}

      </div>

      {/* Column Picker Modal */}
      {pickerOpen && (
        <ColumnPickerModal
          tableKey={pickerOpen}
          availableCols={pickerOpen === 'EXEC' ? (allExecCols.length ? allExecCols : ALL_WO_COLS) : pickerOpen === 'FIN' ? (allFinCols.length ? allFinCols : ALL_FIN_COLS) : (allReasonsCols.length ? allReasonsCols : ALL_REASONS_COLS)}
          selectedKeys={pickerOpen === 'EXEC' ? execColKeys : pickerOpen === 'FIN' ? finColKeys : reasonsColKeys}
          onSave={keys => saveColPrefs(pickerOpen, keys)}
          onClose={() => setPickerOpen(null)}
        />
      )}

      {/* ── مغلقة لم تُفوتر — Drill-down Drawer ──────────────────────────── */}
      {kpiDrawerOpen && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 bg-black/30 z-40"
            onClick={() => setKpiDrawerOpen(false)}
          />
          {/* Panel */}
          <div
            className="fixed top-0 right-0 h-full w-full max-w-5xl bg-white shadow-2xl z-50 flex flex-col"
            dir="rtl"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-indigo-50/60 print:hidden">
              <div className="flex items-center gap-2">
                <FileX2 className="w-5 h-5 text-indigo-500" />
                <span className="font-semibold text-slate-800 text-sm">
                  {lang === 'en' ? 'Closed w/o Invoice' : 'مغلقة لم تُفوتر'}
                </span>
                {!kpiDrawerLoading && (
                  <span className="text-xs bg-indigo-100 text-indigo-700 rounded-full px-2 py-0.5 font-medium">
                    {kpiDrawerRows.length} {lang === 'en' ? 'orders' : 'أمر'}
                    {kpiDrawerTotal > 0 && (
                      <span className="mr-1">
                        · ~{kpiDrawerTotal.toLocaleString('en-US', { maximumFractionDigits: 0 })} {lang === 'en' ? 'SAR' : 'ر.س'}
                      </span>
                    )}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* Column Picker */}
                <button
                  onClick={() => setKpiPickerOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-50 text-slate-600 border border-slate-200 text-xs font-medium hover:border-indigo-400 hover:text-indigo-600 transition-colors"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  {lang === 'en' ? 'Columns' : 'الأعمدة'}
                </button>
                {/* Export Excel */}
                <button
                  onClick={async () => {
                    try {
                      const isAr = lang !== 'en';
                      const ExcelJS = (await import('exceljs')).default;
                      const wb = new ExcelJS.Workbook();
                      const ws = wb.addWorksheet(isAr ? 'مغلقة لم تُفوتر' : 'Closed w/o Invoice');
                      ws.views = [{ rightToLeft: isAr }];
                      const colHeaders = kpiVisibleCols.map(c => isAr ? c.labelAr : c.labelEn);
                      const nc = colHeaders.length;
                      const setC = (rowNum: number, val: string, bold: boolean, size: number, color: string) => {
                        if (nc > 1) ws.mergeCells(rowNum, 1, rowNum, nc);
                        const row = ws.getRow(rowNum); row.height = bold ? 28 : 16;
                        const cell = row.getCell(1); cell.value = val;
                        cell.font = { bold, size, color: { argb: color } };
                        cell.alignment = { horizontal: 'center', vertical: 'middle' };
                      };
                      const compName = (isAr ? reportHdr?.companyNameAr : reportHdr?.companyNameEn) ?? '';
                      let rp = 1;
                      if (compName) setC(rp++, compName, true, 14, 'FF334155');
                      setC(rp++, isAr ? 'مغلقة لم تُفوتر' : 'Closed w/o Invoice', true, 12, 'FF334155');
                      setC(rp++, `${isAr ? 'التاريخ:' : 'Date:'} ${new Date().toLocaleDateString(isAr ? 'ar-SA' : 'en-CA')}`, false, 10, 'FF64748b');
                      ws.getRow(rp++).height = 6;
                      const HR = ws.getRow(rp); HR.height = 22;
                      colHeaders.forEach((h, i) => {
                        const cell = HR.getCell(i + 1); cell.value = h;
                        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
                        cell.alignment = { horizontal: 'center', vertical: 'middle' };
                        cell.border = { top:{style:'thin',color:{argb:'FFFFFFFF'}}, left:{style:'thin',color:{argb:'FFFFFFFF'}}, bottom:{style:'thin',color:{argb:'FFFFFFFF'}}, right:{style:'thin',color:{argb:'FFFFFFFF'}} };
                      });
                      const ds = ++rp;
                      const bdr = { style: 'thin' as const, color: { argb: 'FFcbd5e1' } };
                      kpiDrawerRows.forEach((r: any, ri: number) => {
                        const row = ws.getRow(ds + ri); row.height = 17;
                        kpiVisibleCols.forEach((c, ci) => {
                          const v = ccGetVal(r, c.key);
                          const cell = row.getCell(ci + 1);
                          cell.value = ccIsDate(c) ? ccFmtDate(v) : ccIsNum(c) ? (v != null && v !== '' ? Number(v) : '') : (v ?? '');
                          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ri % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF' } };
                          cell.border = { top: bdr, left: bdr, bottom: bdr, right: bdr };
                          cell.alignment = { horizontal: isAr ? 'right' : 'left', vertical: 'middle' };
                        });
                      });
                      const approxIdxXL = kpiVisibleCols.findIndex((c: { key: string }) => c.key === 'approxValue');
                      if (approxIdxXL >= 0) {
                        const totRow = ws.getRow(ds + kpiDrawerRows.length); totRow.height = 18;
                        const tbdr = { style: 'medium' as const, color: { argb: 'FF334155' } };
                        kpiVisibleCols.forEach((_: unknown, ci: number) => {
                          const cell = totRow.getCell(ci + 1);
                          cell.value = ci === approxIdxXL ? kpiDrawerTotal : ci === approxIdxXL - 1 ? (isAr ? 'الإجمالي' : 'Total') : '';
                          cell.font = { bold: true, color: { argb: 'FF334155' }, size: 11 };
                          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFe2e8f0' } };
                          cell.alignment = { horizontal: isAr ? 'right' : 'left', vertical: 'middle' };
                          cell.border = { top: tbdr, left: bdr, bottom: bdr, right: bdr };
                        });
                      }
                      ws.columns = colHeaders.map(() => ({ width: 18 }));
                      const buf = await wb.xlsx.writeBuffer();
                      const a = Object.assign(document.createElement('a'), {
                        href: URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })),
                        download: `closed-not-invoiced-${new Date().toISOString().slice(0,10)}.xlsx`,
                      });
                      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
                    } catch(e) { console.error(e); }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-medium hover:bg-emerald-100 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  {lang === 'en' ? 'Excel' : 'Excel'}
                </button>
                {/* Print */}
                <button
                  onClick={() => {
                    const isAr = lang !== 'en';
                    const headers = kpiVisibleCols.map((c: { labelAr: string; labelEn: string }) => isAr ? c.labelAr : c.labelEn);
                    const fmtNum = (v: any) => v != null ? Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';
                    const tableRows = kpiDrawerRows.map((r: any, i: number) => {
                      const cells = kpiVisibleCols.map((c: { key: string; dataType?: string }) => {
                        const v = ccGetVal(r, c.key);
                        const isN = ccIsNum(c); const isD = ccIsDate(c);
                        return `<td style="text-align:${isN?'left':'right'};direction:${isN||isD?'ltr':'rtl'}">${ccFmtCell(v, c)}</td>`;
                      }).join('');
                      return `<tr style="background:${i%2===0?'#fff':'#f9fafb'}">${cells}</tr>`;
                    }).join('');
                    const totalVal = fmtNum(kpiDrawerTotal);
                    const approxIdxPR = kpiVisibleCols.findIndex((c: { key: string }) => c.key === 'approxValue');
                    const footerRow = approxIdxPR >= 0
                      ? `<tfoot><tr style="border-top:2px solid #334155">${kpiVisibleCols.map((_: unknown, i: number) => i < approxIdxPR - 1 ? '<td></td>' : i === approxIdxPR - 1 ? `<td style="text-align:right">${isAr?'الإجمالي':'Total'}</td>` : `<td style="text-align:left;direction:ltr">${totalVal}</td>`).join('')}</tr></tfoot>`
                      : '';
                    const compName = (isAr ? reportHdr?.companyNameAr : reportHdr?.companyNameEn) ?? '';
                    const lw = reportHdr?.logoLeftWidthPdf ?? 120;
                    const rw = reportHdr?.logoRightWidthPdf ?? 120;
                    const leftLogo  = reportHdr?.logoLeftUrl  ? `<img src="${reportHdr.logoLeftUrl}"  style="width:${lw}px;max-height:60px;object-fit:contain" />` : '';
                    const rightLogo = reportHdr?.logoRightUrl ? `<img src="${reportHdr.logoRightUrl}" style="width:${rw}px;max-height:60px;object-fit:contain" />` : '';
                    const html = `<!DOCTYPE html><html dir="${isAr?'rtl':'ltr'}"><head><meta charset="utf-8">
                      <title>${isAr ? 'مغلقة لم تُفوتر' : 'Closed w/o Invoice'}</title>
                      <style>
                        body{font-family:Arial,sans-serif;font-size:11px;direction:${isAr?'rtl':'ltr'};margin:0;padding:16px}
                        .sub{font-size:11px;color:#666;margin-bottom:12px}
                        table{width:100%;border-collapse:collapse;page-break-inside:auto}
                        tr{page-break-inside:avoid}
                        th{background:#334155;color:#fff;border:1px solid #fff;padding:5px 8px;font-size:10px;text-align:right}
                        td{border:1px solid #e2e8f0;padding:4px 8px}
                        tfoot td{font-weight:bold;background:#e2e8f0;color:#334155;border-top:2px solid #334155}
                        @page{size:landscape;margin:12mm}
                      </style></head><body>
                      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 8px;background:#f8fafc;border-bottom:3px solid #334155;margin-bottom:12px;">
                        <div style="width:${lw}px;display:flex;align-items:center;justify-content:center">${leftLogo}</div>
                        <div style="flex:1;text-align:center;padding:0 12px;direction:${isAr?'rtl':'ltr'}">
                          ${compName?`<div style="font-size:13px;font-weight:bold;color:#334155;margin-bottom:4px">${compName}</div>`:''}
                          <div style="font-size:11px;color:#334155">${isAr?'مغلقة لم تُفوتر':'Closed w/o Invoice'}</div>
                          <div style="font-size:10px;color:#64748b;margin-top:2px">${new Date().toLocaleDateString(isAr?'ar-SA':'en-CA')}</div>
                        </div>
                        <div style="width:${rw}px;display:flex;align-items:center;justify-content:center">${rightLogo}</div>
                      </div>
                      <div class="sub">${kpiDrawerRows.length} ${isAr?'أمر':'orders'} · ~${totalVal} ${isAr?'ر.س':'SAR'}</div>
                      <table>
                        <thead><tr>${headers.map((h: string)=>`<th>${h}</th>`).join('')}</tr></thead>
                        <tbody>${tableRows}</tbody>
                        ${footerRow}
                      </table>
                      <script>window.addEventListener('load',function(){window.focus();window.print();});<\/script>
                      </body></html>`;
                    const pw = window.open('', '_blank', 'width=1100,height=700');
                    if (pw) { pw.document.write(html); pw.document.close(); }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-600 text-xs font-medium hover:bg-slate-100 transition-colors"
                >
                  <Printer className="w-3.5 h-3.5" />
                  {lang === 'en' ? 'Print' : 'طباعة'}
                </button>
                {/* Close */}
                <button
                  onClick={() => setKpiDrawerOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-auto p-4" id="kpi-drawer-print-area">
              {kpiDrawerLoading ? (
                <div className="flex items-center justify-center h-40 text-slate-400 text-sm gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  {lang === 'en' ? 'Loading...' : 'جارٍ التحميل...'}
                </div>
              ) : kpiDrawerRows.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-slate-400 text-sm">
                  {lang === 'en' ? 'No records found.' : 'لا توجد سجلات.'}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  {/* Print title (hidden on screen) */}
                  <div className="hidden print:block mb-4 text-center font-bold text-base">
                    {lang === 'en' ? 'Closed w/o Invoice — Detail' : 'مغلقة لم تُفوتر — التفاصيل'}
                    <div className="text-xs font-normal text-slate-500 mt-1">
                      {kpiDrawerRows.length} {lang === 'en' ? 'orders' : 'أمر'} · ~{kpiDrawerTotal.toLocaleString('en-US', { maximumFractionDigits: 0 })} {lang === 'en' ? 'SAR' : 'ر.س'}
                    </div>
                  </div>
                  <table className="w-full text-xs border-collapse min-w-[800px]">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        {kpiVisibleCols.map((col: { key: string; labelAr: string; labelEn: string; dataType?: string }) => (
                          <th key={col.key} className={`px-3 py-2 font-semibold text-slate-600 whitespace-nowrap border-b border-slate-200 ${ccIsNum(col) ? 'text-left' : 'text-right'}`}>
                            {lang === 'en' ? col.labelEn : col.labelAr}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {kpiDrawerRows.map((row: any, i: number) => (
                        <tr key={row.orderNumber ?? i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                          {kpiVisibleCols.map((col: { key: string; labelAr: string; labelEn: string; dataType?: string }) => {
                            const v = ccGetVal(row, col.key);
                            const isNum    = ccIsNum(col);
                            const isDate   = ccIsDate(col);
                            const isOrder  = col.key === 'orderNumber';
                            const isApprox = col.key === 'approxValue';
                            return (
                              <td
                                key={col.key}
                                className={`px-3 py-2 whitespace-nowrap ${isOrder ? 'font-medium text-indigo-700' : isApprox ? 'font-semibold text-orange-600 text-left' : isNum ? 'text-slate-700 text-left' : 'text-slate-600'}`}
                                dir={isNum || isDate ? 'ltr' : undefined}
                              >
                                {ccFmtCell(v, col)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                    {kpiVisibleCols.some((c: { key: string }) => c.key === 'approxValue') && (() => {
                      const approxIdx = kpiVisibleCols.findIndex((c: { key: string }) => c.key === 'approxValue');
                      return (
                        <tfoot>
                          <tr className="bg-indigo-50 border-t-2 border-indigo-200 font-semibold">
                            {kpiVisibleCols.map((col: { key: string }, i: number) => (
                              <td key={col.key} className={`px-3 py-2 ${i === approxIdx ? 'text-indigo-600 text-left' : i === approxIdx - 1 ? 'text-right text-slate-600' : ''}`} dir={i === approxIdx ? 'ltr' : undefined}>
                                {i === approxIdx ? kpiDrawerTotal.toLocaleString('en-US', { maximumFractionDigits: 0 }) : i === approxIdx - 1 ? (lang === 'en' ? 'Total Approx. Unbilled' : 'إجمالي غير المفوتر (تقريبي)') : ''}
                              </td>
                            ))}
                          </tr>
                        </tfoot>
                      );
                    })()}
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── مفوتر ولم يصدر له شهادة إنجاز — Drill-down Drawer ──────────── */}
      {certDrawerOpen && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setCertDrawerOpen(false)} />
          <div className="fixed top-0 right-0 h-full w-full max-w-5xl bg-white shadow-2xl z-50 flex flex-col" dir="rtl">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-indigo-50/60 print:hidden">
              <div className="flex items-center gap-2">
                <BadgeAlert className="w-5 h-5 text-indigo-500" />
                <span className="font-semibold text-slate-800 text-sm">
                  {lang === 'en' ? 'Invoiced — No Cert' : 'مفوتر ولم يصدر له شهادة إنجاز'}
                </span>
                {!certDrawerLoading && (
                  <span className="text-xs bg-indigo-100 text-indigo-700 rounded-full px-2 py-0.5 font-medium">
                    {certDrawerRows.length} {lang === 'en' ? 'orders' : 'أمر'}
                    {certDrawerTotal > 0 && (
                      <span className="mr-1">· ~{certDrawerTotal.toLocaleString('en-US', { maximumFractionDigits: 0 })} {lang === 'en' ? 'SAR' : 'ر.س'}</span>
                    )}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* Column Picker */}
                <button
                  onClick={() => setCertPickerOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-50 text-slate-600 border border-slate-200 text-xs font-medium hover:border-indigo-400 hover:text-indigo-600 transition-colors"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  {lang === 'en' ? 'Columns' : 'الأعمدة'}
                </button>
                {/* Excel */}
                <button
                  onClick={async () => {
                    try {
                      const isAr2 = lang !== 'en';
                      const ExcelJS = (await import('exceljs')).default;
                      const wb = new ExcelJS.Workbook();
                      const ws = wb.addWorksheet(isAr2 ? 'مفوتر بلا شهادة' : 'Invoiced No Cert');
                      ws.views = [{ rightToLeft: isAr2 }];
                      const headers = certVisibleCols.map((c: { labelAr: string; labelEn: string }) => isAr2 ? c.labelAr : c.labelEn);
                      const nc2 = headers.length;
                      const setC2 = (rowNum: number, val: string, bold: boolean, size: number, color: string) => {
                        if (nc2 > 1) ws.mergeCells(rowNum, 1, rowNum, nc2);
                        const row2 = ws.getRow(rowNum); row2.height = bold ? 28 : 16;
                        const cell2 = row2.getCell(1); cell2.value = val;
                        cell2.font = { bold, size, color: { argb: color } };
                        cell2.alignment = { horizontal: 'center', vertical: 'middle' };
                      };
                      const compName2 = (isAr2 ? reportHdr?.companyNameAr : reportHdr?.companyNameEn) ?? '';
                      let rp2 = 1;
                      if (compName2) setC2(rp2++, compName2, true, 14, 'FF334155');
                      setC2(rp2++, isAr2 ? 'مفوتر ولم يصدر له شهادة إنجاز' : 'Invoiced No Cert', true, 12, 'FF334155');
                      setC2(rp2++, `${isAr2 ? 'التاريخ:' : 'Date:'} ${new Date().toLocaleDateString(isAr2 ? 'ar-SA' : 'en-CA')}`, false, 10, 'FF64748b');
                      ws.getRow(rp2++).height = 6;
                      const HR2 = ws.getRow(rp2); HR2.height = 22;
                      headers.forEach((h: string, i: number) => {
                        const cell2 = HR2.getCell(i + 1); cell2.value = h;
                        cell2.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
                        cell2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
                        cell2.alignment = { horizontal: 'center', vertical: 'middle' };
                        cell2.border = { top:{style:'thin',color:{argb:'FFFFFFFF'}}, left:{style:'thin',color:{argb:'FFFFFFFF'}}, bottom:{style:'thin',color:{argb:'FFFFFFFF'}}, right:{style:'thin',color:{argb:'FFFFFFFF'}} };
                      });
                      const ds2 = ++rp2;
                      const bdr2 = { style: 'thin' as const, color: { argb: 'FFcbd5e1' } };
                      certDrawerRows.forEach((r: any, ri2: number) => {
                        const row2 = ws.getRow(ds2 + ri2); row2.height = 17;
                        certVisibleCols.forEach((c: { key: string; dataType?: string }, ci2: number) => {
                          const v = certGetVal(r, c.key);
                          const cell2 = row2.getCell(ci2 + 1);
                          cell2.value = ccIsDate(c) ? ccFmtDate(v) : ccIsNum(c) ? (v != null && v !== '' ? Number(v) : '') : (v ?? '');
                          cell2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ri2 % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF' } };
                          cell2.border = { top: bdr2, left: bdr2, bottom: bdr2, right: bdr2 };
                          cell2.alignment = { horizontal: isAr2 ? 'right' : 'left', vertical: 'middle' };
                        });
                      });
                      const approxIdxXL2 = certVisibleCols.findIndex((c: { key: string }) => c.key === 'approxInvoice2');
                      const totalIdxXL2  = certVisibleCols.findIndex((c: { key: string }) => c.key === 'totalEst');
                      if (approxIdxXL2 >= 0 || totalIdxXL2 >= 0) {
                        const totRow2 = ws.getRow(ds2 + certDrawerRows.length); totRow2.height = 18;
                        const tbdr2 = { style: 'medium' as const, color: { argb: 'FF334155' } };
                        certVisibleCols.forEach((_: unknown, ci2: number) => {
                          const cell2 = totRow2.getCell(ci2 + 1);
                          cell2.value = ci2 === approxIdxXL2 ? certDrawerTotal
                            : ci2 === totalIdxXL2 ? certDrawerTotal * 2
                            : ci2 === Math.max(approxIdxXL2, totalIdxXL2) - 1 ? (isAr2 ? 'الإجمالي' : 'Total') : '';
                          cell2.font = { bold: true, color: { argb: 'FF334155' }, size: 11 };
                          cell2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFe2e8f0' } };
                          cell2.alignment = { horizontal: isAr2 ? 'right' : 'left', vertical: 'middle' };
                          cell2.border = { top: tbdr2, left: bdr2, bottom: bdr2, right: bdr2 };
                        });
                      }
                      ws.columns = headers.map(() => ({ width: 18 }));
                      const buf = await wb.xlsx.writeBuffer();
                      const a = Object.assign(document.createElement('a'), {
                        href: URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })),
                        download: `invoiced-no-cert-${new Date().toISOString().slice(0,10)}.xlsx`,
                      });
                      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
                    } catch(e) { console.error(e); }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-medium hover:bg-emerald-100 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />{lang === 'en' ? 'Excel' : 'Excel'}
                </button>
                {/* Print */}
                <button
                  onClick={() => {
                    const isAr = lang !== 'en';
                    const headers = certVisibleCols.map((c: { labelAr: string; labelEn: string }) => isAr ? c.labelAr : c.labelEn);
                    const fmtNum  = (v: any) => v != null ? Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';
                    const tableRows = certDrawerRows.map((r: any, i: number) => {
                      const cells = certVisibleCols.map((c: { key: string; dataType?: string }) => {
                        const v = certGetVal(r, c.key);
                        const isN = ccIsNum(c); const isD = ccIsDate(c);
                        return `<td style="text-align:${isN?'left':'right'};direction:${isN||isD?'ltr':'rtl'}">${ccFmtCell(v, c)}</td>`;
                      }).join('');
                      return `<tr style="background:${i%2===0?'#fff':'#f9fafb'}">${cells}</tr>`;
                    }).join('');
                    const totalVal = fmtNum(certDrawerTotal);
                    const approxIdxPRC = certVisibleCols.findIndex((c: { key: string }) => c.key === 'approxInvoice2');
                    const totalIdxPRC  = certVisibleCols.findIndex((c: { key: string }) => c.key === 'totalEst');
                    const certFooter = (approxIdxPRC >= 0 || totalIdxPRC >= 0)
                      ? `<tfoot><tr style="border-top:2px solid #334155">${certVisibleCols.map((_: unknown, i: number) =>
                          i === approxIdxPRC ? `<td style="text-align:left;direction:ltr">${totalVal}</td>`
                          : i === totalIdxPRC ? `<td style="text-align:left;direction:ltr">${fmtNum(certDrawerTotal*2)}</td>`
                          : i === Math.max(approxIdxPRC,totalIdxPRC) - 1 ? `<td style="text-align:right">${isAr?'الإجمالي':'Total'}</td>`
                          : '<td></td>').join('')}</tr></tfoot>`
                      : '';
                    const compNameC = (isAr ? reportHdr?.companyNameAr : reportHdr?.companyNameEn) ?? '';
                    const lwC = reportHdr?.logoLeftWidthPdf ?? 120;
                    const rwC = reportHdr?.logoRightWidthPdf ?? 120;
                    const leftLogoC  = reportHdr?.logoLeftUrl  ? `<img src="${reportHdr.logoLeftUrl}"  style="width:${lwC}px;max-height:60px;object-fit:contain" />` : '';
                    const rightLogoC = reportHdr?.logoRightUrl ? `<img src="${reportHdr.logoRightUrl}" style="width:${rwC}px;max-height:60px;object-fit:contain" />` : '';
                    const html = `<!DOCTYPE html><html dir="${isAr?'rtl':'ltr'}"><head><meta charset="utf-8">
                      <title>${isAr ? 'مفوتر ولم يصدر له شهادة إنجاز' : 'Invoiced No Cert'}</title>
                      <style>
                        body{font-family:Arial,sans-serif;font-size:11px;direction:${isAr?'rtl':'ltr'};margin:0;padding:16px}
                        .sub{font-size:11px;color:#666;margin-bottom:12px}
                        table{width:100%;border-collapse:collapse;page-break-inside:auto}tr{page-break-inside:avoid}
                        th{background:#334155;color:#fff;border:1px solid #fff;padding:5px 8px;font-size:10px;text-align:right}
                        td{border:1px solid #e2e8f0;padding:4px 8px}
                        tfoot td{font-weight:bold;background:#e2e8f0;color:#334155;border-top:2px solid #334155}
                        @page{size:landscape;margin:12mm}
                      </style></head><body>
                      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 8px;background:#f8fafc;border-bottom:3px solid #334155;margin-bottom:12px;">
                        <div style="width:${lwC}px;display:flex;align-items:center;justify-content:center">${leftLogoC}</div>
                        <div style="flex:1;text-align:center;padding:0 12px;direction:${isAr?'rtl':'ltr'}">
                          ${compNameC?`<div style="font-size:13px;font-weight:bold;color:#334155;margin-bottom:4px">${compNameC}</div>`:''}
                          <div style="font-size:11px;color:#334155">${isAr?'مفوتر ولم يصدر له شهادة إنجاز':'Invoiced No Cert'}</div>
                          <div style="font-size:10px;color:#64748b;margin-top:2px">${new Date().toLocaleDateString(isAr?'ar-SA':'en-CA')}</div>
                        </div>
                        <div style="width:${rwC}px;display:flex;align-items:center;justify-content:center">${rightLogoC}</div>
                      </div>
                      <div class="sub">${certDrawerRows.length} ${isAr?'أمر':'orders'} · ~${totalVal} ${isAr?'ر.س (م.2 تقديري)':'SAR (est. inv.2)'}</div>
                      <table>
                        <thead><tr>${headers.map((h: string)=>`<th>${h}</th>`).join('')}</tr></thead>
                        <tbody>${tableRows}</tbody>
                        ${certFooter}
                      </table>
                      <script>window.addEventListener('load',function(){window.focus();window.print();});<\/script>
                      </body></html>`;
                    const pw = window.open('', '_blank', 'width=1100,height=700');
                    if (pw) { pw.document.write(html); pw.document.close(); }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-600 text-xs font-medium hover:bg-slate-100 transition-colors"
                >
                  <Printer className="w-3.5 h-3.5" />{lang === 'en' ? 'Print' : 'طباعة'}
                </button>
                <button onClick={() => setCertDrawerOpen(false)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            {/* Body */}
            <div className="flex-1 overflow-auto p-4">
              {certDrawerLoading ? (
                <div className="flex items-center justify-center h-40 text-slate-400 text-sm gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin" />{lang === 'en' ? 'Loading...' : 'جارٍ التحميل...'}
                </div>
              ) : certDrawerRows.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-slate-400 text-sm">
                  {lang === 'en' ? 'No records found.' : 'لا توجد سجلات.'}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse min-w-[800px]">
                    <thead>
                      <tr className="bg-indigo-50 border-b border-indigo-200">
                        {certVisibleCols.map((col: { key: string; labelAr: string; labelEn: string; dataType?: string }) => (
                          <th key={col.key} className={`px-3 py-2 font-semibold text-slate-600 whitespace-nowrap border-b border-indigo-200 ${ccIsNum(col) ? 'text-left' : 'text-right'}`}>
                            {lang === 'en' ? col.labelEn : col.labelAr}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {certDrawerRows.map((row: any, i: number) => (
                        <tr key={row.orderNumber ?? i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                          {certVisibleCols.map((col: { key: string; labelAr: string; labelEn: string; dataType?: string }) => {
                            const v = certGetVal(row, col.key);
                            const isNum    = ccIsNum(col);
                            const isDate   = ccIsDate(col);
                            const isOrder  = col.key === 'orderNumber';
                            const isApprox = col.key === 'approxInvoice2';
                            const isTotal  = col.key === 'totalEst';
                            return (
                              <td
                                key={col.key}
                                className={`px-3 py-2 whitespace-nowrap ${isOrder ? 'font-medium text-indigo-700' : isTotal ? 'font-semibold text-indigo-700 text-left' : isApprox ? 'font-medium text-indigo-600 text-left' : isNum ? 'text-slate-700 text-left' : 'text-slate-600'}`}
                                dir={isNum || isDate ? 'ltr' : undefined}
                              >
                                {ccFmtCell(v, col)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                    {certVisibleCols.some((c: { key: string }) => c.key === 'approxInvoice2' || c.key === 'totalEst') && (() => {
                      const approxIdx = certVisibleCols.findIndex((c: { key: string }) => c.key === 'approxInvoice2');
                      const totalIdx  = certVisibleCols.findIndex((c: { key: string }) => c.key === 'totalEst');
                      const labelIdx  = Math.max(approxIdx, totalIdx) - 1;
                      return (
                        <tfoot>
                          <tr className="bg-indigo-50 border-t-2 border-indigo-200 font-semibold">
                            {certVisibleCols.map((col: { key: string }, i: number) => (
                              <td key={col.key} className={`px-3 py-2 ${i === approxIdx ? 'text-indigo-600 text-left' : i === totalIdx ? 'text-indigo-700 text-left' : i === labelIdx ? 'text-right text-slate-600' : ''}`} dir={i === approxIdx || i === totalIdx ? 'ltr' : undefined}>
                                {i === approxIdx ? certDrawerTotal.toLocaleString('en-US', { maximumFractionDigits: 0 })
                                  : i === totalIdx ? (certDrawerTotal * 2).toLocaleString('en-US', { maximumFractionDigits: 0 })
                                  : i === labelIdx ? (lang === 'en' ? 'Total (Est.)' : 'إجمالي م.2 المتبقي (تقديري)')
                                  : ''}
                              </td>
                            ))}
                          </tr>
                        </tfoot>
                      );
                    })()}
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── شهادات الإنجاز المكتملة — Drill-down Drawer ──────────────── */}
      {compCertDrawerOpen && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setCompCertDrawerOpen(false)} />
          <div className="fixed top-0 right-0 h-full w-full max-w-5xl bg-white shadow-2xl z-50 flex flex-col" dir="rtl">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0 gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <BadgeCheck className="w-5 h-5 text-indigo-500" />
                <span className="font-semibold text-slate-800 text-sm">
                  {lang === 'en' ? 'Completed w/ Cert' : 'شهادات الإنجاز المكتملة'}
                </span>
                {!compCertDrawerLoading && (
                  <span className="text-xs bg-indigo-100 text-indigo-700 rounded-full px-2 py-0.5 font-medium">
                    {compCertDrawerRows.length} {lang === 'en' ? 'orders' : 'أمر'}
                    {compCertDrawerTotal > 0 && (
                      <span className="mr-1">· ~{compCertDrawerTotal.toLocaleString('en-US', { maximumFractionDigits: 0 })} {lang === 'en' ? 'SAR' : 'ر.س'}</span>
                    )}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {/* Column picker button */}
                <button
                  onClick={() => setCompCertPickerOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-50 text-slate-600 border border-slate-200 text-xs font-medium hover:border-indigo-400 hover:text-indigo-600 transition-colors"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  {lang === 'en' ? 'Columns' : 'الأعمدة'}
                </button>
                {/* Excel export */}
                <button
                  onClick={async () => {
                    const isArCC = lang !== 'en';
                    const ExcelJS = (await import('exceljs')).default;
                    const wb = new ExcelJS.Workbook();
                    const ws = wb.addWorksheet(isArCC ? 'شهادات مكتملة' : 'Completed Cert');
                    ws.views = [{ rightToLeft: isArCC }];
                    type CCCol = { key: string; labelAr: string; labelEn: string; dataType?: string };
                    const ccHeaders = compCertVisibleCols.map((c: CCCol) => isArCC ? c.labelAr : c.labelEn);
                    const ncCC = ccHeaders.length;
                    const setCCC = (rowNum: number, val: string, bold: boolean, size: number, color: string) => {
                      if (ncCC > 1) ws.mergeCells(rowNum, 1, rowNum, ncCC);
                      const rowCC = ws.getRow(rowNum); rowCC.height = bold ? 28 : 16;
                      const cellCC = rowCC.getCell(1); cellCC.value = val;
                      cellCC.font = { bold, size, color: { argb: color } };
                      cellCC.alignment = { horizontal: 'center', vertical: 'middle' };
                    };
                    const compNameCC = (isArCC ? reportHdr?.companyNameAr : reportHdr?.companyNameEn) ?? '';
                    let rpCC = 1;
                    if (compNameCC) setCCC(rpCC++, compNameCC, true, 14, 'FF334155');
                    setCCC(rpCC++, isArCC ? 'شهادات الإنجاز المكتملة' : 'Completed w/ Cert', true, 12, 'FF334155');
                    setCCC(rpCC++, `${isArCC ? 'التاريخ:' : 'Date:'} ${new Date().toLocaleDateString(isArCC ? 'ar-SA' : 'en-CA')}`, false, 10, 'FF64748b');
                    ws.getRow(rpCC++).height = 6;
                    const HRCC = ws.getRow(rpCC); HRCC.height = 22;
                    ccHeaders.forEach((h: string, i: number) => {
                      const cellCC = HRCC.getCell(i + 1); cellCC.value = h;
                      cellCC.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
                      cellCC.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
                      cellCC.alignment = { horizontal: 'center', vertical: 'middle' };
                      cellCC.border = { top:{style:'thin',color:{argb:'FFFFFFFF'}}, left:{style:'thin',color:{argb:'FFFFFFFF'}}, bottom:{style:'thin',color:{argb:'FFFFFFFF'}}, right:{style:'thin',color:{argb:'FFFFFFFF'}} };
                    });
                    const dsCC = ++rpCC;
                    const bdrCC = { style: 'thin' as const, color: { argb: 'FFcbd5e1' } };
                    compCertDrawerRows.forEach((r: any, riCC: number) => {
                      const rowCC = ws.getRow(dsCC + riCC); rowCC.height = 17;
                      compCertVisibleCols.forEach((c: CCCol, ciCC: number) => {
                        const v = ccGetVal(r, c.key);
                        const cellCC = rowCC.getCell(ciCC + 1);
                        cellCC.value = ccIsDate(c) ? ccFmtDate(v) : ccIsNum(c) ? (v != null && v !== '' ? Number(v) : '') : (v ?? '');
                        cellCC.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: riCC % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF' } };
                        cellCC.border = { top: bdrCC, left: bdrCC, bottom: bdrCC, right: bdrCC };
                        cellCC.alignment = { horizontal: isArCC ? 'right' : 'left', vertical: 'middle' };
                      });
                    });
                    const totalColIdx = compCertVisibleCols.findIndex(c => c.key === 'totalInvoiced');
                    if (totalColIdx >= 0) {
                      const tbdrCC = { style: 'medium' as const, color: { argb: 'FF334155' } };
                      const totRowCC = ws.getRow(dsCC + compCertDrawerRows.length); totRowCC.height = 18;
                      compCertVisibleCols.forEach((_c: CCCol, ciCC: number) => {
                        const cellCC = totRowCC.getCell(ciCC + 1);
                        cellCC.value = ciCC === totalColIdx ? compCertDrawerTotal : ciCC === totalColIdx - 1 ? (isArCC ? 'الإجمالي' : 'Total') : '';
                        cellCC.font = { bold: true, color: { argb: 'FF334155' }, size: 11 };
                        cellCC.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFe2e8f0' } };
                        cellCC.alignment = { horizontal: isArCC ? 'right' : 'left', vertical: 'middle' };
                        cellCC.border = { top: tbdrCC, left: bdrCC, bottom: bdrCC, right: bdrCC };
                      });
                    }
                    ws.columns = ccHeaders.map(() => ({ width: 18 }));
                    const buf = await wb.xlsx.writeBuffer();
                    const a = Object.assign(document.createElement('a'), {
                      href: URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })),
                      download: `completed-cert-${Date.now()}.xlsx`,
                    });
                    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-medium hover:bg-emerald-100 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  {lang === 'en' ? 'Excel' : 'Excel'}
                </button>
                {/* PDF export */}
                <button
                  onClick={() => {
                    const isAr = lang !== 'en';
                    const headers = compCertVisibleCols.map(c => isAr ? c.labelAr : c.labelEn);
                    const totalVal = ccFmtNum(compCertDrawerTotal);
                    const tableRows = compCertDrawerRows.map((r: any, i: number) => {
                      const cells = compCertVisibleCols.map(c => {
                        const v = ccGetVal(r, c.key);
                        const isN = ccIsNum(c); const isD = ccIsDate(c);
                        return `<td style="text-align:${isN?'left':'right'};direction:${isN||isD?'ltr':'rtl'}">${ccFmtCell(v, c)}</td>`;
                      }).join('');
                      return `<tr style="background:${i%2===0?'#fff':'#f9fafb'}">${cells}</tr>`;
                    }).join('');
                    const totalColIdx = compCertVisibleCols.findIndex(c => c.key === 'totalInvoiced');
                    const footerRow = totalColIdx >= 0
                      ? `<tfoot><tr style="border-top:2px solid #334155">${compCertVisibleCols.map((_: any, i: number) => i < totalColIdx ? '<td></td>' : i === totalColIdx - 1 ? `<td style="text-align:right">${isAr?'الإجمالي':'Total'}</td>` : `<td style="text-align:left;direction:ltr">${totalVal}</td>`).join('')}</tr></tfoot>`
                      : '';
                    const compNameP = (isAr ? reportHdr?.companyNameAr : reportHdr?.companyNameEn) ?? '';
                    const lwP = reportHdr?.logoLeftWidthPdf ?? 120;
                    const rwP = reportHdr?.logoRightWidthPdf ?? 120;
                    const leftLogoP  = reportHdr?.logoLeftUrl  ? `<img src="${reportHdr.logoLeftUrl}"  style="width:${lwP}px;max-height:60px;object-fit:contain" />` : '';
                    const rightLogoP = reportHdr?.logoRightUrl ? `<img src="${reportHdr.logoRightUrl}" style="width:${rwP}px;max-height:60px;object-fit:contain" />` : '';
                    const w = window.open('', '_blank');
                    if (!w) return;
                    w.document.write(`<!DOCTYPE html><html dir="${isAr?'rtl':'ltr'}"><head><meta charset="utf-8">
                      <title>${isAr ? 'شهادات الإنجاز المكتملة' : 'Completed w/ Cert'}</title>
                      <style>
                        body{font-family:Arial,sans-serif;font-size:11px;direction:${isAr?'rtl':'ltr'};margin:0;padding:16px}
                        .sub{color:#666;margin-bottom:12px;font-size:11px}
                        table{border-collapse:collapse;width:100%}
                        th,td{border:1px solid #ddd;padding:4px 7px;white-space:nowrap}
                        th{background:#334155;color:#fff;font-weight:bold}
                        tfoot td{font-weight:bold;background:#e2e8f0;color:#334155}
                        @page{size:landscape;margin:12mm}
                      </style></head><body>
                      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 8px;background:#f8fafc;border-bottom:3px solid #334155;margin-bottom:12px;">
                        <div style="width:${lwP}px;display:flex;align-items:center;justify-content:center">${leftLogoP}</div>
                        <div style="flex:1;text-align:center;padding:0 12px;direction:${isAr?'rtl':'ltr'}">
                          ${compNameP?`<div style="font-size:13px;font-weight:bold;color:#334155;margin-bottom:4px">${compNameP}</div>`:''}
                          <div style="font-size:11px;color:#334155">${isAr?'شهادات الإنجاز المكتملة':'Completed w/ Cert'}</div>
                          <div style="font-size:10px;color:#64748b;margin-top:2px">${new Date().toLocaleDateString(isAr?'ar-SA':'en-CA')}</div>
                        </div>
                        <div style="width:${rwP}px;display:flex;align-items:center;justify-content:center">${rightLogoP}</div>
                      </div>
                      <div class="sub">${compCertDrawerRows.length} ${isAr?'أمر':'orders'} · ~${totalVal} ${isAr?'ر.س':'SAR'}</div>
                      <table>
                        <thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead>
                        <tbody>${tableRows}</tbody>
                        ${footerRow}
                      </table>
                      <script>window.addEventListener('load',function(){window.focus();window.print();});<\/script>
                      </body></html>`);
                    w.document.close();
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 text-xs font-medium hover:bg-rose-100 transition-colors"
                >
                  <FileText className="w-3.5 h-3.5" />
                  {lang === 'en' ? 'PDF' : 'PDF'}
                </button>
                <button onClick={() => setCompCertDrawerOpen(false)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            {/* Body */}
            <div className="flex-1 overflow-auto p-4">
              {compCertDrawerLoading ? (
                <div className="flex items-center justify-center h-40 text-slate-400 text-sm gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin" />{lang === 'en' ? 'Loading...' : 'جارٍ التحميل...'}
                </div>
              ) : compCertDrawerRows.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-slate-400 text-sm">
                  {lang === 'en' ? 'No records found.' : 'لا توجد سجلات.'}
                </div>
              ) : (() => {
                  type VCol = { key: string; labelAr: string; labelEn: string; dataType?: string };
                  const totalColVisible = compCertColKeys.includes('totalInvoiced');
                  return (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="bg-indigo-50 text-indigo-800">
                            {compCertVisibleCols.map((col: VCol) => (
                              <th
                                key={col.key}
                                className={`px-3 py-2 font-semibold border-b border-indigo-200 whitespace-nowrap ${ccIsNum(col) ? 'text-left' : 'text-right'}`}
                              >
                                {lang === 'en' ? col.labelEn : col.labelAr}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {compCertDrawerRows.map((row: any, i: number) => (
                            <tr key={row.orderNumber ?? i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                              {compCertVisibleCols.map((col: VCol) => {
                                const v = ccGetVal(row, col.key);
                                const isNum   = ccIsNum(col);
                                const isDate  = ccIsDate(col);
                                const isTotal = col.key === 'totalInvoiced';
                                const isOrder = col.key === 'orderNumber';
                                return (
                                  <td
                                    key={col.key}
                                    className={`px-3 py-2 whitespace-nowrap ${isOrder ? 'font-medium text-indigo-700' : isTotal ? 'font-semibold text-indigo-600 text-left' : isNum ? 'text-slate-700 text-left' : 'text-slate-600'}`}
                                    dir={isNum || isDate ? 'ltr' : undefined}
                                  >
                                    {ccFmtCell(v, col)}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                        {totalColVisible && (
                          <tfoot>
                            <tr className="bg-indigo-50 font-semibold border-t-2 border-indigo-200">
                              <td colSpan={compCertVisibleCols.length - 1} className="px-3 py-2 text-right text-slate-600">
                                {lang === 'en' ? 'Total invoiced' : 'إجمالي المفوتر'}
                              </td>
                              <td className="px-3 py-2 text-indigo-700 text-left" dir="ltr">
                                {compCertDrawerTotal.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                              </td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  );
                })()}
            </div>
          </div>
        </>
      )}

      {/* ── Column Picker Modal (شهادات الإنجاز المكتملة) ──────────────────── */}
      {compCertPickerOpen && (
        <ColumnPickerModal
          tableKey="COMP_CERT"
          availableCols={compCertAvailableCols}
          selectedKeys={compCertColKeys}
          onSave={keys => setCompCertColKeys(keys)}
          onClose={() => setCompCertPickerOpen(false)}
          maxCols={COMP_CERT_MAX_COLS}
        />
      )}

      {/* ── Column Picker Modal (مغلقة لم تُفوتر) ──────────────────────────── */}
      {kpiPickerOpen && (
        <ColumnPickerModal
          tableKey="KPI_CLOSED"
          availableCols={kpiAvailableCols}
          selectedKeys={kpiColKeys}
          onSave={(keys: string[]) => setKpiColKeys(keys)}
          onClose={() => setKpiPickerOpen(false)}
          maxCols={KPI_MAX_COLS}
        />
      )}

      {/* ── Column Picker Modal (مفوتر ولم يصدر له شهادة إنجاز) ────────────── */}
      {certPickerOpen && (
        <ColumnPickerModal
          tableKey="CERT_NO_CERT"
          availableCols={certAvailableCols}
          selectedKeys={certColKeys}
          onSave={(keys: string[]) => setCertColKeys(keys)}
          onClose={() => setCertPickerOpen(false)}
          maxCols={CERT_MAX_COLS}
        />
      )}

      {/* ── Status Drawer ────────────────────────────────────────────────────── */}
      <KpiDrawer
        open={!!statusDrawer}
        onClose={() => setStatusDrawer(null)}
        title={
          statusDrawer?.status === 'OVERDUE'   ? 'أوامر العمل المتأخرة' :
          statusDrawer?.status === 'WARNING'   ? 'أوامر العمل في حالة تنبيه' :
          statusDrawer?.status === 'ON_TIME'   ? 'أوامر العمل المنتظمة' :
          statusDrawer?.status === 'COMPLETED' ? 'أوامر العمل المنجزة' :
          'جميع أوامر العمل'
        }
        titleEn={
          statusDrawer?.status === 'OVERDUE'   ? 'Overdue Orders' :
          statusDrawer?.status === 'WARNING'   ? 'Warning Orders' :
          statusDrawer?.status === 'ON_TIME'   ? 'On-Time Orders' :
          statusDrawer?.status === 'COMPLETED' ? 'Completed Orders' :
          'All Orders'
        }
        icon={
          statusDrawer?.status === 'OVERDUE'  ? AlertTriangle :
          statusDrawer?.status === 'WARNING'  ? Clock :
          statusDrawer?.status === 'COMPLETED'? CheckCircle2 :
          BarChart2
        }
        iconColorCls={
          statusDrawer?.status === 'OVERDUE'  ? 'text-red-500' :
          statusDrawer?.status === 'WARNING'  ? 'text-amber-500' :
          statusDrawer?.status === 'COMPLETED'? 'text-emerald-500' :
          'text-indigo-500'
        }
        rows={statusDrawer?.rows ?? []}
        loading={statusDrawer?.loading ?? false}
        availableCols={statusDrawerAvailCols}
        colKeys={statusDrawerColKeys}
        onColKeysChange={setStatusDrawerColKeys}
        lang={lang}
        reportHeader={reportHdr ?? undefined}
      />

      {/* ── Metric Drawer ────────────────────────────────────────────────────── */}
      <KpiDrawer
        open={!!metricDrawer}
        onClose={() => setMetricDrawer(null)}
        title={metricDrawer ? `تفاصيل: ${metricDrawer.nameAr}` : ''}
        titleEn={metricDrawer ? `Detail: ${metricDrawer.nameEn ?? metricDrawer.nameAr}` : ''}
        icon={TrendingUp}
        iconColorCls="text-violet-500"
        rows={metricDrawer?.rows ?? []}
        loading={metricDrawer?.loading ?? false}
        availableCols={metricDrawerAvailCols}
        colKeys={metricDrawerColKeys}
        onColKeysChange={setMetricDrawerColKeys}
        lang={lang}
        reportHeader={reportHdr ?? undefined}
      />

      {/* ── Pending Survey Drawer ────────────────────────────────────────────── */}
      <KpiDrawer
        open={!!pendingSurveyDrawer}
        onClose={() => setPendingSurveyDrawer(null)}
        title="أوامر العمل غير الممسوحة"
        titleEn="Unsurveyed Work Orders"
        icon={Clock}
        iconColorCls="text-amber-500"
        rows={pendingSurveyDrawer?.rows ?? []}
        loading={pendingSurveyDrawer?.loading ?? false}
        availableCols={pendingSurveyAvailCols}
        colKeys={pendingSurveyColKeys}
        onColKeysChange={setPendingSurveyColKeys}
        lang={lang}
        reportHeader={reportHdr ?? undefined}
        renderCell={(row, col) => {
          if (col.key === 'statusColor') {
            const c = row.statusColor;
            if (!c) return null;
            const map: Record<string, { ar: string; en: string; cls: string }> = {
              red:   { ar: 'متأخر',  en: 'Overdue',   cls: 'bg-red-100 text-red-700' },
              amber: { ar: 'تنبيه',  en: 'Warning',   cls: 'bg-amber-100 text-amber-700' },
              green: { ar: 'منتظم',  en: 'On Track',  cls: 'bg-emerald-100 text-emerald-700' },
            };
            const l = map[c];
            return l ? <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${l.cls}`}>{lang === 'en' ? l.en : l.ar}</span> : null;
          }
          return null;
        }}
      />

      {/* ── Pending Coordination Drawer ───────────────────────────────────────── */}
      <KpiDrawer
        open={!!pendingCoordDrawer}
        onClose={() => setPendingCoordDrawer(null)}
        title="أوامر العمل غير المنسقة"
        titleEn="Uncoordinated Work Orders"
        icon={Clock}
        iconColorCls="text-indigo-500"
        rows={pendingCoordDrawer?.rows ?? []}
        loading={pendingCoordDrawer?.loading ?? false}
        availableCols={pendingCoordAvailCols}
        colKeys={pendingCoordColKeys}
        onColKeysChange={setPendingCoordColKeys}
        lang={lang}
        reportHeader={reportHdr ?? undefined}
        renderCell={(row, col) => {
          if (col.key === 'statusColor') {
            const c = row.statusColor;
            if (!c) return null;
            const map: Record<string, { ar: string; en: string; cls: string }> = {
              red:   { ar: 'متأخر',  en: 'Overdue',   cls: 'bg-red-100 text-red-700' },
              amber: { ar: 'تنبيه',  en: 'Warning',   cls: 'bg-amber-100 text-amber-700' },
              green: { ar: 'منتظم',  en: 'On Track',  cls: 'bg-emerald-100 text-emerald-700' },
            };
            const l = map[c];
            return l ? <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${l.cls}`}>{lang === 'en' ? l.en : l.ar}</span> : null;
          }
          return null;
        }}
      />

      {/* ── Billing Drawer ───────────────────────────────────────────────────── */}
      <KpiDrawer
        open={!!billingDrawer}
        onClose={() => setBillingDrawer(null)}
        title={billingDrawer?.type === 'partialBilled' ? 'أوامر مفوترة جزئياً' : 'أوامر غير مُحصَّلة بالكامل'}
        titleEn={billingDrawer?.type === 'partialBilled' ? 'Partially Billed Orders' : 'Not Fully Collected Orders'}
        icon={billingDrawer?.type === 'partialBilled' ? FileText : BadgeAlert}
        iconColorCls={billingDrawer?.type === 'partialBilled' ? 'text-indigo-500' : 'text-amber-500'}
        rows={billingDrawer?.rows ?? []}
        loading={billingDrawer?.loading ?? false}
        availableCols={billingDrawerAvailCols}
        colKeys={billingDrawerColKeys}
        onColKeysChange={setBillingDrawerColKeys}
        lang={lang}
        reportHeader={reportHdr ?? undefined}
      />

    </div>
    </MetricCfgCtx.Provider>
  );
}
