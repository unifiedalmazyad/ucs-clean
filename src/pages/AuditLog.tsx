import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { useLang } from '../contexts/LangContext';
import {
  ScrollText, Download, RefreshCw, ChevronDown, ChevronUp,
  Loader2, X, User, Calendar, Filter, AlertTriangle,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// ─── Maps ─────────────────────────────────────────────────────────────────────

const ACTION_META: Record<string, { ar: string; en: string; cls: string }> = {
  CREATE:          { ar: 'إنشاء',           en: 'Create',          cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  UPDATE:          { ar: 'تعديل',           en: 'Update',          cls: 'bg-blue-100    text-blue-700    border-blue-200'    },
  DELETE:          { ar: 'حذف',             en: 'Delete',          cls: 'bg-red-100     text-red-700     border-red-200'     },
  LOGIN:           { ar: 'تسجيل دخول',      en: 'Login',           cls: 'bg-slate-100   text-slate-600   border-slate-300'   },
  LOGOUT:          { ar: 'تسجيل خروج',      en: 'Logout',          cls: 'bg-slate-100   text-slate-500   border-slate-200'   },
  PASSWORD_CHANGE: { ar: 'تغيير كلمة المرور', en: 'Password Change', cls: 'bg-amber-100   text-amber-700   border-amber-200'   },
};

const ENTITY_META: Record<string, { ar: string; en: string; cls: string }> = {
  WORK_ORDER: { ar: 'أمر عمل',  en: 'Work Order', cls: 'bg-blue-100    text-blue-700    border-blue-200'    },
  USER:       { ar: 'مستخدم',   en: 'User',       cls: 'bg-sky-100     text-sky-700     border-sky-200'     },
  STAGE:      { ar: 'مرحلة',    en: 'Stage',      cls: 'bg-teal-100    text-teal-700    border-teal-200'    },
  REGION:     { ar: 'منطقة',    en: 'Region',     cls: 'bg-indigo-100  text-indigo-700  border-indigo-200'  },
  SECTOR:     { ar: 'قطاع',     en: 'Sector',     cls: 'bg-orange-100  text-orange-700  border-orange-200'  },
};

const SKIP_DIFF_FIELDS = new Set([
  'id', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy',
  'customFields', 'attachments',
]);

// Human-readable Arabic labels for camelCase field keys
const FIELD_LABELS: Record<string, { ar: string; en: string }> = {
  orderNumber:              { ar: 'رقم الأمر',           en: 'Order Number' },
  stageId:                  { ar: 'المرحلة',             en: 'Stage' },
  regionId:                 { ar: 'المنطقة',             en: 'Region' },
  sectorId:                 { ar: 'القطاع',              en: 'Sector' },
  projectType:              { ar: 'نوع المشروع',          en: 'Project Type' },
  assignmentDate:           { ar: 'تاريخ التعميد',       en: 'Assignment Date' },
  estimatedValue:           { ar: 'القيمة التقديرية',    en: 'Estimated Value' },
  actualInvoiceValue:       { ar: 'المبلغ المفوتر',      en: 'Invoice Value' },
  collectedAmount:          { ar: 'المبلغ المحصّل',      en: 'Collected Amount' },
  remainingAmount:          { ar: 'المبلغ المتبقي',      en: 'Remaining Amount' },
  invoice2BillingDate:      { ar: 'تاريخ الفوترة 2',      en: 'Invoice 2 Billing Date' },
  financialCloseDate:       { ar: 'تاريخ الإغلاق المالي', en: 'Financial Close Date' },
  excavationCompletionDate: { ar: 'تاريخ اكتمال الحفر', en: 'Excavation Date' },
  surveyNotes:              { ar: 'ملاحظات المسح',       en: 'Survey Notes' },
  executionNotes:           { ar: 'ملاحظات التنفيذ',    en: 'Execution Notes' },
  electricalTeam:           { ar: 'فريق الكهرباء',      en: 'Electrical Team' },
  d9No:                     { ar: 'رقم D9',              en: 'D9 No.' },
  procedure:                { ar: 'الإجراء',             en: 'Procedure' },
  username:                 { ar: 'اسم المستخدم',        en: 'Username' },
  fullName:                 { ar: 'الاسم الكامل',        en: 'Full Name' },
  role:                     { ar: 'الدور',               en: 'Role' },
  active:                   { ar: 'الحالة',              en: 'Status' },
  email:                    { ar: 'البريد الإلكتروني',   en: 'Email' },
  phoneNumber:              { ar: 'رقم الجوال',          en: 'Phone' },
  employeeId:               { ar: 'رقم الموظف',          en: 'Employee ID' },
  nameAr:                   { ar: 'الاسم (عربي)',        en: 'Arabic Name' },
  nameEn:                   { ar: 'الاسم (إنجليزي)',     en: 'English Name' },
  seq:                      { ar: 'الترتيب',             en: 'Order' },
  isTerminal:               { ar: 'مرحلة نهائية',       en: 'Is Terminal' },
  isCancelled:              { ar: 'مرحلة إلغاء',        en: 'Is Cancelled' },
  category:                 { ar: 'الفئة',               en: 'Category' },
  slaDays:                  { ar: 'مدة SLA (أيام)',      en: 'SLA Days' },
};

function fieldLabel(key: string, lang: string): string {
  const m = FIELD_LABELS[key];
  if (m) return lang === 'en' ? m.en : m.ar;
  // Convert camelCase to readable form as fallback
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
}

// UUID pattern
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Resolve UUID values to human-readable names using lookup maps
function resolveValue(
  fieldKey: string,
  value: any,
  lookups: { stages: any[]; regions: any[]; sectors: any[] }
): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا';
  const str = String(value);
  if (!UUID_RE.test(str)) {
    if (typeof value === 'object') return JSON.stringify(value).slice(0, 80);
    return str;
  }
  // Try resolving UUID by field context
  if (fieldKey === 'stageId' || fieldKey === 'stage_id') {
    const s = lookups.stages.find(x => x.id === str);
    if (s) return s.nameAr ?? s.nameEn ?? str;
  }
  if (fieldKey === 'regionId' || fieldKey === 'region_id') {
    const r = lookups.regions.find(x => x.id === str);
    if (r) return r.nameAr ?? r.nameEn ?? str;
  }
  if (fieldKey === 'sectorId' || fieldKey === 'sector_id') {
    const s = lookups.sectors.find(x => x.id === str);
    if (s) return s.nameAr ?? s.nameEn ?? str;
  }
  // Unresolved UUID — show shortened form
  return str.slice(0, 8) + '…';
}

// ─── Diff helpers ─────────────────────────────────────────────────────────────

interface DiffEntry { field: string; old: any; new: any }

function computeDiff(changes: any, action: string): DiffEntry[] {
  if (!changes) return [];
  const before: Record<string, any> = changes.before || {};
  const after:  Record<string, any> = changes.after  || {};

  if (action === 'CREATE') {
    return Object.entries(after)
      .filter(([k, v]) => !SKIP_DIFF_FIELDS.has(k) && v !== null && v !== '' && v !== undefined)
      .map(([k, v]) => ({ field: k, old: null, new: v }));
  }
  if (action === 'DELETE') {
    return Object.entries(before)
      .filter(([k, v]) => !SKIP_DIFF_FIELDS.has(k) && v !== null && v !== '' && v !== undefined)
      .map(([k, v]) => ({ field: k, old: v, new: null }));
  }
  if (action === 'UPDATE') {
    const allKeys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter(k => !SKIP_DIFF_FIELDS.has(k));
    return allKeys
      .filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
      .map(k => ({ field: k, old: before[k], new: after[k] }));
  }
  return [];
}

function formatValue(v: any): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'نعم' : 'لا';
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 80);
  return String(v);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ActionBadge({ action, lang }: { action: string; lang: string }) {
  const m = ACTION_META[action] ?? { ar: action, en: action, cls: 'bg-slate-100 text-slate-600 border-slate-200' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${m.cls}`}>
      {lang === 'en' ? m.en : m.ar}
    </span>
  );
}

function EntityBadge({ entityType, lang }: { entityType: string; lang: string }) {
  const m = ENTITY_META[entityType] ?? { ar: entityType, en: entityType, cls: 'bg-slate-100 text-slate-600 border-slate-200' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${m.cls}`}>
      {lang === 'en' ? m.en : m.ar}
    </span>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuditRow {
  id: string;
  actorUserId: string;
  actorName: string | null;
  actorUsername: string | null;
  entityType: string;
  entityId: string;
  action: string;
  changes: any;
  createdAt: string;
}

interface Actor { id: string; fullName: string; username: string }

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AuditLog() {
  const { lang } = useLang();
  const dir = lang === 'en' ? 'ltr' : 'rtl';
  const navigate = useNavigate();

  // ── data state ──
  const [rows, setRows]   = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError]  = useState('');

  // ── pagination ──
  const [page, setPage]   = useState(1);
  const limit = 50;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  // ── filters ──
  const [filterFrom,       setFilterFrom]       = useState('');
  const [filterTo,         setFilterTo]         = useState('');
  const [filterEntityType, setFilterEntityType] = useState('');
  const [filterAction,     setFilterAction]     = useState('');
  const [filterActorId,    setFilterActorId]    = useState('');

  // ── lookup maps for UUID resolution ──
  const [lookups, setLookups] = useState<{ stages: any[]; regions: any[]; sectors: any[] }>({
    stages: [], regions: [], sectors: [],
  });

  // ── meta for filter dropdowns ──
  const [actors,      setActors]      = useState<Actor[]>([]);
  const [entityTypes, setEntityTypes] = useState<string[]>([]);
  const [actions,     setActions]     = useState<string[]>([]);

  // ── UI ──
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  // ── fetch data ──────────────────────────────────────────────────────────────
  const fetchData = useCallback(async (p = page) => {
    setLoading(true);
    setError('');
    try {
      const params: Record<string, string> = { page: String(p), limit: String(limit) };
      if (filterFrom)       params.from         = filterFrom;
      if (filterTo)         params.to           = filterTo;
      if (filterEntityType) params.entityType   = filterEntityType;
      if (filterAction)     params.action       = filterAction;
      if (filterActorId)    params.actorUserId  = filterActorId;

      const res = await api.get('/audit-logs', { params });
      setRows(res.data.rows);
      setTotal(res.data.total);
    } catch {
      setError(lang === 'ar' ? 'فشل تحميل السجلات' : 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  }, [page, filterFrom, filterTo, filterEntityType, filterAction, filterActorId, lang]);

  // fetch meta once
  useEffect(() => {
    api.get('/audit-logs/actors').then(r => setActors(r.data)).catch(() => {});
    api.get('/audit-logs/meta').then(r => {
      setEntityTypes(r.data.entityTypes);
      setActions(r.data.actions);
    }).catch(() => {});
    // fetch lookup tables for UUID resolution in diff view
    Promise.all([
      api.get('/admin/stages').catch(() => ({ data: [] })),
      api.get('/admin/regions').catch(() => ({ data: [] })),
      api.get('/admin/sectors').catch(() => ({ data: [] })),
    ]).then(([st, rg, sc]) => {
      setLookups({
        stages:  Array.isArray(st.data) ? st.data : [],
        regions: Array.isArray(rg.data) ? rg.data : [],
        sectors: Array.isArray(sc.data) ? sc.data : [],
      });
    });
  }, []);

  // fetch on filter/page change
  useEffect(() => { fetchData(page); }, [page]);

  // ── apply filters (reset to page 1) ─────────────────────────────────────────
  const applyFilters = () => {
    setPage(1);
    fetchData(1);
    setExpanded(new Set());
  };

  const clearFilters = () => {
    setFilterFrom('');
    setFilterTo('');
    setFilterEntityType('');
    setFilterAction('');
    setFilterActorId('');
    setPage(1);
    setExpanded(new Set());
    setTimeout(() => fetchData(1), 0);
  };

  const hasFilters = filterFrom || filterTo || filterEntityType || filterAction || filterActorId;

  // ── expand row ───────────────────────────────────────────────────────────────
  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ── export ───────────────────────────────────────────────────────────────────
  const handleExport = async () => {
    setExporting(true);
    try {
      const params: Record<string, string> = {};
      if (filterFrom)       params.from       = filterFrom;
      if (filterTo)         params.to         = filterTo;
      if (filterEntityType) params.entityType = filterEntityType;
      if (filterAction)     params.action     = filterAction;
      if (filterActorId)    params.actorUserId = filterActorId;

      const qs = new URLSearchParams(params).toString();
      const token = localStorage.getItem('token') || '';
      const resp = await fetch(`/api/audit-logs/export?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error();
      const blob = await resp.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `audit_log_${new Date().toISOString().slice(0,10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(lang === 'ar' ? 'فشل التصدير' : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  // ── helpers ──────────────────────────────────────────────────────────────────
  const actorLabel  = (r: AuditRow) => r.actorName || r.actorUsername || '—';
  const entityLabel = (r: AuditRow) => {
    const ch = r.changes as any;
    const orderNum = ch?.after?.orderNumber || ch?.before?.orderNumber;
    if (orderNum) return orderNum;
    if (r.entityId && r.entityId.length < 20) return r.entityId;
    return r.entityId ? r.entityId.slice(0, 8) + '…' : '—';
  };

  const isWO = (r: AuditRow) => r.entityType === 'WORK_ORDER';

  const formatDate = (d: string) => {
    const dt = new Date(d);
    return dt.toLocaleDateString('en-GB') + ' ' + dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  };

  // ── entity type label ────────────────────────────────────────────────────────
  const entityTypeLabel = (type: string) => {
    const m = ENTITY_META[type];
    if (!m) return type;
    return lang === 'ar' ? m.ar : m.en;
  };

  const actionLabel = (a: string) => {
    const m = ACTION_META[a];
    if (!m) return a;
    return lang === 'ar' ? m.ar : m.en;
  };

  // ─── render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50" dir={dir}>

      {/* ── Top command bar ── */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center">
              <ScrollText className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-800" data-testid="text-audit-title">
                {lang === 'ar' ? 'سجل المراجعة' : 'Audit Log'}
              </h1>
              <p className="text-xs text-slate-500">
                {lang === 'ar'
                  ? `${total.toLocaleString('en-US')} إجمالي السجلات`
                  : `${total.toLocaleString('en-US')} total records`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchData(page)}
              disabled={loading}
              data-testid="button-refresh-audit"
              className="flex items-center gap-2 px-3 py-2 text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={handleExport}
              disabled={exporting}
              data-testid="button-export-audit"
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50"
            >
              {exporting
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Download className="w-4 h-4" />}
              {lang === 'ar' ? 'تصدير Excel' : 'Export Excel'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div className="bg-white border-b border-slate-200 px-6 py-3">
        <div className="flex flex-wrap items-end gap-3">

          {/* Date from */}
          <div className="flex flex-col gap-1 min-w-[140px]">
            <label className="text-xs text-slate-500 font-medium">
              {lang === 'ar' ? 'من تاريخ' : 'Date From'}
            </label>
            <div className="relative">
              <Calendar className="absolute top-2 right-2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                type="date"
                value={filterFrom}
                onChange={e => setFilterFrom(e.target.value)}
                data-testid="input-filter-from"
                className="w-full pr-8 pl-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
          </div>

          {/* Date to */}
          <div className="flex flex-col gap-1 min-w-[140px]">
            <label className="text-xs text-slate-500 font-medium">
              {lang === 'ar' ? 'إلى تاريخ' : 'Date To'}
            </label>
            <div className="relative">
              <Calendar className="absolute top-2 right-2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                type="date"
                value={filterTo}
                onChange={e => setFilterTo(e.target.value)}
                data-testid="input-filter-to"
                className="w-full pr-8 pl-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
          </div>

          {/* Entity type */}
          <div className="flex flex-col gap-1 min-w-[140px]">
            <label className="text-xs text-slate-500 font-medium">
              {lang === 'ar' ? 'نوع الكيان' : 'Entity Type'}
            </label>
            <select
              value={filterEntityType}
              onChange={e => setFilterEntityType(e.target.value)}
              data-testid="select-filter-entity"
              className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
            >
              <option value="">{lang === 'ar' ? 'الكل' : 'All'}</option>
              {entityTypes.map(et => (
                <option key={et} value={et}>{entityTypeLabel(et)}</option>
              ))}
            </select>
          </div>

          {/* Action */}
          <div className="flex flex-col gap-1 min-w-[140px]">
            <label className="text-xs text-slate-500 font-medium">
              {lang === 'ar' ? 'الإجراء' : 'Action'}
            </label>
            <select
              value={filterAction}
              onChange={e => setFilterAction(e.target.value)}
              data-testid="select-filter-action"
              className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
            >
              <option value="">{lang === 'ar' ? 'الكل' : 'All'}</option>
              {actions.map(a => (
                <option key={a} value={a}>{actionLabel(a)}</option>
              ))}
            </select>
          </div>

          {/* Actor */}
          <div className="flex flex-col gap-1 min-w-[160px]">
            <label className="text-xs text-slate-500 font-medium">
              {lang === 'ar' ? 'المستخدم' : 'User'}
            </label>
            <select
              value={filterActorId}
              onChange={e => setFilterActorId(e.target.value)}
              data-testid="select-filter-actor"
              className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
            >
              <option value="">{lang === 'ar' ? 'الكل' : 'All'}</option>
              {actors.map(a => (
                <option key={a.id} value={a.id}>{a.fullName || a.username}</option>
              ))}
            </select>
          </div>

          {/* Apply / Clear */}
          <div className="flex items-end gap-2 pb-0">
            <button
              onClick={applyFilters}
              data-testid="button-apply-filters"
              className="flex items-center gap-2 px-4 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
            >
              <Filter className="w-4 h-4" />
              {lang === 'ar' ? 'تطبيق' : 'Apply'}
            </button>
            {hasFilters && (
              <button
                onClick={clearFilters}
                data-testid="button-clear-filters"
                className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
                {lang === 'ar' ? 'مسح' : 'Clear'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* ── Table ── */}
      <div className="p-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">

          {/* Results info */}
          <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
            <span className="text-xs text-slate-500">
              {loading
                ? (lang === 'ar' ? 'جارٍ التحميل…' : 'Loading…')
                : lang === 'ar'
                  ? `يعرض ${rows.length} من ${total.toLocaleString('en-US')} سجل`
                  : `Showing ${rows.length} of ${total.toLocaleString('en-US')} records`}
            </span>
            <span className="text-xs text-slate-400">
              {lang === 'ar'
                ? `صفحة ${page} من ${totalPages}`
                : `Page ${page} of ${totalPages}`}
            </span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-48 gap-3 text-indigo-600">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span className="text-sm">{lang === 'ar' ? 'جارٍ التحميل…' : 'Loading…'}</span>
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-slate-400">
              <ScrollText className="w-10 h-10" />
              <span className="text-sm">{lang === 'ar' ? 'لا توجد سجلات' : 'No records found'}</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-audit-log">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                    <th className="px-4 py-3 text-start font-semibold w-10">#</th>
                    <th className="px-4 py-3 text-start font-semibold min-w-[160px]">
                      {lang === 'ar' ? 'التاريخ' : 'Date'}
                    </th>
                    <th className="px-4 py-3 text-start font-semibold min-w-[140px]">
                      {lang === 'ar' ? 'المستخدم' : 'User'}
                    </th>
                    <th className="px-4 py-3 text-start font-semibold min-w-[120px]">
                      {lang === 'ar' ? 'الإجراء' : 'Action'}
                    </th>
                    <th className="px-4 py-3 text-start font-semibold min-w-[110px]">
                      {lang === 'ar' ? 'الكيان' : 'Entity'}
                    </th>
                    <th className="px-4 py-3 text-start font-semibold min-w-[140px]">
                      {lang === 'ar' ? 'رقم الأمر / المعرف' : 'Order / ID'}
                    </th>
                    <th className="px-4 py-3 text-start font-semibold">
                      {lang === 'ar' ? 'التغييرات' : 'Changes'}
                    </th>
                    <th className="px-4 py-3 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row, idx) => {
                    const rowNum    = (page - 1) * limit + idx + 1;
                    const isExpanded = expanded.has(row.id);
                    const diff      = computeDiff(row.changes, row.action);
                    const hasDiff   = diff.length > 0;
                    const orderNum  = (row.changes as any)?.after?.orderNumber
                                   || (row.changes as any)?.before?.orderNumber;

                    // Preview: first 2 changed fields for UPDATE
                    let preview = '';
                    if (row.action === 'UPDATE' && diff.length > 0) {
                      preview = diff.slice(0, 2)
                        .map(d => `${fieldLabel(d.field, lang)}: ${resolveValue(d.field, d.old, lookups)} ← ${resolveValue(d.field, d.new, lookups)}`)
                        .join(' | ');
                      if (diff.length > 2) preview += ` …(+${diff.length - 2})`;
                    } else if (row.action === 'CREATE') {
                      preview = lang === 'ar' ? `إنشاء جديد (${diff.length} حقل)` : `New record (${diff.length} fields)`;
                    } else if (row.action === 'DELETE') {
                      preview = lang === 'ar' ? 'تم الحذف' : 'Deleted';
                    }

                    return [
                      <tr
                        key={row.id}
                        data-testid={`row-audit-${row.id}`}
                        className={`transition-colors ${isExpanded ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
                      >
                        <td className="px-4 py-3 text-slate-400 text-xs">{rowNum}</td>
                        <td className="px-4 py-3 text-slate-600 tabular-nums text-xs whitespace-nowrap">
                          {formatDate(row.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0">
                              <User className="w-3 h-3 text-slate-500" />
                            </div>
                            <span className="text-slate-700 font-medium truncate max-w-[120px]" title={actorLabel(row)}>
                              {actorLabel(row)}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <ActionBadge action={row.action} lang={lang} />
                        </td>
                        <td className="px-4 py-3">
                          <EntityBadge entityType={row.entityType} lang={lang} />
                        </td>
                        <td className="px-4 py-3">
                          {isWO(row) && orderNum ? (
                            <button
                              onClick={() => navigate(`/work-orders/${row.entityId}`)}
                              data-testid={`link-audit-order-${row.id}`}
                              className="text-indigo-600 hover:text-indigo-800 font-medium hover:underline text-xs"
                            >
                              {orderNum}
                            </button>
                          ) : (
                            <span className="text-slate-500 text-xs font-mono">{entityLabel(row)}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 max-w-xs">
                          {preview ? (
                            <span className="text-xs text-slate-500 truncate block" title={preview}>{preview}</span>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {hasDiff && (
                            <button
                              onClick={() => toggleExpand(row.id)}
                              data-testid={`button-expand-${row.id}`}
                              className="w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-100 transition-colors"
                            >
                              {isExpanded
                                ? <ChevronUp className="w-4 h-4" />
                                : <ChevronDown className="w-4 h-4" />}
                            </button>
                          )}
                        </td>
                      </tr>,

                      // ── Expanded diff row ──
                      isExpanded && hasDiff && (
                        <tr key={`${row.id}-diff`} className="bg-indigo-50 border-b border-indigo-100">
                          <td colSpan={8} className="px-6 py-4">
                            <div className="bg-white rounded-lg border border-indigo-200 overflow-hidden shadow-sm">
                              <div className="px-4 py-2.5 bg-indigo-600 text-white text-xs font-semibold">
                                {row.action === 'UPDATE'
                                  ? (lang === 'ar' ? `${diff.length} حقل متغير` : `${diff.length} changed field(s)`)
                                  : row.action === 'CREATE'
                                    ? (lang === 'ar' ? 'تفاصيل الإنشاء' : 'Creation Details')
                                    : (lang === 'ar' ? 'تفاصيل الحذف' : 'Deletion Details')}
                              </div>
                              <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="bg-slate-50 border-b border-slate-100 text-slate-500">
                                      <th className="px-4 py-2 text-start font-semibold w-1/4">
                                        {lang === 'ar' ? 'الحقل' : 'Field'}
                                      </th>
                                      {row.action !== 'CREATE' && (
                                        <th className="px-4 py-2 text-start font-semibold w-5/12 text-red-600">
                                          {lang === 'ar' ? 'القيمة القديمة' : 'Old Value'}
                                        </th>
                                      )}
                                      {row.action !== 'DELETE' && (
                                        <th className="px-4 py-2 text-start font-semibold w-5/12 text-emerald-600">
                                          {lang === 'ar' ? 'القيمة الجديدة' : 'New Value'}
                                        </th>
                                      )}
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-50">
                                    {diff.map((d, di) => (
                                      <tr key={di} className="hover:bg-slate-50">
                                        <td className="px-4 py-2 text-slate-700 font-medium">{fieldLabel(d.field, lang)}</td>
                                        {row.action !== 'CREATE' && (
                                          <td className="px-4 py-2 text-red-600 break-all">
                                            {resolveValue(d.field, d.old, lookups)}
                                          </td>
                                        )}
                                        {row.action !== 'DELETE' && (
                                          <td className="px-4 py-2 text-emerald-700 break-all">
                                            {resolveValue(d.field, d.new, lookups)}
                                          </td>
                                        )}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ),
                    ];
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Pagination ── */}
          {!loading && totalPages > 1 && (
            <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between bg-slate-50">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                data-testid="button-prev-page"
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {dir === 'rtl' ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                {lang === 'ar' ? 'السابق' : 'Prev'}
              </button>

              <div className="flex items-center gap-1.5">
                {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                  let p: number;
                  if (totalPages <= 7) {
                    p = i + 1;
                  } else if (page <= 4) {
                    p = i < 5 ? i + 1 : i === 5 ? -1 : totalPages;
                  } else if (page >= totalPages - 3) {
                    p = i === 0 ? 1 : i === 1 ? -1 : totalPages - (6 - i);
                  } else {
                    const center = [1, -1, page - 1, page, page + 1, -2, totalPages];
                    p = center[i];
                  }
                  if (p === -1 || p === -2) {
                    return <span key={`ellipsis-${i}`} className="text-slate-400 px-1">…</span>;
                  }
                  return (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      data-testid={`button-page-${p}`}
                      className={`w-8 h-8 text-sm rounded-lg transition-colors ${
                        p === page
                          ? 'bg-indigo-600 text-white font-semibold'
                          : 'text-slate-600 hover:bg-slate-100 border border-slate-200'
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                data-testid="button-next-page"
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {lang === 'ar' ? 'التالي' : 'Next'}
                {dir === 'rtl' ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
