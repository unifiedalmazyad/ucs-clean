import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useLang } from '../contexts/LangContext';
import MultiSelectDropdown from '../components/MultiSelectDropdown';
import { getColLabel, getLang } from '../i18n';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus, Search, X, FileText, Loader2, Trash2,
  AlertTriangle, CheckCircle2, XCircle, RefreshCw,
  ChevronDown, ChevronLeft, Filter, SlidersHorizontal, Layers,
} from 'lucide-react';

// ─── Static special columns (always first, custom renderers) ────────────────
// orderNumber is always visible and fixed — not in this list
const SPECIAL_COLS: { key: string; labelAr: string; labelEn: string }[] = [
  { key: 'execStatus',    labelAr: 'حالة التنفيذ',  labelEn: 'Exec Status'    },
  { key: 'finStatus',     labelAr: 'حالة المالي',    labelEn: 'Fin Status'     },
  { key: 'overallStatus', labelAr: 'الحالة العامة', labelEn: 'Overall Status' },
];
const SPECIAL_KEYS = new Set(SPECIAL_COLS.map(c => c.key));

// Default visible set stored in localStorage — keyed per user so each role gets independent prefs
const getLsKey = () => {
  try {
    const u = JSON.parse(localStorage.getItem('user') || '{}');
    return `wo_visible_cols_v6_${u.id || u.role || 'anon'}`;
  } catch { return 'wo_visible_cols_v6_anon'; }
};
const loadVisibleCols = (defaultKeys: string[], availableKeys: Set<string>): Set<string> => {
  try {
    const saved = localStorage.getItem(getLsKey());
    if (saved) {
      // Only keep saved columns that the current user can actually see
      const filtered = new Set((JSON.parse(saved) as string[]).filter(k => availableKeys.has(k)));
      if (filtered.size > 0) return filtered;
      // If saved prefs don't overlap with available → fall through to defaults
    }
  } catch { /* ignore */ }
  return new Set(defaultKeys.filter(k => availableKeys.has(k)));
};
const saveVisibleCols = (cols: Set<string>) =>
  localStorage.setItem(getLsKey(), JSON.stringify([...cols]));

// Helper: convert snake_case / kebab-case to camelCase for row field access
const toCamel = (s: string) => s.replace(/_(\d+)/g, (_, n) => n).replace(/_([a-z])/g, (_, c) => c.toUpperCase());

// Helper: format a raw value from a row for display
function renderCellVal(value: any, dataType: string, colKey: string, optMap: Record<string, { value: string; labelAr: string; labelEn?: string }[]>): string {
  if (value === null || value === undefined || value === '') return '—';
  if (dataType === 'date' || dataType === 'timestamp' || dataType === 'timestamp with time zone') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  if (dataType === 'currency' || dataType === 'number' || dataType === 'numeric') {
    const n = parseFloat(value);
    return isNaN(n) ? String(value) : n.toLocaleString('en-US');
  }
  if ((dataType === 'select' || dataType === 'boolean') && optMap[colKey]) {
    const opt = optMap[colKey].find(o => o.value === String(value));
    if (!opt) return String(value);
    const isEn = getLang() === 'en';
    return (isEn && opt.labelEn) ? opt.labelEn : opt.labelAr;
  }
  return String(value);
}

const STATUS_CFG: Record<string, { labelAr: string; labelEn: string; color: string; icon: any; bg: string; border: string }> = {
  OVERDUE:        { labelAr: 'متأخر',        labelEn: 'Delayed',         color: 'text-red-700',     icon: XCircle,       bg: 'bg-red-50',     border: 'border-red-200' },
  WARN:           { labelAr: 'تنبيه',        labelEn: 'Warning',         color: 'text-amber-700',   icon: AlertTriangle, bg: 'bg-amber-50',   border: 'border-amber-200' },
  OK:             { labelAr: 'منتظم',        labelEn: 'On Track',        color: 'text-emerald-700', icon: CheckCircle2,  bg: 'bg-emerald-50', border: 'border-emerald-200' },
  COMPLETED:      { labelAr: 'منجز',         labelEn: 'Completed',       color: 'text-blue-700',    icon: CheckCircle2,  bg: 'bg-blue-50',    border: 'border-blue-200' },
  COMPLETED_LATE: { labelAr: 'منجز متأخر',  labelEn: 'Completed Late',  color: 'text-purple-700',  icon: CheckCircle2,  bg: 'bg-purple-50',  border: 'border-purple-200' },
  CANCELLED:      { labelAr: 'ملغى',         labelEn: 'Cancelled',       color: 'text-slate-600',   icon: XCircle,       bg: 'bg-slate-100',  border: 'border-slate-300' },
  CLOSED:         { labelAr: 'مغلق',         labelEn: 'Closed',          color: 'text-teal-700',    icon: CheckCircle2,  bg: 'bg-teal-50',    border: 'border-teal-200' },
  NONE:           { labelAr: '—',            labelEn: '—',               color: 'text-slate-400',   icon: FileText,      bg: 'bg-slate-50',   border: 'border-slate-200' },
  INCOMPLETE:     { labelAr: 'ناقص بيانات', labelEn: 'Incomplete',      color: 'text-slate-500',   icon: FileText,      bg: 'bg-slate-50',   border: 'border-slate-200' },
};

