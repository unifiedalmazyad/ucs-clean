import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { useLang } from '../contexts/LangContext';
import { motion, AnimatePresence } from 'motion/react';
import {
  Columns, Plus, Edit2, Power, Trash2, Settings, AlertTriangle,
  GripVertical, Check, Layers, Tag
} from 'lucide-react';

type Tab = 'columns' | 'groups' | 'categories';

// ─── safety warning ────────────────────────────────────────────────────────
const SystemWarning = () => {
  const { lang } = useLang();
  return (
    <div className="mb-5 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-amber-800 text-sm">
      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-500" />
      <span>{lang === 'en' ? 'These are system base data. Any changes in the code are automatically updated in all linked tables — ensure accuracy before saving.' : 'هذه البيانات أساس النظام. أي تغيير في الكود يُحدَّث تلقائياً في جميع الجداول المرتبطة — تأكد قبل الحفظ.'}</span>
    </div>
  );
};

// ─── shared drag helpers ───────────────────────────────────────────────────
function useDragReorder<T extends { id: string }>(
  items: T[],
  setItems: (v: T[]) => void,
  onSave: (ids: string[]) => Promise<void>
) {
  const dragIdx = useRef<number | null>(null);
  const dragOverIdx = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const onDragStart = (i: number) => { dragIdx.current = i; setDragging(true); };
  const onDragOver = (e: React.DragEvent, i: number) => { e.preventDefault(); dragOverIdx.current = i; setDropTarget(i); };
  const onDragEnd = async () => {
    setDragging(false); setDropTarget(null);
    if (dragIdx.current === null || dragOverIdx.current === null || dragIdx.current === dragOverIdx.current) {
      dragIdx.current = null; dragOverIdx.current = null; return;
    }
    const reordered = [...items];
    const [moved] = reordered.splice(dragIdx.current, 1);
    reordered.splice(dragOverIdx.current, 0, moved);
    dragIdx.current = null; dragOverIdx.current = null;
    setItems(reordered);
    setSaving(true); setSaved(false);
    try { await onSave(reordered.map(x => x.id)); setSaved(true); setTimeout(() => setSaved(false), 2000); }
    catch { /* revert on error is handled by parent fetchData */ }
    finally { setSaving(false); }
  };
  const rowClass = (i: number) =>
    dragging && dragIdx.current === i ? 'opacity-40 bg-indigo-50/50' :
    dropTarget === i && dragIdx.current !== i ? 'bg-indigo-50 border-indigo-200' : '';

  return { onDragStart, onDragOver, onDragEnd, rowClass, saving, saved };
}

