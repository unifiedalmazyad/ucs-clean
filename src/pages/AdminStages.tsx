import { useEffect, useRef, useState } from 'react';
import api from '../services/api';
import { useLang } from '../contexts/LangContext';
import {
  GripVertical, ListOrdered, Plus, Save, Trash2, X,
  Zap, Lock, Calculator, Info, Ban, Link2, ArrowRight
} from 'lucide-react';

interface Stage {
  id: string;
  nameAr: string;
  nameEn: string | null;
  category: 'EXEC' | 'FIN';
  seq: number;
  isTerminal: boolean;
  isCancelled: boolean;
  active: boolean;
  startColumnKey: string | null;
  endColumnKey: string | null;
}

interface DateCol { columnKey: string; labelAr: string; labelEn?: string; }

const EMPTY_FORM = {
  nameAr: '', nameEn: '', category: 'EXEC' as 'EXEC' | 'FIN',
  isTerminal: false, isCancelled: false, active: true,
};

type StageMode = 'none' | 'lock' | 'auto' | 'info';

const MODES: { key: StageMode; icon: any; label: string; labelEn: string; desc: string; descEn: string; activeColor: string; dot: string }[] = [
  {
    key: 'none', icon: Ban,
    label: 'إيقاف (وضع افتراضي)',
    labelEn: 'Off (default)',
    desc: 'الإجراء يُحدَّد يدوياً بالكامل دون أي قيود',
    descEn: 'Stage is determined fully manually without any restrictions',
    activeColor: 'border-slate-500 bg-slate-50 text-slate-800',
    dot: 'bg-slate-500',
  },
  {
    key: 'lock', icon: Lock,
    label: 'قفل الإجراء',
    labelEn: 'Lock Stage',
    desc: 'بعد تحديد الإجراء يصبح مقفلاً ولا يمكن تغييره يدوياً',
    descEn: 'Once set, the stage becomes locked and cannot be changed manually',
    activeColor: 'border-red-400 bg-red-50 text-red-700',
    dot: 'bg-red-400',
  },
  {
    key: 'auto', icon: Calculator,
    label: 'حساب تلقائي',
    labelEn: 'Auto Calculate',
    desc: 'يُحدَّد الإجراء تلقائياً عند الحفظ بناءً على التواريخ المُدخلة',
    descEn: 'Stage is automatically determined upon saving based on entered dates',
    activeColor: 'border-amber-400 bg-amber-50 text-amber-700',
    dot: 'bg-amber-400',
  },
  {
    key: 'info', icon: Info,
    label: 'عرض توضيحي فقط',
    labelEn: 'Display Only',
    desc: 'يظهر مؤشر "ديناميكي" بجانب الإجراء دون قيود على التعديل',
    descEn: 'A "dynamic" indicator appears next to the stage without editing restrictions',
    activeColor: 'border-indigo-400 bg-indigo-50 text-indigo-700',
    dot: 'bg-indigo-400',
  },
];

