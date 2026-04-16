import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, ChevronDown, ChevronUp, Filter, FileText, Sheet, Loader2, Database, ShieldAlert } from 'lucide-react';
import { useLang } from '../contexts/LangContext';
import api from '../services/api';

// ── Types ──────────────────────────────────────────────────────────────────────
interface Dataset {
  key: string;
  nameAr: string;
  nameEn: string;
  descAr: string;
  descEn: string;
  supportsDateRange: boolean;
  supportsRegionSector: boolean;
  supportsStatusFilter: boolean;
  count: number | null;
}
interface Region { id: string; nameAr: string; nameEn?: string | null; }
interface Sector { id: string; nameAr: string; nameEn?: string | null; }

// ── Download helper ────────────────────────────────────────────────────────────
async function downloadBlob(endpoint: string, filename: string) {
  const token = localStorage.getItem('token') ?? '';
  const res = await fetch(`/api${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => 'Export failed');
    throw new Error(msg);
  }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

// ── AdvancedPanel ──────────────────────────────────────────────────────────────
function AdvancedPanel({
  ds, isAr, regions, sectors, pending, onExport,
}: {
  ds: Dataset; isAr: boolean;
  regions: Region[]; sectors: Sector[];
  pending: boolean;
  onExport: (params: Record<string, string>) => void;
}) {
  const [from, setFrom]         = useState('');
  const [to, setTo]             = useState('');
  const [regionId, setRegion]   = useState('');
  const [sectorId, setSector]   = useState('');
  const [status, setStatus]     = useState('');
  const [incCancelled, setIncC] = useState(false);
  const [format, setFormat]     = useState<'csv' | 'xlsx'>('xlsx');

  const handleExport = () => {
    const p: Record<string, string> = { format };
    if (ds.supportsDateRange && from) p.from = from;
    if (ds.supportsDateRange && to)   p.to   = to;
    if (ds.supportsRegionSector && regionId) p.regionId = regionId;
    if (ds.supportsRegionSector && sectorId) p.sectorId = sectorId;
    if (ds.supportsStatusFilter && status)   p.status   = status;
    if (ds.supportsStatusFilter) p.includeCancelled = String(incCancelled);
    onExport(p);
  };

  return (
    <div className="border-t border-slate-100 bg-slate-50 rounded-b-xl p-4 space-y-3">
      <div className="flex flex-wrap gap-3 items-end">
        {/* Format */}
        <div className="flex flex-col gap-1 min-w-[110px]">
          <label className="text-xs text-slate-500 font-medium">{isAr ? 'الصيغة' : 'Format'}</label>
          <select
            data-testid={`select-adv-format-${ds.key}`}
            value={format} onChange={e => setFormat(e.target.value as 'csv' | 'xlsx')}
            className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 h-9"
          >
            <option value="xlsx">XLSX (Excel)</option>
            <option value="csv">CSV</option>
          </select>
        </div>

        {ds.supportsDateRange && (
          <>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500 font-medium">{isAr ? 'من' : 'From'}</label>
              <input data-testid={`input-from-${ds.key}`} type="date" value={from}
                onChange={e => setFrom(e.target.value)}
                className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 h-9"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500 font-medium">{isAr ? 'إلى' : 'To'}</label>
              <input data-testid={`input-to-${ds.key}`} type="date" value={to}
                onChange={e => setTo(e.target.value)}
                className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 h-9"
              />
            </div>
          </>
        )}

        {ds.supportsRegionSector && (
          <>
            <div className="flex flex-col gap-1 min-w-[130px]">
              <label className="text-xs text-slate-500 font-medium">{isAr ? 'المنطقة' : 'Region'}</label>
              <select data-testid={`select-region-${ds.key}`} value={regionId} onChange={e => setRegion(e.target.value)}
                className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 h-9"
              >
                <option value="">{isAr ? 'الكل' : 'All'}</option>
                {regions.map(r => <option key={r.id} value={r.id}>{isAr ? r.nameAr : (r.nameEn ?? r.nameAr)}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1 min-w-[130px]">
              <label className="text-xs text-slate-500 font-medium">{isAr ? 'القطاع' : 'Sector'}</label>
              <select data-testid={`select-sector-${ds.key}`} value={sectorId} onChange={e => setSector(e.target.value)}
                className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 h-9"
              >
                <option value="">{isAr ? 'الكل' : 'All'}</option>
                {sectors.map(s => <option key={s.id} value={s.id}>{isAr ? s.nameAr : (s.nameEn ?? s.nameAr)}</option>)}
              </select>
            </div>
          </>
        )}

        {ds.supportsStatusFilter && (
          <>
            <div className="flex flex-col gap-1 min-w-[130px]">
              <label className="text-xs text-slate-500 font-medium">{isAr ? 'الحالة' : 'Status'}</label>
              <select data-testid={`select-status-${ds.key}`} value={status} onChange={e => setStatus(e.target.value)}
                className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 h-9"
              >
                <option value="">{isAr ? 'جميع الحالات' : 'All Statuses'}</option>
                {['OVERDUE', 'WARN', 'OK', 'COMPLETED', 'COMPLETED_LATE', 'CANCELLED'].map(s =>
                  <option key={s} value={s}>{s}</option>
                )}
              </select>
            </div>
            <div className="flex items-end pb-0.5">
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input
                  data-testid={`checkbox-cancelled-${ds.key}`}
                  type="checkbox" checked={incCancelled}
                  onChange={e => setIncC(e.target.checked)}
                  className="w-4 h-4 rounded accent-blue-600"
                />
                <span className="text-slate-600 text-xs">{isAr ? 'تضمين الملغية' : 'Include Cancelled'}</span>
              </label>
            </div>
          </>
        )}
      </div>

      <div className="flex justify-end">
        <button
          data-testid={`button-advanced-export-${ds.key}`}
          onClick={handleExport} disabled={pending}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          {isAr ? 'تصدير' : 'Export'}
        </button>
      </div>
    </div>
  );
}

// ── DatasetCard ────────────────────────────────────────────────────────────────
function DatasetCard({ ds, isAr, regions, sectors }: {
  ds: Dataset; isAr: boolean; regions: Region[]; sectors: Sector[];
  key?: string;
}) {
  const [showAdv, setShowAdv]   = useState(false);
  const [quickFmt, setQuickFmt] = useState<'csv' | 'xlsx'>('xlsx');
  const [pending, setPending]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const triggerDownload = async (params: Record<string, string>) => {
    setPending(true); setError(null);
    const fmt = params.format ?? 'xlsx';
    try {
      const q = new URLSearchParams(params).toString();
      await downloadBlob(`/export-center/export/${ds.key}?${q}`, `${ds.key}_${new Date().toISOString().slice(0,10)}.${fmt}`);
    } catch (e: any) {
      setError(isAr ? 'فشل التصدير. حاول مرة أخرى.' : 'Export failed. Please try again.');
    } finally { setPending(false); }
  };

  return (
    <div data-testid={`card-dataset-${ds.key}`} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-start gap-4 p-4">
        {/* Icon */}
        <div className="w-10 h-10 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Database className="w-5 h-5 text-blue-500" />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 flex-wrap justify-between">
            <div>
              <h3 className="font-semibold text-slate-800 text-sm leading-tight">
                {isAr ? ds.nameAr : ds.nameEn}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                {isAr ? ds.descAr : ds.descEn}
              </p>
            </div>
            {ds.count !== null && (
              <span data-testid={`badge-count-${ds.key}`}
                className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-medium flex-shrink-0"
              >
                {ds.count.toLocaleString('en-US')} {isAr ? 'سجل' : 'rec.'}
              </span>
            )}
          </div>
          {error && <p className="text-xs text-red-500 mt-1.5">{error}</p>}
        </div>

        {/* Quick export controls */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <select
            data-testid={`select-quick-format-${ds.key}`}
            value={quickFmt} onChange={e => setQuickFmt(e.target.value as 'csv' | 'xlsx')}
            className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 h-9"
          >
            <option value="xlsx">XLSX</option>
            <option value="csv">CSV</option>
          </select>

          <button
            data-testid={`button-quick-export-${ds.key}`}
            onClick={() => triggerDownload({ format: quickFmt })}
            disabled={pending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-medium rounded-lg transition-colors h-9"
          >
            {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            {isAr ? 'تصدير' : 'Export'}
          </button>

          <button
            data-testid={`button-toggle-advanced-${ds.key}`}
            onClick={() => setShowAdv(v => !v)}
            className="flex items-center gap-1 px-2.5 h-9 border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs rounded-lg transition-colors"
            title={isAr ? 'تصدير متقدم' : 'Advanced Export'}
          >
            <Filter className="w-3.5 h-3.5" />
            {showAdv ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {showAdv && (
        <AdvancedPanel
          ds={ds} isAr={isAr}
          regions={regions} sectors={sectors}
          pending={pending}
          onExport={triggerDownload}
        />
      )}
    </div>
  );
}

// ── ExportCenter page ──────────────────────────────────────────────────────────
export default function ExportCenter() {
  const navigate = useNavigate();
  const { lang } = useLang();
  const isAr = lang === 'ar';

  const [datasets, setDatasets]   = useState<Dataset[]>([]);
  const [regions, setRegions]     = useState<Region[]>([]);
  const [sectors, setSectors]     = useState<Sector[]>([]);
  const [loading, setLoading]     = useState(true);

  // Admin guard
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  useEffect(() => {
    if (user?.role !== 'ADMIN') navigate('/dashboard', { replace: true });
  }, []);

  // Fetch datasets + regions + sectors on mount
  useEffect(() => {
    if (user?.role !== 'ADMIN') return;
    Promise.all([
      api.get('/export-center/datasets'),
      api.get('/admin/regions'),
      api.get('/admin/sectors'),
    ]).then(([dsRes, rgRes, scRes]) => {
      setDatasets(dsRes.data);
      setRegions(rgRes.data);
      setSectors(scRes.data);
    }).catch(err => {
      console.error('[ExportCenter]', err);
    }).finally(() => setLoading(false));
  }, []);

  const totalRecords = datasets.reduce((s, d) => s + (d.count ?? 0), 0);

  return (
    <div className="min-h-full bg-slate-50 p-6">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 data-testid="text-export-center-title" className="text-2xl font-bold text-slate-800">
              {isAr ? 'مركز تصدير بيانات النظام' : 'System Data Export Center'}
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              {isAr
                ? 'تصدير جداول النظام بصيغة Excel أو CSV — البيانات الحساسة محجوبة تلقائياً'
                : 'Export system tables as Excel or CSV — sensitive fields are always excluded'}
            </p>
          </div>
          <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-2.5 shadow-sm">
            <Database className="w-4 h-4 text-slate-400" />
            <div className="text-sm">
              <span className="text-slate-500">{isAr ? 'إجمالي السجلات' : 'Total records'}: </span>
              <span data-testid="text-total-records" className="font-semibold text-slate-700">
                {totalRecords.toLocaleString('en-US')}
              </span>
            </div>
          </div>
        </div>

        {/* Security notice */}
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          <ShieldAlert className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-600" />
          <p>
            {isAr
              ? 'ملاحظة: حقول كلمات المرور والرموز المشفرة ومفاتيح API مستبعدة تلقائياً من جميع عمليات التصدير.'
              : 'Note: Passwords, encrypted tokens, and API keys are automatically excluded from all exports.'}
          </p>
        </div>

        {/* Format legend */}
        <div className="flex items-center gap-6 text-xs text-slate-400">
          <div className="flex items-center gap-1.5">
            <Sheet className="w-3.5 h-3.5 text-emerald-500" />
            <span>XLSX — {isAr ? 'Excel مع دعم ترميز UTF-8' : 'Excel with UTF-8 encoding'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-blue-500" />
            <span>CSV — {isAr ? 'نص مع BOM لدعم العربية' : 'Text with BOM for Arabic support'}</span>
          </div>
        </div>

        {/* Dataset list */}
        {loading ? (
          <div className="flex items-center justify-center py-24 text-slate-400 gap-3">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="text-sm">{isAr ? 'جاري التحميل...' : 'Loading...'}</span>
          </div>
        ) : (
          <div data-testid="list-datasets" className="space-y-3">
            {datasets.map(ds => (
              <DatasetCard
                key={ds.key}
                ds={ds}
                isAr={isAr}
                regions={regions}
                sectors={sectors}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
