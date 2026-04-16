import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { motion } from 'motion/react';
import { Layers, Plus, Edit2, Power } from 'lucide-react';
import { useLang } from '../contexts/LangContext';

export default function AdminSectors() {
  const { lang } = useLang();
  const [sectors, setSectors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingSector, setEditingSector] = useState<any>(null);
  const [formData, setFormData] = useState({ nameAr: '', nameEn: '', active: true });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const res = await api.get('/admin/sectors');
      setSectors(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingSector) {
        await api.put(`/admin/sectors/${editingSector.id}`, formData);
      } else {
        await api.post('/admin/sectors', formData);
      }
      setShowModal(false);
      setEditingSector(null);
      setFormData({ nameAr: '', nameEn: '', active: true });
      fetchData();
    } catch (err) {
      alert(lang === 'en' ? 'An error occurred while saving' : 'حدث خطأ أثناء الحفظ');
    }
  };

  return (
    <div className="p-4 md:p-8" dir={lang === 'en' ? 'ltr' : 'rtl'}>
      <header className="flex justify-between items-center mb-6 md:mb-8 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Layers className="w-8 h-8 text-indigo-600" />
            {lang === 'en' ? 'Sector Management' : 'إدارة القطاعات'}
          </h1>
          <p className="text-slate-500">
            {lang === 'en' ? 'Define administrative sectors for projects' : 'تحديد القطاعات الإدارية للمشاريع'}
          </p>
        </div>
        <button 
          data-testid="button-new-sector"
          onClick={() => { setEditingSector(null); setFormData({ nameAr: '', nameEn: '', active: true }); setShowModal(true); }}
          className="bg-indigo-600 text-white px-4 py-2 rounded-xl flex items-center gap-2 hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          {lang === 'en' ? 'New Sector' : 'قطاع جديد'}
        </button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {sectors.map((s) => (
          <motion.div 
            key={s.id}
            layout
            data-testid={`card-sector-${s.id}`}
            className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex justify-between items-center"
          >
            <div>
              <h3 className="font-bold text-slate-900" data-testid={`text-sector-name-${s.id}`}>{lang === 'en' && s.nameEn ? s.nameEn : s.nameAr}</h3>
              <p className="text-xs text-slate-500">{lang === 'en' ? s.nameAr : (s.nameEn || '—')}</p>
              <span 
                data-testid={`status-sector-${s.id}`}
                className={`inline-block mt-2 px-2 py-0.5 rounded text-[10px] font-bold ${
                s.active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
              }`}>
                {s.active ? (lang === 'en' ? 'Active' : 'نشط') : (lang === 'en' ? 'Inactive' : 'معطل')}
              </span>
            </div>
            <div className="flex gap-2">
              <button 
                data-testid={`button-edit-sector-${s.id}`}
                onClick={() => { setEditingSector(s); setFormData({ nameAr: s.nameAr, nameEn: s.nameEn || '', active: s.active }); setShowModal(true); }}
                className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
              >
                <Edit2 className="w-4 h-4" />
              </button>
              <button 
                data-testid={`button-toggle-sector-${s.id}`}
                onClick={async () => {
                  await api.put(`/admin/sectors/${s.id}`, { active: !s.active });
                  fetchData();
                }}
                className={`p-2 rounded-lg transition-colors ${
                  s.active ? 'text-slate-400 hover:text-red-600 hover:bg-red-50' : 'text-emerald-600 bg-emerald-50'
                }`}
              >
                <Power className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        ))}
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
                {editingSector 
                  ? (lang === 'en' ? 'Edit Sector' : 'تعديل قطاع') 
                  : (lang === 'en' ? 'New Sector' : 'قطاع جديد')}
              </h2>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {lang === 'en' ? 'Arabic Name' : 'الاسم بالعربي'}
                </label>
                <input
                  data-testid="input-name-ar"
                  required
                  type="text"
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={formData.nameAr}
                  onChange={e => setFormData({ ...formData, nameAr: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {lang === 'en' ? 'English Name (optional)' : 'الاسم بالإنجليزي (اختياري)'}
                </label>
                <input
                  data-testid="input-name-en"
                  type="text"
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={formData.nameEn}
                  onChange={e => setFormData({ ...formData, nameEn: e.target.value })}
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  data-testid="button-submit"
                  type="submit"
                  className="flex-1 bg-indigo-600 text-white py-2 rounded-xl font-bold hover:bg-indigo-700 transition-colors"
                >
                  {editingSector 
                    ? (lang === 'en' ? 'Update' : 'تحديث') 
                    : (lang === 'en' ? 'Create' : 'إنشاء')}
                </button>
                <button
                  data-testid="button-cancel"
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 bg-slate-100 text-slate-600 py-2 rounded-xl font-bold hover:bg-slate-200 transition-colors"
                >
                  {lang === 'en' ? 'Cancel' : 'إلغاء'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
