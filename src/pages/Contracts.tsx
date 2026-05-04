import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { useLang } from '../contexts/LangContext';
import {
  FileText, Plus, Pencil, Archive, ArchiveRestore, Paperclip,
  AlertTriangle, RefreshCw, ChevronDown, ChevronUp, X, Check,
  Loader2, Eye, RotateCcw, Trash2,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Sector  { id: string; nameAr: string; nameEn?: string }
interface Contract {
  id: string; sectorId: string; contractNumber: string;
  startDate: string; endDate: string; notes?: string;
  archivedAt?: string | null; createdAt: string; updatedAt: string;
  sectorNameAr?: string; sectorNameEn?: string;
  attachmentCount: number; woCount: number;
}
interface Attachment { id: string; contractId: string; name: string; url: string; createdAt: string }
interface UnlinkedOrder {
  id: string; orderNumber?: string; sectorId?: string; sectorNameAr?: string;
  assignmentDate?: string; createdAt: string; unlinkReason: string;
}
interface UnlinkedSummary {
  total: number;
  byReason: { no_assignment_date: number; no_contract_coverage: number; missing_data: number };
}
interface RelinkPreview {
  total: number; willChange: number; willStayUnlinked: number;
  changes: { id: string; orderNumber?: string; assignmentDate?: string; currentContractId?: string; newContractId?: string; newContractNumber?: string }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const user = () => JSON.parse(localStorage.getItem('user') || '{}');
const canManage = () => user().canManageContracts || user().role === 'ADMIN';

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function StatusBadge({ archivedAt, endDate }: { archivedAt?: string | null; endDate?: string }) {
  const { lang } = useLang();
  if (archivedAt) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-500 border border-slate-200">
      <Archive size={11} />{lang === 'en' ? 'Archived' : 'مؤرشف'}
    </span>
  );
  const expired = endDate && new Date(endDate) < new Date(new Date().toDateString());
  if (expired) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-50 text-amber-600 border border-amber-200">
      <Archive size={11} />{lang === 'en' ? 'Expired' : 'منتهي'}
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-600 border border-emerald-200">
      <Check size={11} />{lang === 'en' ? 'Active' : 'نشط'}
    </span>
  );
}