export default function AdminStages() {
  const { lang } = useLang();
  const [stages, setStages]         = useState<Stage[]>([]);
  const [dateCols, setDateCols]     = useState<DateCol[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showModal, setShowModal]   = useState(false);
  const [form, setForm]             = useState({ ...EMPTY_FORM });
  const [saving, setSaving]         = useState(false);
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [editingName, setEditingName] = useState({ nameAr: '', nameEn: '' });
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const [stageMode, setStageMode]   = useState<StageMode>('none');
  const [modeSaving, setModeSaving] = useState(false);
  const [modeLoading, setModeLoading] = useState(true);

  // per-stage col draft for inline editing
  const [colSaving, setColSaving]   = useState<string | null>(null);

  const dragItem = useRef<number | null>(null);
  const dragOver = useRef<number | null>(null);

  /* ─── fetch ─────────────────────────────────────────────────────────────── */
  const fetchStages = async () => {
    try {
      const res = await api.get('/admin/stages');
      setStages(res.data.sort((a: Stage, b: Stage) => a.seq - b.seq));
    } catch { /* noop */ }
    finally { setLoading(false); }
  };

  const fetchDateCols = async () => {
    try {
      const res = await api.get('/work-orders/table-columns');
      const cols = (res.data.columns ?? res.data) as any[];
      setDateCols(
        cols
          .filter((c: any) => ['date','timestamp','timestamp with time zone'].includes(c.dataType))
          .filter((c: any) => c.labelAr && !c.labelAr.startsWith('-'))
          .map((c: any) => ({ columnKey: c.physicalKey || c.columnKey, labelAr: c.labelAr, labelEn: c.labelEn }))
      );
    } catch { /* noop */ }
  };

  const fetchMode = async () => {
    try {
      const res = await api.get('/admin/system-settings');
      setStageMode((res.data.stage_determination_mode as StageMode) || 'none');
    } catch { /* noop */ }
    finally { setModeLoading(false); }
  };

  useEffect(() => { fetchStages(); fetchDateCols(); fetchMode(); }, []);

  /* ─── derived ────────────────────────────────────────────────────────────── */
  // map columnKey → stage id (which stage owns it)
  const usedColMap = stages.reduce<Record<string, string>>((acc, s) => {
    if (s.startColumnKey) acc[s.startColumnKey] = s.id;
    if (s.endColumnKey)   acc[s.endColumnKey]   = s.id;
    return acc;
  }, {});

  const showColConfig = stageMode !== 'none';

  /* ─── actions ────────────────────────────────────────────────────────────── */
  const update = async (id: string, data: Partial<Stage>) => {
    try { await api.put(`/admin/stages/${id}`, data); fetchStages(); }
    catch { alert(lang === 'en' ? 'Update failed' : 'فشل التحديث'); }
  };

  const updateCol = async (id: string, field: 'startColumnKey' | 'endColumnKey', val: string) => {
    setColSaving(id + field);
    try { await api.put(`/admin/stages/${id}`, { [field]: val || null }); fetchStages(); }
    catch { alert(lang === 'en' ? 'Save failed' : 'فشل الحفظ'); }
    finally { setColSaving(null); }
  };

  const saveMode = async (mode: StageMode) => {
    setStageMode(mode);
    setModeSaving(true);
    try { await api.put('/admin/system-settings/stage_determination_mode', { value: mode }); }
    catch { alert(lang === 'en' ? 'Failed to save setting' : 'فشل حفظ الإعداد'); }
    finally { setModeSaving(false); }
  };

  const handleAdd = async () => {
    if (!form.nameAr.trim()) { alert(lang === 'en' ? 'Arabic name is required' : 'الاسم العربي مطلوب'); return; }
    setSaving(true);
    try {
      const maxSeq = stages.length > 0 ? Math.max(...stages.map(s => s.seq)) : 0;
      await api.post('/admin/stages', {
        nameAr: form.nameAr.trim(), nameEn: form.nameEn.trim() || null,
        category: form.category, seq: maxSeq + 1,
        isTerminal: form.isTerminal, isCancelled: form.isCancelled, active: form.active,
      });
      setShowModal(false); setForm({ ...EMPTY_FORM }); fetchStages();
    } catch { alert(lang === 'en' ? 'Add failed' : 'فشل الإضافة'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    try { await api.delete(`/admin/stages/${id}`); setDeleteConfirmId(null); fetchStages(); }
    catch (err: any) { alert(err?.response?.data?.error || (lang === 'en' ? 'Delete failed' : 'فشل الحذف')); setDeleteConfirmId(null); }
  };

  const saveEditName = async (id: string) => {
    if (!editingName.nameAr.trim()) return;
    await update(id, { nameAr: editingName.nameAr.trim(), nameEn: editingName.nameEn.trim() || null });
    setEditingId(null);
  };

  /* ─── drag ───────────────────────────────────────────────────────────────── */
  const handleDragStart = (i: number) => { dragItem.current = i; };
  const handleDragEnter = (i: number) => {
    if (dragItem.current === null || dragItem.current === i) return;
    const r = [...stages];
    const d = r.splice(dragItem.current, 1)[0];
    r.splice(i, 0, d);
    dragItem.current = i;
    setStages(r);
  };
  const handleDragEnd = async () => {
    const order = stages.map((s, i) => ({ id: s.id, seq: i + 1 }));
    try { await api.patch('/admin/stages/reorder', { order }); fetchStages(); }
    catch { alert(lang === 'en' ? 'Failed to save order' : 'فشل حفظ الترتيب'); }
    dragItem.current = null; dragOver.current = null;
  };

  /* ─── column selector ────────────────────────────────────────────────────── */
  const ColSel = ({
    stageId, value, field, placeholder,
  }: { stageId: string; value: string; field: 'startColumnKey' | 'endColumnKey'; placeholder: string }) => {
    const otherUsed = Object.entries(usedColMap)
      .filter(([, sid]) => sid !== stageId)
      .map(([col]) => col);
    const isSaving = colSaving === stageId + field;

    return (
      <div className="relative">
        <select
          value={value}
          onChange={e => updateCol(stageId, field, e.target.value)}
          disabled={isSaving}
          className={`w-full pl-3 pr-7 py-1.5 border rounded-lg text-xs focus:ring-2 focus:ring-indigo-400 outline-none appearance-none bg-white transition-colors ${
            value ? 'border-indigo-300 text-indigo-700 bg-indigo-50/40' : 'border-slate-200 text-slate-500'
          } ${isSaving ? 'opacity-60' : ''}`}
        >
          <option value="">{placeholder}</option>
          {dateCols
            .filter(c => !otherUsed.includes(c.columnKey) || c.columnKey === value)
            .map(c => <option key={c.columnKey} value={c.columnKey}>{lang === 'en' ? (c as any).labelEn || c.labelAr : c.labelAr}</option>)}
        </select>
        {isSaving && (
          <span className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
        )}
        {!isSaving && value && (
          <span className="absolute left-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-indigo-400" />
        )}
      </div>
    );
  };

  const execStages = stages.filter(s => s.category === 'EXEC');
  const finStages  = stages.filter(s => s.category === 'FIN');
  const linkedCount = Object.keys(usedColMap).length;
  const activeMode  = MODES.find(m => m.key === stageMode);

  /* ─── Stage Row ──────────────────────────────────────────────────────────── */
  const StageRow = ({ stage, globalIndex }: { stage: Stage; globalIndex: number; key?: string }) => {
    const isEditing       = editingId === stage.id;
    const isDeleteConfirm = deleteConfirmId === stage.id;
    const hasStart = !!stage.startColumnKey;
    const hasEnd   = !!stage.endColumnKey;
    const { lang } = useLang();

    return (
      <div
        draggable={!isEditing}
        onDragStart={() => handleDragStart(globalIndex)}
        onDragEnter={() => handleDragEnter(globalIndex)}
        onDragEnd={handleDragEnd}
        onDragOver={e => e.preventDefault()}
        data-testid={`row-stage-${stage.id}`}
        className="group border-b border-slate-100 hover:bg-slate-50/60 transition-colors"
      >
        <div className="flex items-center gap-3 px-4 py-3">
          {/* Drag */}
          <div className="text-slate-300 group-hover:text-slate-400 cursor-grab active:cursor-grabbing flex-shrink-0">
            <GripVertical className="w-4 h-4" />
          </div>

          {/* Name */}
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <div className="space-y-1.5">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold text-slate-400">{lang === 'en' ? 'Arabic Name' : 'الاسم بالعربي'}</label>
                  <input autoFocus value={editingName.nameAr}
                    onChange={e => setEditingName(p => ({ ...p, nameAr: e.target.value }))}
                    className="w-full px-2.5 py-1.5 border border-indigo-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-300"
                    data-testid={`input-edit-name-ar-${stage.id}`} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold text-slate-400">{lang === 'en' ? 'English Name' : 'الاسم بالإنجليزي'}</label>
                  <input value={editingName.nameEn}
                    onChange={e => setEditingName(p => ({ ...p, nameEn: e.target.value }))}
                    placeholder={lang === 'en' ? 'English name (optional)' : 'الاسم بالإنجليزي (اختياري)'} dir="ltr"
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm outline-none text-left" />
                </div>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => saveEditName(stage.id)}
                    className="px-3 py-1 bg-indigo-600 text-white text-xs rounded-lg hover:bg-indigo-700 flex items-center gap-1"
                    data-testid={`button-save-name-${stage.id}`}><Save size={10} /> {lang === 'en' ? 'Save' : 'حفظ'}</button>
                  <button onClick={() => setEditingId(null)}
                    className="px-3 py-1 bg-slate-100 text-slate-600 text-xs rounded-lg hover:bg-slate-200">{lang === 'en' ? 'Cancel' : 'إلغاء'}</button>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className="font-semibold text-slate-800 cursor-pointer hover:text-indigo-600 transition-colors text-sm"
                    onClick={() => { setEditingId(stage.id); setEditingName({ nameAr: stage.nameAr, nameEn: stage.nameEn || '' }); }}
                    title={lang === 'en' ? 'Click to edit' : 'انقر للتعديل'}
                  >
                    {lang === 'en' ? (stage.nameEn || stage.nameAr) : stage.nameAr}
                  </span>
                  {stage.nameEn && lang !== 'en' && <span className="text-xs text-slate-400" dir="ltr">({stage.nameEn})</span>}
                  {stage.nameAr && lang === 'en' && stage.nameEn && <span className="text-xs text-slate-400" dir="rtl">({stage.nameAr})</span>}
                  {/* column badges — visible when config active */}
                  {showColConfig && (hasStart || hasEnd) && (
                    <span className="flex items-center gap-1 text-[10px]">
                      {hasStart && (
                        <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded-full font-medium">
                          ▶ {lang === 'en' ? (dateCols.find(c => c.columnKey === stage.startColumnKey)?.labelEn || dateCols.find(c => c.columnKey === stage.startColumnKey)?.labelAr) : dateCols.find(c => c.columnKey === stage.startColumnKey)?.labelAr}
                        </span>
                      )}
                      {hasStart && hasEnd && <ArrowRight size={9} className="text-slate-400" />}
                      {hasEnd && (
                        <span className="px-1.5 py-0.5 bg-red-100 text-red-600 rounded-full font-medium">
                          ⏹ {lang === 'en' ? (dateCols.find(c => c.columnKey === stage.endColumnKey)?.labelEn || dateCols.find(c => c.columnKey === stage.endColumnKey)?.labelAr) : dateCols.find(c => c.columnKey === stage.endColumnKey)?.labelAr}
                        </span>
                      )}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Col selectors — only shown when mode ≠ none */}
          {showColConfig && !isEditing && (
            <div className="flex items-center gap-2 flex-shrink-0 w-80">
              <div className="flex-1">
                <p className="text-[9px] text-slate-400 mb-1 font-medium">{lang === 'en' ? '▶ Start' : '▶ بداية'}</p>
                <ColSel stageId={stage.id} value={stage.startColumnKey || ''} field="startColumnKey" placeholder={lang === 'en' ? '— Not Set —' : '— لم يُحدد —'} />
              </div>
              <div className="flex-1">
                <p className="text-[9px] text-slate-400 mb-1 font-medium">{lang === 'en' ? '⏹ End' : '⏹ نهاية'}</p>
                <ColSel stageId={stage.id} value={stage.endColumnKey || ''} field="endColumnKey" placeholder={lang === 'en' ? '— Not Set —' : '— لم يُحدد —'} />
              </div>
            </div>
          )}

          {/* Category */}
          <button
            onClick={() => update(stage.id, { category: stage.category === 'EXEC' ? 'FIN' : 'EXEC' })}
            data-testid={`button-toggle-category-${stage.id}`}
            title={lang === 'en' ? 'Click to change category' : 'انقر لتغيير الفئة'}
            className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors cursor-pointer hover:opacity-80 flex-shrink-0 ${
              stage.category === 'EXEC'
                ? 'bg-blue-50 text-blue-700 border-blue-200'
                : 'bg-purple-50 text-purple-700 border-purple-200'
            }`}
          >
            {stage.category === 'EXEC' ? (lang === 'en' ? 'Executive' : 'تنفيذي') : (lang === 'en' ? 'Financial' : 'مالي')}
          </button>

          {/* Checkboxes */}
          <div className="flex items-center gap-4 text-xs text-slate-500 flex-shrink-0">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={stage.isTerminal}
                onChange={e => update(stage.id, { isTerminal: e.target.checked })}
                className="w-3 h-3 accent-indigo-600"
                data-testid={`checkbox-terminal-${stage.id}`} /> {lang === 'en' ? 'Final' : 'نهائي'}
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={stage.isCancelled}
                onChange={e => update(stage.id, { isCancelled: e.target.checked })}
                className="w-3 h-3 accent-red-500"
                data-testid={`checkbox-cancelled-${stage.id}`} /> {lang === 'en' ? 'Cancelled' : 'ملغى'}
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={stage.active}
                onChange={e => update(stage.id, { active: e.target.checked })}
                className="w-3 h-3 accent-emerald-500"
                data-testid={`checkbox-active-${stage.id}`} /> {lang === 'en' ? 'Active' : 'نشط'}
            </label>
          </div>

          {/* Delete */}
          <div className="flex-shrink-0 w-16 flex justify-end">
            {isDeleteConfirm ? (
              <div className="flex items-center gap-1">
                <button onClick={() => handleDelete(stage.id)}
                  className="px-2 py-0.5 bg-red-600 text-white text-[10px] rounded hover:bg-red-700"
                  data-testid={`button-confirm-delete-${stage.id}`}>{lang === 'en' ? 'Yes' : 'نعم'}</button>
                <button onClick={() => setDeleteConfirmId(null)}
                  className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] rounded">{lang === 'en' ? 'No' : 'لا'}</button>
              </div>
            ) : (
              <button onClick={() => setDeleteConfirmId(stage.id)}
                className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 transition-all p-1 rounded"
                data-testid={`button-delete-stage-${stage.id}`}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  /* ─── render ─────────────────────────────────────────────────────────────── */
  return (
    <div className="p-6 max-w-6xl mx-auto" dir={lang === 'en' ? 'ltr' : 'rtl'}>
      {/* Header */}
      <div className="flex justify-between items-start gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
              <ListOrdered className="w-5 h-5 text-indigo-600" />
            </span>
            {lang === 'en' ? 'Stage Management' : 'إدارة الإجراءات'}
          </h1>
          <p className="text-slate-500 mt-1 text-sm">{lang === 'en' ? 'Drag to reorder • Click name to edit • Click category to toggle' : 'اسحب لإعادة الترتيب • انقر على الاسم للتعديل • انقر على الفئة لتغييرها'}</p>
        </div>
        <button data-testid="button-add-stage" onClick={() => setShowModal(true)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl flex items-center gap-2 transition-colors shadow-sm text-sm font-medium flex-shrink-0">
          <Plus className="w-4 h-4" /> {lang === 'en' ? 'Add Stage' : 'إضافة إجراء'}
        </button>
      </div>

      {/* ── Mode selector card ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden mb-5">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2.5 bg-gradient-to-l from-slate-50 to-white">
          <span className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center">
            <Zap size={14} className="text-indigo-600" />
          </span>
          <div>
            <h3 className="text-sm font-bold text-slate-800">{lang === 'en' ? 'Stage Determination Mode' : 'وضع تحديد الإجراء'}</h3>
            <p className="text-xs text-slate-400">{lang === 'en' ? 'Choose how the system behaves when determining work order stages' : 'اختر كيف يتصرف النظام عند تحديد إجراء أمر العمل'}</p>
          </div>
          <div className={lang === 'en' ? 'ml-auto flex items-center gap-2' : 'mr-auto flex items-center gap-2'}>
            {modeSaving && (
              <span className="text-xs text-indigo-500 flex items-center gap-1">
                <span className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                {lang === 'en' ? 'Saving...' : 'جاري الحفظ...'}
              </span>
            )}
            {!modeSaving && !modeLoading && activeMode && stageMode !== 'none' && (
              <span className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${activeMode.activeColor}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${activeMode.dot}`} />
                {lang === 'en' ? activeMode.labelEn : activeMode.label}
              </span>
            )}
          </div>
        </div>

        <div className="p-4 grid grid-cols-4 gap-3">
          {MODES.map(({ key, icon: Icon, label, labelEn, desc, descEn, activeColor, dot }) => {
            const isActive = stageMode === key;
            return (
              <button key={key} onClick={() => saveMode(key)}
                data-testid={`button-mode-${key}`}
                disabled={modeSaving || modeLoading}
                className={`relative ${lang === 'en' ? 'text-left' : 'text-right'} flex flex-col items-start gap-2 p-4 rounded-xl border-2 transition-all disabled:opacity-60 ${
                  isActive ? activeColor : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2 w-full">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isActive ? 'bg-white/70 shadow-sm' : 'bg-slate-100'}`}>
                    <Icon size={16} className={isActive ? '' : 'text-slate-400'} />
                  </div>
                  {isActive && <span className={`${lang === 'en' ? 'ml-auto' : 'mr-auto'} w-2 h-2 rounded-full ${dot}`} />}
                </div>
                <div>
                  <p className="font-bold text-xs">{lang === 'en' ? labelEn : label}</p>
                  <p className={`text-[10px] mt-0.5 leading-relaxed ${isActive ? 'opacity-75' : 'text-slate-400'}`}>{lang === 'en' ? descEn : desc}</p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Column config hint — shown when mode active */}
        {showColConfig && (
          <div className="mx-4 mb-4 px-4 py-2.5 bg-indigo-50 border border-indigo-200 rounded-xl flex items-center gap-2.5 text-xs text-indigo-700">
            <Link2 size={14} className="flex-shrink-0" />
            <span>
              {lang === 'en' ? (
                <>
                  Select <strong>Start</strong> and <strong>End</strong> columns for each stage from the dropdowns below.
                  Each column can be linked to only one stage.
                  <span className="ml-2 text-indigo-500">({linkedCount} of {dateCols.length} columns currently linked)</span>
                </>
              ) : (
                <>
                  حدّد أعمدة <strong>البداية</strong> و<strong>النهاية</strong> لكل إجراء من القوائم المنسدلة أدناه.
                  كل عمود لا يمكن ربطه بأكثر من إجراء واحد.
                  <span className="mr-2 text-indigo-500">({linkedCount} من {dateCols.length} عمود مرتبط حالياً)</span>
                </>
              )}
            </span>
          </div>
        )}
      </div>

      {/* ── Stages List ── */}
      {loading ? (
        <div className="text-center py-16 text-slate-400">{lang === 'en' ? 'Loading...' : 'جاري التحميل...'}</div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className={`flex items-center gap-3 px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-400 uppercase tracking-wider ${lang === 'en' ? 'text-left' : 'text-right'}`}>
            <div className="w-4 flex-shrink-0" />
            <div className="flex-1">{lang === 'en' ? 'Stage Name' : 'اسم الإجراء'}</div>
            {showColConfig && <div className="w-80 flex-shrink-0 text-center">{lang === 'en' ? 'Linked Columns' : 'الأعمدة المرتبطة'}</div>}
            <div className="flex-shrink-0 w-16 text-center">{lang === 'en' ? 'Category' : 'الفئة'}</div>
            <div className="flex-shrink-0">{lang === 'en' ? 'Properties' : 'الخصائص'}</div>
            <div className="w-16 flex-shrink-0" />
          </div>

          {execStages.length > 0 && (
            <div className="px-4 py-2 text-xs font-bold text-blue-600 bg-blue-50 border-y border-blue-100 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-500" />
              {lang === 'en' ? 'Executive Stages' : 'الإجراءات التنفيذية'}
              <span className="font-normal text-blue-400">({execStages.length})</span>
            </div>
          )}
          {execStages.map((s: Stage) => (
            <StageRow key={s.id} stage={s} globalIndex={stages.indexOf(s) as number} />
          ))}

          {finStages.length > 0 && (
            <div className="px-4 py-2 text-xs font-bold text-purple-600 bg-purple-50 border-y border-purple-100 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-purple-500" />
              {lang === 'en' ? 'Financial Stages' : 'الإجراءات المالية'}
              <span className="font-normal text-purple-400">({finStages.length})</span>
            </div>
          )}
          {finStages.map((s: Stage) => (
            <StageRow key={s.id} stage={s} globalIndex={stages.indexOf(s) as number} />
          ))}

          {stages.length === 0 && (
            <div className="text-center py-16 text-slate-400">
              <ListOrdered className="w-10 h-10 mx-auto mb-3 opacity-30" />
              {lang === 'en' ? 'No stages found, add your first stage' : 'لا توجد إجراءات، أضف أول إجراء'}
            </div>
          )}
        </div>
      )}

      {/* ── Add Modal ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden" dir={lang === 'en' ? 'ltr' : 'rtl'}>
            <div className={`flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-gradient-to-l from-slate-50 to-white ${lang === 'en' ? 'flex-row-reverse' : ''}`}>
              <h2 className="font-bold text-slate-800 flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center">
                  <Plus size={14} className="text-indigo-600" />
                </span>
                {lang === 'en' ? 'Add New Stage' : 'إضافة إجراء جديد'}
              </h2>
              <button onClick={() => { setShowModal(false); setForm({ ...EMPTY_FORM }); }}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
                data-testid="button-close-modal"><X size={16} /></button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className={`block text-sm font-semibold text-slate-700 mb-1.5 ${lang === 'en' ? 'text-left' : 'text-right'}`}>
                  {lang === 'en' ? 'Arabic Name' : 'الاسم بالعربي'} <span className="text-red-500">*</span>
                </label>
                <input data-testid="input-stage-name-ar" autoFocus value={form.nameAr}
                  onChange={e => setForm(p => ({ ...p, nameAr: e.target.value }))}
                  placeholder={lang === 'en' ? 'e.g. Field Survey' : 'مثال: المسح الميداني'}
                  className={`w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-400 outline-none text-sm ${lang === 'en' ? 'text-left' : 'text-right'}`} />
              </div>
              <div>
                <label className={`block text-sm font-semibold text-slate-700 mb-1.5 ${lang === 'en' ? 'text-left' : 'text-right'}`}>
                  {lang === 'en' ? 'English Name' : 'الاسم بالإنجليزي'} <span className="text-slate-400 font-normal text-xs">{lang === 'en' ? '(optional)' : '(اختياري)'}</span>
                </label>
                <input data-testid="input-stage-name-en" value={form.nameEn}
                  onChange={e => setForm(p => ({ ...p, nameEn: e.target.value }))}
                  placeholder="e.g. Field Survey" dir="ltr"
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-400 outline-none text-sm text-left" />
              </div>
              <div>
                <label className={`block text-sm font-semibold text-slate-700 mb-2 ${lang === 'en' ? 'text-left' : 'text-right'}`}>{lang === 'en' ? 'Category' : 'الفئة'}</label>
                <div className="flex gap-3">
                  {(['EXEC', 'FIN'] as const).map(cat => (
                    <button key={cat} type="button" onClick={() => setForm(p => ({ ...p, category: cat }))}
                      data-testid={`button-category-${cat.toLowerCase()}`}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-bold border-2 transition-colors ${
                        form.category === cat
                          ? cat === 'EXEC' ? 'bg-blue-600 text-white border-blue-600' : 'bg-purple-600 text-white border-purple-600'
                          : 'bg-slate-50 text-slate-500 border-slate-200 hover:border-slate-300'
                      }`}>
                      {cat === 'EXEC' ? (lang === 'en' ? 'Executive' : 'تنفيذي') : (lang === 'en' ? 'Financial' : 'مالي')}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-5 pt-1 border-t border-slate-100">
                {[
                  { key: 'isTerminal', label: lang === 'en' ? 'Terminal (Closes Order)' : 'نهائي (يُغلق الأمر)', accent: 'accent-indigo-600' },
                  { key: 'isCancelled', label: lang === 'en' ? 'Cancelled' : 'ملغى', accent: 'accent-red-500' },
                ].map(({ key, label, accent }) => (
                  <label key={key} className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={(form as any)[key]}
                      onChange={e => setForm(p => ({ ...p, [key]: e.target.checked }))}
                      className={`w-4 h-4 ${accent}`} />
                    <span className="text-sm text-slate-700">{label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className={`flex ${lang === 'en' ? 'justify-start' : 'justify-end'} gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50`}>
              <button onClick={() => { setShowModal(false); setForm({ ...EMPTY_FORM }); }}
                className="px-5 py-2 text-sm text-slate-600 hover:bg-slate-200 rounded-xl">{lang === 'en' ? 'Cancel' : 'إلغاء'}</button>
              <button data-testid="button-save-stage" onClick={handleAdd}
                disabled={saving || !form.nameAr.trim()}
                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl disabled:opacity-50 flex items-center gap-2">
                <Save size={14} />
                {saving ? (lang === 'en' ? 'Saving...' : 'جاري الحفظ...') : (lang === 'en' ? 'Add' : 'إضافة')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