// ─── Columns Tab ───────────────────────────────────────────────────────────
function ColumnsTab() {
  const { lang } = useLang();
  const [columns, setColumns] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingCol, setEditingCol] = useState<any>(null);
  const [formData, setFormData] = useState<any>({
    labelAr: '', columnKey: '', groupKey: '', category: 'EXEC',
    dataType: 'text', isSensitive: false, isEnabled: true, options: []
  });

  const fetchData = async () => {
    try {
      const [colRes, grpRes, catRes] = await Promise.all([
        api.get('/admin/columns'),
        api.get('/admin/column-groups'),
        api.get('/admin/column-categories'),
      ]);
      setColumns(colRes.data);
      setGroups(grpRes.data.filter((g: any) => g.active));
      setCategories(catRes.data.filter((c: any) => c.active));
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetchData(); }, []);

  const drag = useDragReorder(columns, setColumns,
    (ids) => api.patch('/admin/columns/reorder', { ids }).then(() => {}));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[a-z][a-z0-9_]*$/.test(formData.columnKey)) {
      alert(lang === 'en' ? 'Key must start with a lowercase letter and contain only lowercase letters, numbers, and underscores' : 'الكود يجب أن يبدأ بحرف إنجليزي صغير ويحتوي على حروف صغيرة وأرقام وشرطة سفلية فقط');
      return;
    }
    try {
      if (editingCol) {
        if (formData.columnKey !== editingCol.columnKey)
          await api.patch(`/admin/columns/${editingCol.id}/rename-key`, { newKey: formData.columnKey });
        await api.put(`/admin/columns/${editingCol.id}`, formData);
      } else {
        await api.post('/admin/columns', formData);
      }
      setShowModal(false); setEditingCol(null); fetchData();
    } catch (err: any) { alert(err.response?.data?.error || (lang === 'en' ? 'An error occurred while saving' : 'حدث خطأ أثناء الحفظ')); }
  };

  const addOption    = () => setFormData({ ...formData, options: [...formData.options, { value: '', labelAr: '', sortOrder: formData.options.length }] });
  const removeOption = (i: number) => { const o = [...formData.options]; o.splice(i, 1); setFormData({ ...formData, options: o }); };
  const updateOption = (i: number, f: string, v: any) => { const o = [...formData.options]; o[i] = { ...o[i], [f]: v }; setFormData({ ...formData, options: o }); };

  const catBadge = (key: string) => {
    const cat = categories.find(c => c.key === key);
    const label = (lang === 'en' ? cat?.nameEn : cat?.nameAr) || cat?.nameAr || key;
    const colors = ['bg-indigo-50 text-indigo-700 border-indigo-100', 'bg-emerald-50 text-emerald-700 border-emerald-100',
      'bg-purple-50 text-purple-700 border-purple-100', 'bg-rose-50 text-rose-700 border-rose-100'];
    const idx = categories.findIndex(c => c.key === key);
    const color = colors[idx % colors.length] || colors[0];
    return <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold border ${color}`}>{label}</span>;
  };

  if (loading) return <div className="py-20 text-center text-slate-400">{lang === 'en' ? 'Loading...' : 'جاري التحميل...'}</div>;

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-3">
          <AnimatePresence>
            {drag.saving && <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-slate-400 text-sm">{lang === 'en' ? 'Saving...' : 'جاري الحفظ...'}</motion.span>}
            {drag.saved  && <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-1 text-emerald-600 text-sm font-medium"><Check className="w-4 h-4" /> {lang === 'en' ? 'Order saved' : 'تم حفظ الترتيب'}</motion.span>}
          </AnimatePresence>
          <p className="text-slate-400 text-xs">{lang === 'en' ? 'Drag rows to reorder' : 'اسحب الصفوف لإعادة الترتيب'}</p>
        </div>
        <button
          onClick={() => { setEditingCol(null); setFormData({ labelAr: '', labelEn: '', columnKey: '', groupKey: groups[0]?.key || '', category: categories[0]?.key || 'EXEC', dataType: 'text', isSensitive: false, isEnabled: true, options: [] }); setShowModal(true); }}
          className="bg-indigo-600 text-white px-4 py-2 rounded-xl flex items-center gap-2 hover:bg-indigo-700 transition-colors text-sm font-medium"
          data-testid="button-new-column"
        >
          <Plus className="w-4 h-4" /> {lang === 'en' ? 'New Column' : 'عمود جديد'}
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <table className={`w-full ${lang === 'en' ? 'text-left' : 'text-right'}`}>
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="px-3 py-3 w-8"></th>
              <th className="px-4 py-3 text-xs font-bold text-slate-500">{lang === 'en' ? 'Name' : 'الاسم'}</th>
              <th className="px-4 py-3 text-xs font-bold text-slate-500">{lang === 'en' ? 'Key' : 'المفتاح'}</th>
              <th className="px-4 py-3 text-xs font-bold text-slate-500">{lang === 'en' ? 'Group' : 'المجموعة'}</th>
              <th className="px-4 py-3 text-xs font-bold text-slate-500">{lang === 'en' ? 'Category' : 'الفئة'}</th>
              <th className="px-4 py-3 text-xs font-bold text-slate-500">{lang === 'en' ? 'Type' : 'النوع'}</th>
              <th className="px-4 py-3 text-xs font-bold text-slate-500">{lang === 'en' ? 'On Create' : 'عند الإنشاء'}</th>
              <th className="px-4 py-3 text-xs font-bold text-slate-500">{lang === 'en' ? 'Status' : 'الحالة'}</th>
              <th className="px-4 py-3 text-xs font-bold text-slate-500"></th>
            </tr>
          </thead>
          <tbody>
            {columns.map((c, idx) => (
              <tr
                key={c.id}
                draggable
                onDragStart={() => drag.onDragStart(idx)}
                onDragOver={e => drag.onDragOver(e, idx)}
                onDragEnd={drag.onDragEnd}
                className={`border-b border-slate-50 transition-all hover:bg-slate-50/50 ${drag.rowClass(idx)}`}
                data-testid={`row-column-${c.id}`}
              >
                <td className="px-3 py-3"><GripVertical className="w-4 h-4 text-slate-300 cursor-grab active:cursor-grabbing mx-auto" /></td>
                <td className="px-4 py-3 font-medium text-slate-900 text-sm">
                  {lang === 'en' ? (c.labelEn || c.labelAr) : c.labelAr}
                </td>
                <td className="px-4 py-3 text-xs font-mono text-slate-400">{c.columnKey}</td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {(() => {
                    const g = groups.find(g => g.key === c.groupKey);
                    return lang === 'en' ? (g?.nameEn || g?.nameAr || c.groupKey) : (g?.nameAr || c.groupKey);
                  })()}
                </td>
                <td className="px-4 py-3">{catBadge(c.category)}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{c.dataType}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={async () => { await api.put(`/admin/columns/${c.id}`, { showInCreate: !c.showInCreate }); fetchData(); }}
                    className={`relative w-9 h-5 rounded-full transition-colors ${c.showInCreate ? 'bg-indigo-500' : 'bg-slate-200'}`}
                    data-testid={`toggle-show-create-${c.id}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${c.showInCreate ? (lang === 'en' ? 'left-4.5 translate-x-4' : 'right-0.5') : (lang === 'en' ? 'left-0.5' : 'left-0.5')}`} />
                  </button>
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${c.isEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                    {c.isEnabled ? (lang === 'en' ? 'Enabled' : 'مفعل') : (lang === 'en' ? 'Disabled' : 'معطل')}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={async () => {
                        setEditingCol(c);
                        let opts: any[] = [];
                        if (c.dataType === 'select') { const r = await api.get(`/admin/column-options/${c.columnKey}`); opts = r.data; }
                        setFormData({ ...c, options: opts }); setShowModal(true);
                      }}
                      className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                      data-testid={`button-edit-column-${c.id}`}
                    ><Edit2 className="w-4 h-4" /></button>
                    <button
                      onClick={async () => { await api.put(`/admin/columns/${c.id}`, { isEnabled: !c.isEnabled }); fetchData(); }}
                      className={`p-1.5 rounded-lg transition-colors ${c.isEnabled ? 'text-slate-400 hover:text-red-600 hover:bg-red-50' : 'text-emerald-600 bg-emerald-50'}`}
                      data-testid={`button-toggle-enabled-${c.id}`}
                    ><Power className="w-4 h-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-5 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">{editingCol ? (lang === 'en' ? 'Edit Column' : 'تعديل عمود') : (lang === 'en' ? 'Add New Column' : 'إضافة عمود جديد')}</h2>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto flex-1" dir={lang === 'en' ? 'ltr' : 'rtl'}>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">{lang === 'en' ? 'Arabic Name' : 'الاسم بالعربي'}</label>
                  <input required type="text" className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                    value={formData.labelAr} onChange={e => setFormData({ ...formData, labelAr: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">{lang === 'en' ? 'English Name' : 'الاسم بالإنجليزي'}</label>
                  <input type="text" className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                    value={formData.labelEn || ''} onChange={e => setFormData({ ...formData, labelEn: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {lang === 'en' ? 'Column Key (snake_case)' : 'مفتاح العمود (snake_case)'}
                    {editingCol && formData.columnKey !== editingCol.columnKey && <span className="mr-2 text-amber-600 text-xs">⚠ {lang === 'en' ? 'All references will be updated' : 'سيتم تحديث جميع المراجع'}</span>}
                  </label>
                  <input required type="text" dir="ltr" placeholder="e.g. custom_date_field"
                    className={`w-full px-4 py-2 rounded-xl border focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-sm ${editingCol && formData.columnKey !== editingCol.columnKey ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}
                    value={formData.columnKey}
                    onChange={e => setFormData({ ...formData, columnKey: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">{lang === 'en' ? 'Group' : 'المجموعة'}</label>
                  <select className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                    value={formData.groupKey} onChange={e => setFormData({ ...formData, groupKey: e.target.value })}>
                    {groups.map(g => <option key={g.key} value={g.key}>{lang === 'en' ? (g.nameEn || g.nameAr) : g.nameAr}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">{lang === 'en' ? 'Category' : 'الفئة'}</label>
                  <select className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                    value={formData.category} onChange={e => setFormData({ ...formData, category: e.target.value })}>
                    {categories.map(c => <option key={c.key} value={c.key}>{lang === 'en' ? (c.nameEn || c.nameAr) : c.nameAr} ({c.key})</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">{lang === 'en' ? 'Data Type' : 'نوع البيانات'}</label>
                  <select className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                    value={formData.dataType} onChange={e => setFormData({ ...formData, dataType: e.target.value })}>
                    <option value="text">{lang === 'en' ? 'Text' : 'نص'}</option>
                    <option value="number">{lang === 'en' ? 'Number' : 'رقم'}</option>
                    <option value="date">{lang === 'en' ? 'Date' : 'تاريخ'}</option>
                    <option value="select">{lang === 'en' ? 'Select' : 'قائمة منسدلة'}</option>
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 rounded border-slate-300 text-indigo-600"
                  checked={formData.isSensitive} onChange={e => setFormData({ ...formData, isSensitive: e.target.checked })} />
                <span className="text-sm text-slate-700">{lang === 'en' ? 'Sensitive field (hide from unauthorized users)' : 'حقل حساس (إخفاء عن غير المخولين)'}</span>
              </label>
              {formData.dataType === 'select' && (
                <div className="pt-4 border-t border-slate-100">
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="font-bold text-slate-900 flex items-center gap-2 text-sm"><Settings className="w-4 h-4" /> {lang === 'en' ? 'Menu Options' : 'خيارات القائمة'}</h3>
                    <button type="button" onClick={addOption} className="text-indigo-600 text-sm font-bold flex items-center gap-1 hover:text-indigo-700">
                      <Plus className="w-4 h-4" /> {lang === 'en' ? 'Add Option' : 'إضافة خيار'}
                    </button>
                  </div>
                  <div className="space-y-2">
                    {formData.options.map((opt: any, i: number) => (
                      <div key={i} className="flex gap-2 items-center">
                        <input placeholder={lang === 'en' ? 'Value' : 'القيمة'} className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 text-sm outline-none" value={opt.value} onChange={e => updateOption(i, 'value', e.target.value)} />
                        <input placeholder={lang === 'en' ? 'Label Ar' : 'التسمية Ar'} className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 text-sm outline-none" value={opt.labelAr} onChange={e => updateOption(i, 'labelAr', e.target.value)} />
                        <input placeholder={lang === 'en' ? 'Label En' : 'التسمية En'} className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 text-sm outline-none text-left" dir="ltr" value={opt.labelEn || ''} onChange={e => updateOption(i, 'labelEn', e.target.value)} />
                        <button type="button" onClick={() => removeOption(i)} className="p-1.5 text-red-400 hover:text-red-600 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex gap-3 pt-4">
                <button type="submit" className="flex-1 bg-indigo-600 text-white py-2 rounded-xl font-bold hover:bg-indigo-700 transition-colors">
                  {editingCol ? (lang === 'en' ? 'Update' : 'تحديث') : (lang === 'en' ? 'Create' : 'إنشاء')}
                </button>
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 bg-slate-100 text-slate-600 py-2 rounded-xl font-bold hover:bg-slate-200 transition-colors">{lang === 'en' ? 'Cancel' : 'إلغاء'}</button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </>
  );
}

// ─── Groups Tab ────────────────────────────────────────────────────────────
function GroupsTab() {
  const { lang } = useLang();
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState<any>(null);
  const [formData, setFormData] = useState({ key: '', nameAr: '', nameEn: '', sortOrder: 0, active: true });

  const fetchData = async () => {
    try { const r = await api.get('/admin/column-groups'); setGroups(r.data); }
    catch (err) { console.error(err); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetchData(); }, []);

  const drag = useDragReorder(groups, setGroups,
    (ids) => {
      const reqs = ids.map((id, i) => api.put(`/admin/column-groups/${id}`, { sortOrder: i + 1 }));
      return Promise.all(reqs).then(() => {});
    });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[A-Z][A-Z0-9_]*$/.test(formData.key)) {
      alert(lang === 'en' ? 'Key must start with an uppercase letter and contain only uppercase letters, numbers, and underscores' : 'الكود يجب أن يبدأ بحرف إنجليزي كبير ويحتوي على حروف كبيرة وأرقام وشرطة سفلية فقط');
      return;
    }
    try {
      if (editingGroup) {
        if (formData.key !== editingGroup.key)
          await api.patch(`/admin/column-groups/${editingGroup.id}/rename-key`, { newKey: formData.key });
        await api.put(`/admin/column-groups/${editingGroup.id}`, formData);
      } else {
        await api.post('/admin/column-groups', formData);
      }
      setShowModal(false); setEditingGroup(null);
      setFormData({ key: '', nameAr: '', nameEn: '', sortOrder: 0, active: true });
      fetchData();
    } catch (err: any) { alert(err.response?.data?.error || (lang === 'en' ? 'An error occurred. Make sure the key is unique.' : 'حدث خطأ. تأكد من أن الكود فريد.')); }
  };

  if (loading) return <div className="py-20 text-center text-slate-400">{lang === 'en' ? 'Loading...' : 'جاري التحميل...'}</div>;

  return (
    <>
      <div className="flex justify-end mb-4">
        <button
          onClick={() => { setEditingGroup(null); setFormData({ key: '', nameAr: '', nameEn: '', sortOrder: groups.length + 1, active: true }); setShowModal(true); }}
          className="bg-indigo-600 text-white px-4 py-2 rounded-xl flex items-center gap-2 hover:bg-indigo-700 transition-colors text-sm font-medium"
        ><Plus className="w-4 h-4" /> {lang === 'en' ? 'New Group' : 'مجموعة جديدة'}</button>
      </div>
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <table className={`w-full ${lang === 'en' ? 'text-left' : 'text-right'}`}>
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="px-3 py-3 w-8"></th>
              <th className="px-4 py-3 text-xs font-bold text-slate-500">{lang === 'en' ? 'Key' : 'الكود'}</th>
              <th className="px-4 py-3 text-xs font-bold text-slate-500">{lang === 'en' ? 'Name' : 'الاسم بالعربي'}</th>
              <th className="px-4 py-3 text-xs font-bold text-slate-500">{lang === 'en' ? 'Status' : 'الحالة'}</th>
              <th className="px-4 py-3 text-xs font-bold text-slate-500"></th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g, idx) => (
              <tr key={g.id}
                draggable
                onDragStart={() => drag.onDragStart(idx)}
                onDragOver={e => drag.onDragOver(e, idx)}
                onDragEnd={drag.onDragEnd}
                className={`border-b border-slate-50 hover:bg-slate-50/50 transition-all ${drag.rowClass(idx)}`}
              >
                <td className="px-3 py-3"><GripVertical className="w-4 h-4 text-slate-300 cursor-grab active:cursor-grabbing mx-auto" /></td>
                <td className="px-4 py-3 text-sm font-mono font-bold text-slate-700">{g.key}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{lang === 'en' ? (g.nameEn || g.nameAr) : g.nameAr}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${g.active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                    {g.active ? (lang === 'en' ? 'Active' : 'نشط') : (lang === 'en' ? 'Inactive' : 'معطل')}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    <button onClick={() => { setEditingGroup(g); setFormData({ key: g.key, nameAr: g.nameAr, nameEn: g.nameEn || '', sortOrder: g.sortOrder, active: g.active }); setShowModal(true); }}
                      className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"><Edit2 className="w-4 h-4" /></button>
                    <button onClick={async () => { await api.put(`/admin/column-groups/${g.id}`, { active: !g.active }); fetchData(); }}
                      className={`p-1.5 rounded-lg transition-colors ${g.active ? 'text-slate-400 hover:text-red-600 hover:bg-red-50' : 'text-emerald-600 bg-emerald-50'}`}><Power className="w-4 h-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-5 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">{editingGroup ? (lang === 'en' ? 'Edit Group' : 'تعديل مجموعة') : (lang === 'en' ? 'New Group' : 'مجموعة جديدة')}</h2>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4" dir={lang === 'en' ? 'ltr' : 'rtl'}>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {lang === 'en' ? 'Code (Key) - Uppercase English' : 'الكود (Key) - بالإنجليزية الكبيرة'}
                  {editingGroup && formData.key !== editingGroup.key && <span className="mr-2 text-amber-600 text-xs">⚠ {lang === 'en' ? 'All linked columns will be updated' : 'سيتم تحديث جميع الأعمدة المرتبطة'}</span>}
                </label>
                <input required type="text" dir="ltr" placeholder="e.g. BASIC, OPS, FINANCE"
                  className={`w-full px-4 py-2 rounded-xl border focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-sm ${editingGroup && formData.key !== editingGroup.key ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}
                  value={formData.key}
                  onChange={e => setFormData({ ...formData, key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">{lang === 'en' ? 'Arabic Name' : 'الاسم بالعربي'}</label>
                  <input required type="text" className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                    value={formData.nameAr} onChange={e => setFormData({ ...formData, nameAr: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">{lang === 'en' ? 'English Name' : 'الاسم بالإنجليزي'}</label>
                  <input type="text" className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                    value={formData.nameEn || ''} onChange={e => setFormData({ ...formData, nameEn: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{lang === 'en' ? 'Order' : 'الترتيب'}</label>
                <input required type="number" className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                  value={formData.sortOrder} onChange={e => setFormData({ ...formData, sortOrder: parseInt(e.target.value) })} />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" className="flex-1 bg-indigo-600 text-white py-2 rounded-xl font-bold hover:bg-indigo-700 transition-colors">
                  {editingGroup ? (lang === 'en' ? 'Update' : 'تحديث') : (lang === 'en' ? 'Create' : 'إنشاء')}
                </button>
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 bg-slate-100 text-slate-600 py-2 rounded-xl font-bold hover:bg-slate-200 transition-colors">{lang === 'en' ? 'Cancel' : 'إلغاء'}</button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </>
  );
}

// ─── Categories Tab ─────────────────────────────────────────────────────────
function CategoriesTab() {
  const { lang } = useLang();
  const [cats, setCats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingCat, setEditingCat] = useState<any>(null);
  const [formData, setFormData] = useState({ key: '', nameAr: '', nameEn: '', sortOrder: 0, active: true });

  const fetchData = async () => {
    try { const r = await api.get('/admin/column-categories'); setCats(r.data); }
    catch (err) { console.error(err); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetchData(); }, []);

  const drag = useDragReorder(cats, setCats,
    (ids) => api.patch('/admin/column-categories/reorder', { ids }).then(() => {}));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[A-Z][A-Z0-9_]*$/.test(formData.key)) {
      alert(lang === 'en' ? 'Key must start with an uppercase letter and contain only uppercase letters, numbers, and underscores (e.g., EXEC, FIN)' : 'الكود يجب أن يبدأ بحرف إنجليزي كبير ويحتوي على حروف كبيرة وأرقام وشرطة سفلية فقط (مثل: EXEC, FIN)');
      return;
    }
    try {
      if (editingCat) {
        if (formData.key !== editingCat.key)
          await api.patch(`/admin/column-categories/${editingCat.id}/rename-key`, { newKey: formData.key });
        await api.put(`/admin/column-categories/${editingCat.id}`, { nameAr: formData.nameAr, nameEn: formData.nameEn, sortOrder: formData.sortOrder, active: formData.active });
      } else {
        await api.post('/admin/column-categories', formData);
      }
      setShowModal(false); setEditingCat(null); fetchData();
    } catch (err: any) { alert(err.response?.data?.error || (lang === 'en' ? 'An error occurred while saving' : 'حدث خطأ أثناء الحفظ')); }
  };

  const colors = [
    'bg-indigo-50 text-indigo-700 border-indigo-200',
    'bg-emerald-50 text-emerald-700 border-emerald-200',
    'bg-purple-50 text-purple-700 border-purple-200',
    'bg-rose-50 text-rose-700 border-rose-200',
    'bg-amber-50 text-amber-700 border-amber-200',
  ];

  if (loading) return <div className="py-20 text-center text-slate-400">{lang === 'en' ? 'Loading...' : 'جاري التحميل...'}</div>;

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-3">
          <AnimatePresence>
            {drag.saving && <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-slate-400 text-sm">{lang === 'en' ? 'Saving...' : 'جاري الحفظ...'}</motion.span>}
            {drag.saved  && <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-1 text-emerald-600 text-sm font-medium"><Check className="w-4 h-4" /> {lang === 'en' ? 'Order saved' : 'تم حفظ الترتيب'}</motion.span>}
          </AnimatePresence>
          <p className="text-slate-400 text-xs">{lang === 'en' ? 'Drag to reorder' : 'اسحب للترتيب'}</p>
        </div>
        <button
          onClick={() => { setEditingCat(null); setFormData({ key: '', nameAr: '', nameEn: '', sortOrder: cats.length + 1, active: true }); setShowModal(true); }}
          className="bg-indigo-600 text-white px-4 py-2 rounded-xl flex items-center gap-2 hover:bg-indigo-700 transition-colors text-sm font-medium"
        ><Plus className="w-4 h-4" /> {lang === 'en' ? 'New Category' : 'فئة جديدة'}</button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cats.map((cat, idx) => (
          <motion.div
            key={cat.id}
            draggable
            onDragStart={() => drag.onDragStart(idx)}
            onDragOver={e => drag.onDragOver(e, idx)}
            onDragEnd={drag.onDragEnd}
            className={`bg-white border rounded-2xl p-5 cursor-grab active:cursor-grabbing shadow-sm transition-all hover:shadow-md ${drag.rowClass(idx)}`}
          >
            <div className={`flex items-start justify-between mb-3 ${lang === 'en' ? 'flex-row' : 'flex-row-reverse'}`}>
              <div className="flex items-center gap-2">
                <GripVertical className="w-4 h-4 text-slate-300" />
                <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${colors[idx % colors.length]}`}>
                  {cat.key}
                </span>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => { setEditingCat(cat); setFormData({ key: cat.key, nameAr: cat.nameAr, nameEn: cat.nameEn || '', sortOrder: cat.sortOrder, active: cat.active }); setShowModal(true); }}
                  className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                ><Edit2 className="w-3.5 h-3.5" /></button>
                <button
                  onClick={async () => { await api.put(`/admin/column-categories/${cat.id}`, { active: !cat.active }); fetchData(); }}
                  className={`p-1.5 rounded-lg transition-colors ${cat.active ? 'text-slate-400 hover:text-red-600 hover:bg-red-50' : 'text-emerald-600 bg-emerald-50'}`}
                ><Power className="w-3.5 h-3.5" /></button>
              </div>
            </div>
            <p className={`text-xl font-bold text-slate-900 ${lang === 'en' ? 'text-left' : 'text-right'}`}>{lang === 'en' ? (cat.nameEn || cat.nameAr) : cat.nameAr}</p>
            <p className={`mt-2 text-xs font-medium ${cat.active ? 'text-emerald-600' : 'text-slate-400'} ${lang === 'en' ? 'text-left' : 'text-right'}`}>
              {cat.active ? (lang === 'en' ? '● Active' : '● نشط') : (lang === 'en' ? '○ Inactive' : '○ معطل')}
            </p>
          </motion.div>
        ))}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="p-5 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">{editingCat ? (lang === 'en' ? 'Edit Category' : 'تعديل فئة') : (lang === 'en' ? 'New Category' : 'فئة جديدة')}</h2>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4" dir={lang === 'en' ? 'ltr' : 'rtl'}>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {lang === 'en' ? 'Code (Key) - Uppercase English' : 'الكود (Key) - بالإنجليزية الكبيرة'}
                  {editingCat && formData.key !== editingCat.key && (
                    <span className="mr-2 text-amber-600 text-xs">⚠ {lang === 'en' ? 'Updates: Columns, Stages, KPIs' : 'يُحدّث: الأعمدة، الإجراءات، KPI'}</span>
                  )}
                </label>
                <input required type="text" dir="ltr" placeholder="e.g. EXEC, FIN, CUSTOM"
                  className={`w-full px-4 py-2 rounded-xl border focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-sm ${editingCat && formData.key !== editingCat.key ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}
                  value={formData.key}
                  onChange={e => setFormData({ ...formData, key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} />
                {editingCat && formData.key !== editingCat.key && (
                  <div className="mt-2 flex items-start gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-700">{lang === 'en' ? 'Changing the key will update all columns, stages, and KPI rules associated with this category.' : 'تغيير الكود سيحدّث جميع الأعمدة والإجراءات وقواعد KPI المرتبطة بهذه الفئة.'}</p>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">{lang === 'en' ? 'Arabic Name' : 'الاسم بالعربي'}</label>
                  <input required type="text" className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                    value={formData.nameAr} onChange={e => setFormData({ ...formData, nameAr: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">{lang === 'en' ? 'English Name' : 'الاسم بالإنجليزي'}</label>
                  <input type="text" className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                    value={formData.nameEn || ''} onChange={e => setFormData({ ...formData, nameEn: e.target.value })} />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" className="flex-1 bg-indigo-600 text-white py-2 rounded-xl font-bold hover:bg-indigo-700 transition-colors">
                  {editingCat ? (lang === 'en' ? 'Update' : 'تحديث') : (lang === 'en' ? 'Create' : 'إنشاء')}
                </button>
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 bg-slate-100 text-slate-600 py-2 rounded-xl font-bold hover:bg-slate-200 transition-colors">{lang === 'en' ? 'Cancel' : 'إلغاء'}</button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────
export default function AdminColumns() {
  const { lang } = useLang();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = (searchParams.get('tab') as Tab) || 'columns';
  const setTab = (t: Tab) => setSearchParams({ tab: t });

  const tabs = [
    { key: 'columns',    label: lang === 'en' ? 'Columns' : 'الأعمدة',   icon: Columns },
    { key: 'groups',     label: lang === 'en' ? 'Groups' : 'المجموعات', icon: Layers  },
    { key: 'categories', label: lang === 'en' ? 'Categories' : 'الفئات',    icon: Tag     },
  ] as const;

  return (
    <div className="p-8" dir={lang === 'en' ? 'ltr' : 'rtl'}>
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">{lang === 'en' ? 'Data Structure Management' : 'إدارة هيكل البيانات'}</h1>
        <p className="text-slate-500 text-sm mt-0.5">{lang === 'en' ? 'Columns • Groups • Categories' : 'الأعمدة • المجموعات • الفئات'}</p>
      </header>

      <SystemWarning />

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl mb-6 w-fit">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === t.key
                ? 'bg-white text-indigo-600 shadow-sm font-bold'
                : 'text-slate-500 hover:text-slate-700'
            }`}
            data-testid={`tab-${t.key}`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
        >
          {tab === 'columns'    && <ColumnsTab />}
          {tab === 'groups'     && <GroupsTab />}
          {tab === 'categories' && <CategoriesTab />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