// ─── Contract Form Modal ──────────────────────────────────────────────────────
function ContractModal({ sectors, initial, onSave, onClose }: {
  sectors: Sector[];
  initial?: Partial<Contract>;
  onSave: (data: any) => Promise<void>;
  onClose: () => void;
}) {
  const { lang } = useLang();
  const isEdit = !!initial?.id;
  const [form, setForm] = useState({
    sectorId:       initial?.sectorId       ?? '',
    contractNumber: initial?.contractNumber ?? '',
    startDate:      initial?.startDate?.slice(0, 10) ?? '',
    endDate:        initial?.endDate?.slice(0, 10)   ?? '',
    notes:          initial?.notes          ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');

  const handle = async () => {
    if (!form.sectorId || !form.contractNumber || !form.startDate || !form.endDate) {
      setErr(lang === 'en' ? 'All fields except notes are required.' : 'جميع الحقول مطلوبة ما عدا الملاحظات.');
      return;
    }
    setSaving(true); setErr('');
    try { await onSave(form); onClose(); }
    catch (e: any) { setErr(e?.response?.data?.error ?? (lang === 'en' ? 'Save failed' : 'فشل الحفظ')); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-slate-800 text-base">
            {isEdit ? (lang === 'en' ? 'Edit Contract' : 'تعديل عقد') : (lang === 'en' ? 'New Contract' : 'عقد جديد')}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <div className="space-y-4">
          {/* Sector */}
          <div>
            <label className="block text-xs text-slate-500 mb-1">{lang === 'en' ? 'Sector' : 'القطاع'}</label>
            <select
              value={form.sectorId}
              onChange={e => setForm(p => ({ ...p, sectorId: e.target.value }))}
              disabled={isEdit}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:bg-slate-50"
            >
              <option value="">{lang === 'en' ? '— Select sector —' : '— اختر قطاعاً —'}</option>
              {sectors.map(s => (
                <option key={s.id} value={s.id}>{lang === 'en' && s.nameEn ? s.nameEn : s.nameAr}</option>
              ))}
            </select>
          </div>
          {/* Contract Number */}
          <div>
            <label className="block text-xs text-slate-500 mb-1">{lang === 'en' ? 'Contract Number' : 'رقم العقد'}</label>
            <input
              value={form.contractNumber}
              onChange={e => setForm(p => ({ ...p, contractNumber: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              dir="ltr"
            />
          </div>
          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">{lang === 'en' ? 'Start Date' : 'تاريخ البداية'}</label>
              <input type="date" value={form.startDate}
                onChange={e => setForm(p => ({ ...p, startDate: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">{lang === 'en' ? 'End Date' : 'تاريخ النهاية'}</label>
              <input type="date" value={form.endDate}
                onChange={e => setForm(p => ({ ...p, endDate: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>
          </div>
          {/* Notes */}
          <div>
            <label className="block text-xs text-slate-500 mb-1">{lang === 'en' ? 'Notes (optional)' : 'ملاحظات (اختياري)'}</label>
            <textarea value={form.notes}
              onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
              rows={2}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none" />
          </div>
          {err && <p className="text-red-500 text-xs">{err}</p>}
        </div>

        <div className="flex gap-2 mt-5 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50">
            {lang === 'en' ? 'Cancel' : 'إلغاء'}
          </button>
          <button onClick={handle} disabled={saving}
            className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {lang === 'en' ? 'Save' : 'حفظ'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Attachments Panel ────────────────────────────────────────────────────────
function AttachmentsPanel({ contractId }: { contractId: string }) {
  const { lang } = useLang();
  const [atts, setAtts]     = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.get(`/contracts/${contractId}/attachments`); setAtts(r.data); }
    finally { setLoading(false); }
  }, [contractId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <p className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1">
        <Paperclip size={12} />{lang === 'en' ? 'Attachments' : 'المرفقات'}
      </p>
      {loading ? (
        <Loader2 size={14} className="animate-spin text-slate-300" />
      ) : atts.length === 0 ? (
        <p className="text-xs text-slate-400">{lang === 'en' ? 'No attachments.' : 'لا توجد مرفقات.'}</p>
      ) : (
        <div className="space-y-1">
          {atts.map(a => (
            <div key={a.id} className="flex items-center justify-between">
              <a href={a.url} target="_blank" rel="noopener noreferrer"
                className="text-xs text-indigo-600 hover:underline truncate">{a.name}</a>
              {canManage() && (
                <button onClick={async () => {
                  await api.delete(`/contracts/${contractId}/attachments/${a.id}`);
                  load();
                }} className="text-slate-300 hover:text-red-400 ml-2">
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {canManage() && (
        <UploadAttachment contractId={contractId} onUploaded={load} />
      )}
    </div>
  );
}

function UploadAttachment({ contractId, onUploaded }: { contractId: string; onUploaded: () => void }) {
  const { lang } = useLang();
  const [uploading, setUploading] = useState(false);

  const handleFile = async (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const up = await api.post('/uploads/file', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      await api.post(`/contracts/${contractId}/attachments`, { name: file.name, url: up.data.url });
      onUploaded();
    } finally { setUploading(false); e.target.value = ''; }
  };

  return (
    <label className="mt-2 flex items-center gap-1.5 cursor-pointer text-xs text-indigo-500 hover:text-indigo-700">
      {uploading ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
      {lang === 'en' ? 'Add attachment' : 'إضافة مرفق'}
      <input type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.zip" onChange={handleFile} />
    </label>
  );
}

// ─── Unlinked Alert Panel ──────────────────────────────────────────────────────
function UnlinkedPanel() {
  const { lang } = useLang();
  const [open, setOpen]         = useState(false);
  const [summary, setSummary]   = useState<UnlinkedSummary | null>(null);
  const [orders, setOrders]     = useState<UnlinkedOrder[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    api.get('/contracts/unlinked-orders').then(r => {
      setSummary(r.data.summary);
      setOrders(r.data.orders);
    }).finally(() => setLoading(false));
  }, []);

  const REASON_LABELS: Record<string, { ar: string; en: string; color: string }> = {
    no_assignment_date:   { ar: 'تاريخ الإسناد فارغ',         en: 'No assignment date',      color: 'text-amber-600 bg-amber-50 border-amber-200' },
    no_contract_coverage: { ar: 'لا يوجد عقد يغطي الفترة',   en: 'No contract coverage',    color: 'text-red-600 bg-red-50 border-red-200' },
    missing_data:         { ar: 'بيانات ناقصة أو غير صالحة', en: 'Missing / invalid data',  color: 'text-slate-600 bg-slate-50 border-slate-200' },
  };

  if (loading) return null;
  if (!summary || summary.total === 0) return (
    <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-700 mb-4">
      <Check size={15} />
      {lang === 'en' ? 'All work orders are linked to contracts.' : 'جميع أوامر العمل مرتبطة بعقود.'}
    </div>
  );

  return (
    <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-amber-800 hover:bg-amber-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-amber-500 shrink-0" />
          <span className="font-semibold text-sm">
            {lang === 'en'
              ? `${summary.total} work orders not linked to any contract`
              : `${summary.total} أمر عمل غير مرتبط بأي عقد`}
          </span>
          <div className="flex gap-1.5 mr-2">
            {summary.byReason.no_assignment_date > 0 && (
              <span className={`text-xs px-2 py-0.5 rounded-full border ${REASON_LABELS.no_assignment_date.color}`}>
                {summary.byReason.no_assignment_date} {lang === 'en' ? 'no date' : 'بلا تاريخ'}
              </span>
            )}
            {summary.byReason.no_contract_coverage > 0 && (
              <span className={`text-xs px-2 py-0.5 rounded-full border ${REASON_LABELS.no_contract_coverage.color}`}>
                {summary.byReason.no_contract_coverage} {lang === 'en' ? 'no coverage' : 'بلا تغطية'}
              </span>
            )}
            {summary.byReason.missing_data > 0 && (
              <span className={`text-xs px-2 py-0.5 rounded-full border ${REASON_LABELS.missing_data.color}`}>
                {summary.byReason.missing_data} {lang === 'en' ? 'missing data' : 'بيانات ناقصة'}
              </span>
            )}
          </div>
        </div>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {open && (
        <div className="border-t border-amber-200 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-amber-100 text-amber-700">
              <tr>
                <th className="px-3 py-2 text-right font-medium">{lang === 'en' ? 'Order #' : 'رقم الأمر'}</th>
                <th className="px-3 py-2 text-right font-medium">{lang === 'en' ? 'Sector' : 'القطاع'}</th>
                <th className="px-3 py-2 text-right font-medium">{lang === 'en' ? 'Assignment Date' : 'تاريخ الإسناد'}</th>
                <th className="px-3 py-2 text-right font-medium">{lang === 'en' ? 'Reason' : 'السبب'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-amber-100">
              {orders.map(o => (
                <tr key={o.id} className="bg-white hover:bg-amber-50">
                  <td className="px-3 py-2 font-mono text-slate-700">{o.orderNumber ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{o.sectorNameAr ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{fmtDate(o.assignmentDate)}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded-full border text-xs ${REASON_LABELS[o.unlinkReason]?.color ?? ''}`}>
                      {lang === 'en' ? REASON_LABELS[o.unlinkReason]?.en : REASON_LABELS[o.unlinkReason]?.ar}
                    </span>
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

// ─── Relink Panel ─────────────────────────────────────────────────────────────
function RelinkPanel({ sectors }: { sectors: Sector[] }) {
  const { lang } = useLang();
  const [open, setOpen]         = useState(false);
  const [sectorId, setSectorId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate]     = useState('');
  const [preview, setPreview]   = useState<RelinkPreview | null>(null);
  const [loading, setLoading]   = useState(false);
  const [executing, setExecuting] = useState(false);
  const [done, setDone]         = useState<number | null>(null);

  const runPreview = async () => {
    if (!sectorId) return;
    setLoading(true); setPreview(null); setDone(null);
    try {
      const r = await api.post('/contracts/relink/preview', { sectorId, fromDate: fromDate || undefined, toDate: toDate || undefined });
      setPreview(r.data);
    } finally { setLoading(false); }
  };

  const execute = async () => {
    if (!preview || !sectorId) return;
    setExecuting(true);
    try {
      const r = await api.post('/contracts/relink/execute', { sectorId, fromDate: fromDate || undefined, toDate: toDate || undefined });
      setDone(r.data.updated);
      setPreview(null);
    } finally { setExecuting(false); }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <RotateCcw size={15} className="text-indigo-400" />
          {lang === 'en' ? 'Re-link Work Orders to Contracts' : 'إعادة ربط أوامر العمل بالعقود'}
        </div>
        {open ? <ChevronUp size={15} className="text-slate-400" /> : <ChevronDown size={15} className="text-slate-400" />}
      </button>

      {open && (
        <div className="border-t border-slate-100 p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">{lang === 'en' ? 'Sector *' : 'القطاع *'}</label>
              <select value={sectorId} onChange={e => { setSectorId(e.target.value); setPreview(null); setDone(null); }}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
                <option value="">{lang === 'en' ? '— All sectors —' : '— اختر القطاع —'}</option>
                {sectors.map(s => <option key={s.id} value={s.id}>{lang === 'en' && s.nameEn ? s.nameEn : s.nameAr}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">{lang === 'en' ? 'From date (optional)' : 'من تاريخ (اختياري)'}</label>
              <input type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); setPreview(null); }}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">{lang === 'en' ? 'To date (optional)' : 'إلى تاريخ (اختياري)'}</label>
              <input type="date" value={toDate} onChange={e => { setToDate(e.target.value); setPreview(null); }}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>
          </div>

          <button onClick={runPreview} disabled={!sectorId || loading}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 disabled:opacity-50">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
            {lang === 'en' ? 'Preview changes' : 'معاينة التغييرات'}
          </button>

          {/* Preview result */}
          {preview && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-white rounded-lg border border-slate-200 p-3">
                  <div className="text-xl font-bold text-slate-700">{preview.total}</div>
                  <div className="text-xs text-slate-500">{lang === 'en' ? 'Total orders' : 'إجمالي الأوامر'}</div>
                </div>
                <div className="bg-white rounded-lg border border-indigo-200 p-3">
                  <div className="text-xl font-bold text-indigo-600">{preview.willChange}</div>
                  <div className="text-xs text-slate-500">{lang === 'en' ? 'Will change' : 'ستتغير'}</div>
                </div>
                <div className="bg-white rounded-lg border border-amber-200 p-3">
                  <div className="text-xl font-bold text-amber-600">{preview.willStayUnlinked}</div>
                  <div className="text-xs text-slate-500">{lang === 'en' ? 'Still unlinked' : 'ستبقى غير مرتبطة'}</div>
                </div>
              </div>

              {preview.changes.length > 0 && (
                <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 text-xs">
                  <table className="w-full">
                    <thead className="bg-slate-100 text-slate-600 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-right">{lang === 'en' ? 'Order #' : 'رقم الأمر'}</th>
                        <th className="px-3 py-2 text-right">{lang === 'en' ? 'New Contract' : 'العقد الجديد'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {preview.changes.map(c => (
                        <tr key={c.id}>
                          <td className="px-3 py-1.5 font-mono">{c.orderNumber ?? '—'}</td>
                          <td className="px-3 py-1.5">
                            {c.newContractNumber
                              ? <span className="text-emerald-600">{c.newContractNumber}</span>
                              : <span className="text-amber-500">{lang === 'en' ? 'unlinked' : 'غير مرتبط'}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <button onClick={execute} disabled={executing || preview.willChange === 0}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {executing ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                {lang === 'en' ? `Execute (${preview.willChange} orders)` : `تنفيذ (${preview.willChange} أمر)`}
              </button>
            </div>
          )}

          {done !== null && (
            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5 text-sm text-emerald-700">
              <Check size={15} />
              {lang === 'en' ? `Done — ${done} orders updated.` : `تم — تم تحديث ${done} أمر عمل.`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Contract Row ─────────────────────────────────────────────────────────────
function ContractRow({ contract, onEdit, onArchive, onUnarchive, refresh }: {
  contract: Contract;
  onEdit: (c: Contract) => void;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  refresh: () => void;
}) {
  const { lang } = useLang();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`bg-white rounded-xl border ${contract.archivedAt ? 'border-slate-200 opacity-70' : 'border-slate-200'} shadow-sm overflow-hidden`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="w-8 h-8 bg-indigo-50 rounded-lg flex items-center justify-center shrink-0">
          <FileText size={15} className="text-indigo-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-slate-800 text-sm" dir="ltr">{contract.contractNumber}</span>
            <StatusBadge archivedAt={contract.archivedAt} endDate={contract.endDate} />
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            {lang === 'en' && contract.sectorNameEn ? contract.sectorNameEn : contract.sectorNameAr}
            <span className="mx-1.5">·</span>
            {fmtDate(contract.startDate)} — {fmtDate(contract.endDate)}
            <span className="mx-1.5">·</span>
            {contract.woCount} {lang === 'en' ? 'orders' : 'أمر'}
            {contract.attachmentCount > 0 && (
              <><span className="mx-1.5">·</span><Paperclip size={10} className="inline mb-0.5" /> {contract.attachmentCount}</>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setExpanded(v => !v)}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
            {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
          {canManage() && !contract.archivedAt && (
            <button onClick={() => onEdit(contract)}
              className="p-1.5 text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 rounded-lg" title={lang === 'en' ? 'Edit' : 'تعديل'}>
              <Pencil size={14} />
            </button>
          )}
          {canManage() && !contract.archivedAt && (
            <button onClick={() => onArchive(contract.id)}
              className="p-1.5 text-slate-400 hover:text-amber-500 hover:bg-amber-50 rounded-lg" title={lang === 'en' ? 'Archive' : 'أرشفة'}>
              <Archive size={14} />
            </button>
          )}
          {canManage() && contract.archivedAt && (
            <button onClick={() => onUnarchive(contract.id)}
              className="p-1.5 text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 rounded-lg" title={lang === 'en' ? 'Restore' : 'استعادة'}>
              <ArchiveRestore size={14} />
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-100 px-4 pb-4">
          {contract.notes && (
            <p className="text-xs text-slate-500 mt-3 leading-relaxed">{contract.notes}</p>
          )}
          <AttachmentsPanel contractId={contract.id} />
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Contracts() {
  const { lang } = useLang();
  const [contracts, setContracts]   = useState<Contract[]>([]);
  const [sectors, setSectors]       = useState<Sector[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [filterSector, setFilterSector] = useState('');
  const [modal, setModal]           = useState<'create' | Contract | null>(null);
  const [err, setErr]               = useState('');

  const usr = user();
  const isScoped = usr.scopeType === 'OWN_SECTOR' || usr.scopeType === 'OWN_REGION';

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const params = new URLSearchParams();
      if (filterSector) params.set('sectorId', filterSector);
      if (showArchived) params.set('archived', 'true');
      const cr = await api.get(`/contracts?${params}`);
      setContracts(cr.data);
      try {
        const sr = await api.get('/admin/sectors');
        setSectors(sr.data);
      } catch {
        const derived: Sector[] = Object.values(
          (cr.data as Contract[]).reduce((acc: Record<string, Sector>, c) => {
            if (c.sectorId && !acc[c.sectorId])
              acc[c.sectorId] = { id: c.sectorId, nameAr: c.sectorNameAr ?? c.sectorId, nameEn: c.sectorNameEn };
            return acc;
          }, {})
        );
        setSectors(derived);
      }
    } catch { setErr(lang === 'en' ? 'Failed to load contracts.' : 'فشل تحميل العقود.'); }
    finally { setLoading(false); }
  }, [filterSector, showArchived, lang]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (form: any) => {
    await api.post('/contracts', form);
    load();
  };
  const handleEdit = async (form: any) => {
    const id = (modal as Contract).id;
    await api.put(`/contracts/${id}`, form);
    load();
  };
  const handleArchive = async (id: string) => {
    if (!confirm(lang === 'en' ? 'Archive this contract?' : 'أرشفة هذا العقد؟')) return;
    await api.post(`/contracts/${id}/archive`);
    load();
  };
  const handleUnarchive = async (id: string) => {
    try {
      await api.post(`/contracts/${id}/unarchive`);
      load();
    } catch (e: any) {
      alert(e?.response?.data?.error ?? (lang === 'en' ? 'Failed to restore.' : 'فشل الاستعادة.'));
    }
  };

  // Group contracts by sector
  const grouped: Record<string, Contract[]> = {};
  for (const c of contracts) {
    const key = c.sectorNameAr ?? c.sectorId;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(c);
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-500" />
            {lang === 'en' ? 'Contracts' : 'العقود'}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {lang === 'en' ? 'Manage sector contracts and work order linking.' : 'إدارة عقود القطاعات وربط أوامر العمل.'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={load} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
            <RefreshCw size={15} />
          </button>
          {canManage() && (
            <button onClick={() => setModal('create')}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700">
              <Plus size={15} />{lang === 'en' ? 'New Contract' : 'عقد جديد'}
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        {!isScoped && (
          <select value={filterSector} onChange={e => setFilterSector(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white">
            <option value="">{lang === 'en' ? 'All sectors' : 'كل القطاعات'}</option>
            {sectors.map(s => <option key={s.id} value={s.id}>{lang === 'en' && s.nameEn ? s.nameEn : s.nameAr}</option>)}
          </select>
        )}
        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
          <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)}
            className="w-4 h-4 accent-indigo-600" />
          {lang === 'en' ? 'Show archived' : 'إظهار المؤرشفة'}
        </label>
      </div>

      {/* Unlinked alert */}
      <UnlinkedPanel />

      {/* Error */}
      {err && <div className="text-red-500 text-sm">{err}</div>}

      {/* Contracts list */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 size={24} className="animate-spin" />
        </div>
      ) : contracts.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <FileText size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">{lang === 'en' ? 'No contracts found.' : 'لا توجد عقود.'}</p>
          {canManage() && (
            <button onClick={() => setModal('create')} className="mt-3 text-sm text-indigo-600 hover:underline">
              {lang === 'en' ? 'Create the first contract' : 'أنشئ أول عقد'}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([sectorName, list]) => (
            <div key={sectorName}>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <span className="w-5 h-0.5 bg-slate-200 rounded" />
                {sectorName}
                <span className="font-normal normal-case">({list.length})</span>
              </h3>
              <div className="space-y-2">
                {list.map(c => (
                  <div key={c.id}>
                  <ContractRow
                    contract={c}
                    onEdit={c => setModal(c)}
                    onArchive={handleArchive}
                    onUnarchive={handleUnarchive}
                    refresh={load}
                  />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Relink panel (managers only) */}
      {canManage() && sectors.length > 0 && (
        <RelinkPanel sectors={isScoped && usr.sectorId ? sectors.filter(s => s.id === usr.sectorId) : sectors} />
      )}

      {/* Create / Edit modal */}
      {modal && (
        <ContractModal
          sectors={isScoped && usr.sectorId ? sectors.filter(s => s.id === usr.sectorId) : sectors}
          initial={modal === 'create' ? undefined : modal as Contract}
          onSave={modal === 'create' ? handleCreate : handleEdit}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
