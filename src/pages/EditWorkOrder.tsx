import { useEffect, useState, useCallback, useRef, Fragment, type ReactNode } from 'react';
import { useUpload } from '../hooks/use-upload';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useLang } from '../contexts/LangContext';
import { getColLabel, getLang } from '../i18n';
import { motion, AnimatePresence } from 'motion/react';
import {
  Save, ArrowRight, AlertCircle, History, X,
  Plus, PenLine, Trash2, ChevronDown, ChevronUp, User, Clock,
  MessageSquare, Send, Paperclip, ExternalLink,
  LayoutGrid, TrendingUp, FileText, Settings2,
  Eye, Download, Image, File,
  Wrench, MapPin, ClipboardCheck
} from 'lucide-react';

// ─── Utilities ────────────────────────────────────────────────────────────────
function toCamel(s: string): string {
  return s.replace(/_(\d+)/g, (_, n) => n).replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
function getField(order: any, columnKey: string): any {
  if (columnKey in order) return order[columnKey];
  return order[toCamel(columnKey)];
}
function fieldExists(order: any, columnKey: string): boolean {
  return (columnKey in order) || (toCamel(columnKey) in order);
}
function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatVal(v: any, colKey?: string, options?: any[]): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'نعم' : 'لا';
  if (typeof v === 'string') {
    // Dates
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) {
      return new Date(v).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
    }
    // UUIDs — show short form
    if (UUID_RE.test(v)) return `…${v.slice(-6)}`;
    // Try to resolve select option label
    if (colKey && options) {
      const opt = options.find((o: any) => o.columnKey === colKey && o.value === v);
      if (opt) {
        const l = getLang();
        return (l === 'en' && opt.labelEn) ? opt.labelEn : (opt.labelAr || v);
      }
    }
  }
  return String(v);
}

/** Return the correct language label for a column key from the catalog */
function colLabel(key: string, catalog: any[], lang?: string): string {
  const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  const col = catalog.find((c: any) => c.columnKey === key || c.columnKey === camel);
  if (!col) return key;
  const l = lang ?? getLang();
  return (l === 'en' && col.labelEn) ? col.labelEn : col.labelAr;
}

const ACTION_META: Record<string, { label: string; labelEn: string; color: string; icon: ReactNode }> = {
  CREATE: { label: 'إنشاء', labelEn: 'Created', color: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: <Plus size={12}/> },
  UPDATE: { label: 'تعديل', labelEn: 'Updated', color: 'bg-blue-100 text-blue-700 border-blue-200',   icon: <PenLine size={12}/> },
  DELETE: { label: 'حذف',  labelEn: 'Deleted',  color: 'bg-red-100 text-red-700 border-red-200',       icon: <Trash2 size={12}/> },
};

// ─── History Panel ─────────────────────────────────────────────────────────────
interface LogEntry {
  id: string;
  action: string;
  createdAt: string;
  actorUsername: string | null;
  actorFullName: string | null;
  diff: Array<{ key: string; before: any; after: any }>;
}

function HistoryPanel({ workOrderId, catalog, options }: {
  workOrderId: string;
  catalog: any[];
  options: any[];
}) {
  const { lang } = useLang();
  const [logs, setLogs]       = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/work-orders/${workOrderId}/history`);
      setLogs(res.data);
    } catch { /* noop */ } finally { setLoading(false); }
  }, [workOrderId]);

  useEffect(() => { load(); }, [load]);

  const actorName = (log: LogEntry) => log.actorFullName || log.actorUsername || (lang === 'en' ? 'System' : 'النظام');

  return (
    <div className="flex flex-col h-full" dir={lang === 'en' ? 'ltr' : 'rtl'}>
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="font-semibold text-sm text-gray-700 flex items-center gap-2">
          <History size={15} className="text-indigo-500"/>
          {lang === 'en' ? 'Activity Log' : 'سجل النشاط'}
        </h3>
        <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{logs.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-gray-400 text-sm">{lang === 'en' ? 'Loading...' : 'جاري التحميل...'}</div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-400 text-sm gap-2">
            <History size={24} className="text-gray-300"/>
            {lang === 'en' ? 'No activity yet' : 'لا يوجد سجل بعد'}
          </div>
        ) : (
          <div className="relative px-4">
            {/* Vertical line */}
            <div className="absolute right-6 top-0 bottom-0 w-px bg-gray-100"/>
            <div className="space-y-4">
              {logs.map((log, i) => {
                const meta = ACTION_META[log.action] ?? ACTION_META.UPDATE;
                const isOpen = expanded === log.id;
                const hasDiff = log.diff && log.diff.length > 0;
                return (
                  <div key={log.id} className="relative pr-6">
                    {/* Dot */}
                    <div className={`absolute right-3.5 top-2.5 w-2.5 h-2.5 rounded-full border-2 border-white
                      ${log.action === 'CREATE' ? 'bg-emerald-400' : log.action === 'DELETE' ? 'bg-red-400' : 'bg-blue-400'}`}/>

                    <div data-testid={`log-entry-${i}`}
                      className={`bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden
                        ${hasDiff ? 'cursor-pointer hover:border-indigo-200 transition-colors' : ''}`}
                      onClick={() => hasDiff && setExpanded(isOpen ? null : log.id)}
                    >
                      <div className="px-3 py-2.5">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${meta.color}`}>
                            {meta.icon}{lang === 'en' ? meta.labelEn : meta.label}
                          </span>
                          {hasDiff && (
                            <span className="text-xs text-gray-400">
                              {isOpen ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-gray-500">
                          <User size={11} className="text-gray-400"/>
                          <span className="font-medium text-gray-700">{actorName(log)}</span>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-gray-400 mt-1">
                          <Clock size={11}/>
                          <span>{formatDate(log.createdAt)}</span>
                        </div>
                      </div>

                      {/* Diff Section */}
                      <AnimatePresence>
                        {isOpen && hasDiff && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="border-t border-gray-50 overflow-hidden"
                          >
                            <div className="px-3 py-2 space-y-1.5 bg-gray-50/50">
                              {log.diff.map(d => (
                                <div key={d.key} className="text-xs">
                                  <div className="font-semibold text-indigo-600 mb-0.5">
                                    {colLabel(d.key, catalog, lang)}
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="px-1.5 py-0.5 bg-red-50 text-red-600 rounded line-through max-w-[45%] truncate">
                                      {formatVal(d.before, d.key, options)}
                                    </span>
                                    <span className="text-gray-400">←</span>
                                    <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded font-medium max-w-[45%] truncate">
                                      {formatVal(d.after, d.key, options)}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Refresh */}
      <div className="px-4 py-2 border-t border-gray-100">
        <button onClick={load} className="text-xs text-indigo-500 hover:text-indigo-700 flex items-center gap-1">
          <History size={12}/> {lang === 'en' ? 'Refresh Log' : 'تحديث السجل'}
        </button>
      </div>
    </div>
  );
}

// ─── Notes Panel ──────────────────────────────────────────────────────────────
interface NoteEntry {
  id: string;
  content: string;
  createdAt: string;
  userId: string | null;
  authorUsername: string | null;
  authorFullName: string | null;
}

function NotesPanel({ workOrderId, currentUserId }: { workOrderId: string; currentUserId?: string }) {
  const [notes, setNotes]   = useState<NoteEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText]     = useState('');
  const [sending, setSending] = useState(false);
  const { lang } = useLang();
  const bottomRef = useCallback((el: HTMLDivElement | null) => { if (el) el.scrollIntoView({ behavior: 'smooth' }); }, [notes]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/work-orders/${workOrderId}/notes`);
      setNotes(res.data);
    } catch { /* noop */ } finally { setLoading(false); }
  }, [workOrderId]);

  useEffect(() => { load(); }, [load]);

  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      const res = await api.post(`/work-orders/${workOrderId}/notes`, { content: text.trim() });
      setNotes(prev => [...prev, res.data]);
      setText('');
    } catch { /* noop */ } finally { setSending(false); }
  };

  const authorName = (n: NoteEntry) => n.authorFullName || n.authorUsername || (lang === 'en' ? 'Unknown' : 'مجهول');
  const isMe = (n: NoteEntry) => n.userId === currentUserId;

  return (
    <div className="flex flex-col h-full" dir={lang === 'en' ? 'ltr' : 'rtl'}>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-gray-400 text-sm">{lang === 'en' ? 'Loading...' : 'جاري التحميل...'}</div>
        ) : notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-400 text-sm gap-2">
            <MessageSquare size={24} className="text-gray-300"/>
            {lang === 'en' ? 'No notes yet' : 'لا توجد ملاحظات بعد'}
          </div>
        ) : (
          notes.map((n, i) => {
            const mine = isMe(n);
            return (
              <div key={n.id} className={`flex flex-col gap-0.5 ${mine ? 'items-end' : 'items-start'}`}
                data-testid={`note-${i}`}>
                <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed shadow-sm
                  ${mine
                    ? 'bg-indigo-600 text-white rounded-tr-sm'
                    : 'bg-gray-100 text-gray-800 rounded-tl-sm'}`}>
                  {n.content}
                </div>
                <div className="flex items-center gap-1 text-[10px] text-gray-400 px-1">
                  <User size={9}/>
                  <span>{authorName(n)}</span>
                  <span>·</span>
                  <span>{formatDate(n.createdAt)}</span>
                </div>
              </div>
            );
          })
        )}
        {!loading && <div ref={bottomRef}/>}
      </div>

      <div className="border-t border-gray-100 p-3 flex gap-2 items-end bg-gray-50/50">
        <textarea
          data-testid="input-note-text"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }}}
          placeholder={lang === 'en' ? 'Write a note...' : 'اكتب ملاحظة...'}
          rows={2}
          className="flex-1 resize-none border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
        />
        <button
          data-testid="button-send-note"
          onClick={send}
          disabled={sending || !text.trim()}
          className="p-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-xl transition-colors shrink-0"
        >
          <Send size={15}/>
        </button>
      </div>
    </div>
  );
}

// ─── Attachments Panel ────────────────────────────────────────────────────────
interface Attachment {
  id: string;
  name: string;
  url: string;
  createdAt: string;
  uploaderUsername: string | null;
  uploaderFullName: string | null;
}