// Single status badge
function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.NONE;
  const lang = getLang();
  const label = lang === 'en' ? cfg.labelEn : cfg.labelAr;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold border ${cfg.bg} ${cfg.border} ${cfg.color} whitespace-nowrap`}>
      <Icon className="w-3 h-3 flex-shrink-0" />
      {label}
    </span>
  );
}

export default function WorkOrders() {
  const navigate = useNavigate();
  const { lang, t } = useLang();

  // ─── Current User Scope ───────────────────────────────────────────────────
  const getStoredUser = () => {
    try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; }
  };
  const [currentUser, setCurrentUser] = useState<any>(getStoredUser);

  // Refresh user permissions from server — ensures role changes are reflected
  // without requiring re-login
  useEffect(() => {
    api.get('/auth/me').then(res => {
      const fresh = res.data;
      const stored = getStoredUser();
      const merged = { ...stored, ...fresh };
      localStorage.setItem('user', JSON.stringify(merged));
      setCurrentUser(merged);
    }).catch(() => {});
  }, []);

  const userRegionId:  string  = currentUser.regionId  ?? '';
  const userSectorId:  string  = currentUser.sectorId  ?? '';
  const isUnrestricted = ['ADMIN', 'MANAGER'].includes(currentUser.role ?? '');
  // Exec / Financial KPI card visibility — default true for backward compat
  const canViewExecKpiCards: boolean = currentUser.canViewExecKpiCards !== false;
  const canViewFinKpiCards:  boolean = currentUser.canViewFinKpiCards  !== false;
  // Infer scopeType from user data (fallback for sessions before scopeType was added)
  const userScopeType: string  = currentUser.scopeType
    ?? (userRegionId  ? 'OWN_REGION'
      : userSectorId  ? 'OWN_SECTOR'
      : 'ALL');

  // ─── KPI Report State ─────────────────────────────────────────────────────
  const [kpiReport,   setKpiReport]   = useState<any>(null);
  const [kpiLoading,  setKpiLoading]  = useState(true);
  const [dashCards,   setDashCards]   = useState<any>(null);
  const [dashLoading, setDashLoading] = useState(true);

  // ─── Filters ──────────────────────────────────────────────────────────────
  const [filterStatus,          setFilterStatus]          = useState<string[]>([]);
  const [filterWorkStatusClass, setFilterWorkStatusClass] = useState<string[]>([]);
  const [filterExecStatuses,    setFilterExecStatuses]    = useState<string[]>([]);
  const [filterFinStatuses,     setFilterFinStatuses]     = useState<string[]>([]);
  const [filterOverallStatuses, setFilterOverallStatuses] = useState<string[]>([]);
  // Pre-lock region/sector based on user scope
  const [filterRegions,      setFilterRegions]      = useState<string[]>(
    userScopeType === 'OWN_REGION' && userRegionId ? [userRegionId] : []
  );
  const [filterSectors,      setFilterSectors]      = useState<string[]>(
    userScopeType === 'OWN_SECTOR' && userSectorId ? [userSectorId] : []
  );
  const [filterProjectTypes, setFilterProjectTypes] = useState<string[]>([]);
  const [filterProcedures,   setFilterProcedures]   = useState<string[]>([]);
  const [filterDelays,       setFilterDelays]       = useState<string[]>([]);
  const [search,            setSearch]            = useState('');
  // Category-level card filter: { cat: 'EXEC'|'FIN', status: 'OK'|'WARN'|'OVERDUE' } | null
  const [filterCat,         setFilterCat]         = useState<{ cat: string; status: string } | null>(null);
  // '' = search across default cols; otherwise = specific columnKey (snake_case)
  const [searchCol,         setSearchCol]         = useState('');
  // إظهار المغلق والملغي
  const [showHidden,        setShowHidden]        = useState(false);
  // Grouping: null = flat list, 'procedure' = group by current procedure
  const [groupBy,           setGroupBy]           = useState<string | null>(null);

  // ─── Expanded Row ─────────────────────────────────────────────────────────
  const [expanded, setExpanded] = useState<string | null>(null);

  // ─── Dynamic Columns (fetched from backend) ──────────────────────────────
  const [dynCols,      setDynCols]      = useState<any[]>([]);
  const [colOptMap,    setColOptMap]    = useState<Record<string, { value: string; labelAr: string }[]>>({});
  const [colsLoaded,   setColsLoaded]   = useState(false);

  useEffect(() => {
    api.get('/work-orders/table-columns').then(res => {
      const cols = res.data.columns as any[];
      setDynCols(cols);
      setColOptMap(res.data.options ?? {});
      // Default visible: all 3 special cols + key catalog cols (by name for stability)
      const PRIORITY_COLS = ['project_type', 'work_type', 'client', 'district', 'procedure'];
      const priorityVisible = cols
        .filter((c: any) => PRIORITY_COLS.includes(c.columnKey))
        .sort((a: any, b: any) => PRIORITY_COLS.indexOf(a.columnKey) - PRIORITY_COLS.indexOf(b.columnKey))
        .map((c: any) => c.columnKey);
      const defaultKeys = [
        ...SPECIAL_COLS.map(c => c.key),   // execStatus, finStatus, overallStatus
        ...priorityVisible,
      ];
      // availableKeys = all columns this user can read (special + dynamic)
      const availableKeys = new Set<string>([
        ...SPECIAL_COLS.map(c => c.key),
        ...cols.map((c: any) => c.columnKey),
      ]);
      setVisibleCols(loadVisibleCols(defaultKeys, availableKeys));
      setColsLoaded(true);
    }).catch(err => {
      console.error('Failed to load table columns', err);
      setColsLoaded(true);
    });
  }, []);

  // ─── Column Visibility ────────────────────────────────────────────────────
  const [visibleCols,     setVisibleCols]     = useState<Set<string>>(new Set());
  const [showColPicker,   setShowColPicker]   = useState(false);
  const colPickerRef = useRef<HTMLDivElement>(null);

  const toggleCol = (key: string) => {
    setVisibleCols(prev => {
      const next = new Set<string>(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      saveVisibleCols(next);
      return next;
    });
  };

  const isCol = (key: string) => visibleCols.has(key);

  // Dynamic cols visible in table (exclude special cols — they have hardcoded positions)
  const visibleDynCols = dynCols.filter(c => isCol(c.columnKey));

  // Close col picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target as Node)) {
        setShowColPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ─── Create Modal ─────────────────────────────────────────────────────────
  const [showModal,     setShowModal]     = useState(false);
  const [creating,      setCreating]      = useState(false);
  const [createFields,  setCreateFields]  = useState<any[]>([]);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [formData,      setFormData]      = useState<Record<string, any>>({});
  const [formError,     setFormError]     = useState('');

  // ─── Fetch KPI Report ─────────────────────────────────────────────────────
  // For multi-select: only send filter to backend when exactly 1 value selected
  // (backend supports single values only); multi-value filtering is done client-side
  const fetchReport = useCallback(async () => {
    setKpiLoading(true);
    try {
      const params = new URLSearchParams({ status: 'ALL' });
      if (filterRegions.length      === 1) params.set('regionId',    filterRegions[0]);
      if (filterSectors.length      === 1) params.set('sectorId',    filterSectors[0]);
      if (filterProjectTypes.length === 1) params.set('projectType', filterProjectTypes[0]);
      const res = await api.get(`/kpis/report?${params}`);
      setKpiReport(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setKpiLoading(false);
    }
  }, [filterRegions, filterSectors, filterProjectTypes]);

  // ─── Fetch Dashboard Cards (5-state from DASHBOARD-scoped rules) ──────────
  const fetchDashCards = useCallback(async () => {
    setDashLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterSectors.length      === 1) params.set('sectorId',    filterSectors[0]);
      if (filterRegions.length      === 1) params.set('regionId',    filterRegions[0]);
      if (filterProjectTypes.length === 1) params.set('projectType', filterProjectTypes[0]);
      const res = await api.get(`/kpis/dashboard-cards?${params}`);
      setDashCards(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setDashLoading(false);
    }
  }, [filterSectors, filterRegions, filterProjectTypes]);

  useEffect(() => { fetchReport(); }, [fetchReport]);
  useEffect(() => { fetchDashCards(); }, [fetchDashCards]);

  // ─── Derived Data ─────────────────────────────────────────────────────────
  const allRows            = kpiReport?.rows            ?? [];
  const allRegions         = kpiReport?.regions         ?? [];
  const allSectors         = kpiReport?.sectors         ?? [];
  const projectTypeOptions = kpiReport?.projectTypeOptions ?? [];

  // Dashboard card counts — from the DASHBOARD-scoped KPI endpoint (5 states)
  const DC = dashCards ?? { exec: {}, fin: {} };
  const execOk            = DC.exec?.OK             ?? 0;
  const execWarn          = DC.exec?.WARN           ?? 0;
  const execOverdue       = DC.exec?.OVERDUE        ?? 0;
  const execCompleted     = DC.exec?.COMPLETED      ?? 0;
  const execCompletedLate = DC.exec?.COMPLETED_LATE ?? 0;
  const finOk             = DC.fin?.OK              ?? 0;
  const finWarn           = DC.fin?.WARN            ?? 0;
  const finOverdue        = DC.fin?.OVERDUE         ?? 0;
  const finCompleted      = DC.fin?.COMPLETED       ?? 0;
  const finCompletedLate  = DC.fin?.COMPLETED_LATE  ?? 0;

  const isCardsLoading = dashLoading;

  // catWorstStatus still used for table-row filtering (ORDER-scoped KPIs)
  const CAT_ORDER: Record<string, number> = { OVERDUE: 0, WARN: 1, OK: 2, INCOMPLETE: 3 };
  const catWorstStatus = (kpis: any[], cat: string): string => {
    const ks = (kpis ?? []).filter((k: any) => k.category === cat);
    if (!ks.length) return 'NONE';
    return ks.reduce((w: string, k: any) =>
      (CAT_ORDER[k.status] ?? 9) < (CAT_ORDER[w] ?? 9) ? k.status : w, 'INCOMPLETE');
  };

  // عدد أوامر العمل المغلقة (لإظهار العداد) — الملغية مخفية دائماً
  const totalClosedCount = allRows.filter((r: any) =>
    r.overallStatus === 'CLOSED'
  ).length;

  const filteredRows = allRows.filter((row: any) => {
    // الأوامر الملغية مخفية دائماً — إلا إذا كان البحث يطابق رقم الأمر تماماً
    if (row.dashExec === 'CANCELLED') {
      const orderNum = String(row.orderNumber ?? '').toLowerCase();
      const q = search.trim().toLowerCase();
      if (!q || !orderNum || orderNum !== q) return false;
    }
    // إخفاء المغلق افتراضياً ما لم يُفعَّل خيار إظهارها أو فلتر كرت نشط
    const isHidden = row.overallStatus === 'CLOSED';
    if (isHidden && !showHidden && !filterCat) return false;

    if (filterStatus.length > 0 && !filterStatus.includes(row.worstStatus)) return false;
    if (filterWorkStatusClass.length > 0) {
      const wsc = row.workStatusClassification ?? row.work_status_classification ?? '';
      if (!filterWorkStatusClass.includes(wsc)) return false;
    }
    // فلاتر حالات KPI (حالة التنفيذ / المالية / العامة)
    if (filterExecStatuses.length    > 0 && !filterExecStatuses.includes(row.execStatus    ?? '')) return false;
    if (filterFinStatuses.length     > 0 && !filterFinStatuses.includes(row.finStatus      ?? '')) return false;
    if (filterOverallStatuses.length > 0 && !filterOverallStatuses.includes(row.overallStatus ?? '')) return false;
    // Multi-select client-side filters
    if (filterRegions.length      > 0 && !filterRegions.includes(row.regionId      ?? '')) return false;
    if (filterSectors.length      > 0 && !filterSectors.includes(row.sectorId      ?? '')) return false;
    if (filterProjectTypes.length > 0 && !filterProjectTypes.includes(row.projectType ?? '')) return false;
    if (filterProcedures.length   > 0 && !filterProcedures.includes(row.procedure   ?? '')) return false;
    if (filterDelays.length > 0) {
      const execDelayed = row.execStatus === 'OVERDUE' || row.execStatus === 'COMPLETED_LATE';
      const finDelayed  = row.finStatus  === 'OVERDUE' || row.finStatus  === 'COMPLETED_LATE';
      const matchesAny = filterDelays.some(d => {
        if (d === 'EXEC_JUSTIFIED')   return execDelayed && row.execDelayJustified === true;
        if (d === 'EXEC_UNJUSTIFIED') return execDelayed && row.execDelayJustified !== true;
        if (d === 'FIN_JUSTIFIED')    return finDelayed  && row.finDelayJustified  === true;
        if (d === 'FIN_UNJUSTIFIED')  return finDelayed  && row.finDelayJustified  !== true;
        return false;
      });
      if (!matchesAny) return false;
    }
    if (filterCat) {
      const dashVal = filterCat.cat === 'EXEC' ? row.dashExec : row.dashFin;
      const effectiveVal = dashVal && dashVal !== 'NONE'
        ? dashVal
        : catWorstStatus(row.kpis, filterCat.cat);
      if (effectiveVal !== filterCat.status) return false;
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      if (searchCol) {
        // خريطة تحويل قيم الحالة إلى تسميات عربية للبحث
        const STATUS_AR: Record<string, string> = {
          COMPLETED: 'منجز', COMPLETED_LATE: 'منجز متأخر', CANCELLED: 'مغلق ملغي ملغى',
          OVERDUE: 'متأخر', WARN: 'تنبيه', OK: 'منتظم', NONE: '—', CLOSED: 'مغلق',
        };
        if (searchCol.startsWith('__special__')) {
          const fieldKey = searchCol.replace('__special__', '');
          const raw = String(row[fieldKey] ?? '');
          const label = (STATUS_AR[raw] ?? raw).toLowerCase();
          return label.includes(q);
        }
        // تحويل snake_case → camelCase للوصول لحقل الصف
        const camelKey = searchCol.replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase());
        const val = String(row[camelKey] ?? row[searchCol] ?? '').toLowerCase();
        return val.includes(q);
      }
      // البحث في جميع حقول الصف — مع ترجمة قيم الحالة إلى عربي
      const STATUS_ALL_AR: Record<string, string> = {
        COMPLETED: 'منجز', COMPLETED_LATE: 'منجز متأخر', CANCELLED: 'مغلق ملغي ملغى',
        OVERDUE: 'متأخر', WARN: 'تنبيه', OK: 'منتظم', NONE: '—', CLOSED: 'مغلق',
        PENDING: 'معلق', IN_PROGRESS: 'جاري', REJECTED: 'مرفوض تم رفض',
      };
      return Object.values(row).some(v => {
        if (v === null || v === undefined || Array.isArray(v) || typeof v === 'object') return false;
        const raw = String(v);
        const translated = STATUS_ALL_AR[raw] ?? raw;
        return translated.toLowerCase().includes(q);
      });
    }
    return true;
  }).sort((a: any, b: any) => {
    // dashExec هو الحقل الصحيح الذي يحمل: COMPLETED / COMPLETED_LATE / CANCELLED
    const DONE = new Set(['COMPLETED', 'COMPLETED_LATE', 'CANCELLED']);
    const aDone = DONE.has(a.dashExec);
    const bDone = DONE.has(b.dashExec);
    // منجز متأخر / منجز / مغلق → يذهب للأسفل دائماً بغض النظر عن التاريخ
    if (aDone && !bDone) return 1;
    if (!aDone && bDone) return -1;
    // النشطة: الأقدم تاريخ إسناد في الأعلى (المتأخر الأقدم أولاً)
    const da = a.assignmentDate ? new Date(a.assignmentDate).getTime() : Infinity;
    const db2 = b.assignmentDate ? new Date(b.assignmentDate).getTime() : Infinity;
    return da - db2;
  });

  // Locked values (from user scope) don't count as user-applied filters
  const lockedRegion = userScopeType === 'OWN_REGION' ? userRegionId : '';
  const lockedSector = userScopeType === 'OWN_SECTOR' ? userSectorId : '';
  const hasFilters =
    (filterRegions.length      > 0 && !(filterRegions.length      === 1 && filterRegions[0]      === lockedRegion))
    || (filterSectors.length   > 0 && !(filterSectors.length      === 1 && filterSectors[0]      === lockedSector))
    || filterProjectTypes.length > 0 || filterProcedures.length > 0 || filterDelays.length > 0
    || !!search.trim() || !!filterCat || !!searchCol || showHidden
    || filterStatus.length > 0 || filterWorkStatusClass.length > 0
    || filterExecStatuses.length > 0 || filterFinStatuses.length > 0 || filterOverallStatuses.length > 0;

  // Unique procedure values from all rows (for the filter dropdown)
  const allProcedures = [...new Set(allRows.map((r: any) => r.procedure).filter(Boolean))] as string[];

  // Display items — either flat or grouped by procedure
  type DisplayItem = { type: 'row'; row: any } | { type: 'group'; proc: string; count: number };
  const displayItems: DisplayItem[] = groupBy === 'procedure'
    ? (() => {
        const procs = [...new Set(filteredRows.map((r: any) => r.procedure || '—'))] as string[];
        return procs.flatMap(proc => {
          const groupRows = filteredRows.filter((r: any) => (r.procedure || '—') === proc);
          return [
            { type: 'group' as const, proc, count: groupRows.length },
            ...groupRows.map(row => ({ type: 'row' as const, row })),
          ];
        });
      })()
    : filteredRows.map(row => ({ type: 'row' as const, row }));

  // ─── Delete ───────────────────────────────────────────────────────────────
  const deleteOrder = async (id: string, orderNumber: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`هل أنت متأكد من حذف أمر العمل "${orderNumber}"؟\nلا يمكن التراجع عن هذا الإجراء.`)) return;
    try {
      await api.delete(`/work-orders/${id}`);
      fetchReport();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'فشل حذف أمر العمل');
    }
  };

  // ─── Create Modal ─────────────────────────────────────────────────────────
  const openModal = async () => {
    setFormError('');
    setFormData({});
    setShowModal(true);
    setFieldsLoading(true);
    try {
      const res = await api.get('/admin/columns/create-fields');
      const { fields } = res.data;
      // Visible fields only (hidden ones are auto-filled by the backend)
      setCreateFields(fields.filter((f: any) => !f.hidden));
      // Pre-fill defaults; include prefill values for hidden fields too
      const defaults: Record<string, any> = {};
      fields.forEach((f: any) => {
        defaults[f.columnKey] = f.hidden ? (f.prefill ?? '') : '';
      });
      setFormData(defaults);
    } catch (err) {
      console.error(err);
    } finally {
      setFieldsLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    for (const field of createFields) {
      // Only validate visible (non-hidden) fields
      const val = formData[field.columnKey];
      if (!val || (typeof val === 'string' && !val.trim())) {
        setFormError(lang === 'en' ? `Field "${getColLabel(field, lang)}" is required` : `حقل "${getColLabel(field, lang)}" مطلوب`);
        return;
      }
    }
    setCreating(true);
    try {
      const payload: Record<string, any> = {};
      Object.entries(formData).forEach(([k, v]) => {
        if (v !== '' && v !== null && v !== undefined) payload[k] = v;
      });
      const res = await api.post('/work-orders', payload);
      setShowModal(false);
      navigate(`/work-orders/${res.data.id}/edit`);
    } catch (err: any) {
      setFormError(err?.response?.data?.error || 'فشل إنشاء أمر العمل، تأكد من عدم تكرار رقم الأمر');
    } finally {
      setCreating(false);
    }
  };

  const renderField = (field: any) => {
    const val = formData[field.columnKey] ?? '';
    const onChange = (v: string) => setFormData(prev => ({ ...prev, [field.columnKey]: v }));
    const base = "w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm bg-white";
    if (field.dataType === 'select' && field.options?.length > 0) {
      return (
        <select value={val} onChange={e => onChange(e.target.value)} className={base}>
          <option value="">{lang === 'en' ? 'Select...' : 'اختر...'}</option>
          {field.options.map((o: any) => (
            <option key={o.value} value={o.value}>
              {lang === 'en' && o.labelEn ? o.labelEn : o.labelAr}
            </option>
          ))}
        </select>
      );
    }
    if (field.dataType === 'date')   return <input type="date"   value={val} onChange={e => onChange(e.target.value)} className={base} />;
    if (field.dataType === 'number' || field.dataType === 'currency') return <input type="number" value={val} onChange={e => onChange(e.target.value)} className={base} />;
    return <input type="text" value={val} onChange={e => onChange(e.target.value)} required className={base} />;
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col min-h-full lg:h-full" dir={lang === 'en' ? 'ltr' : 'rtl'}>

      {/* ── Header ── */}
      <header className="bg-white border-b border-slate-200 px-4 md:px-6 py-3 md:py-5 flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-800">{lang === 'en' ? 'Work Orders' : 'أوامر العمل'}</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {lang === 'en'
              ? `${allRows.length} work orders in your scope`
              : `${allRows.length} أمر عمل في نطاق صلاحيتك`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { fetchReport(); setGroupBy(null); }}
            data-testid="button-refresh"
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-500"
            title={lang === 'en' ? 'Refresh (resets grouping)' : 'تحديث (يُعيد ضبط التجميع)'}
          >
            <RefreshCw className={`w-5 h-5 ${kpiLoading ? 'animate-spin' : ''}`} />
          </button>

          <button
            data-testid="button-group-by-procedure"
            onClick={() => setGroupBy(g => g === 'procedure' ? null : 'procedure')}
            className={`p-2 rounded-lg transition-colors flex items-center gap-1 text-sm font-medium ${
              groupBy === 'procedure'
                ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
                : 'hover:bg-slate-100 text-slate-500'
            }`}
            title={groupBy === 'procedure'
              ? (lang === 'en' ? 'Ungroup' : 'إلغاء التجميع')
              : (lang === 'en' ? 'Group by Procedure' : 'تجميع حسب الإجراء')}
          >
            <Layers className="w-5 h-5" />
          </button>

          {/* Column Picker */}
          <div className="relative" ref={colPickerRef}>
            <button
              data-testid="button-col-picker"
              onClick={() => setShowColPicker(v => !v)}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-500 flex items-center gap-1"
              title={lang === 'en' ? 'Customize Columns' : 'تخصيص الأعمدة'}
            >
              <SlidersHorizontal className="w-5 h-5" />
            </button>
            <AnimatePresence>
              {showColPicker && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.95 }}
                  className="absolute left-0 top-full mt-2 w-52 bg-white rounded-xl border border-slate-200 shadow-xl z-40 overflow-hidden"
                >
                  <div className="px-4 py-2.5 border-b border-slate-100">
                    <p className="text-xs font-semibold text-slate-500">{lang === 'en' ? 'Customize Columns' : 'تخصيص الأعمدة'}</p>
                  </div>
                  <div className="p-2 max-h-72 overflow-y-auto">
                    {/* Special system columns */}
                    {SPECIAL_COLS.map(col => (
                      <label key={col.key} className="flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer text-sm hover:bg-slate-50 transition-colors">
                        <input
                          type="checkbox"
                          checked={isCol(col.key)}
                          onChange={() => toggleCol(col.key)}
                          className="accent-indigo-600 w-4 h-4"
                          data-testid={`checkbox-col-${col.key}`}
                        />
                        <span className="text-slate-700">{lang === 'en' ? col.labelEn : col.labelAr}</span>
                      </label>
                    ))}
                    {/* Dynamic catalog columns */}
                    {dynCols.length > 0 && (
                      <div className="border-t border-slate-100 mt-1 pt-1">
                        {dynCols.map(col => (
                          <label key={col.columnKey} className="flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer text-sm hover:bg-slate-50 transition-colors">
                            <input
                              type="checkbox"
                              checked={isCol(col.columnKey)}
                              onChange={() => toggleCol(col.columnKey)}
                              className="accent-indigo-600 w-4 h-4"
                              data-testid={`checkbox-col-${col.columnKey}`}
                            />
                            <span className="text-slate-700 truncate">{getColLabel(col, lang)}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="border-t border-slate-100 px-4 py-2 flex gap-3">
                    <button
                      onClick={() => {
                        const allKeys = new Set([...SPECIAL_COLS.map(c => c.key), ...dynCols.map(c => c.columnKey)]);
                        setVisibleCols(allKeys); saveVisibleCols(allKeys);
                      }}
                      className="text-xs text-indigo-600 hover:underline"
                    >
                      {lang === 'en' ? 'Show All' : 'إظهار الكل'}
                    </button>
                    <button
                      onClick={() => {
                        const minKeys = new Set(SPECIAL_COLS.map(c => c.key));
                        setVisibleCols(minKeys); saveVisibleCols(minKeys);
                      }}
                      className="text-xs text-slate-400 hover:underline"
                    >
                      {lang === 'en' ? 'Minimum' : 'الحد الأدنى'}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {(currentUser.canCreateOrder || currentUser.role === 'ADMIN') && (
            <button
              data-testid="button-create-work-order"
              onClick={openModal}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-indigo-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">{lang === 'en' ? 'New Work Order' : 'أمر عمل جديد'}</span>
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 flex flex-col lg:overflow-hidden p-3 md:p-6 gap-3 md:gap-5">

        {/* ── Summary Cards (5-state dashboard KPI) — controlled per-section by role permissions ── */}
        {(canViewExecKpiCards || canViewFinKpiCards) && (() => {
          const CARD_STYLES = {
            OK:             { color: 'text-emerald-600', bg: 'bg-white', ring: 'ring-emerald-400', Icon: CheckCircle2,  labelAr: 'منتظم',      labelEn: 'On Track'  },
            WARN:           { color: 'text-amber-600',   bg: 'bg-white', ring: 'ring-amber-400',   Icon: AlertTriangle, labelAr: 'تنبيه',      labelEn: 'Warning'   },
            OVERDUE:        { color: 'text-red-600',     bg: 'bg-white', ring: 'ring-red-400',     Icon: XCircle,       labelAr: 'متأخر',      labelEn: 'Overdue'   },
            COMPLETED:      { color: 'text-indigo-600',  bg: 'bg-white', ring: 'ring-indigo-400',  Icon: CheckCircle2,  labelAr: 'منجز',       labelEn: 'Done'      },
            COMPLETED_LATE: { color: 'text-slate-500',   bg: 'bg-white', ring: 'ring-slate-400',   Icon: CheckCircle2,  labelAr: 'منجز متأخر', labelEn: 'Late Done' },
          } as const;
          type CardStatus = keyof typeof CARD_STYLES;
          const allSections: {
            cat: string; key: 'exec' | 'fin'; titleAr: string; titleEn: string; headerBg: string; titleCls: string;
            cards: { status: CardStatus; count: number }[];
          }[] = [
            {
              cat: 'EXEC', key: 'exec', titleAr: 'الجانب التنفيذي', titleEn: 'Executive',
              headerBg: 'bg-indigo-50 border-indigo-100', titleCls: 'text-indigo-700',
              cards: [
                { status: 'OK',             count: execOk            },
                { status: 'WARN',           count: execWarn          },
                { status: 'OVERDUE',        count: execOverdue       },
                { status: 'COMPLETED',      count: execCompleted     },
                { status: 'COMPLETED_LATE', count: execCompletedLate },
              ],
            },
            {
              cat: 'FIN', key: 'fin', titleAr: 'الجانب المالي', titleEn: 'Financial',
              headerBg: 'bg-indigo-50 border-indigo-100', titleCls: 'text-indigo-700',
              cards: [
                { status: 'OK',             count: finOk             },
                { status: 'WARN',           count: finWarn           },
                { status: 'OVERDUE',        count: finOverdue        },
                { status: 'COMPLETED',      count: finCompleted      },
                { status: 'COMPLETED_LATE', count: finCompletedLate  },
              ],
            },
          ];
          // Filter sections based on role permissions
          const sections = allSections.filter(s =>
            s.key === 'exec' ? canViewExecKpiCards : canViewFinKpiCards
          );
          // Full-width when only one section is visible, two columns when both
          const gridCls = sections.length === 1
            ? 'grid grid-cols-1 gap-3 md:gap-4'
            : 'grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4';
          return (
            <div className={gridCls}>
              {sections.map(section => (
                <div key={section.cat} className={`rounded-xl border ${section.headerBg} overflow-hidden`}>
                  <div className={`px-4 py-2 border-b ${section.headerBg}`}>
                    <span className={`text-sm font-bold ${section.titleCls}`}>{lang === 'en' ? section.titleEn : section.titleAr}</span>
                    {isCardsLoading && <span className="text-xs text-slate-400 mr-2">{lang === 'en' ? 'Loading...' : 'جاري التحميل...'}</span>}
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-0">
                    {section.cards.map(({ status, count }) => {
                      const s = CARD_STYLES[status];
                      const active = filterCat?.cat === section.cat && filterCat?.status === status;
                      return (
                        <button
                          key={status}
                          data-testid={`card-kpi-${section.cat.toLowerCase()}-${status.toLowerCase()}`}
                          onClick={() => setFilterCat(active ? null : { cat: section.cat, status })}
                          className={`flex flex-col items-center gap-1 py-3 px-1 transition-all hover:bg-slate-50 ${s.bg} ${active ? `ring-2 ring-inset ${s.ring}` : ''}`}
                        >
                          <s.Icon className={`w-4 h-4 ${s.color}`} />
                          <span className={`text-2xl font-bold leading-none ${s.color}`}>
                            {isCardsLoading ? '…' : count}
                          </span>
                          <span className="text-[11px] font-medium text-slate-500">{lang === 'en' ? s.labelEn : s.labelAr}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}

        {/* ── Filter Bar ── */}
        {(() => {
          const kpiOpts = [
            { value: 'OK',             labelAr: 'منتظم',       labelEn: 'On Track'   },
            { value: 'WARN',           labelAr: 'تنبيه',       labelEn: 'Warning'    },
            { value: 'OVERDUE',        labelAr: 'متأخر',       labelEn: 'Overdue'    },
            { value: 'COMPLETED',      labelAr: 'منجز',        labelEn: 'Done'       },
            { value: 'COMPLETED_LATE', labelAr: 'منجز متأخر',  labelEn: 'Late Done'  },
            { value: 'CLOSED',         labelAr: 'مغلق',        labelEn: 'Closed'     },
            { value: 'NONE',           labelAr: 'بدون بيانات', labelEn: 'No data'    },
          ];
          const DASH_STATUS_META: Record<string, { labelAr: string; labelEn: string; cls: string }> = {
            OK:             { labelAr: 'منتظم',      labelEn: 'On Track',  cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
            WARN:           { labelAr: 'تنبيه',      labelEn: 'Warning',   cls: 'bg-amber-50   text-amber-700   border-amber-200'   },
            OVERDUE:        { labelAr: 'متأخر',      labelEn: 'Overdue',   cls: 'bg-red-50     text-red-700     border-red-200'     },
            COMPLETED:      { labelAr: 'منجز',       labelEn: 'Done',      cls: 'bg-indigo-50  text-indigo-700  border-indigo-100'  },
            COMPLETED_LATE: { labelAr: 'منجز متأخر', labelEn: 'Late Done', cls: 'bg-slate-100  text-slate-600   border-slate-300'   },
          };
          return (
            <div className="bg-white rounded-xl border border-slate-200">

              {/* ── صف ١: البحث + النتائج + المسح ── */}
              <div className="px-3 py-2.5 flex flex-wrap gap-2 items-center border-b border-slate-100">
                <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />

                {/* Search — column picker + input */}
                <div className="relative flex flex-1 min-w-[220px] rounded-lg border border-slate-200 bg-white overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500">
                  <select
                    data-testid="select-search-col"
                    value={searchCol}
                    onChange={e => setSearchCol(e.target.value)}
                    className="shrink-0 border-0 border-l border-slate-200 text-xs text-slate-600 bg-slate-50 px-2 py-1.5 outline-none cursor-pointer hover:bg-slate-100 max-w-[120px]"
                  >
                    <option value="">{lang === 'en' ? 'All columns' : 'كل الأعمدة'}</option>
                    {SPECIAL_COLS.map(sc => (
                      <option key={sc.key} value={`__special__${sc.key}`}>
                        {lang === 'en' ? sc.labelEn : sc.labelAr}
                      </option>
                    ))}
                    {dynCols.map((col: any) => (
                      <option key={col.columnKey} value={col.columnKey}>
                        {lang === 'en' && col.labelEn ? col.labelEn : col.labelAr}
                      </option>
                    ))}
                  </select>
                  <div className="relative flex-1">
                    <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 w-3.5 h-3.5 pointer-events-none" />
                    <input
                      data-testid="input-search"
                      type="text"
                      placeholder={(() => {
                        if (!searchCol) return lang === 'en' ? 'Search...' : 'بحث...';
                        if (searchCol.startsWith('__special__')) {
                          const key = searchCol.replace('__special__', '');
                          const sc = SPECIAL_COLS.find(s => s.key === key);
                          return sc ? (lang === 'en' ? sc.labelEn : sc.labelAr) : key;
                        }
                        return dynCols.find((c: any) => c.columnKey === searchCol)?.[lang === 'en' ? 'labelEn' : 'labelAr'] ?? searchCol;
                      })()}
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      className="w-full pr-8 pl-3 py-1.5 text-sm bg-transparent outline-none"
                    />
                  </div>
                </div>

                {/* filterCat badge */}
                {filterCat && (() => {
                  const meta = DASH_STATUS_META[filterCat.status] ?? DASH_STATUS_META.OK;
                  const catLabel = filterCat.cat === 'EXEC'
                    ? (lang === 'en' ? 'Executive' : 'تنفيذي')
                    : (lang === 'en' ? 'Financial' : 'مالي');
                  return (
                    <span className={`flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border ${meta.cls}`}>
                      {catLabel} · {lang === 'en' ? meta.labelEn : meta.labelAr}
                      <button onClick={() => setFilterCat(null)} className="opacity-60 hover:opacity-100 mr-1">✕</button>
                    </span>
                  );
                })()}

                <div className="flex-1" />

                {/* result count */}
                <span className="text-xs text-slate-400 whitespace-nowrap">{filteredRows.length} {lang === 'en' ? 'result' : 'نتيجة'}</span>

                {/* show hidden */}
                {totalClosedCount > 0 && !filterCat && (
                  <button
                    onClick={() => setShowHidden(v => !v)}
                    className={`text-xs underline whitespace-nowrap transition-colors ${
                      showHidden ? 'text-indigo-600 hover:text-indigo-800' : 'text-slate-400 hover:text-indigo-600'
                    }`}
                  >
                    {showHidden
                      ? `إخفاء المغلق/الملغي (${totalClosedCount})`
                      : `${totalClosedCount} مغلق/ملغي مخفي`}
                  </button>
                )}

                {/* clear filters */}
                {hasFilters && (
                  <button
                    onClick={() => {
                      setFilterRegions(lockedRegion ? [lockedRegion] : []);
                      setFilterSectors(lockedSector ? [lockedSector] : []);
                      setFilterProjectTypes([]);
                      setFilterProcedures([]);
                      setFilterDelays([]);
                      setFilterStatus([]);
                      setFilterWorkStatusClass([]);
                      setFilterExecStatuses([]);
                      setFilterFinStatuses([]);
                      setFilterOverallStatuses([]);
                      setSearch('');
                      setFilterCat(null);
                      setSearchCol('');
                      setShowHidden(false);
                    }}
                    className="text-xs text-slate-500 hover:text-red-500 underline whitespace-nowrap"
                  >
                    {lang === 'en' ? 'Clear Filters' : 'مسح الفلاتر'}
                  </button>
                )}
              </div>

              {/* ── صف ٢: الفلاتر ── */}
              <div className="px-3 py-2.5 flex flex-wrap gap-2 items-center">
                <Filter className="w-4 h-4 text-slate-400 flex-shrink-0" />

                {/* مجموعة ١: فلاتر المشروع */}
                {isUnrestricted || (userScopeType !== 'OWN_SECTOR' && userScopeType !== 'OWN_REGION') ? (
                  <MultiSelectDropdown
                    data-testid="filter-sector"
                    options={allSectors.map((s: any) => ({ value: s.id, labelAr: s.nameAr, labelEn: s.nameEn ?? s.nameAr }))}
                    selected={filterSectors}
                    onChange={setFilterSectors}
                    placeholder="كل القطاعات"
                    placeholderEn="All Sectors"
                    lang={lang as 'ar' | 'en'}
                  />
                ) : null}

                {isUnrestricted || userScopeType !== 'OWN_REGION' ? (
                  <MultiSelectDropdown
                    data-testid="filter-region"
                    options={allRegions.map((r: any) => ({ value: r.id, labelAr: r.nameAr, labelEn: r.nameEn ?? r.nameAr }))}
                    selected={filterRegions}
                    onChange={setFilterRegions}
                    placeholder="كل المناطق"
                    placeholderEn="All Regions"
                    lang={lang as 'ar' | 'en'}
                  />
                ) : null}

                <MultiSelectDropdown
                  data-testid="filter-project-type"
                  options={projectTypeOptions.map((opt: any) => ({ value: opt.value, labelAr: opt.labelAr, labelEn: opt.labelEn ?? opt.labelAr }))}
                  selected={filterProjectTypes}
                  onChange={setFilterProjectTypes}
                  placeholder="كل أنواع المشاريع"
                  placeholderEn="All Types"
                  lang={lang as 'ar' | 'en'}
                />

                <MultiSelectDropdown
                  data-testid="filter-procedure"
                  options={allProcedures.map(proc => ({ value: proc, labelAr: proc, labelEn: proc }))}
                  selected={filterProcedures}
                  onChange={setFilterProcedures}
                  placeholder="كل الإجراءات"
                  placeholderEn="All Procedures"
                  lang={lang as 'ar' | 'en'}
                />

                <MultiSelectDropdown
                  data-testid="filter-delay"
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
                />

                {/* ── فاصل بين مجموعتي الفلاتر ── */}
                <div className="w-px h-6 bg-slate-200 mx-0.5 self-center flex-shrink-0" />

                {/* مجموعة ٢: فلاتر الحالة */}
                <MultiSelectDropdown
                  data-testid="filter-work-status-class"
                  options={[
                    { value: 'EXECUTED', labelAr: 'تم التنفيذ', labelEn: 'Executed' },
                    { value: 'ONGOING',  labelAr: 'قائم',       labelEn: 'Ongoing'  },
                  ]}
                  selected={filterWorkStatusClass}
                  onChange={setFilterWorkStatusClass}
                  placeholder="حالة التنفيذ الميداني"
                  placeholderEn="Field Status"
                  lang={lang as 'ar' | 'en'}
                />

                <MultiSelectDropdown
                  data-testid="filter-exec-status"
                  options={kpiOpts}
                  selected={filterExecStatuses}
                  onChange={setFilterExecStatuses}
                  placeholder="حالة التنفيذ"
                  placeholderEn="Exec Status"
                  lang={lang as 'ar' | 'en'}
                />

                <MultiSelectDropdown
                  data-testid="filter-fin-status"
                  options={kpiOpts}
                  selected={filterFinStatuses}
                  onChange={setFilterFinStatuses}
                  placeholder="الحالة المالية"
                  placeholderEn="Fin Status"
                  lang={lang as 'ar' | 'en'}
                />

                <MultiSelectDropdown
                  data-testid="filter-overall-status"
                  options={kpiOpts}
                  selected={filterOverallStatuses}
                  onChange={setFilterOverallStatuses}
                  placeholder="الحالة العامة"
                  placeholderEn="Overall Status"
                  lang={lang as 'ar' | 'en'}
                />
              </div>
            </div>
          );
        })()}

        {/* ── Table ── */}
        <div className="lg:flex-1 lg:min-h-0 bg-white rounded-xl border border-slate-200 overflow-auto">
          {kpiLoading ? (
            <div className="py-16 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              جاري تحميل البيانات...
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="py-16 text-center">
              <FileText className="w-10 h-10 text-slate-200 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">
                {hasFilters ? 'لا توجد نتائج بهذه الفلاتر' : 'لا توجد أوامر عمل. اضغط "أمر عمل جديد" للبدء'}
              </p>
            </div>
          ) : (
            <table className="w-full text-right" style={{ minWidth: `${Math.max(700, 180 + visibleDynCols.length * 150)}px` }}>
              <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                <tr>
                  <th className="w-8 px-3 py-3"></th>
                  {/* Fixed: order number always first */}
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500">رقم الأمر</th>
                  {/* Special system columns */}
                  {SPECIAL_COLS.map(sc => isCol(sc.key) && (
                    <th key={sc.key} className="px-4 py-3 text-xs font-semibold text-slate-500 whitespace-nowrap">
                      {lang === 'en' ? sc.labelEn : sc.labelAr}
                    </th>
                  ))}
                  {/* Dynamic catalog column headers */}
                  {visibleDynCols.map(col => (
                    <th key={col.columnKey} className="px-4 py-3 text-xs font-semibold text-slate-500 whitespace-nowrap">{getColLabel(col, lang)}</th>
                  ))}
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500"></th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const colSpanCount = 2 + SPECIAL_COLS.filter(c => isCol(c.key)).length + visibleDynCols.length + 1;
                  return displayItems.map((item) => {
                  if (item.type === 'group') {
                    return (
                      <tr key={`group-${item.proc}`}>
                        <td colSpan={colSpanCount} className="bg-indigo-50 px-5 py-2.5 text-sm font-bold text-indigo-700 border-y border-indigo-100">
                          <span className="flex items-center gap-2">
                            <Layers className="w-4 h-4 opacity-60" />
                            {item.proc}
                            <span className="text-xs font-normal bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full">{item.count} أمر</span>
                          </span>
                        </td>
                      </tr>
                    );
                  }
                  const row = item.row;
                  const isExp   = expanded === row.id;

                  return (
                    <React.Fragment key={row.id}>
                      <tr
                        data-testid={`row-work-order-${row.id}`}
                        className={`border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer group ${isExp ? 'bg-slate-50' : ''}`}
                        onClick={() => setExpanded(isExp ? null : row.id)}
                      >
                        {/* Expand toggle */}
                        <td className="px-3 py-3">
                          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isExp ? 'rotate-180' : ''}`} />
                        </td>

                        {/* Order Number — always shown, fixed */}
                        <td className="px-4 py-3">
                          <button
                            data-testid={`link-order-${row.id}`}
                            onClick={e => { e.stopPropagation(); navigate(`/work-orders/${row.id}/edit`); }}
                            className="text-sm font-semibold text-indigo-700 hover:text-indigo-900 hover:underline underline-offset-2 transition-colors"
                          >
                            {row.orderNumber || '-'}
                          </button>
                        </td>

                        {/* حالة التنفيذ */}
                        {isCol('execStatus') && (
                          <td className="px-4 py-3">
                            <StatusBadge status={row.execStatus || 'NONE'} />
                          </td>
                        )}

                        {/* حالة المالي */}
                        {isCol('finStatus') && (
                          <td className="px-4 py-3">
                            <StatusBadge status={row.finStatus || 'NONE'} />
                          </td>
                        )}

                        {/* الحالة العامة */}
                        {isCol('overallStatus') && (
                          <td className="px-4 py-3">
                            <StatusBadge status={row.overallStatus || 'NONE'} />
                          </td>
                        )}

                        {/* Dynamic catalog columns — generic renderer */}
                        {visibleDynCols.map(col => {
                          const physKey = col.physicalKey || col.columnKey;
                          const camelKey = toCamel(physKey);
                          const cf = row.customFields && typeof row.customFields === 'object' ? row.customFields as Record<string,any> : {};
                          const rawVal = row[camelKey] ?? row[physKey] ?? cf[physKey] ?? cf[camelKey];

                          // Special badge rendering for delay justification columns
                          if (col.columnKey === 'exec_delay_justified' || col.columnKey === 'fin_delay_justified') {
                            const isExec = col.columnKey === 'exec_delay_justified';
                            const isDelayed = isExec
                              ? (row.execStatus === 'OVERDUE' || row.execStatus === 'COMPLETED_LATE')
                              : (row.finStatus  === 'OVERDUE' || row.finStatus  === 'COMPLETED_LATE');
                            if (!isDelayed) return <td key={col.columnKey} className="px-4 py-3 max-w-[180px]"><span className="text-slate-300 text-sm">—</span></td>;
                            const justified = rawVal === true;
                            return (
                              <td key={col.columnKey} className="px-4 py-3 max-w-[180px]">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${justified ? 'bg-orange-50 text-orange-700 border-orange-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                                  {justified ? (lang === 'en' ? '✓ Justified' : '✓ نعم مسبب') : (lang === 'en' ? '✗ Unjustified' : '✗ لا مسبب')}
                                </span>
                              </td>
                            );
                          }

                          const displayVal = renderCellVal(rawVal, col.dataType, col.columnKey, colOptMap);
                          const isCurrency = col.dataType === 'currency' || col.dataType === 'number';
                          return (
                            <td key={col.columnKey} className="px-4 py-3 max-w-[180px]">
                              <span
                                className={`text-sm text-slate-600 truncate block ${isCurrency ? 'font-medium text-slate-800 tabular-nums' : ''}`}
                                title={displayVal !== '—' ? displayVal : undefined}
                              >
                                {displayVal}
                              </span>
                            </td>
                          );
                        })}

                        {/* Actions */}
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {(currentUser.canDeleteOrder || currentUser.role === 'ADMIN') && (
                              <button
                                data-testid={`button-delete-${row.id}`}
                                onClick={e => deleteOrder(row.id, row.orderNumber || row.id, e)}
                                className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                title="حذف"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              data-testid={`button-edit-${row.id}`}
                              onClick={e => { e.stopPropagation(); navigate(`/work-orders/${row.id}/edit`); }}
                              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                              title="تعديل"
                            >
                              <ChevronLeft className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* ── Expanded KPI Details ── */}
                      <AnimatePresence>
                        {isExp && (
                          <tr>
                            <td colSpan={colSpanCount} className="bg-slate-50 border-b border-slate-200 p-0">
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden"
                              >
                                <div className="px-6 py-4">
                                  <div className="flex items-center justify-between mb-3">
                                    <h4 className="text-sm font-bold text-slate-700">
                                      تفاصيل المؤشرات — {row.orderNumber}
                                    </h4>
                                    <button
                                      data-testid={`button-open-order-${row.id}`}
                                      onClick={e => { e.stopPropagation(); navigate(`/work-orders/${row.id}/edit`); }}
                                      className="text-xs text-indigo-600 hover:underline flex items-center gap-1"
                                    >
                                      فتح أمر العمل <ChevronLeft className="w-3 h-3" />
                                    </button>
                                  </div>

                                  {(!row.kpis || row.kpis.length === 0) ? (
                                    <p className="text-xs text-slate-400">لا توجد مؤشرات مضبوطة لهذا النوع من المشاريع.</p>
                                  ) : (
                                    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
                                      {row.kpis.map((kpi: any) => {
                                        const kCfg  = STATUS_CFG[kpi.status] ?? STATUS_CFG.INCOMPLETE;
                                        const KIcon = kCfg.icon;
                                        return (
                                          <div key={kpi.ruleId} className={`rounded-lg border p-3 ${kCfg.bg} ${kCfg.border}`}>
                                            <div className="flex items-start justify-between gap-1 mb-1">
                                              <span className="text-xs font-medium text-slate-700 leading-tight">{kpi.nameAr}</span>
                                              <KIcon className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${kCfg.color}`} />
                                            </div>
                                            <div className={`text-xs font-bold ${kCfg.color}`}>{lang === 'en' ? kCfg.labelEn : kCfg.labelAr}</div>
                                            {kpi.elapsedDays !== null && kpi.elapsedDays !== undefined && (
                                              <div className="text-[10px] text-slate-500 mt-1">
                                                {kpi.elapsedDays} {lang === 'en' ? 'd' : 'يوم'} / {kpi.slaDays} {lang === 'en' ? 'd SLA' : 'يوم SLA'}
                                              </div>
                                            )}
                                            {kpi.percentValue !== null && kpi.percentValue !== undefined && (
                                              <div className="text-[10px] text-slate-500 mt-1">
                                                {lang === 'en' ? 'Rate: ' : 'نسبة: '}{kpi.percentValue}%
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </motion.div>
                            </td>
                          </tr>
                        )}
                      </AnimatePresence>
                    </React.Fragment>
                  );
                  });
                })()}
              </tbody>
            </table>
          )}
        </div>
      </main>

      {/* ── Create Modal ── */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={e => e.target === e.currentTarget && setShowModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col"
            >
              <div className="flex items-center justify-between p-6 border-b border-slate-200">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">{lang === 'en' ? 'Create New Work Order' : 'إنشاء أمر عمل جديد'}</h2>
                  <p className="text-xs text-slate-400 mt-0.5">{lang === 'en' ? 'Displayed fields can be customized from the Columns page' : 'الحقول المعروضة قابلة للتخصيص من صفحة الأعمدة'}</p>
                </div>
                <button onClick={() => setShowModal(false)} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>

              {fieldsLoading ? (
                <div className="flex items-center justify-center py-16 gap-3 text-slate-400">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  {lang === 'en' ? 'Loading fields...' : 'جاري تحميل الحقول...'}
                </div>
              ) : (
                <form onSubmit={handleCreate} className="p-6 space-y-4 overflow-y-auto flex-1">
                  <div className="grid grid-cols-2 gap-4">
                    {createFields.map(field => (
                      <div
                        key={field.columnKey}
                        className={field.columnKey === 'client' || field.columnKey === 'district' ? 'col-span-2' : ''}
                      >
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          {getColLabel(field, lang)}
                          <span className="text-red-500 mr-1">*</span>
                        </label>
                        {renderField(field)}
                      </div>
                    ))}
                  </div>

                  {createFields.length === 0 && (
                    <div className="text-center py-4 text-slate-400 text-sm">
                      {lang === 'en'
                        ? 'No fields configured. Enable required fields from the "Columns" page using the "Show on Create" toggle.'
                        : 'لا توجد حقول محددة. فعّل الحقول المطلوبة من صفحة "الأعمدة" عبر مفتاح "يظهر عند الإنشاء".'}
                    </div>
                  )}

                  {formError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
                      {formError}
                    </div>
                  )}

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowModal(false)}
                      className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors font-medium"
                    >
                      {lang === 'en' ? 'Cancel' : 'إلغاء'}
                    </button>
                    <button
                      type="submit"
                      disabled={creating || createFields.length === 0}
                      className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium disabled:opacity-50"
                    >
                      {creating
                        ? (lang === 'en' ? 'Creating...' : 'جاري الإنشاء...')
                        : (lang === 'en' ? 'Create & Edit' : 'إنشاء والانتقال للتعديل')}
                    </button>
                  </div>
                </form>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
