import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { motion } from 'motion/react';
import { Layers, Plus, Edit2, Power, ArrowUp, ArrowDown, AlertTriangle } from 'lucide-react';

export default function AdminColumnGroups() {
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState<any>(null);
  const [formData, setFormData] = useState({ key: '', nameAr: '', nameEn: '', sortOrder: 0, active: true });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const res = await api.get('/admin/column-groups');
      setGroups(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[A-Z][A-Z0-9_]*$/.test(formData.key)) {
      alert('الكود يجب أن يبدأ بحرف إنجليزي كبير ويحتوي على حروف كبيرة وأرقام وشرطة سفلية فقط');
      return;
    }
    try {
      if (editingGroup) {
        // Rename key first if it changed (cascades to column_catalog.group_key)
        if (formData.key !== editingGroup.key) {
          await api.patch(`/admin/column-groups/${editingGroup.id}/rename-key`, { newKey: formData.key });
        }
        await api.put(`/admin/column-groups/${editingGroup.id}`, formData);
      } else {
        await api.post('/admin/column-groups', formData);
      }
      setShowModal(false);
      setEditingGroup(null);
      setFormData({ key: '', nameAr: '', nameEn: '', sortOrder: 0, active: true });
      fetchData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'حدث خطأ أثناء الحفظ. تأكد من أن الكود (Key) فريد.');
    }
  };

  return (
    <div className="p-8">
      <header className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Layers className="w-8 h-8 text-indigo-600" />
            إدارة مجموعات الأعمدة
          </h1>
          <p className="text-slate-500">تصنيف الأعمدة في مجموعات منطقية (مثل: البيانات الأساسية، العمليات...)</p>
        </div>
        <button 
          onClick={() => { setEditingGroup(null); setFormData({ key: '', nameAr: '', nameEn: '', sortOrder: groups.length + 1, active: true }); setShowModal(true); }}
          className="bg-indigo-600 text-white px-4 py-2 rounded-xl flex items-center gap-2 hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          مجموعة جديدة
        </button>
      </header>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-right">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="p-4 text-sm font-semibold text-slate-600">الترتيب</th>
              <th className="p-4 text-sm font-semibold text-slate-600">الكود (Key)</th>
              <th className="p-4 text-sm font-semibold text-slate-600">الاسم بالعربي</th>
              <th className="p-4 text-sm font-semibold text-slate-600">الحالة</th>
              <th className="p-4 text-sm font-semibold text-slate-600">الإجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {groups.map((g) => (
              <tr key={g.id} className="hover:bg-slate-50 transition-colors">
                <td className="p-4 text-sm text-slate-600 font-mono">{g.sortOrder}</td>
                <td className="p-4 text-sm font-bold text-slate-900">{g.key}</td>
                <td className="p-4 text-sm text-slate-600">{g.nameAr}</td>
                <td className="p-4 text-sm">
                  <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${
                    g.active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                  }`}>
                    {g.active ? 'نشط' : 'معطل'}
                  </span>
                </td>
                <td className="p-4 text-sm">
                  <div className="flex gap-2">
                    <button 
                      onClick={() => { setEditingGroup(g); setFormData({ key: g.key, nameAr: g.nameAr, nameEn: g.nameEn || '', sortOrder: g.sortOrder, active: g.active }); setShowModal(true); }}
                      className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={async () => {
                        await api.put(`/admin/column-groups/${g.id}`, { active: !g.active });
                        fetchData();
                      }}
                      className={`p-2 rounded-lg transition-colors ${
                        g.active ? 'text-slate-400 hover:text-red-600 hover:bg-red-50' : 'text-emerald-600 bg-emerald-50'
                      }`}
                    >
                      <Power className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
          >
            <div className="p-6 border-b border-slate-100">
              <h2 className="text-xl font-bold text-slate-900">
                {editingGroup ? 'تعديل مجموعة' : 'مجموعة جديدة'}
              </h2>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  الكود (Key) - بالإنجليزية
                  {editingGroup && formData.key !== editingGroup.key && (
                    <span className="mr-2 text-amber-600 text-xs font-normal">⚠ سيتم تحديث جميع الأعمدة المرتبطة</span>
                  )}
                </label>
                <input
                  required
                  type="text"
                  dir="ltr"
                  placeholder="e.g. BASIC, OPS, FINANCE"
                  className={`w-full px-4 py-2 rounded-xl border focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-sm
                    ${editingGroup && formData.key !== editingGroup.key
                      ? 'border-amber-300 bg-amber-50 text-amber-900'
                      : 'border-slate-200 bg-white'}`}
                  value={formData.key}
                  onChange={e => setFormData({ ...formData, key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })}
                />
                {editingGroup && formData.key !== editingGroup.key && (
                  <div className="mt-1.5 flex items-start gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-700 leading-relaxed">
                      تغيير الكود سيحدّث جميع الأعمدة المُصنّفة ضمن هذه المجموعة تلقائياً.
                    </p>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">الاسم بالعربي</label>
                <input
                  required
                  type="text"
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={formData.nameAr}
                  onChange={e => setFormData({ ...formData, nameAr: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">الترتيب</label>
                <input
                  required
                  type="number"
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={formData.sortOrder}
                  onChange={e => setFormData({ ...formData, sortOrder: parseInt(e.target.value) })}
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 bg-indigo-600 text-white py-2 rounded-xl font-bold hover:bg-indigo-700 transition-colors"
                >
                  {editingGroup ? 'تحديث' : 'إنشاء'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 bg-slate-100 text-slate-600 py-2 rounded-xl font-bold hover:bg-slate-200 transition-colors"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