function AttachmentsPanel({ workOrderId }: { workOrderId: string }) {
  const [list, setList]           = useState<Attachment[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showAdd, setShowAdd]     = useState(false);
  const [mode, setMode]           = useState<'file' | 'url'>('file');
  const [name, setName]           = useState('');
  const [urlVal, setUrlVal]       = useState('');
  const [saving, setSaving]       = useState(false);
  const [deleting, setDeleting]   = useState<string | null>(null);
  const [err, setErr]             = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { lang } = useLang();

  const { uploadFile, isUploading, progress, error: uploadError } = useUpload();

  // ── Preview state ──
  const [previewAtt, setPreviewAtt]         = useState<Attachment | null>(null);
  const [previewUrl, setPreviewUrl]         = useState<string | null>(null);
  const [previewType, setPreviewType]       = useState<'image' | 'pdf' | 'other'>('other');
  const [previewLoading, setPreviewLoading] = useState(false);

  const getFileType = (url: string, name: string): 'image' | 'pdf' | 'other' => {
    const ext = (name.split('.').pop() || url.split('?')[0].split('.').pop() || '').toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image';
    if (ext === 'pdf') return 'pdf';
    return 'other';
  };

  const mimeToType = (mime: string): 'image' | 'pdf' | 'other' => {
    if (mime.startsWith('image/')) return 'image';
    if (mime === 'application/pdf') return 'pdf';
    return 'other';
  };

  const openPreview = async (a: Attachment) => {
    setPreviewAtt(a);
    setPreviewUrl(null);
    setPreviewLoading(true);
    // Start with name-based detection
    setPreviewType(getFileType(a.url, a.name));
    if (isFileAttachment(a.url)) {
      try {
        const token = localStorage.getItem('token') || '';
        const resp = await fetch(a.url, { headers: { Authorization: `Bearer ${token}` } });
        if (resp.ok) {
          const blob = await resp.blob();
          // Override type detection using actual Content-Type from server
          const detectedType = mimeToType(blob.type || '');
          setPreviewType(detectedType !== 'other' ? detectedType : getFileType(a.url, a.name));
          setPreviewUrl(window.URL.createObjectURL(blob));
        }
      } catch { /* noop */ }
    } else {
      setPreviewUrl(a.url);
    }
    setPreviewLoading(false);
  };

  const closePreview = () => {
    if (previewUrl && previewAtt && isFileAttachment(previewAtt.url)) {
      window.URL.revokeObjectURL(previewUrl);
    }
    setPreviewAtt(null);
    setPreviewUrl(null);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.get(`/work-orders/${workOrderId}/attachments`); setList(r.data); }
    catch { /* noop */ } finally { setLoading(false); }
  }, [workOrderId]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => { setShowAdd(true); setErr(''); setName(''); setUrlVal(''); setSelectedFile(null); setMode('file'); };

  const saveAttachment = async (attName: string, attUrl: string) => {
    setSaving(true);
    try {
      const r = await api.post(`/work-orders/${workOrderId}/attachments`, { name: attName, url: attUrl });
      setList(prev => [r.data, ...prev]);
      setShowAdd(false);
    } catch { setErr('فشل في الحفظ، حاول مجدداً'); }
    finally { setSaving(false); }
  };

  const handleSubmit = async () => {
    setErr('');
    if (!name.trim()) { setErr('أدخل اسم المرفق'); return; }

    if (mode === 'file') {
      if (!selectedFile) { setErr('اختر ملفاً للرفع'); return; }
      const result = await uploadFile(selectedFile);
      if (!result) {
        setErr(uploadError?.message || 'فشل رفع الملف، حاول مجدداً');
        return;
      }
      await saveAttachment(name.trim(), result.objectPath);
    } else {
      if (!urlVal.trim()) { setErr('أدخل رابط المرفق'); return; }
      await saveAttachment(name.trim(), urlVal.trim());
    }
  };

  const remove = async (id: string) => {
    setDeleting(id);
    try {
      await api.delete(`/work-orders/${workOrderId}/attachments/${id}`);
      setList(prev => prev.filter(a => a.id !== id));
    } catch { /* noop */ }
    finally { setDeleting(null); }
  };

  const isFileAttachment = (url: string) => url.startsWith('/objects/');
  const uploaderName = (a: Attachment) => a.uploaderFullName || a.uploaderUsername || '—';

  const downloadGCSFile = async (url: string, fileName: string) => {
    try {
      const token = localStorage.getItem('token') || '';
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        if (response.status === 403) { setErr(lang === 'en' ? 'Access denied to this file' : 'ليس لديك صلاحية الوصول إلى هذا الملف'); return; }
        if (response.status === 404) { setErr(lang === 'en' ? 'File not found' : 'الملف غير موجود على الخادم'); return; }
        setErr(lang === 'en' ? 'Failed to download file' : 'فشل في تحميل الملف');
        return;
      }
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
    } catch {
      setErr(lang === 'en' ? 'Failed to download file' : 'فشل في تحميل الملف');
    }
  };

  return (
    <div className="space-y-4 max-w-4xl" dir={lang === 'en' ? 'ltr' : 'rtl'}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
          <Paperclip className="w-5 h-5 text-indigo-500"/>
          {lang === 'en' ? 'Attachments' : 'المرفقات'}
          <span className="text-sm font-normal text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{list.length}</span>
        </h2>
        <button
          data-testid="button-add-attachment"
          onClick={openAdd}
          className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-xl transition-colors"
        >
          <Plus className="w-4 h-4"/> {lang === 'en' ? 'Add Attachment' : 'إضافة مرفق'}
        </button>
      </div>

      {/* Add Modal */}
      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={() => setShowAdd(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.93, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.93, y: 12 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md mx-4"
              dir={lang === 'en' ? 'ltr' : 'rtl'}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                  <Paperclip className="w-4 h-4 text-indigo-500"/> {lang === 'en' ? 'Add New Attachment' : 'إضافة مرفق جديد'}
                </h3>
                <button onClick={() => setShowAdd(false)} className="p-1 hover:bg-slate-100 rounded-lg text-slate-400">
                  <X size={16}/>
                </button>
              </div>

              {/* Mode Tabs */}
              <div className="flex gap-1 px-6 pt-4">
                <button onClick={() => setMode('file')}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${mode === 'file' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  {lang === 'en' ? 'Upload File' : 'رفع ملف'}
                </button>
                <button onClick={() => setMode('url')}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${mode === 'url' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  {lang === 'en' ? 'External Link' : 'رابط خارجي'}
                </button>
              </div>

              <div className="px-6 py-4 space-y-4">
                {/* Attachment Name */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">{lang === 'en' ? 'Attachment Name' : 'اسم المرفق'} <span className="text-red-500">*</span></label>
                  <input
                    data-testid="input-attachment-name"
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder={lang === 'en' ? 'e.g. Contract, Invoice No. 5...' : 'مثال: عقد العمل، فاتورة رقم 5...'}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                </div>

                {mode === 'file' ? (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">{lang === 'en' ? 'Choose File' : 'اختر الملف'} <span className="text-red-500">*</span></label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.zip"
                      className="hidden"
                      onChange={e => {
                        const f = e.target.files?.[0] || null;
                        setSelectedFile(f);
                        if (f && !name.trim()) setName(f.name.replace(/\.[^.]+$/, ''));
                      }}
                    />
                    <button
                      data-testid="button-select-file"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full border-2 border-dashed border-slate-200 hover:border-indigo-300 rounded-xl py-6 flex flex-col items-center gap-2 text-slate-400 hover:text-indigo-500 transition-colors cursor-pointer"
                    >
                      <Paperclip size={24}/>
                      {selectedFile
                        ? <>
                            <span className="text-sm font-medium text-slate-700">{selectedFile.name}</span>
                            <span className="text-xs text-slate-500">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</span>
                          </>
                        : <>
                            <span className="text-sm">{lang === 'en' ? 'Click to choose file' : 'اضغط لاختيار ملف'}</span>
                            <span className="text-xs">PDF, Word, Excel, {lang === 'en' ? 'Images' : 'صور'}, ZIP</span>
                            <span className="text-xs text-slate-400">{lang === 'en' ? 'Max 100 MB' : 'الحد الأقصى 100 MB'}</span>
                          </>
                      }
                    </button>

                    {/* Upload Progress */}
                    {isUploading && (
                      <div className="mt-2">
                        <div className="flex justify-between text-xs text-slate-500 mb-1">
                          <span>{lang === 'en' ? 'Uploading...' : 'جاري الرفع...'}</span>
                          <span>{progress}%</span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${progress}%` }}/>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">{lang === 'en' ? 'Attachment URL' : 'رابط المرفق'} <span className="text-red-500">*</span></label>
                    <input
                      data-testid="input-attachment-url"
                      type="url"
                      value={urlVal}
                      onChange={e => setUrlVal(e.target.value)}
                      placeholder="https://..."
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                      dir="ltr"
                    />
                    <p className="text-xs text-slate-400 mt-1">{lang === 'en' ? 'Paste a link from Google Drive, SharePoint, or any other source' : 'الصق رابط الملف من Google Drive أو SharePoint أو أي مصدر آخر'}</p>
                  </div>
                )}

                {err && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{err}</p>}
              </div>

              <div className="px-6 pb-5 flex gap-2 justify-end">
                <button onClick={() => setShowAdd(false)} className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm hover:bg-slate-50">{lang === 'en' ? 'Cancel' : 'إلغاء'}</button>
                <button
                  data-testid="button-save-attachment"
                  onClick={handleSubmit}
                  disabled={saving || isUploading}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium disabled:opacity-50 flex items-center gap-1.5"
                >
                  {isUploading ? (lang === 'en' ? 'Uploading...' : 'جاري الرفع...') : saving ? (lang === 'en' ? 'Saving...' : 'جاري الحفظ...') : <><Plus className="w-4 h-4"/>{lang === 'en' ? 'Save' : 'حفظ'}</>}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-slate-400 text-sm">{lang === 'en' ? 'Loading...' : 'جاري التحميل...'}</div>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-slate-400 text-sm gap-3">
            <Paperclip size={32} className="text-slate-200"/>
            <span>{lang === 'en' ? 'No attachments yet' : 'لا توجد مرفقات حتى الآن'}</span>
            <button onClick={() => setShowAdd(true)} className="text-indigo-500 hover:text-indigo-700 text-sm flex items-center gap-1">
              <Plus size={13}/> {lang === 'en' ? 'Add first attachment' : 'أضف أول مرفق'}
            </button>
          </div>
        ) : (
          <table className="w-full text-sm" dir={lang === 'en' ? 'ltr' : 'rtl'}>
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-right px-5 py-3 font-semibold text-slate-600">{lang === 'en' ? 'Attachment Name' : 'اسم المرفق'}</th>
                <th className="text-right px-5 py-3 font-semibold text-slate-600">{lang === 'en' ? 'Link' : 'الرابط'}</th>
                <th className="text-right px-5 py-3 font-semibold text-slate-600">{lang === 'en' ? 'Uploaded By' : 'رُفع بواسطة'}</th>
                <th className="text-right px-5 py-3 font-semibold text-slate-600">{lang === 'en' ? 'Upload Date' : 'تاريخ الرفع'}</th>
                <th className="px-5 py-3"/>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((a, i) => (
                <tr key={a.id} className="hover:bg-slate-50 transition-colors" data-testid={`attachment-row-${i}`}>
                  <td className="px-5 py-3.5 font-medium text-slate-800">
                    <div className="flex items-center gap-2">
                      {(() => {
                        const t = getFileType(a.url, a.name);
                        return t === 'image' ? <Image size={13} className="text-indigo-400 shrink-0"/>
                          : t === 'pdf'   ? <FileText size={13} className="text-red-400 shrink-0"/>
                          : <Paperclip size={13} className="text-indigo-400 shrink-0"/>;
                      })()}
                      {a.name}
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        data-testid={`button-preview-attachment-${i}`}
                        onClick={() => openPreview(a)}
                        className="inline-flex items-center gap-1 text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 px-2 py-1 rounded-lg text-xs font-medium transition-colors"
                      >
                        <Eye size={12}/>
                        {lang === 'en' ? 'Preview' : 'معاينة'}
                      </button>
                      {isFileAttachment(a.url) ? (
                        <button
                          type="button"
                          data-testid={`attachment-link-${i}`}
                          onClick={() => downloadGCSFile(a.url, a.name)}
                          className="inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 px-2 py-1 rounded-lg text-xs font-medium transition-colors"
                        >
                          <Download size={12}/>
                          {lang === 'en' ? 'Download' : 'تنزيل'}
                        </button>
                      ) : (
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          data-testid={`attachment-link-${i}`}
                          className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-700 hover:bg-slate-100 px-2 py-1 rounded-lg text-xs font-medium transition-colors"
                        >
                          <ExternalLink size={12}/>
                          {lang === 'en' ? 'Open' : 'فتح'}
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-slate-500">{uploaderName(a)}</td>
                  <td className="px-5 py-3.5 text-slate-400 text-xs">
                    {new Date(a.createdAt).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' })}
                  </td>
                  <td className="px-5 py-3.5 text-left">
                    <button
                      data-testid={`button-delete-attachment-${i}`}
                      onClick={() => remove(a.id)}
                      disabled={deleting === a.id}
                      className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
                    >
                      <Trash2 size={13}/>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Preview Modal ── */}
      <AnimatePresence>
        {previewAtt && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={closePreview}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.93, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.93, y: 16 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl mx-4 flex flex-col overflow-hidden"
              style={{ maxHeight: '90vh' }}
              dir={lang === 'en' ? 'ltr' : 'rtl'}
            >
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-slate-50 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  {previewType === 'image'
                    ? <Image size={16} className="text-indigo-500 shrink-0"/>
                    : previewType === 'pdf'
                    ? <FileText size={16} className="text-red-500 shrink-0"/>
                    : <File size={16} className="text-slate-500 shrink-0"/>}
                  <span className="font-semibold text-slate-800 truncate text-sm">{previewAtt.name}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ms-3">
                  {previewUrl && previewType === 'pdf' && (
                    <button type="button" onClick={() => window.open(previewUrl, '_blank')}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg transition-colors">
                      <ExternalLink size={12}/>
                      {lang === 'en' ? 'Open in New Tab' : 'فتح في تبويب جديد'}
                    </button>
                  )}
                  {isFileAttachment(previewAtt.url) && (
                    <button type="button" onClick={() => downloadGCSFile(previewAtt.url, previewAtt.name)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg transition-colors">
                      <Download size={12}/>
                      {lang === 'en' ? 'Download' : 'تنزيل'}
                    </button>
                  )}
                  <button onClick={closePreview} className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-400 transition-colors"><X size={16}/></button>
                </div>
              </div>
              <div className="flex-1 overflow-auto flex items-center justify-center bg-slate-100 min-h-0" style={{ minHeight: 300 }}>
                {previewLoading ? (
                  <div className="flex flex-col items-center gap-3 text-slate-400">
                    <div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin"/>
                    <span className="text-sm">{lang === 'en' ? 'Loading preview...' : 'جاري تحميل المعاينة...'}</span>
                  </div>
                ) : previewUrl ? (
                  (() => {
                    if (previewType === 'image') return <img src={previewUrl} alt={previewAtt.name} className="max-w-full max-h-full object-contain rounded-lg shadow-sm" style={{ maxHeight: 'calc(90vh - 120px)' }}/>;
                    if (previewType === 'pdf') return (
                      <div className="w-full flex flex-col" style={{ height: 'calc(90vh - 120px)' }}>
                        <object
                          data={previewUrl}
                          type="application/pdf"
                          className="w-full flex-1"
                          style={{ border: 'none', minHeight: 0 }}
                        >
                          {/* Fallback when object tag doesn't work */}
                          <div className="flex flex-col items-center justify-center h-full gap-4 bg-slate-50 text-slate-500">
                            <FileText size={48} className="text-red-300"/>
                            <p className="text-sm font-medium text-slate-700">{previewAtt.name}</p>
                            <p className="text-xs text-slate-400 text-center px-4">{lang === 'en' ? 'PDF preview is not supported in this browser. Open in a new tab to view.' : 'معاينة PDF غير مدعومة في هذا المتصفح. افتحه في تبويب جديد للعرض.'}</p>
                            <button
                              type="button"
                              onClick={() => window.open(previewUrl!, '_blank')}
                              className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-xl transition-colors"
                            >
                              <ExternalLink size={14}/>
                              {lang === 'en' ? 'Open PDF in New Tab' : 'فتح PDF في تبويب جديد'}
                            </button>
                          </div>
                        </object>
                      </div>
                    );
                    return (
                      <div className="flex flex-col items-center gap-4 py-12 text-slate-500">
                        <File size={48} className="text-slate-300"/>
                        <p className="text-sm font-medium text-slate-700">{previewAtt.name}</p>
                        <p className="text-xs text-slate-400">{lang === 'en' ? 'Preview not available for this file type' : 'لا تتوفر معاينة لهذا النوع من الملفات'}</p>
                        {isFileAttachment(previewAtt.url) && (
                          <button type="button" onClick={() => downloadGCSFile(previewAtt.url, previewAtt.name)}
                            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-xl transition-colors">
                            <Download size={14}/>{lang === 'en' ? 'Download to View' : 'نزّل لعرضه'}
                          </button>
                        )}
                      </div>
                    );
                  })()
                ) : (
                  <div className="flex flex-col items-center gap-3 text-slate-400 py-12">
                    <AlertCircle size={32} className="text-red-300"/>
                    <p className="text-sm">{lang === 'en' ? 'Could not load preview' : 'تعذّر تحميل المعاينة'}</p>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Status badge helper ───────────────────────────────────────────────────────
const STATUS_META: Record<string, { ar: string; en: string; badge: string; icon: string }> = {
  OK:             { ar: 'منتظم',         en: 'On Track',       badge: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: '✓' },
  WARN:           { ar: 'تنبيه',         en: 'Warning',        badge: 'bg-amber-100 text-amber-700 border-amber-200',       icon: '⚠' },
  OVERDUE:        { ar: 'متأخر',            en: 'Overdue',      badge: 'bg-red-100 text-red-700 border-red-200',             icon: '✕' },
  COMPLETED:      { ar: 'منجز في الوقت', en: 'Completed',      badge: 'bg-teal-100 text-teal-700 border-teal-200',          icon: '✓' },
  COMPLETED_LATE: { ar: 'منجز متأخراً',  en: 'Done (Late)',    badge: 'bg-orange-100 text-orange-700 border-orange-200',    icon: '✓' },
  INCOMPLETE:     { ar: 'لم يبدأ',       en: 'Not Started',   badge: 'bg-slate-100 text-slate-500 border-slate-200',       icon: '—' },
};

function KpiStatusBadge({ status, compact }: { status: string; compact?: boolean }) {
  const { lang } = useLang();
  const meta = STATUS_META[status] ?? STATUS_META.INCOMPLETE;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full font-semibold border ${meta.badge} ${compact ? 'px-1.5 py-px text-[9px]' : 'px-2 py-0.5 text-[11px]'}`}>
      <span>{meta.icon}</span>
      {lang === 'en' ? meta.en : meta.ar}
    </span>
  );
}

// ─── Work Order Time Counter ─────────────────────────────────────────────────
function WorkOrderTimer({ order, workOrderId }: { order: any; workOrderId: string }) {
  const { lang } = useLang();

  // Collapsible state — persisted so mobile users keep their preference
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('wo_timer_collapsed') === '1'; } catch { return false; }
  });
  const toggleCollapsed = () => setCollapsed(prev => {
    const next = !prev;
    try { localStorage.setItem('wo_timer_collapsed', next ? '1' : '0'); } catch {}
    return next;
  });

  // Fetch phase SLA from dedicated endpoint (uses DASHBOARD-scope KPI rules by project type)
  const [phaseSla, setPhaseSla] = useState<{ execSlaDays: number | null; finSlaDays: number }>({ execSlaDays: null, finSlaDays: 20 });
  useEffect(() => {
    if (!workOrderId) return;
    api.get(`/kpis/phase-sla/${workOrderId}`)
      .then(res => setPhaseSla(res.data))
      .catch(() => {});
  }, [workOrderId]);

  const startRaw  = order.assignmentDate     ?? order.assignment_date;
  const pivotRaw  = order.proc155CloseDate   ?? order.proc_155_close_date;
  const endRaw    = order.financialCloseDate ?? order.financial_close_date;

  if (!startRaw) return null;

  // Normalize to UTC midnight so timezone offset doesn't skew day counts
  const utcDay = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());

  const startDate = new Date(startRaw);
  const pivotDate = pivotRaw  ? new Date(pivotRaw)  : null;
  const endDate   = endRaw    ? new Date(endRaw)    : null;
  const refDate   = endDate ?? new Date();
  const diffMs    = utcDay(refDate) - utcDay(startDate);
  const totalDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const years     = Math.floor(totalDays / 365);
  const months    = Math.floor((totalDays % 365) / 30);
  const days      = totalDays % 30;
  const isRunning = !endDate;

  // SLA values from dedicated phase-sla endpoint (project-type aware)
  const execSla = phaseSla.execSlaDays;
  const finSla  = phaseSla.finSlaDays;

  const fmtDate = (d: Date) =>
    d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  // Mini phase bar helper — plain function (not a component) to avoid hook violations
  const renderMiniPhase = (
    label: string, startD: Date | null, endD: Date | null,
    slaDays: number | null, color: string, kpiStatus?: string
  ) => {
    if (!startD) return (
      <div key={label} className="flex-1 rounded-lg border border-dashed border-slate-200 p-2 text-center">
        <div className="text-[10px] text-slate-400">{label}</div>
        <div className="text-[10px] text-slate-300 mt-0.5">{lang === 'en' ? 'No start date' : 'لا يوجد تاريخ'}</div>
      </div>
    );

    const today   = new Date();
    const ref2    = endD ?? today;
    const rawDiff = Math.floor((utcDay(ref2) - utcDay(startD)) / 86400000);

    // Phase hasn't started yet (start date is in the future)
    if (rawDiff < 0) return (
      <div key={label} className="flex-1 rounded-lg border border-dashed border-slate-200 p-2.5 text-center flex flex-col items-center justify-center gap-1">
        <div className="text-[10px] font-bold text-slate-500">{label}</div>
        <div className="text-[10px] text-slate-400">{lang === 'en' ? 'Not started yet' : 'لم يبدأ بعد'}</div>
        <div className="text-[9px] text-slate-300">{fmtDate(startD)}</div>
      </div>
    );

    const elapsed = rawDiff;
    const running = !endD;
    const pct     = slaDays ? Math.min(Math.round((elapsed / slaDays) * 100), 100) : 0;
    const isLate  = slaDays ? elapsed > slaDays : false;
    const overBy  = slaDays ? elapsed - slaDays : 0;

    // Determine effective status if not passed from KPI
    const effectiveStatus = kpiStatus ?? (
      !running && !isLate ? 'COMPLETED'
      : !running && isLate ? 'COMPLETED_LATE'
      : running && isLate  ? 'OVERDUE'
      : 'OK'
    );

    const barColor =
      effectiveStatus === 'COMPLETED'      ? 'bg-emerald-500'
      : effectiveStatus === 'COMPLETED_LATE' ? 'bg-amber-500'
      : effectiveStatus === 'OVERDUE'      ? 'bg-red-500'
      : pct >= 80                          ? 'bg-amber-400'
      : 'bg-indigo-400';

    return (
      <div key={label} className={`flex-1 rounded-md border p-2 ${color}`}>
        {/* Label + status badge on same row */}
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-semibold text-slate-500">{label}</span>
          <KpiStatusBadge status={effectiveStatus} compact />
        </div>

        {/* Day counter */}
        <div className="flex items-baseline gap-1 mb-1">
          <span className="text-base font-bold tabular-nums text-slate-800 leading-none">
            {elapsed.toLocaleString('en-US')}
          </span>
          <span className="text-[10px] text-slate-400">{lang === 'en' ? 'd' : 'يوم'}</span>
        </div>

        {/* SLA bar */}
        {slaDays && (
          <div className="w-full bg-slate-200 rounded-full h-1 mb-1 overflow-hidden">
            <div className={`h-1 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
          </div>
        )}

        {/* SLA + date in one compact row */}
        <div className="flex items-center justify-between text-[9px] text-slate-400">
          {slaDays
            ? <span>SLA: {slaDays} {lang === 'en' ? 'd' : 'ي'}{isLate ? <span className="text-red-500 mr-1"> (+{overBy})</span> : null}</span>
            : <span />
          }
          <span>{endD ? fmtDate(endD) : (lang === 'en' ? 'now' : 'جاري')}</span>
        </div>
      </div>
    );
  };

  return (
    <div className={`rounded-xl border mb-3 relative overflow-hidden ${
      isRunning
        ? 'bg-gradient-to-br from-indigo-50 to-blue-50 border-indigo-200'
        : 'bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-200'
    }`}>

      {/* ── Header row — always visible ── */}
      <button
        onClick={toggleCollapsed}
        className="w-full flex items-center justify-between px-3 py-2.5 text-right"
        data-testid="timer-toggle"
      >
        <div className="flex items-center gap-2">
          {/* Pulsing dot */}
          {isRunning && (
            <span className="flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-indigo-400 opacity-75"/>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"/>
            </span>
          )}
          {/* Compact summary: days + label */}
          <span className={`text-lg font-black tabular-nums leading-none ${isRunning ? 'text-indigo-700' : 'text-emerald-800'}`}>
            {totalDays.toLocaleString('en-US')}
          </span>
          <span className="text-[10px] text-slate-400">{lang === 'en' ? 'd' : 'يوم'}</span>
          <span className={`text-[11px] font-semibold ${isRunning ? 'text-indigo-500' : 'text-emerald-600'}`}>
            {isRunning
              ? (lang === 'en' ? '⏱ Running' : '⏱ جاري')
              : (lang === 'en' ? '✓ Closed' : '✓ مغلق')
            }
          </span>
        </div>
        {/* Chevron icon */}
        <span className={`text-slate-400 text-xs transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`}>▾</span>
      </button>

      {/* ── Expandable body ── */}
      {!collapsed && (
        <div className="px-3 pb-3">
          {/* Big day count */}
          <div className="flex items-baseline gap-1.5 mb-2">
            <span className={`text-4xl font-black tabular-nums ${isRunning ? 'text-indigo-700' : 'text-emerald-800'}`}>
              {totalDays.toLocaleString('en-US')}
            </span>
            <span className="text-sm font-medium text-slate-500">{lang === 'en' ? 'days' : 'يوم'}</span>
          </div>

          {/* Breakdown */}
          {totalDays >= 30 && (
            <div className="flex gap-3 mb-2">
              {years > 0 && (
                <div className="text-center">
                  <div className="text-base font-bold text-slate-700">{years}</div>
                  <div className="text-[10px] text-slate-400">{lang === 'en' ? 'yr' : 'سنة'}</div>
                </div>
              )}
              {(years > 0 || months > 0) && (
                <div className="text-center">
                  <div className="text-base font-bold text-slate-700">{months}</div>
                  <div className="text-[10px] text-slate-400">{lang === 'en' ? 'mo' : 'شهر'}</div>
                </div>
              )}
              <div className="text-center">
                <div className="text-base font-bold text-slate-700">{days}</div>
                <div className="text-[10px] text-slate-400">{lang === 'en' ? 'd' : 'يوم'}</div>
              </div>
            </div>
          )}

          {/* Date range */}
          <div className="border-t border-white/60 pt-2 mb-3 space-y-1">
            <div className="flex justify-between text-[10px]">
              <span className="text-slate-400">{lang === 'en' ? 'Assigned:' : 'تاريخ الاسناد:'}</span>
              <span className="font-medium text-slate-700">{fmtDate(startDate)}</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-slate-400">{lang === 'en' ? 'Financial Close:' : 'الإغلاق المالي:'}</span>
              <span className={`font-medium ${isRunning ? 'text-indigo-400 italic' : 'text-slate-700'}`}>
                {isRunning ? (lang === 'en' ? 'Not closed yet' : 'لم يُغلق بعد') : fmtDate(endDate!)}
              </span>
            </div>
          </div>

          {/* Mini phase timers */}
          <div className="flex gap-2">
            {renderMiniPhase(lang === 'en' ? 'Execution' : 'التنفيذي', startDate, pivotDate, execSla, 'bg-blue-50/80 border-blue-100')}
            {renderMiniPhase(lang === 'en' ? 'Financial' : 'المالي',   pivotDate, endDate,   finSla,  'bg-amber-50/80 border-amber-100')}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Stage Progress Counter ──────────────────────────────────────────────────
function StageProgressBar({ order, stagesList }: { order: any; stagesList: any[] }) {
  const { lang } = useLang();
  const execStages = stagesList.filter((s: any) => s.category === 'EXEC').sort((a: any, b: any) => a.seq - b.seq);
  const finStages  = stagesList.filter((s: any) => s.category === 'FIN').sort((a: any, b: any) => a.seq - b.seq);

  const currentStageId = order.stageId;
  const currentStage = stagesList.find((s: any) => s.id === currentStageId);
  if (!currentStage) return null;

  const allStages = [...execStages, ...finStages];
  const currentIdx = allStages.findIndex((s: any) => s.id === currentStageId);
  const total = allStages.length;
  const done  = currentIdx + 1;
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0;

  const stageName = lang === 'en' && currentStage.nameEn ? currentStage.nameEn : currentStage.nameAr;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 mb-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-slate-600">{lang === 'en' ? 'Current Stage' : 'الإجراء الحالي'}</span>
        <span className="text-xs font-bold text-indigo-600">{done} / {total}</span>
      </div>
      <div className="text-sm font-bold text-slate-800 mb-2 truncate">{stageName}</div>
      {/* Progress bar */}
      <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
        <div
          className={`h-2 rounded-full transition-all ${pct === 100 ? 'bg-emerald-500' : pct >= 60 ? 'bg-indigo-500' : 'bg-amber-400'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-slate-400 mt-1">
        <span>{lang === 'en' ? 'Start' : 'البداية'}</span>
        <span className="font-medium text-indigo-600">{pct}%</span>
        <span>{lang === 'en' ? 'End' : 'النهاية'}</span>
      </div>
    </div>
  );
}

// ─── KPI Cards — read-only view for all users ─────────────────────────────────
function KpiList({ workOrderId }: { workOrderId: string }) {
  const [kpis, setKpis]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { lang } = useLang();

  useEffect(() => {
    setLoading(true);
    api.get(`/kpis/${workOrderId}`)
      .then(res => setKpis(res.data))
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, [workOrderId]);

  const cardBg = (s: string) => {
    if (s === 'OVERDUE')        return 'border-red-200 bg-red-50';
    if (s === 'WARN')           return 'border-amber-200 bg-amber-50';
    if (s === 'OK')             return 'border-emerald-200 bg-emerald-50';
    if (s === 'COMPLETED')      return 'border-teal-200 bg-teal-50';
    if (s === 'COMPLETED_LATE') return 'border-orange-200 bg-orange-50';
    return 'border-slate-200 bg-white';
  };

  if (loading) return (
    <div className="flex flex-col gap-2">
      {[1,2,3].map(i => <div key={i} className="h-20 bg-slate-100 rounded-xl animate-pulse"/>)}
    </div>
  );

  if (kpis.length === 0) return (
    <div className="text-center py-8 text-slate-400 text-sm flex flex-col items-center gap-2">
      <TrendingUp size={28} className="text-slate-200"/>
      {lang === 'en' ? 'No KPIs defined for this project type' : 'لا توجد مؤشرات لهذا النوع'}
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      {kpis.map(kpi => {
        const isDate = kpi.calcMode !== 'RATIO' && kpi.calcMode !== 'DIFF';
        const isDone = kpi.isCompleted;
        const daysNum = kpi.elapsedDays ?? null;

        // SLA progress bar (only for date-based KPIs with slaDays > 0)
        const slaPercent = (kpi.slaDays > 0 && daysNum !== null)
          ? Math.min(100, Math.round((daysNum / kpi.slaDays) * 100))
          : null;

        const barColor =
          kpi.status === 'OVERDUE'        ? 'bg-red-400' :
          kpi.status === 'COMPLETED_LATE' ? 'bg-orange-400' :
          kpi.status === 'WARN'           ? 'bg-amber-400' :
          kpi.status === 'COMPLETED'      ? 'bg-teal-500' :
          kpi.status === 'OK'             ? 'bg-emerald-500' : 'bg-slate-300';

        return (
          <div key={kpi.ruleId} className={`rounded-xl border p-3.5 ${cardBg(kpi.status)}`}>
            {/* Header */}
            <div className="flex items-start justify-between gap-2 mb-2">
              <h3 className="text-xs font-bold text-slate-700 leading-tight">{kpi.nameAr}</h3>
              <KpiStatusBadge status={kpi.status} />
            </div>

            {/* Main metric */}
            {kpi.percentValue !== null ? (
              <div className="flex items-baseline gap-1 mb-2">
                <span className="text-2xl font-bold text-slate-900">{kpi.percentValue}%</span>
              </div>
            ) : daysNum !== null ? (
              <div className="flex items-baseline gap-1 mb-2">
                <span className="text-2xl font-bold text-slate-900">{daysNum}</span>
                <span className="text-xs text-slate-500">{lang === 'en' ? 'days' : 'يوم'}</span>
                {isDone && kpi.details?.endDate && (
                  <span className="text-[10px] text-slate-400 mr-auto">
                    {lang === 'en' ? 'Done:' : 'أُنجز:'} {new Date(kpi.details.endDate).toLocaleDateString('en-GB')}
                  </span>
                )}
              </div>
            ) : null}

            {/* SLA Progress Bar */}
            {slaPercent !== null && (
              <div className="mb-2">
                <div className="w-full bg-white/60 rounded-full h-1.5 overflow-hidden">
                  <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${Math.min(slaPercent, 100)}%` }}/>
                </div>
              </div>
            )}

            {/* Footer info */}
            <div className="flex items-center justify-between text-[10px] text-slate-500">
              <span>SLA: {kpi.slaDays} {lang === 'en' ? 'days' : 'يوم'}</span>
              {!isDone && kpi.remainingDays !== null && (
                <span className={kpi.remainingDays < 0 ? 'text-red-600 font-bold' : 'text-slate-500'}>
                  {kpi.remainingDays < 0
                    ? `${lang === 'en' ? 'Late by' : 'تأخر'} ${Math.abs(kpi.remainingDays)} ${lang === 'en' ? 'd' : 'يوم'}`
                    : `${lang === 'en' ? 'Left:' : 'متبقي:'} ${kpi.remainingDays} ${lang === 'en' ? 'd' : 'يوم'}`
                  }
                </span>
              )}
              {isDone && (
                <span className="text-teal-600 font-semibold">{lang === 'en' ? '✓ Completed' : '✓ تم الإنجاز'}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Excavation Permits Sub-Table ─────────────────────────────────────────────
function ExcavationPermitsTable({ workOrderId, canEdit = true, canDelete = true }: { workOrderId: string; canEdit?: boolean; canDelete?: boolean }) {
  const [permits, setPermits]       = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showForm, setShowForm]     = useState(false);
  const [extTarget, setExtTarget]   = useState<any | null>(null);
  const [saving, setSaving]         = useState(false);
  const [form, setForm]             = useState({ permitNo: '', startDate: '', endDate: '' });
  const [extForm, setExtForm]       = useState({ startDate: '', endDate: '' });
  const { lang } = useLang();

  const loadPermits = async () => {
    try {
      const res = await api.get(`/work-orders/${workOrderId}/excavation-permits`);
      setPermits(res.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadPermits(); }, [workOrderId]);

  const handleAdd = async () => {
    if (!form.permitNo.trim()) { alert(lang === 'en' ? 'Permit number is required' : 'رقم التصريح مطلوب'); return; }
    setSaving(true);
    try {
      await api.post(`/work-orders/${workOrderId}/excavation-permits`, form);
      setForm({ permitNo: '', startDate: '', endDate: '' });
      setShowForm(false);
      loadPermits();
    } catch (e: any) { alert(e?.response?.data?.error || (lang === 'en' ? 'Save failed' : 'فشل الحفظ')); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(lang === 'en' ? 'Delete this permit?' : 'هل تريد حذف هذا التصريح؟')) return;
    await api.delete(`/work-orders/${workOrderId}/excavation-permits/${id}`);
    loadPermits();
  };

  const handleExtend = async () => {
    if (!extTarget) return;
    setSaving(true);
    try {
      await api.post(`/work-orders/${workOrderId}/excavation-permits/${extTarget.id}/extend`, extForm);
      setExtTarget(null);
      setExtForm({ startDate: '', endDate: '' });
      loadPermits();
    } catch (e: any) { alert(e?.response?.data?.error || (lang === 'en' ? 'Extension failed' : 'فشل التمديد')); }
    finally { setSaving(false); }
  };

  const statusBadge = (s: string) => {
    if (s === 'منتهي')             return 'bg-red-100 text-red-700';
    if (s === 'شارف على الانتهاء') return 'bg-amber-100 text-amber-700';
    return 'bg-emerald-100 text-emerald-700';
  };

  const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-GB') : '—';

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 4v5M15 4v5"/>
          </svg>
          <h2 className="font-bold text-slate-800">{lang === 'en' ? 'Excavation Permits' : 'تصاريح الحفر'}</h2>
          <span className="text-xs bg-slate-200 text-slate-600 rounded-full px-2 py-0.5">{permits.length}</span>
        </div>
        {canEdit && (
          <button
            onClick={() => setShowForm(v => !v)}
            data-testid="btn-add-excavation-permit"
            className="flex items-center gap-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
            {lang === 'en' ? 'Add Permit' : 'إضافة تصريح'}
          </button>
        )}
      </div>

      {/* Add form */}
      {showForm && (
        <div className="px-6 py-4 bg-indigo-50/50 border-b border-indigo-100">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">{lang === 'en' ? 'Permit No. *' : 'رقم التصريح *'}</label>
              <input
                type="text"
                value={form.permitNo}
                onChange={e => setForm({ ...form, permitNo: e.target.value })}
                placeholder="EX-2025-001"
                data-testid="input-permit-no"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-400 outline-none bg-white"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">{lang === 'en' ? 'Start Date' : 'تاريخ البداية'}</label>
              <input
                type="date"
                value={form.startDate}
                onChange={e => setForm({ ...form, startDate: e.target.value })}
                data-testid="input-permit-start"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-400 outline-none bg-white"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">{lang === 'en' ? 'End Date' : 'تاريخ الانتهاء'}</label>
              <input
                type="date"
                value={form.endDate}
                onChange={e => setForm({ ...form, endDate: e.target.value })}
                data-testid="input-permit-end"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-400 outline-none bg-white"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={handleAdd} disabled={saving} data-testid="btn-save-permit"
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded-lg disabled:opacity-50 transition-colors">
              {saving ? (lang === 'en' ? 'Saving...' : 'جاري الحفظ...') : (lang === 'en' ? 'Save' : 'حفظ')}
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-1.5 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-white transition-colors">
              {lang === 'en' ? 'Cancel' : 'إلغاء'}
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="px-6 py-8 text-center text-slate-400 text-sm">{lang === 'en' ? 'Loading...' : 'جاري التحميل...'}</div>
      ) : permits.length === 0 ? (
        <div className="px-6 py-8 text-center text-slate-400 text-sm">{lang === 'en' ? 'No excavation permits added' : 'لا توجد تصاريح حفر مضافة'}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500">{lang === 'en' ? 'Permit No.' : 'رقم التصريح'}</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500">{lang === 'en' ? 'Start' : 'البداية'}</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500">{lang === 'en' ? 'End' : 'الانتهاء'}</th>
                <th className="px-4 py-2.5 text-center text-xs font-semibold text-slate-500">{lang === 'en' ? 'Extension No.' : 'رقم التمديد'}</th>
                <th className="px-4 py-2.5 text-center text-xs font-semibold text-slate-500">{lang === 'en' ? 'Status' : 'الحالة'}</th>
                <th className="px-4 py-2.5 text-center text-xs font-semibold text-slate-500">{lang === 'en' ? 'Action' : 'إجراء'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {permits.map(p => (
                <tr key={p.id} data-testid={`row-permit-${p.id}`} className={`hover:bg-slate-50/50 ${p.isExtension ? 'bg-sky-50/30' : ''}`}>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-700">
                    {p.isExtension && <span className="text-sky-500 mr-1">↳</span>}
                    {p.permitNo}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-600">{fmtDate(p.startDate)}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-600">{fmtDate(p.endDate)}</td>
                  <td className="px-4 py-2.5 text-center text-xs text-slate-600">
                    {p.extensionNumber === 0 ? '—' : `${lang === 'en' ? 'Ext.' : 'تمديد'} ${p.extensionNumber}`}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${statusBadge(p.status)}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      {canEdit && (
                        <button
                          onClick={() => { setExtTarget(p); setExtForm({ startDate: p.endDate || '', endDate: '' }); }}
                          title="إضافة تمديد"
                          data-testid={`btn-extend-${p.id}`}
                          className="p-1 text-sky-500 hover:text-sky-700 hover:bg-sky-50 rounded transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => handleDelete(p.id)}
                          title="حذف"
                          data-testid={`btn-delete-permit-${p.id}`}
                          className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                        </button>
                      )}
                      {!canEdit && !canDelete && <span className="text-slate-300 text-xs">—</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Extension Modal */}
      {extTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && setExtTarget(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between p-4 border-b border-slate-100">
              <h3 className="font-bold text-slate-800 text-sm">{lang === 'en' ? 'Extend Permit:' : 'تمديد التصريح:'} <span className="font-mono text-indigo-600">{extTarget.permitNo}</span></h3>
              <button onClick={() => setExtTarget(null)} className="p-1 hover:bg-slate-100 rounded-lg">
                <svg className="w-4 h-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">{lang === 'en' ? 'Extension Start Date' : 'تاريخ بداية التمديد'}</label>
                <input type="date" value={extForm.startDate} onChange={e => setExtForm({ ...extForm, startDate: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-400 outline-none" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">{lang === 'en' ? 'Extension End Date *' : 'تاريخ انتهاء التمديد *'}</label>
                <input type="date" value={extForm.endDate} onChange={e => setExtForm({ ...extForm, endDate: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-400 outline-none" />
              </div>
            </div>
            <div className="flex gap-2 p-4 border-t border-slate-100">
              <button onClick={() => setExtTarget(null)} className="flex-1 px-3 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm hover:bg-slate-50">{lang === 'en' ? 'Cancel' : 'إلغاء'}</button>
              <button onClick={handleExtend} disabled={saving || !extForm.endDate}
                data-testid="btn-confirm-extend"
                className="flex-1 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm disabled:opacity-50 transition-colors">
                {saving ? (lang === 'en' ? 'Loading...' : 'جاري...') : (lang === 'en' ? 'Confirm Extension' : 'تأكيد التمديد')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function EditWorkOrder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { lang } = useLang();
  const [order, setOrder]   = useState<any>({});
  const [catalog, setCatalog] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [options, setOptions] = useState<any[]>([]);
  const [stagesList, setStagesList] = useState<any[]>([]);
  const [sectorsList, setSectorsList] = useState<any[]>([]);
  const [regionsList, setRegionsList] = useState<any[]>([]);
  const [userScope, setUserScope] = useState<{ role: string; sectorId: string | null; regionId: string | null; scopeType: string; canViewExcavationPermits?: boolean; canEditExcavationPermits?: boolean; canDeleteExcavationPermits?: boolean }>({ role: 'OPERATOR', sectorId: null, regionId: null, scopeType: 'ALL' });
  const [effectivePerms, setEffectivePerms] = useState<Record<string, { canRead: boolean; canWrite: boolean }>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [sidebarTab, setSidebarTab]       = useState<'kpis' | 'history' | 'notes'>('kpis');
  const [dateConstraints, setDateConstraints] = useState<Array<{ startCol: string; endCol: string; labelAr: string }>>([]);
  const [dateErrors, setDateErrors]           = useState<Record<string, string>>({});
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('wo_sidebar_collapsed') === '1'; } catch { return false; }
  });
  const toggleSidebar = () => setSidebarCollapsed(prev => {
    const next = !prev;
    try { localStorage.setItem('wo_sidebar_collapsed', next ? '1' : '0'); } catch {}
    return next;
  });
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [navTarget,        setNavTarget]        = useState('');
  const [delayErr,         setDelayErr]         = useState('');
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const toggleSection = (key: string) => setOpenSections(p => ({ ...p, [key]: !p[key] }));

  useEffect(() => {
    api.get(`/work-orders/${id}/edit-context`).then(res => {
      const { workOrder, catalog, options, groups, stages: stgs, sectors: scts, regions: rgns, userScope: us, effectivePerms: ep } = res.data;
      setOrder(workOrder);
      setCatalog(catalog);
      setOptions(options);
      setGroups(groups);
      setStagesList(stgs || []);
      setSectorsList(scts || []);
      // For OWN_SECTOR: only show regions that belong to the user's sector
      const filteredRegions = us?.scopeType === 'OWN_SECTOR' && us?.sectorId
        ? (rgns || []).filter((r: any) => r.sectorId === us.sectorId)
        : (rgns || []);
      setRegionsList(filteredRegions);
      if (us) setUserScope(us);
      if (ep) {
        const permMap: Record<string, { canRead: boolean; canWrite: boolean }> = {};
        (ep as any[]).forEach((p: any) => { permMap[p.columnKey] = { canRead: p.canRead, canWrite: p.canWrite }; });
        setEffectivePerms(permMap);
      }
      // Default all groups open
      if (groups && groups.length > 0) {
        const init: Record<string, boolean> = { delay: true, attachments: false };
        groups.forEach((g: any) => { init[g.key] = true; });
        setOpenSections(init);
      }
    }).catch(console.error).finally(() => setLoading(false));

    // Fetch date constraints for this work order (KPI-based min-date validation)
    if (id) {
      api.get(`/kpis/date-constraints/${id}`)
        .then(r => setDateConstraints(r.data ?? []))
        .catch(() => {});
    }
  }, [id]);

  // ── Guard: warn browser on refresh / tab-close / OS back button ────────────
  useEffect(() => {
    if (!hasChanges) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasChanges]);

  // ── Guard: intercept in-app link clicks (sidebar NavLinks, etc.) ───────────
  useEffect(() => {
    if (!hasChanges) return;
    const handleClick = (e: MouseEvent) => {
      const anchor = (e.target as Element).closest('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || href === window.location.pathname) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setNavTarget(href);
      setShowLeaveConfirm(true);
    };
    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [hasChanges]);

  // ── Safe navigate: shows confirm dialog if unsaved changes exist ───────────
  const safeNavigate = (to: string) => {
    if (hasChanges) { setNavTarget(to); setShowLeaveConfirm(true); }
    else navigate(to);
  };

  const confirmLeave = () => {
    setShowLeaveConfirm(false);
    setHasChanges(false);
    navigate(navTarget);
  };

  const saveAndLeave = async () => {
    setShowLeaveConfirm(false);
    setSaving(true);
    try {
      await api.put(`/work-orders/${id}`, order);
      setHasChanges(false);
      navigate(navTarget);
    } catch {
      alert('فشل الحفظ — يرجى المحاولة مجدداً');
    } finally {
      setSaving(false);
    }
  };

  /**
   * Returns true when the current user can write to this column.
   * ADMIN always can. Scope-restricted fields (sector/region) are forced read-only
   * even if column permissions say canWrite, because the backend will ignore the change.
   */
  const canWriteField = (columnKey: string): boolean => {
    if (userScope.role === 'ADMIN') return true;
    // sector_id is always fixed for OWN_SECTOR and OWN_REGION users
    if (columnKey === 'sector_id' && (userScope.scopeType === 'OWN_SECTOR' || userScope.scopeType === 'OWN_REGION')) return false;
    // region_id is fixed for OWN_REGION users
    if (columnKey === 'region_id' && userScope.scopeType === 'OWN_REGION') return false;
    const p = effectivePerms[columnKey];
    return p?.canWrite === true;
  };

  const handleSave = async () => {
    // Validate delay fields
    const execJustified = order.execDelayJustified ?? order.exec_delay_justified;
    const finJustified  = order.finDelayJustified  ?? order.fin_delay_justified;
    const execReason    = (order.execDelayReason   ?? order.exec_delay_reason   ?? '').toString().trim();
    const finReason     = (order.finDelayReason    ?? order.fin_delay_reason    ?? '').toString().trim();

    const canWriteExec = canWriteField('exec_delay_justified');
    const canWriteFin  = canWriteField('fin_delay_justified');

    if (canWriteExec && execJustified === true && !execReason) {
      setDelayErr(lang === 'en' ? 'Execution delay reason is required when marked as justified' : 'سبب التأخير التنفيذي مطلوب عند اختيار مسبب');
      return;
    }
    if (canWriteFin && finJustified === true && !finReason) {
      setDelayErr(lang === 'en' ? 'Financial delay reason is required when marked as justified' : 'سبب التأخير المالي مطلوب عند اختيار مسبب');
      return;
    }
    setDelayErr('');
    setSaving(true);
    try {
      await api.put(`/work-orders/${id}`, order);
      setHasChanges(false);
      alert('تم الحفظ بنجاح');
    } catch { alert('فشل الحفظ'); }
    finally { setSaving(false); }
  };

  // Validate a date field against KPI constraints; returns error string or null
  const validateDateField = (physicalKey: string, newValue: string | null, currentOrder: any): string | null => {
    if (!newValue) return null;
    const newDate = new Date(newValue);
    for (const c of dateConstraints) {
      // This field is an "end" — must be >= start
      if (c.endCol === physicalKey) {
        const startVal = getField(currentOrder, c.startCol);
        if (startVal) {
          const startDate = new Date(String(startVal).slice(0, 10));
          if (newDate < startDate) {
            const startFmt = startDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
            return lang === 'en'
              ? `Must be on or after ${startFmt} (${c.labelAr} start)`
              : `يجب أن يكون بعد أو يساوي ${startFmt} (بداية ${c.labelAr})`;
          }
        }
      }
      // This field is a "start" — all end fields that depend on it must be re-checked
      if (c.startCol === physicalKey) {
        const endVal = getField(currentOrder, c.endCol);
        if (endVal) {
          const endDate = new Date(String(endVal).slice(0, 10));
          if (newDate > endDate) {
            const endFmt = endDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
            return lang === 'en'
              ? `Start date cannot be after ${endFmt} (${c.labelAr} end)`
              : `لا يمكن أن يكون قبل ${endFmt} (نهاية ${c.labelAr})`;
          }
        }
      }
    }
    return null;
  };

  const handleChange = (key: string, value: any) => {
    setOrder((prev: any) => ({ ...prev, [key]: value }));
    setHasChanges(true);
    // Clear any existing error for this key on change
    setDateErrors(prev => { const n = { ...prev }; delete n[key]; return n; });
  };

  const handleDateChange = (writeKey: string, physicalKey: string, value: string | null, currentOrder: any) => {
    const err = validateDateField(physicalKey, value, currentOrder);
    if (err) {
      setDateErrors(prev => ({ ...prev, [writeKey]: err }));
      return; // reject: don't apply the value
    }
    setDateErrors(prev => { const n = { ...prev }; delete n[writeKey]; return n; });
    setOrder((prev: any) => ({ ...prev, [writeKey]: value }));
    setHasChanges(true);
  };

  if (loading) return <div className="p-8 text-center text-slate-500">{lang === 'en' ? 'Loading...' : 'جاري التحميل...'}</div>;

  // ── Shared field renderer (used in both old and new design) ─────────────────
  const renderField = (col: any) => {
    const writable = canWriteField(col.columnKey);
    const roClass  = "w-full px-4 py-2 bg-slate-100 border border-slate-200 rounded-lg text-slate-600 text-sm flex items-center gap-2 min-h-[40px]";
    // Read via physicalKey so renamed columns (e.g. proc_155_date → proc_155_close_date) work
    const rawVal   = getField(order, (col as any).physicalKey || col.columnKey);
    // Write via camelCase of physicalKey so the order state key matches what getField reads back
    const writeKey = toCamel((col as any).physicalKey || col.columnKey);

    const currentInvoiceType = getField(order, 'invoiceType') || getField(order, 'invoice_type');
    if (col.columnKey === 'invoice_2' && currentInvoiceType === 'نهائي') return null;

    const isComputed = (col.columnKey === 'collected_amount' || col.columnKey === 'remaining_amount') && !!currentInvoiceType;
    if (isComputed) {
      const numVal = Number(rawVal);
      const formatted = isNaN(numVal) ? '—' : numVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const isRemaining = col.columnKey === 'remaining_amount';
      const colorCls = isRemaining
        ? (numVal <= 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-amber-50 border-amber-200 text-amber-700')
        : 'bg-indigo-50 border-indigo-200 text-indigo-700';
      return (
        <div key={col.columnKey} className="space-y-1">
          <label className="block text-sm font-medium text-slate-700 flex items-center gap-1">
            {getColLabel(col, lang)}
            <span className="text-[10px] bg-slate-100 text-slate-500 border border-slate-200 rounded px-1.5 py-0.5">{lang === 'en' ? 'Auto' : 'محسوب'}</span>
          </label>
          <div className={`w-full px-4 py-2 border rounded-lg text-sm font-medium flex items-center justify-between ${colorCls}`}>
            <span>{formatted}</span>
            <span className="text-xs opacity-60">{lang === 'en' ? 'SAR' : 'ر.س'}</span>
          </div>
        </div>
      );
    }

    const roValue = () => {
      if (col.columnKey === 'procedure') {
        const st = stagesList.find((s: any) => s.id === order.stageId);
        return (lang === 'en' && st?.nameEn ? st.nameEn : st?.nameAr) || rawVal || '—';
      }
      if (col.columnKey === 'sector_id') {
        const sc = sectorsList.find((s: any) => s.id === (getField(order, 'sectorId') || getField(order, 'sector_id')));
        return (lang === 'en' && sc?.nameEn ? sc.nameEn : sc?.nameAr) || '—';
      }
      if (col.columnKey === 'region_id') {
        const rg = regionsList.find((r: any) => r.id === (getField(order, 'regionId') || getField(order, 'region_id')));
        return (lang === 'en' && rg?.nameEn ? rg.nameEn : rg?.nameAr) || '—';
      }
      if (col.dataType === 'boolean') return rawVal === true ? (lang === 'en' ? 'Yes' : 'نعم') : rawVal === false ? (lang === 'en' ? 'No' : 'لا') : '—';
      if (col.dataType === 'select') {
        const opt = options.find((o: any) => o.columnKey === col.columnKey && o.value === rawVal);
        if (opt) return (lang === 'en' && opt.labelEn) ? opt.labelEn : (opt.labelAr || rawVal || '—');
        return rawVal || '—';
      }
      if ((col.dataType === 'timestamp with time zone' || col.dataType === 'timestamp' || col.dataType === 'date') && rawVal) {
        return new Date(rawVal).toLocaleDateString('en-GB');
      }
      return rawVal ?? '—';
    };

    return (
      <div key={col.columnKey} className="space-y-1">
        <label className="block text-sm font-medium text-slate-700 flex items-center gap-1">
          {getColLabel(col, lang)}
          {!writable && <span className="text-slate-400 text-xs" title="للعرض فقط">🔒</span>}
        </label>
        {!writable ? (
          col.columnKey === 'hold_reason'
            ? <div className="w-full px-4 py-2 bg-slate-100 border border-slate-200 rounded-lg text-slate-600 text-sm min-h-[40px] whitespace-pre-wrap leading-relaxed">{roValue()}</div>
            : <div className={roClass}>{roValue()}</div>
        ) : col.columnKey === 'sector_id' ? (
          <select data-testid="field-sector_id" value={getField(order, 'sectorId') || getField(order, 'sector_id') || ''} onChange={e => handleChange('sectorId', e.target.value || null)} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none">
            <option value="">{lang === 'en' ? '— Select Sector —' : '— اختر القطاع —'}</option>
            {sectorsList.map((s: any) => <option key={s.id} value={s.id}>{lang === 'en' && s.nameEn ? s.nameEn : s.nameAr}</option>)}
          </select>
        ) : col.columnKey === 'region_id' ? (
          <select data-testid="field-region_id" value={getField(order, 'regionId') || getField(order, 'region_id') || ''} onChange={e => handleChange('regionId', e.target.value || null)} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none">
            <option value="">{lang === 'en' ? '— Select Region —' : '— اختر المنطقة —'}</option>
            {regionsList.map((r: any) => <option key={r.id} value={r.id}>{lang === 'en' && r.nameEn ? r.nameEn : r.nameAr}</option>)}
          </select>
        ) : col.columnKey === 'procedure' ? (
          <select data-testid="field-procedure" value={order.stageId || ''} onChange={e => { const stage = stagesList.find((s: any) => s.id === e.target.value); setOrder((prev: any) => ({ ...prev, stageId: stage?.id ?? null, procedure: stage?.nameAr ?? '' })); setHasChanges(true); }} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none">
            <option value="">{lang === 'en' ? '— Select Stage —' : '— اختر الإجراء —'}</option>
            {stagesList.map((s: any) => <option key={s.id} value={s.id}>{lang === 'en' && s.nameEn ? s.nameEn : s.nameAr}</option>)}
          </select>
        ) : col.dataType === 'boolean' ? (
          <select data-testid={`field-${col.columnKey}`} value={rawVal === true ? 'true' : rawVal === false ? 'false' : ''} onChange={e => handleChange(writeKey, e.target.value === 'true' ? true : e.target.value === 'false' ? false : null)} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none">
            <option value="">{lang === 'en' ? '— Select —' : '— اختر —'}</option>
            <option value="true">{lang === 'en' ? 'Yes' : 'نعم'}</option>
            <option value="false">{lang === 'en' ? 'No' : 'لا'}</option>
          </select>
        ) : col.columnKey === 'work_status_classification' ? (
          /* Button-toggle UI for execution status */
          <div className="flex gap-2 flex-wrap">
            {(['EXECUTED', 'ONGOING'] as const).map(val => {
              const label = val === 'EXECUTED' ? (lang === 'en' ? 'Executed' : 'تم التنفيذ') : (lang === 'en' ? 'Ongoing' : 'قائم');
              const isSelected = rawVal === val;
              return (
                <button key={val} type="button" disabled={!writable} data-testid={`btn-work-status-${val.toLowerCase()}`}
                  onClick={() => handleChange(writeKey, isSelected ? null : val)}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${isSelected ? (val === 'EXECUTED' ? 'bg-emerald-100 border-emerald-400 text-emerald-800' : 'bg-blue-100 border-blue-400 text-blue-800') : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'} ${!writable ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                  {label}
                </button>
              );
            })}
            {rawVal && writable && (
              <button type="button" onClick={() => handleChange(writeKey, null)} data-testid="btn-work-status-clear"
                className="px-3 py-2 rounded-xl text-sm text-slate-400 border-2 border-slate-200 bg-white hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-all">
                {lang === 'en' ? 'Clear' : 'مسح'}
              </button>
            )}
          </div>
        ) : col.dataType === 'select' ? (
          <select data-testid={`field-${col.columnKey}`} value={rawVal || ''} onChange={e => handleChange(writeKey, e.target.value || null)} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none">
            <option value="">{lang === 'en' ? '— Select —' : '— اختر —'}</option>
            {options.filter((o: any) => o.columnKey === col.columnKey).map((o: any) => <option key={o.value} value={o.value}>{lang === 'en' && o.labelEn ? o.labelEn : o.labelAr}</option>)}
          </select>
        ) : (col.dataType === 'timestamp with time zone' || col.dataType === 'timestamp' || col.dataType === 'date') ? (
          <div>
            <input
              data-testid={`field-${col.columnKey}`}
              type="date"
              value={rawVal ? String(rawVal).slice(0, 10) : ''}
              min={(() => { const c = dateConstraints.find(dc => dc.endCol === ((col as any).physicalKey || col.columnKey)); return c ? String(getField(order, c.startCol) ?? '').slice(0, 10) || undefined : undefined; })()}
              onChange={e => handleDateChange(writeKey, (col as any).physicalKey || col.columnKey, e.target.value || null, order)}
              className={`w-full px-4 py-2 bg-slate-50 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm ${dateErrors[writeKey] ? 'border-red-400 bg-red-50' : 'border-slate-200'}`}
            />
            {dateErrors[writeKey] && (
              <div className="mt-1 flex items-start gap-1 text-[11px] text-red-600 font-medium">
                <span className="mt-0.5 shrink-0">⚠</span>
                <span>{dateErrors[writeKey]}</span>
              </div>
            )}
          </div>
        ) : col.dataType === 'numeric' || col.dataType === 'integer' ? (
          <input data-testid={`field-${col.columnKey}`} type="number" value={rawVal ?? ''} onChange={e => handleChange(writeKey, e.target.value === '' ? null : Number(e.target.value))} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm" />
        ) : col.dataType === 'text' && col.columnKey === 'hold_reason' ? (
          <textarea data-testid={`field-${col.columnKey}`} rows={3} value={rawVal || ''} onChange={e => handleChange(writeKey, e.target.value)} className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm resize-none" />
        ) : (
          <input data-testid={`field-${col.columnKey}`} type="text" value={rawVal || ''} onChange={e => handleChange(writeKey, e.target.value)} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm" />
        )}
      </div>
    );
  };

  /* ── Financial Section ────────────────────────────────────────────────────── */
  const renderFinancialSection = () => {
    const invType = String(order.invoiceType ?? order.invoice_type ?? '');

    // Read numeric field robustly (handles null, string from DB, or number)
    const rn = (k1: string, k2: string) => parseFloat(String(order[k1] ?? order[k2] ?? '0')) || 0;
    const rs = (k1: string, k2: string) => String(order[k1] ?? order[k2] ?? '');
    const rd = (k1: string, k2: string) => { const v = order[k1] ?? order[k2]; return v ? String(v).slice(0, 10) : ''; };

    const fmtNum = (v: number) => isNaN(v) ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const inp  = 'w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm';
    const inpD = (off: boolean) => inp + (off ? ' opacity-50 cursor-not-allowed' : '');
    const lbl  = 'block text-xs font-semibold text-slate-600 mb-1 flex items-center gap-1';
    const invTypeOptions = ['نهائي', 'جزئي'];
    const canInvType  = canWriteField('invoice_type');
    const canEst      = canWriteField('estimated_value');
    const canActual   = canWriteField('actual_invoice_value');
    const canInvNum   = canWriteField('invoice_number');
    const canInv1     = canWriteField('invoice_1');
    const canBillDate = canWriteField('invoice_billing_date');
    const canInv2Num  = canWriteField('invoice_2_number');
    const canInv2     = canWriteField('invoice_2');
    const canFinClose = canWriteField('financial_close_date');
    const canNotes    = canWriteField('financial_close_notes');

    /* ── الصف العلوي الثابت (يظهر دائماً) ── */
    const topSection = (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={lbl}>
            القيمة التقديرية
            <span className="text-[10px] font-bold bg-slate-100 text-slate-500 rounded px-1">ر.س</span>
          </label>
          <input type="number" value={rs('estimatedValue','estimated_value')} disabled={!canEst}
            onChange={e => handleChange('estimatedValue', e.target.value === '' ? null : Number(e.target.value))}
            className={inpD(!canEst)} />
        </div>
        <div>
          <label className={lbl}>نوع المستخلص</label>
          <select value={invType} disabled={!canInvType}
            onChange={e => handleChange('invoiceType', e.target.value || null)}
            className={inpD(!canInvType)}>
            <option value="">— اختر —</option>
            {invTypeOptions.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        {invType && (
          <div>
            <label className={lbl}>
              القيمة الفعلية للفاتورة
              <span className="text-[10px] font-bold bg-slate-100 text-slate-500 rounded px-1">ر.س</span>
            </label>
            <input type="number" value={rs('actualInvoiceValue','actual_invoice_value')} disabled={!canActual}
              onChange={e => handleChange('actualInvoiceValue', e.target.value === '' ? null : Number(e.target.value))}
              className={inpD(!canActual)} />
          </div>
        )}
      </div>
    );

    /* ── لم يُختر نوع بعد ── */
    if (!invType) {
      return <div className="p-5">{topSection}</div>;
    }

    /* ── حسابات مشتركة ── */
    const inv1      = rn('invoice1', 'invoice_1');
    const inv2      = rn('invoice2', 'invoice_2');
    const actual    = rn('actualInvoiceValue', 'actual_invoice_value');
    const estimated = rn('estimatedValue', 'estimated_value');

    // المعادلة الصحيحة: المتبقي = القيمة الفعلية للفاتورة − قيمة المستخلص (لكلا النوعين)
    const [collected, remaining] = invType === 'جزئي'
      ? [inv1 + inv2,  actual - (inv1 + inv2)]
      : [inv1,         actual - inv1];

    const remCls = remaining <= 0
      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
      : 'bg-amber-50 border-amber-200 text-amber-700';

    const divider = (txt: string) => (
      <div className="col-span-2 flex items-center gap-2 py-1">
        <div className="flex-1 h-px bg-slate-200" />
        <span className="text-[11px] font-bold text-slate-400 tracking-wide">{txt}</span>
        <div className="flex-1 h-px bg-slate-200" />
      </div>
    );

    const moneyRO = (v: number, lbTxt: string, cls: string) => (
      <div>
        <label className={lbl}>
          {lbTxt}
          <span className="text-[10px] bg-slate-100 text-slate-400 border border-slate-200 rounded px-1">محسوب</span>
        </label>
        <div className={`w-full px-4 py-2 border rounded-lg text-sm font-semibold flex items-center justify-between ${cls}`}>
          <span>{fmtNum(v)}</span>
          <span className="text-xs opacity-60">ر.س</span>
        </div>
      </div>
    );

    /* ── جزئي ── */
    if (invType === 'جزئي') {
      return (
        <div className="p-5 space-y-4">
          {topSection}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">

            {divider('مستخلص 1')}

            <div>
              <label className={lbl}>
                <span className="text-[10px] font-bold bg-indigo-100 text-indigo-600 rounded px-1">#</span>
                رقم المستخلص 1
              </label>
              <input type="text" value={rs('invoiceNumber','invoice_number')} disabled={!canInvNum}
                onChange={e => handleChange('invoiceNumber', e.target.value)}
                className={inpD(!canInvNum)} />
            </div>
            <div>
              <label className={lbl}>
                <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 rounded px-1">ر.س</span>
                قيمة مستخلص 1
              </label>
              <input type="number" value={rs('invoice1','invoice_1')} disabled={!canInv1}
                onChange={e => handleChange('invoice1', e.target.value === '' ? null : Number(e.target.value))}
                className={inpD(!canInv1)} />
            </div>
            <div>
              <label className={lbl}>تاريخ الفوترة</label>
              <input type="date" value={rd('invoiceBillingDate','invoice_billing_date')} disabled={!canBillDate}
                onChange={e => handleChange('invoiceBillingDate', e.target.value || null)}
                className={inpD(!canBillDate)} />
            </div>
            <div />

            {divider('مستخلص 2')}

            <div>
              <label className={lbl}>
                <span className="text-[10px] font-bold bg-indigo-100 text-indigo-600 rounded px-1">#</span>
                رقم المستخلص 2
              </label>
              <input type="text" value={rs('invoice2Number','invoice_2_number')} disabled={!canInv2Num}
                onChange={e => handleChange('invoice2Number', e.target.value)}
                className={inpD(!canInv2Num)} />
            </div>
            <div>
              <label className={lbl}>
                <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 rounded px-1">ر.س</span>
                قيمة مستخلص 2
              </label>
              <input type="number" value={rs('invoice2','invoice_2')} disabled={!canInv2}
                onChange={e => handleChange('invoice2', e.target.value === '' ? null : Number(e.target.value))}
                className={inpD(!canInv2)} />
            </div>
            <div>
              <label className={lbl}>تاريخ الفوترة 2</label>
              <input type="date" value={rd('financialCloseDate','financial_close_date')} disabled={!canFinClose}
                onChange={e => handleChange('financialCloseDate', e.target.value || null)}
                className={inpD(!canFinClose)} />
            </div>
            <div />

            {divider('الإجماليات')}

            {moneyRO(collected, 'القيمة المحصلة', 'bg-indigo-50 border-indigo-200 text-indigo-700')}
            {moneyRO(remaining, 'المتبقي', remCls)}

            <div className="col-span-2">
              <label className={lbl}>ملاحظات الإجراء المالي</label>
              <input type="text" value={rs('financialNotes','financial_close_notes')} disabled={!canNotes}
                onChange={e => handleChange('financialNotes', e.target.value)}
                className={inpD(!canNotes)} />
            </div>
          </div>
        </div>
      );
    }

    /* ── نهائي ── */
    return (
      <div className="p-5 space-y-4">
        {topSection}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
          <div>
            <label className={lbl}>
              <span className="text-[10px] font-bold bg-indigo-100 text-indigo-600 rounded px-1">#</span>
              رقم المستخلص
            </label>
            <input type="text" value={rs('invoiceNumber','invoice_number')} disabled={!canInvNum}
              onChange={e => handleChange('invoiceNumber', e.target.value)}
              className={inpD(!canInvNum)} />
          </div>
          <div>
            <label className={lbl}>
              <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 rounded px-1">ر.س</span>
              قيمة المستخلص
            </label>
            <input type="number" value={rs('invoice1','invoice_1')} disabled={!canInv1}
              onChange={e => handleChange('invoice1', e.target.value === '' ? null : Number(e.target.value))}
              className={inpD(!canInv1)} />
          </div>
          <div>
            <label className={lbl}>تاريخ الفوترة</label>
            <input type="date" value={rd('invoiceBillingDate','invoice_billing_date')} disabled={!canBillDate}
              onChange={e => handleChange('invoiceBillingDate', e.target.value || null)}
              className={inpD(!canBillDate)} />
          </div>
          <div />

          {moneyRO(collected, 'القيمة المحصلة', 'bg-indigo-50 border-indigo-200 text-indigo-700')}
          {moneyRO(remaining, 'المتبقي', remCls)}

          <div>
            <label className={lbl}>تاريخ الإغلاق المالي</label>
            <input type="date" value={rd('financialCloseDate','financial_close_date')} disabled={!canFinClose}
              onChange={e => handleChange('financialCloseDate', e.target.value || null)}
              className={inpD(!canFinClose)} />
          </div>
          <div>
            <label className={lbl}>ملاحظات الإجراء المالي</label>
            <input type="text" value={rs('financialNotes','financial_close_notes')} disabled={!canNotes}
              onChange={e => handleChange('financialNotes', e.target.value)}
              className={inpD(!canNotes)} />
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="h-screen bg-slate-50 flex flex-col overflow-hidden" dir={lang === 'en' ? 'ltr' : 'rtl'}>

      {/* ── Sticky Header ── */}
      <header className="sticky top-0 z-20 bg-white border-b border-slate-200 px-4 md:px-6 py-3 flex items-center justify-between shadow-sm gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => safeNavigate('/work-orders')} className="p-2 hover:bg-slate-100 rounded-full transition-colors flex-shrink-0">
            <ArrowRight className="w-5 h-5 text-slate-600" />
          </button>
          <div className="min-w-0">
            <h1 className="text-base md:text-lg font-bold text-slate-900 truncate">{lang === 'en' ? 'Edit Work Order' : 'تعديل أمر عمل'}</h1>
            <p className="text-xs text-slate-500 truncate">{lang === 'en' ? 'No.' : 'رقم:'} <span className="font-mono font-semibold text-indigo-600">{order.orderNumber || order.order_number || id}</span></p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {hasChanges && (
            <span className="text-amber-600 text-xs hidden sm:flex items-center gap-1 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">
              <AlertCircle className="w-3.5 h-3.5" /> {lang === 'en' ? 'Unsaved' : 'غير محفوظ'}
            </span>
          )}
          <button
            data-testid="button-save"
            onClick={handleSave}
            disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-semibold flex items-center gap-2 transition-colors disabled:opacity-50 text-sm shadow-sm"
          >
            <Save className="w-4 h-4" />
            <span className="hidden sm:inline">{saving ? (lang === 'en' ? 'Saving...' : 'جاري الحفظ...') : (lang === 'en' ? 'Save' : 'حفظ التغييرات')}</span>
          </button>
        </div>
      </header>

      {/* ── Two-Column Body ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── RIGHT: Scrollable Form ── */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
          {groups.map(group => {
            const DELAY_COLS = new Set(['exec_delay_justified','exec_delay_reason','fin_delay_justified','fin_delay_reason']);
            const groupCols   = catalog.filter((c: any) => {
              if (DELAY_COLS.has(c.columnKey)) return false;
              return c.groupKey === group.key;
            }).sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
            const visibleCols = groupCols.filter((c: any) => {
              if (userScope.role === 'ADMIN') return true;
              const p = effectivePerms[c.columnKey];
              return p?.canRead === true;
            });
            if (visibleCols.length === 0) return null;
            const isOpen = openSections[group.key] !== false;
            const SECTION_ICONS: Record<string, ReactNode> = {
              BASE:          <LayoutGrid    size={15} className="text-indigo-500"/>,
              OPS:           <Wrench        size={15} className="text-orange-500"/>,
              COORD:         <MapPin        size={15} className="text-sky-500"/>,
              PROCEDURE_155: <ClipboardCheck size={15} className="text-violet-500"/>,
              FINANCE:       <TrendingUp    size={15} className="text-emerald-500"/>,
            };
            return (
              <Fragment key={group.key}>
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  {/* Section header — clickable to collapse */}
                  <button
                    type="button"
                    onClick={() => toggleSection(group.key)}
                    className="w-full flex items-center justify-between px-5 py-3.5 bg-slate-50 border-b border-slate-200 hover:bg-slate-100 transition-colors"
                  >
                    <span className="flex items-center gap-2 font-bold text-slate-800 text-sm">
                      {SECTION_ICONS[group.key] ?? <Settings2 size={15} className="text-slate-400"/>}
                      {lang === 'en' && group.nameEn ? group.nameEn : group.nameAr}
                      <span className="text-xs font-normal text-slate-400">({visibleCols.length} {lang === 'en' ? 'fields' : 'حقل'})</span>
                    </span>
                    {isOpen ? <ChevronUp size={16} className="text-slate-400"/> : <ChevronDown size={16} className="text-slate-400"/>}
                  </button>

                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        key="content"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18 }}
                        className="overflow-hidden"
                      >
                        {group.key === 'FINANCE'
                          ? renderFinancialSection()
                          : (
                            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                              {visibleCols.map((col: any) => renderField(col))}
                            </div>
                          )
                        }
                        {/* Excavation permits inside the coordination section */}
                        {group.key === 'COORD' && (userScope.canViewExcavationPermits ?? (userScope.role === 'ADMIN')) && (
                          <div className="border-t border-slate-100 px-5 pb-5 pt-4">
                            <ExcavationPermitsTable
                              workOrderId={id!}
                              canEdit={userScope.canEditExcavationPermits ?? (userScope.role === 'ADMIN')}
                              canDelete={userScope.canDeleteExcavationPermits ?? (userScope.role === 'ADMIN')}
                            />
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </Fragment>
            );
          })}


          {/* ── Delay Classification ── */}
          {(() => {
            const canReadExecJ  = userScope.role === 'ADMIN' || effectivePerms['exec_delay_justified']?.canRead;
            const canReadFinJ   = userScope.role === 'ADMIN' || effectivePerms['fin_delay_justified']?.canRead;
            if (!canReadExecJ && !canReadFinJ) return null;

            const canWriteExecJ = canWriteField('exec_delay_justified');
            const canWriteExecR = canWriteField('exec_delay_reason');
            const canWriteFinJ  = canWriteField('fin_delay_justified');
            const canWriteFinR  = canWriteField('fin_delay_reason');

            const execJustified = order.execDelayJustified ?? order.exec_delay_justified ?? false;
            const execReason    = order.execDelayReason    ?? order.exec_delay_reason    ?? '';
            const finJustified  = order.finDelayJustified  ?? order.fin_delay_justified  ?? false;
            const finReason     = order.finDelayReason     ?? order.fin_delay_reason     ?? '';

            const toggleClass = (active: boolean) =>
              `flex-1 py-2 text-sm font-semibold rounded-lg border-2 transition-all ${active ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'}`;

            const isDelayOpen = openSections['delay'] !== false;

            return (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden" data-testid="section-delay-classification">
                <button type="button" onClick={() => toggleSection('delay')} className="w-full flex items-center justify-between px-5 py-3.5 bg-amber-50 border-b border-amber-100 hover:bg-amber-100 transition-colors">
                  <span className="flex items-center gap-2 font-bold text-amber-800 text-sm">
                    <AlertCircle size={15} className="text-amber-600"/>
                    {lang === 'en' ? 'Delay Classification' : 'تصنيف التأخير'}
                  </span>
                  {isDelayOpen ? <ChevronUp size={16} className="text-amber-400"/> : <ChevronDown size={16} className="text-amber-400"/>}
                </button>
                <AnimatePresence initial={false}>
                  {isDelayOpen && (
                    <motion.div key="delay" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
                      <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
                        {canReadExecJ && (
                          <div className="space-y-3">
                            <h3 className="font-semibold text-slate-700 text-sm border-b border-slate-100 pb-1">{lang === 'en' ? 'Execution Delay' : 'التأخير التنفيذي'}</h3>
                            <div className="space-y-1">
                              <label className="block text-xs font-medium text-slate-600">{lang === 'en' ? 'Is execution delay justified?' : 'هل التأخير التنفيذي مسبب؟'}{!canWriteExecJ && <span className="text-slate-400 mr-1" title="للعرض فقط">🔒</span>}</label>
                              {canWriteExecJ ? (
                                <div className="flex gap-2" data-testid="toggle-exec-delay-justified">
                                  <button type="button" data-testid="btn-exec-justified-yes" onClick={() => { handleChange('execDelayJustified', true); setDelayErr(''); }} className={toggleClass(execJustified === true)}>{lang === 'en' ? 'Yes' : 'نعم'}</button>
                                  <button type="button" data-testid="btn-exec-justified-no" onClick={() => { handleChange('execDelayJustified', false); handleChange('execDelayReason', null); setDelayErr(''); }} className={toggleClass(execJustified === false || execJustified == null)}>{lang === 'en' ? 'No' : 'لا'}</button>
                                </div>
                              ) : (
                                <div className="px-4 py-2 bg-slate-100 border border-slate-200 rounded-lg text-slate-600 text-sm">{execJustified === true ? (lang === 'en' ? 'Yes' : 'نعم') : execJustified === false ? (lang === 'en' ? 'No' : 'لا') : '—'}</div>
                              )}
                            </div>
                            {execJustified === true && (
                              <div className="space-y-1" data-testid="field-exec-delay-reason-wrapper">
                                <label className="block text-xs font-medium text-slate-600">{lang === 'en' ? 'Execution delay reason' : 'سبب التأخير التنفيذي'}{canWriteExecR && <span className="text-red-500 mr-1">*</span>}{!canWriteExecR && <span className="text-slate-400 mr-1" title="للعرض فقط">🔒</span>}</label>
                                {canWriteExecR ? (
                                  <textarea data-testid="input-exec-delay-reason" rows={3} value={execReason} onChange={e => { handleChange('execDelayReason', e.target.value); setDelayErr(''); }} placeholder={lang === 'en' ? 'Describe the reason…' : 'اكتب سبب التأخير التنفيذي…'} className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm resize-none"/>
                                ) : (
                                  <div className="px-4 py-2 bg-slate-100 border border-slate-200 rounded-lg text-slate-600 text-sm min-h-[72px] whitespace-pre-wrap leading-relaxed">{execReason || '—'}</div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                        {canReadFinJ && (
                          <div className="space-y-3">
                            <h3 className="font-semibold text-slate-700 text-sm border-b border-slate-100 pb-1">{lang === 'en' ? 'Financial Delay' : 'التأخير المالي'}</h3>
                            <div className="space-y-1">
                              <label className="block text-xs font-medium text-slate-600">{lang === 'en' ? 'Is financial delay justified?' : 'هل التأخير المالي مسبب؟'}{!canWriteFinJ && <span className="text-slate-400 mr-1" title="للعرض فقط">🔒</span>}</label>
                              {canWriteFinJ ? (
                                <div className="flex gap-2" data-testid="toggle-fin-delay-justified">
                                  <button type="button" data-testid="btn-fin-justified-yes" onClick={() => { handleChange('finDelayJustified', true); setDelayErr(''); }} className={toggleClass(finJustified === true)}>{lang === 'en' ? 'Yes' : 'نعم'}</button>
                                  <button type="button" data-testid="btn-fin-justified-no" onClick={() => { handleChange('finDelayJustified', false); handleChange('finDelayReason', null); setDelayErr(''); }} className={toggleClass(finJustified === false || finJustified == null)}>{lang === 'en' ? 'No' : 'لا'}</button>
                                </div>
                              ) : (
                                <div className="px-4 py-2 bg-slate-100 border border-slate-200 rounded-lg text-slate-600 text-sm">{finJustified === true ? (lang === 'en' ? 'Yes' : 'نعم') : finJustified === false ? (lang === 'en' ? 'No' : 'لا') : '—'}</div>
                              )}
                            </div>
                            {finJustified === true && (
                              <div className="space-y-1">
                                <label className="block text-xs font-medium text-slate-600">{lang === 'en' ? 'Financial delay reason' : 'سبب التأخير المالي'}{canWriteFinR && <span className="text-red-500 mr-1">*</span>}{!canWriteFinR && <span className="text-slate-400 mr-1" title="للعرض فقط">🔒</span>}</label>
                                {canWriteFinR ? (
                                  <textarea data-testid="input-fin-delay-reason" rows={3} value={finReason} onChange={e => { handleChange('finDelayReason', e.target.value); setDelayErr(''); }} placeholder={lang === 'en' ? 'Describe the reason…' : 'اكتب سبب التأخير المالي…'} className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm resize-none"/>
                                ) : (
                                  <div className="px-4 py-2 bg-slate-100 border border-slate-200 rounded-lg text-slate-600 text-sm min-h-[72px] whitespace-pre-wrap leading-relaxed">{finReason || '—'}</div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      {delayErr && (
                        <div data-testid="error-delay-validation" className="mx-5 mb-4 flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                          <AlertCircle className="w-4 h-4 flex-shrink-0"/>{delayErr}
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })()}

          {/* ── Attachments (collapsible section) ── */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <button type="button" onClick={() => toggleSection('attachments')} className="w-full flex items-center justify-between px-5 py-3.5 bg-slate-50 border-b border-slate-200 hover:bg-slate-100 transition-colors">
              <span className="flex items-center gap-2 font-bold text-slate-800 text-sm">
                <Paperclip size={15} className="text-slate-400"/>
                {lang === 'en' ? 'Attachments' : 'المرفقات'}
              </span>
              {openSections['attachments'] ? <ChevronUp size={16} className="text-slate-400"/> : <ChevronDown size={16} className="text-slate-400"/>}
            </button>
            <AnimatePresence initial={false}>
              {openSections['attachments'] && (
                <motion.div key="att" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
                  <div className="p-5">
                    <AttachmentsPanel workOrderId={id!} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

        </main>

        {/* ── LEFT: Fixed Sidebar ── */}
        <aside className={`shrink-0 bg-white border-r border-slate-200 flex flex-col overflow-hidden transition-all duration-200 ${sidebarCollapsed ? 'w-10' : 'w-80'}`}>

          {sidebarCollapsed ? (
            /* ── Collapsed: icon strip ── */
            <div className="flex flex-col items-center pt-2 gap-1">
              {/* Expand button */}
              <button
                onClick={toggleSidebar}
                title={lang === 'en' ? 'Expand panel' : 'توسيع اللوحة'}
                data-testid="sidebar-expand-btn"
                className="w-8 h-8 flex items-center justify-center rounded-md text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
              >
                <span className="text-base">‹</span>
              </button>
              {/* Tab icons */}
              {([
                { key: 'kpis',    icon: <TrendingUp size={14}/>,    title: 'المؤشرات' },
                { key: 'history', icon: <History size={14}/>,       title: 'السجل' },
                { key: 'notes',   icon: <MessageSquare size={14}/>, title: 'الملاحظات' },
              ] as const).map(t => (
                <button
                  key={t.key}
                  title={t.title}
                  onClick={() => { setSidebarTab(t.key); toggleSidebar(); }}
                  className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors ${
                    sidebarTab === t.key ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400 hover:bg-slate-100'
                  }`}
                >
                  {t.icon}
                </button>
              ))}
            </div>
          ) : (
            <>
              {/* ── Expanded: full header ── */}
              <div className="flex items-center border-b border-slate-100 bg-slate-50/80">
                {/* Tab switcher */}
                <div className="flex flex-1">
                  {([
                    { key: 'kpis',    icon: <TrendingUp size={13}/>,     label: 'المؤشرات',  labelEn: 'KPIs' },
                    { key: 'history', icon: <History size={13}/>,        label: 'السجل',     labelEn: 'History' },
                    { key: 'notes',   icon: <MessageSquare size={13}/>,  label: 'الملاحظات', labelEn: 'Notes' },
                  ] as const).map(t => (
                    <button
                      key={t.key}
                      data-testid={`sidebar-tab-${t.key}`}
                      onClick={() => setSidebarTab(t.key)}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-semibold transition-colors border-b-2 ${
                        sidebarTab === t.key ? 'text-indigo-600 border-indigo-500 bg-white' : 'text-slate-500 border-transparent hover:bg-slate-100'
                      }`}
                    >
                      {t.icon}
                      {lang === 'en' ? t.labelEn : t.label}
                    </button>
                  ))}
                </div>
                {/* Collapse button */}
                <button
                  onClick={toggleSidebar}
                  title={lang === 'en' ? 'Collapse panel' : 'طي اللوحة'}
                  data-testid="sidebar-collapse-btn"
                  className="px-2 py-3 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors border-b-2 border-transparent text-base"
                >
                  ›
                </button>
              </div>

              {/* Sidebar body */}
              <div className="flex-1 overflow-y-auto">
                {sidebarTab === 'kpis' && (
                  <div className="p-4">
                    <WorkOrderTimer order={order} workOrderId={id!} />
                    <StageProgressBar order={order} stagesList={stagesList} />
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                        {lang === 'en' ? 'Performance Indicators' : 'مؤشرات الأداء'}
                      </span>
                      {userScope.role === 'ADMIN' && (
                        <a href="/admin/kpis" onClick={e => { e.preventDefault(); navigate('/admin/kpis'); }}
                          className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium">
                          <Settings2 size={12}/> {lang === 'en' ? 'Settings' : 'الإعدادات'}
                        </a>
                      )}
                    </div>
                    <KpiList workOrderId={id!} />
                  </div>
                )}
                {sidebarTab === 'history' && <HistoryPanel workOrderId={id!} catalog={catalog} options={options} />}
                {sidebarTab === 'notes'   && <NotesPanel workOrderId={id!} currentUserId={JSON.parse(localStorage.getItem('user') || '{}').id} />}
              </div>
            </>
          )}
        </aside>

      </div>{/* end two-column body */}

      {/* ── Leave Confirmation Modal ── */}
      <AnimatePresence>
        {showLeaveConfirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowLeaveConfirm(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.92, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.92, y: 16 }} onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-sm mx-4 overflow-hidden" dir={lang === 'en' ? 'ltr' : 'rtl'}>
              <div className="bg-amber-50 border-b border-amber-100 px-6 py-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0"><AlertCircle className="w-5 h-5 text-amber-600"/></div>
                <div>
                  <h3 className="font-bold text-slate-800 text-base">{lang === 'en' ? 'Unsaved Changes' : 'تغييرات غير محفوظة'}</h3>
                  <p className="text-xs text-slate-500 mt-0.5">{lang === 'en' ? 'You have unsaved edits' : 'لديك تعديلات لم يتم حفظها بعد'}</p>
                </div>
              </div>
              <div className="px-6 py-5">
                <p className="text-sm text-slate-600 leading-relaxed">{lang === 'en' ? 'If you leave now, your changes will be lost. Save before leaving?' : 'إذا غادرت الصفحة الآن ستُفقد التعديلات. هل تريد حفظها قبل المغادرة؟'}</p>
              </div>
              <div className="px-6 pb-5 flex flex-col gap-2">
                <button data-testid="button-save-and-leave" onClick={saveAndLeave} disabled={saving} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium text-sm transition-colors disabled:opacity-50"><Save className="w-4 h-4"/>{lang === 'en' ? 'Save & Leave' : 'حفظ والمغادرة'}</button>
                <button data-testid="button-leave-without-save" onClick={confirmLeave} className="w-full px-4 py-2.5 border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 rounded-xl font-medium text-sm transition-colors">{lang === 'en' ? 'Leave Without Saving' : 'مغادرة بدون حفظ'}</button>
                <button data-testid="button-cancel-leave" onClick={() => setShowLeaveConfirm(false)} className="w-full px-4 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl font-medium text-sm transition-colors">{lang === 'en' ? 'Cancel' : 'إلغاء والرجوع للتعديل'}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
