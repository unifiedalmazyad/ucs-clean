import { useState, useRef, useCallback, useEffect } from 'react';
import api from '../services/api';
import { motion, AnimatePresence } from 'motion/react';
import {
  Upload, Download, FileSpreadsheet, CheckCircle2, XCircle,
  AlertTriangle, ChevronDown, ChevronUp, Loader2, RefreshCw,
  Eye, X, Users, ClipboardList,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────
interface PreviewResult {
  totalRows: number;
  insertCount: number;
  updateCount: number;
  errorCount: number;
  errors: { row: number; message: string }[];
  permitRows?: number;
  allBlank?: boolean;
}

interface CommitResult {
  inserted: number;
  updated: number;
  failed: number;
  errors: { row: number; message: string }[];
  note?: string;
  permitInserted?: number;
  permitFailed?: number;
  permitErrors?: { row: number; message: string }[];
}

interface ImportRun {
  id: string;
  module: string;
  uploadedAt: string;
  status: string;
  inserted: number;
  updated: number;
  failed: number;
  errorsJson: { row: number; message: string }[];
  uploaderUsername: string | null;
  uploaderFullName: string | null;
}

const MODULE_LABELS: Record<string, { label: string; icon: any; color: string }> = {
  work_orders: { label: 'أوامر العمل', icon: ClipboardList, color: 'text-indigo-600' },
  users:       { label: 'المستخدمين',  icon: Users,         color: 'text-emerald-600' },
};

// ─── Single Module Card ──────────────────────────────────────────────────
function ModuleCard({ module, onRunsRefresh }: { module: 'work_orders' | 'users'; onRunsRefresh: () => void }) {
  const [file, setFile]               = useState<File | null>(null);
  const [preview, setPreview]         = useState<PreviewResult | null>(null);
  const [commit, setCommit]           = useState<CommitResult | null>(null);
  const [loadingPreview, setLP]       = useState(false);
  const [loadingCommit, setLC]        = useState(false);
  const [err, setErr]                 = useState('');
  const [showErrors, setShowErrors]   = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const cfg = MODULE_LABELS[module];
  const Icon = cfg.icon;

  const downloadTemplate = async () => {
    try {
      const res = await api.get(`/import/${module}/template`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${module}_template.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { setErr('فشل في تنزيل القالب'); }
  };

  const downloadExport = async () => {
    try {
      const res = await api.get(`/import/export/${module}`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `export_${module}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { setErr('فشل في تصدير البيانات'); }
  };

  const handleFile = (f: File | null) => {
    setFile(f);
    setPreview(null);
    setCommit(null);
    setErr('');
    setShowErrors(false);
  };

  const runPreview = async () => {
    if (!file) { setErr('اختر ملف Excel أولاً'); return; }
    setErr('');
    setLP(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.post(`/import/${module}/preview`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setPreview(r.data);
      setCommit(null);
      if (r.data?.allBlank || (r.data?.errorCount > 0 && r.data?.insertCount === 0 && r.data?.updateCount === 0)) {
        setShowErrors(true);
      }
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'فشل في المعاينة');
    } finally { setLP(false); }
  };

  const runCommit = async () => {
    if (!file || !preview) return;
    setErr('');
    setLC(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.post(`/import/${module}/commit`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setCommit(r.data);
      setPreview(null);
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      onRunsRefresh();
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'فشل في الاستيراد');
    } finally { setLC(false); }
  };

  const reset = () => { setFile(null); setPreview(null); setCommit(null); setErr(''); if (fileRef.current) fileRef.current.value = ''; };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-xl bg-white border border-slate-200 ${cfg.color}`}>
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-slate-800">{cfg.label}</h3>
            <p className="text-xs text-slate-500">استيراد وتصدير بيانات {cfg.label}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            data-testid={`button-export-${module}`}
            onClick={downloadExport}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-50 border border-emerald-200 hover:border-emerald-400 hover:text-emerald-700 text-emerald-600 text-sm font-medium rounded-xl transition-colors"
          >
            <Download className="w-4 h-4" />
            تصدير البيانات
          </button>
          <button
            data-testid={`button-download-template-${module}`}
            onClick={downloadTemplate}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 hover:border-indigo-300 hover:text-indigo-600 text-slate-600 text-sm font-medium rounded-xl transition-colors"
          >
            <Download className="w-4 h-4" />
            تنزيل القالب
          </button>
        </div>
      </div>

      <div className="p-6 space-y-5">
        {/* Composite-key note for work orders */}
        {module === 'work_orders' && (
          <div className="flex items-start gap-2 text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 px-4 py-3 rounded-xl">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              <strong>المفتاح المركّب:</strong> رقم الأمر + نوع العمل معاً يحددان السجل.
              الخلايا الفارغة في الملف لن تمسح البيانات الموجودة — فقط الأعمدة التي تحتوي قيمة ستُحدَّث.
            </span>
          </div>
        )}

        {/* File Drop Zone */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">رفع ملف Excel</label>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            data-testid={`input-file-${module}`}
            onChange={e => handleFile(e.target.files?.[0] || null)}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className={`w-full border-2 border-dashed rounded-2xl py-8 flex flex-col items-center gap-2 transition-colors ${
              file ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 hover:border-indigo-200 text-slate-400 hover:text-indigo-400'
            }`}
          >
            <FileSpreadsheet className="w-8 h-8" />
            {file ? (
              <div className="text-center">
                <p className="font-medium text-sm">{file.name}</p>
                <p className="text-xs mt-0.5 opacity-70">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
            ) : (
              <>
                <p className="text-sm font-medium">اضغط لاختيار ملف Excel</p>
                <p className="text-xs">.xlsx أو .xls فقط</p>
              </>
            )}
          </button>
        </div>

        {err && (
          <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {err}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2">
          <button
            data-testid={`button-preview-${module}`}
            onClick={runPreview}
            disabled={!file || loadingPreview || loadingCommit}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-slate-700 hover:bg-slate-800 text-white text-sm font-medium rounded-xl disabled:opacity-40 transition-colors"
          >
            {loadingPreview ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
            معاينة
          </button>
          {file && (
            <button onClick={reset} className="px-3 py-2.5 border border-slate-200 text-slate-500 hover:bg-slate-50 rounded-xl transition-colors">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Preview Result */}
        <AnimatePresence>
          {preview && (
            <motion.div
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
              className="border border-slate-200 rounded-2xl overflow-hidden"
            >
              <div className="bg-slate-50 px-5 py-3 border-b border-slate-200 flex items-center justify-between">
                <h4 className="font-semibold text-slate-700 text-sm flex items-center gap-2">
                  <Eye className="w-4 h-4 text-slate-400" /> نتيجة المعاينة ({preview.totalRows} صف)
                </h4>
              </div>
              <div className="grid grid-cols-3 divide-x divide-x-reverse divide-slate-100 rtl:divide-x-reverse">
                <StatBox label="إدراج جديد" value={preview.insertCount} color="text-emerald-600" bg="bg-emerald-50" />
                <StatBox label="تحديث موجود" value={preview.updateCount} color="text-indigo-600" bg="bg-indigo-50" />
                <StatBox label="أخطاء" value={preview.errorCount} color="text-red-600" bg="bg-red-50" />
              </div>
              {preview.permitRows !== undefined && preview.permitRows > 0 && (
                <div className="px-5 py-2 bg-amber-50 border-t border-amber-100 text-xs text-amber-700">
                  تم اكتشاف بيانات تصريح حفر في <strong>{preview.permitRows}</strong> صف
                </div>
              )}
              {preview.allBlank && (
                <div className="px-5 py-3 bg-red-50 border-t border-red-200 text-xs text-red-700 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    <strong>تعذّر قراءة البيانات:</strong> رؤوس الأعمدة في الملف لا تطابق القالب المطلوب.
                    تأكد من تنزيل القالب الصحيح وملئه دون تعديل أسماء الأعمدة.
                    العمود الإلزامي الأول يجب أن يكون: <strong>اسم المستخدم *</strong>
                  </span>
                </div>
              )}

              {preview.errors.length > 0 && (
                <div className="border-t border-slate-100">
                  <button
                    onClick={() => setShowErrors(v => !v)}
                    className="w-full flex items-center justify-between px-5 py-3 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    <span className="font-medium">عرض {preview.errors.length} خطأ</span>
                    {showErrors ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {showErrors && (
                    <div className="px-5 pb-4 max-h-48 overflow-y-auto space-y-1">
                      {preview.errors.map((e, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-red-700 bg-red-50 px-3 py-1.5 rounded-lg">
                          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                          <span>صف {e.row}: {e.message}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {(preview.insertCount + preview.updateCount) > 0 && (
                <div className="px-5 py-4 border-t border-slate-100 bg-amber-50">
                  <p className="text-xs text-amber-700 mb-3">
                    سيتم إدراج <strong>{preview.insertCount}</strong> سجل جديد وتحديث <strong>{preview.updateCount}</strong> سجل موجود. هل تريد المتابعة؟
                  </p>
                  <button
                    data-testid={`button-commit-${module}`}
                    onClick={runCommit}
                    disabled={loadingCommit}
                    className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl disabled:opacity-50 transition-colors"
                  >
                    {loadingCommit ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    تأكيد الاستيراد
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Commit Result */}
        <AnimatePresence>
          {commit && (
            <motion.div
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
              className="border border-emerald-200 bg-emerald-50 rounded-2xl overflow-hidden"
            >
              <div className="px-5 py-3 border-b border-emerald-100 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <h4 className="font-semibold text-emerald-800 text-sm">تم الاستيراد بنجاح</h4>
              </div>
              <div className="grid grid-cols-3 divide-x divide-x-reverse divide-emerald-100">
                <StatBox label="تم إدراجه" value={commit.inserted} color="text-emerald-700" bg="bg-white" />
                <StatBox label="تم تحديثه" value={commit.updated} color="text-indigo-700" bg="bg-white" />
                <StatBox label="فشل" value={commit.failed} color="text-red-700" bg="bg-white" />
              </div>
              {commit.permitInserted !== undefined && commit.permitInserted > 0 && (
                <div className="px-5 py-3 border-t border-emerald-100 bg-amber-50 text-xs text-amber-800">
                  تصاريح الحفر: تم حفظ <strong>{commit.permitInserted}</strong> تصريح مضمّن في أوامر العمل
                </div>
              )}
              {commit.note && (
                <p className="px-5 py-3 text-xs text-amber-700 border-t border-emerald-100 bg-amber-50">
                  ملاحظة: {commit.note}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function StatBox({ label, value, color, bg }: { label: string; value: number; color: string; bg: string }) {
  return (
    <div className={`flex flex-col items-center py-4 ${bg}`}>
      <span className={`text-2xl font-bold ${color}`}>{value}</span>
      <span className="text-xs text-slate-500 mt-0.5">{label}</span>
    </div>
  );
}

// ─── Import History Table ────────────────────────────────────────────────
function ImportHistory({ runs, loading, onRefresh }: { runs: ImportRun[]; loading: boolean; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const statusCfg: Record<string, { label: string; color: string; icon: any }> = {
    DONE:    { label: 'ناجح',   color: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: CheckCircle2 },
    FAILED:  { label: 'فشل',    color: 'text-red-700 bg-red-50 border-red-200',             icon: XCircle },
    PENDING: { label: 'جاري',   color: 'text-amber-700 bg-amber-50 border-amber-200',       icon: Loader2 },
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
        <h3 className="font-bold text-slate-800 flex items-center gap-2">
          سجل عمليات الاستيراد
          <span className="text-xs font-normal bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">{runs.length}</span>
        </h3>
        <button onClick={onRefresh} disabled={loading} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors disabled:opacity-40">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32 text-slate-400 text-sm gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> جاري التحميل...
        </div>
      ) : runs.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-32 text-slate-400 text-sm gap-2">
          <FileSpreadsheet className="w-8 h-8 text-slate-200" />
          لا توجد عمليات استيراد بعد
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {runs.map(run => {
            const cfg = statusCfg[run.status] ?? statusCfg.PENDING;
            const SIcon = cfg.icon;
            const mCfg = MODULE_LABELS[run.module] || { label: run.module, icon: FileSpreadsheet, color: '' };
            const MIcon = mCfg.icon;
            return (
              <div key={run.id} data-testid={`run-row-${run.id}`}>
                <div className="flex items-center justify-between px-6 py-4 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className={`p-1.5 rounded-lg bg-slate-100 ${mCfg.color}`}>
                      <MIcon className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-800">{mCfg.label}</p>
                      <p className="text-xs text-slate-400">
                        {run.uploaderFullName || run.uploaderUsername || 'نظام'} ·{' '}
                        {new Date(run.uploadedAt).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' })}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="hidden sm:flex items-center gap-3 text-xs text-slate-500">
                      <span className="text-emerald-600 font-medium">+{run.inserted}</span>
                      <span className="text-indigo-600 font-medium">↻{run.updated}</span>
                      {run.failed > 0 && <span className="text-red-600 font-medium">✕{run.failed}</span>}
                    </div>
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border ${cfg.color}`}>
                      <SIcon className="w-3 h-3" />
                      {cfg.label}
                    </span>
                    {(run.errorsJson as any[]).length > 0 && (
                      <button onClick={() => setExpanded(v => v === run.id ? null : run.id)} className="p-1 text-slate-400 hover:text-slate-600">
                        {expanded === run.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded errors */}
                <AnimatePresence>
                  {expanded === run.id && (run.errorsJson as any[]).length > 0 && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-6 pb-4 space-y-1">
                        {(run.errorsJson as any[]).map((e: any, i: number) => (
                          <div key={i} className="flex items-start gap-2 text-xs text-red-700 bg-red-50 px-3 py-1.5 rounded-lg">
                            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                            <span>صف {e.row}: {e.message}</span>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────
export default function ImportExport() {
  const [runs, setRuns]         = useState<ImportRun[]>([]);
  const [runsLoading, setRL]    = useState(true);

  const loadRuns = useCallback(async () => {
    setRL(true);
    try {
      const r = await api.get('/import/runs');
      setRuns(r.data);
    } catch { /* noop */ }
    finally { setRL(false); }
  }, []);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6" dir="rtl">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">استيراد وتصدير البيانات</h1>
          <p className="text-slate-500 text-sm mt-1">رفع ملفات Excel لاستيراد البيانات بأمان مع معاينة قبل التأكيد</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-xs font-medium">
          <AlertTriangle className="w-3.5 h-3.5" />
          للمديرين فقط
        </div>
      </div>

      {/* Module Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ModuleCard module="work_orders" onRunsRefresh={loadRuns} />
        <ModuleCard module="users" onRunsRefresh={loadRuns} />
      </div>

      {/* History */}
      <ImportHistory runs={runs} loading={runsLoading} onRefresh={loadRuns} />
    </div>
  );
}
