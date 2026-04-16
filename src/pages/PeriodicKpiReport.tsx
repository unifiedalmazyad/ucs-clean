import React, { useEffect, useState, useCallback, useMemo } from 'react';
import api from '../services/api';
import { useLang } from '../contexts/LangContext';
import {
  RefreshCw, ChevronDown, BarChart2, Clock, CheckCircle2,
  XCircle, AlertTriangle, TrendingUp, ArrowRight, Search, X,
  EyeOff, Eye, SlidersHorizontal, Download, Printer, Link2, Calendar,
  FileX2, BadgeAlert,
} from 'lucide-react';

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

interface DateBasisOption { type: string; labelAr: string; labelEn: string; columnKey: string | null }
interface MetricResult { code: string; nameAr: string; nameEn?: string; metricType?: 'DATE_DIFF' | 'NUMERIC_AGG'; aggFunction?: string | null; avgDays: number | null; totalDays: number; count: number; thresholdDays: number | null; statusColor: 'red' | 'amber' | 'green' | null }
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
interface KpiAlerts { closedNotInvoiced: number; invoicedNoCert: number; }
interface Summary {
  total: number; active: number; completed: number; cancelled: number;
  overdue: number; warning: number; onTime: number; unconfigured: number;
  avgDays: number | null; metricsAverages: MetricResult[]; from: string; to: string;
  billingCounts?: { partialBilled: number; notFullyBilled: number };
  finEnabled?: boolean; finCounts?: FinSumCounts | null;
  kpiAlerts?: KpiAlerts | null;
}
interface RegionCard {
  id: string; nameAr: string; nameEn?: string; sectorId: string | null; sectorNameAr: string | null; sectorNameEn?: string | null;
  total: number; active: number; completed: number; cancelled: number;
  overdue: number; warning: number; onTime: number; avgDays: number | null;
  metricsAverages: MetricResult[];
  execDelayedJustified: number; execDelayedUnjustified: number;
  finDelayedJustified: number; finDelayedUnjustified: number;
}
interface FinCounts { total: number; completed: number; overdue: number; warning: number; onTime: number; slaDays?: number; }
interface PtStat {
  projectTypeValue: string; projectTypeLabelAr: string; projectTypeLabelEn?: string; configured: boolean;
  slaDays?: number; warningDays?: number;
  total: number; active?: number; completed?: number; cancelled?: number;
  overdue?: number; warning?: number; onTime?: number; avgDays?: number | null;
  metricsAverages?: MetricResult[];
  finCounts?: FinCounts | null;
}
interface RegionDetails {
  projectTypeStats: PtStat[];
  overdueWOs: any[]; onTimeWOs: any[];
  cancelledWOs: any[]; reasonWOs: any[];
  finOverdueWOs: any[]; finOnTimeWOs: any[];
  finStats: FinCounts | null;
  finEnabled: boolean; includeCancelled: boolean;
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
  { key: 'actualInvoiceValue', labelAr: 'القيمة الفعلية', labelEn: 'Actual Value' },
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

function StatCard({ label, value, icon: Icon, colorCls, subLabel, execVal, finVal }: {
  label: string; value: number | string | null; icon?: any; colorCls?: string; subLabel?: string;
  execVal?: number | null; finVal?: number | null;
}) {
  const { lang } = useLang();
  const showDetail = execVal != null && finVal != null;
  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-1 bg-white shadow-sm ${colorCls ?? 'border-slate-200'}`}>
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

function MetricCard({ m }: { m: MetricResult }) {
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
    <div className={`rounded-xl border bg-white shadow-sm p-4 flex flex-col gap-1 w-full h-full ${isNumeric ? 'border-violet-100' : 'border-slate-200'}`}>
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
  tableKey, availableCols, selectedKeys, onSave, onClose,
}: {
  tableKey: 'EXEC' | 'FIN' | 'REASONS';
  availableCols: { key: string; labelAr: string; labelEn?: string; virtual?: boolean }[];
  selectedKeys: string[];
  onSave: (keys: string[]) => void;
  onClose: () => void;
}) {
  const { lang } = useLang();
  const validKeys = useMemo(
    () => selectedKeys.filter(k => availableCols.some(c => c.key === k)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const [selected, setSelected] = useState<string[]>(validKeys);
  const atMax = selected.length >= MAX_COLS;
  const toggle = (key: string) => setSelected(prev => {
    if (prev.includes(key)) return prev.filter(k => k !== key);
    if (prev.length >= MAX_COLS) return prev;
    return [...prev, key];
  });
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" dir={lang === 'en' ? 'ltr' : 'rtl'}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="font-bold text-slate-800">{lang === 'en' ? 'Select Columns' : 'اختيار الأعمدة'}</h2>
            <p className={`text-xs mt-0.5 ${atMax ? 'text-amber-600 font-medium' : 'text-slate-400'}`}>
              {selected.length}/{MAX_COLS} {lang === 'en' ? 'columns' : 'أعمدة'} {atMax && (lang === 'en' ? '— Max reached' : '— الحد الأقصى')}
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
          <span className="text-[11px] shrink-0 px-2 py-0.5 rounded-full font-medium" style={{ background: '#eef2ff', color: '#4338ca', border: '1px solid #c7d2fe' }}>
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
  const [activeTab, setActiveTab] = useState<'overdue' | 'exec-justified' | 'ontime' | 'fin' | 'fin-justified' | 'cancelled' | 'reasons'>('overdue');
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
          {(details.overdueWOs.length > 0 || details.onTimeWOs.length > 0 || details.finEnabled || details.cancelledWOs?.length > 0 || details.reasonWOs?.length > 0) && (
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
                  ...(details.includeCancelled && (details.cancelledWOs?.length ?? 0) > 0 ? [{ key: 'cancelled', label: lang === 'en' ? `Cancelled (${details.cancelledWOs?.length ?? 0})` : `الملغيات (${details.cancelledWOs?.length ?? 0})`, color: 'text-slate-600' } as any] : []),
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
              {activeTab === 'cancelled' && details.includeCancelled && (
                <WOTable
                  wos={details.cancelledWOs ?? []} title={lang === 'en' ? 'Cancelled' : 'الملغيات'}
                  tableKey="EXEC" selectedColKeys={execColKeys} allCols={allExecCols.length ? allExecCols : ALL_WO_COLS}
                  onOpenPicker={() => onOpenColPicker('EXEC')}
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
    dateBasisType: 'CREATED_AT',
    dateBasisColumnKey: '',
  });
  const [appliedFilters, setAppliedFilters] = useState<Filters | null>(null);

  // ── Client-side display state
  const [hideEmpty,         setHideEmpty]         = useState(false);
  const [viewMode,          setViewMode]          = useState('all');
  const [searchText,        setSearchText]        = useState('');
  const [copySuccess,       setCopySuccess]       = useState(false);
  const [includeCancelled,  setIncludeCancelled]  = useState(false);
  const [includeCompleted,  setIncludeCompleted]  = useState(true);

  // ── Column picker state
  const [execColKeys,    setExecColKeys]    = useState<string[]>(DEFAULT_EXEC_COLS);
  const [finColKeys,     setFinColKeys]     = useState<string[]>(ALL_FIN_COLS.map(c => c.key));
  const [reasonsColKeys, setReasonsColKeys] = useState<string[]>(DEFAULT_REASONS_COLS);
  const [pickerOpen,     setPickerOpen]     = useState<'EXEC' | 'FIN' | 'REASONS' | null>(null);
  const [catalogCols,    setCatalogCols]    = useState<{ key: string; labelAr: string; labelEn: string; dataType?: string }[]>([]);

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
  const buildQS = (f: Filters, incCancelled: boolean, incCompleted: boolean) => {
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
    p.set('includeCancelled', String(incCancelled));
    p.set('includeCompleted', String(incCompleted));
    return p.toString();
  };

  const fetchData = useCallback(async (f: Filters, incCancelled: boolean, incCompleted: boolean) => {
    const qs = buildQS(f, incCancelled, incCompleted);
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
    if (appliedFilters) fetchData(appliedFilters, includeCancelled, includeCompleted);
  }, [appliedFilters, fetchData, includeCancelled, includeCompleted]);

  const fetchDetails = useCallback(async (region: RegionCard, f: Filters, incCancelled: boolean, incCompleted: boolean) => {
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
      p.set('includeCancelled', String(incCancelled));
      p.set('includeCompleted', String(incCompleted));
      const res = await api.get(`/reports/periodic-kpis/region/${region.id}/details?${p}`);
      setRegionDetails(res.data);
    } catch (e) { console.error(e); }
    finally { setLoadingDetails(false); }
  }, []);

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleRegionClick = (region: RegionCard) => {
    setExpandedRegion(region);
    if (appliedFilters) fetchDetails(region, appliedFilters, includeCancelled, includeCompleted);
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
    setIncludeCancelled(false); setIncludeCompleted(true);
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
    rows.push([en ? 'Total' : 'الإجمالي', en ? 'Overdue' : 'متأخر', en ? 'Warning' : 'تنبيه', en ? 'On Track' : 'منتظم', en ? 'Done' : 'منجز', en ? 'Cancelled' : 'ملغي']);
    rows.push([summary?.total ?? '', summary?.overdue ?? '', summary?.warning ?? '', summary?.onTime ?? '', summary?.completed ?? '', summary?.cancelled ?? '']);
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
        ? ['Region', 'Sector', 'Total', 'Active', 'Overdue', 'Overdue (Justified)', 'Warning', 'On Track', 'Done', 'Cancelled']
        : ['المنطقة', 'القطاع', 'الإجمالي', 'نشطة', 'متأخر', 'متأخر مسبب', 'تنبيه', 'منتظم', 'منجز', 'ملغي']),
      ...metricCols,
    ]);
    visibleRegionCards.forEach(r => {
      const regionMetrics = allMetrics.map(m => {
        const rm = r.metricsAverages?.find(rm2 => rm2.code === m.code);
        return rm?.avgDays != null ? rm.avgDays : '—';
      });
      rows.push([rn(r), sn(r), r.total, r.active, r.execDelayedUnjustified ?? r.overdue, r.execDelayedJustified ?? 0, r.warning, r.onTime, r.completed, r.cancelled, ...regionMetrics]);
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
              onClick={() => appliedFilters && fetchData(appliedFilters, includeCancelled, includeCompleted)}
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
              { key: 'includeCancelled', label: lang === 'en' ? 'Cancelled' : 'الملغية', value: includeCancelled, set: setIncludeCancelled },
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
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-slate-200 bg-white h-24 animate-pulse" />
            ))}
          </div>
        ) : summary && (
          <>
            {/* Cards — RTL order (first HTML = rightmost): متأخرة · تنبيه · منتظمة · منجزة · ملغية · الإجمالي */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <StatCard
                label={lang === 'en' ? 'Overdue' : 'متأخرة'}
                value={summary.finEnabled && summary.finCounts ? summary.overdue + summary.finCounts.overdue : summary.overdue}
                icon={AlertTriangle}
                colorCls={summary.overdue > 0 ? 'border-red-200 bg-red-50/30' : 'border-slate-200'}
                execVal={summary.finEnabled && summary.finCounts ? summary.overdue : undefined}
                finVal={summary.finEnabled && summary.finCounts ? summary.finCounts.overdue : undefined}
              />
              <StatCard
                label={lang === 'en' ? 'Warning' : 'تنبيه'}
                value={summary.warning + (summary.finEnabled && summary.finCounts ? summary.finCounts.warning : 0)}
                icon={Clock}
                colorCls={summary.warning > 0 ? 'border-amber-200 bg-amber-50/30' : 'border-slate-200'}
                execVal={summary.finEnabled ? summary.warning : undefined}
                finVal={summary.finEnabled ? (summary.finCounts?.warning ?? 0) : undefined}
              />
              <StatCard
                label={lang === 'en' ? 'On Track' : 'منتظمة'}
                value={summary.onTime + (summary.finEnabled && summary.finCounts ? summary.finCounts.onTime : 0)}
                icon={CheckCircle2}
                colorCls="border-emerald-50"
                execVal={summary.finEnabled ? summary.onTime : undefined}
                finVal={summary.finEnabled ? (summary.finCounts?.onTime ?? 0) : undefined}
              />
              <StatCard
                label={lang === 'en' ? 'Done' : 'منجزة'}
                value={summary.finEnabled && summary.finCounts ? summary.completed + summary.finCounts.completed : summary.completed}
                icon={CheckCircle2}
                colorCls="border-emerald-100"
                execVal={summary.finEnabled && summary.finCounts ? summary.completed : undefined}
                finVal={summary.finEnabled && summary.finCounts ? summary.finCounts.completed : undefined}
              />
              <StatCard
                label={lang === 'en' ? 'Cancelled' : 'ملغية'}
                value={summary.cancelled}
                icon={XCircle}
                colorCls="border-slate-200"
                execVal={summary.finEnabled ? summary.cancelled : undefined}
                finVal={summary.finEnabled ? 0 : undefined}
              />
              <StatCard
                label={lang === 'en' ? 'Total Period' : 'الإجمالي ضمن الفترة'}
                value={summary.finEnabled && summary.finCounts ? summary.total + summary.finCounts.total : summary.total}
                icon={BarChart2}
                execVal={summary.finEnabled && summary.finCounts ? summary.total : undefined}
                finVal={summary.finEnabled && summary.finCounts ? summary.finCounts.total : undefined}
              />
            </div>

            {/* Billing counts badges */}
            {summary.billingCounts && (summary.billingCounts.partialBilled > 0 || summary.billingCounts.notFullyBilled > 0) && (
              <div className="flex flex-wrap gap-3">
                {summary.billingCounts.partialBilled > 0 && (
                  <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-2.5 shadow-sm">
                    <span className="text-xl font-bold text-indigo-700">{summary.billingCounts.partialBilled}</span>
                    <span className="text-xs font-medium text-indigo-600">{lang === 'en' ? 'Partially Billed' : 'مفوتر جزئياً'}</span>
                  </div>
                )}
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
                      <div className="flex gap-3 flex-wrap items-stretch">
                        {dateDiff.map(m => <div key={m.nameAr} style={{ flex: '1 1 150px' }}><MetricCard m={m} /></div>)}
                      </div>
                    </div>
                  )}
                  {(numericAgg.length > 0 || !!summary.kpiAlerts) && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <BarChart2 className="w-3.5 h-3.5 text-violet-400" />
                        <span className="text-xs font-semibold text-slate-500">{lang === 'en' ? 'Quantity Indicators' : 'مؤشرات كمية'}</span>
                      </div>
                      <div className="flex gap-3 flex-wrap items-stretch">
                        {numericAgg.map(m => <div key={m.nameAr} style={{ flex: '1 1 150px' }}><MetricCard m={m} /></div>)}
                        {/* كرت: مغلقة لم تُفوتر */}
                        {summary.kpiAlerts && (
                          <div style={{ flex: '1 1 150px' }}>
                            <div className={`rounded-xl border p-4 flex flex-col gap-1 bg-white shadow-sm h-full ${
                              summary.kpiAlerts.closedNotInvoiced > 0 ? 'border-orange-200 bg-orange-50/30' : 'border-slate-200'
                            }`}>
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-slate-500">{lang === 'en' ? 'Closed w/o Invoice' : 'مغلقة لم تُفوتر'}</span>
                                <FileX2 className={`w-4 h-4 ${summary.kpiAlerts.closedNotInvoiced > 0 ? 'text-orange-400' : 'text-slate-300'}`} />
                              </div>
                              <div className={`text-2xl font-bold ${summary.kpiAlerts.closedNotInvoiced > 0 ? 'text-orange-600' : 'text-slate-400'}`}>
                                {summary.kpiAlerts.closedNotInvoiced}
                              </div>
                              <div className="text-xs text-slate-400">{lang === 'en' ? 'work orders' : 'أمر عمل'}</div>
                            </div>
                          </div>
                        )}
                        {/* كرت: فُوتر بلا شهادة إنجاز */}
                        {summary.kpiAlerts && (
                          <div style={{ flex: '1 1 150px' }}>
                            <div className={`rounded-xl border p-4 flex flex-col gap-1 bg-white shadow-sm h-full ${
                              summary.kpiAlerts.invoicedNoCert > 0 ? 'border-amber-200 bg-amber-50/30' : 'border-slate-200'
                            }`}>
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-slate-500">{lang === 'en' ? 'Invoiced — No Cert' : 'فُوتر — بلا شهادة إنجاز'}</span>
                                <BadgeAlert className={`w-4 h-4 ${summary.kpiAlerts.invoicedNoCert > 0 ? 'text-amber-400' : 'text-slate-300'}`} />
                              </div>
                              <div className={`text-2xl font-bold ${summary.kpiAlerts.invoicedNoCert > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                                {summary.kpiAlerts.invoicedNoCert}
                              </div>
                              <div className="text-xs text-slate-400">{lang === 'en' ? 'work orders' : 'أمر عمل'}</div>
                            </div>
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

    </div>
    </MetricCfgCtx.Provider>
  );
}
