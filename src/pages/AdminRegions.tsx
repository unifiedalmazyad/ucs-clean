import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { motion } from 'motion/react';
import { Map, Plus, Edit2, Power } from 'lucide-react';
import { useLang } from '../contexts/LangContext';

export default function AdminRegions() {
  const { lang } = useLang();
  const [regions, setRegions] = useState<any[]>([]);
  const [sectors, setSectors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingRegion, setEditingRegion] = useState<any>(null);
  const [formData, setFormData] = useState({ nameAr: '', nameEn: '', sectorId: '', active: true });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [regionsRes, sectorsRes] = await Promise.all([
        api.get('/admin/regions'),
        api.get('/admin/sectors')
      ]);
      setRegions(regionsRes.data);
      setSectors(sectorsRes.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingRegion) {
        await api.put(`/admin/regions/${editingRegion.id}`, formData);
      } else {
        await api.post('/admin/regions', formData);
      }
      setShowModal(false);
      setEditingRegion(null);
      setFormData({ nameAr: '', nameEn: '', sectorId: '', active: true });
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
            <Map className="w-8 h-8 text-indigo-600" />
            {lang === 'en' ? 'Region Management' : 'إدارة المناطق'}
          </h1>
          <p className="text-slate-500">
            {lang === 'en' ? 'Define geographical regions for projects and link them to sectors' : 'تحديد المناطق الجغرافية للمشاريع وربطها بالقطاعات'}
          </p>
        </div>
        <button 
          data-testid="button-new-region"
          onClick={() => { setEditingRegion(null); setFormData({ nameAr: '', nameEn: '', sectorId: '', active: true }); setShowModal(true); }}
          className="bg-indigo-600 text-white px-4 py-2 rounded-xl flex items-center gap-2 hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          {lang === 'en' ? 'New Region' : 'منطقة جديدة'}
        </button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {regions.map((r) => {
          const sector = sectors.find(s => s.id === r.sectorId);
          return (
            <motion.div 
              key={r.id}
              layout
              data-testid={`card-region-${r.id}`}
              className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex justify-between items-center"
            >
              <div>
                <h3 className="font-bold text-slate-900" data-testid={`text-region-name-${r.id}`}>{lang === 'en' && r.nameEn ? r.nameEn : r.nameAr}</h3>
                <p className="text-xs text-slate-500">{lang === 'en' ? r.nameAr : (r.nameEn || '—')}</p>
                <div className="mt-2 flex items-center gap-2">
                  <span 
                    data-testid={`status-region-${r.id}`}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    r.active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                  }`}>
                    {r.active ? (lang === 'en' ? 'Active' : 'نشط') : (lang === 'en' ? 'Inactive' : 'معطل')}
                  </span>
                  {sector && (
                    <span 
                      data-testid={`badge-sector-${r.id}`}
                      className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded text-[10px] font-bold">
                      {lang === 'en' && sector.nameEn ? sector.nameEn : sector.nameAr}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button 
                  data-testid={`button-edit-region-${r.id}`}
                  onClick={() => { setEditingRegion(r); setFormData({ nameAr: r.nameAr, nameEn: r.nameEn || '', sectorId: r.sectorId || '', active: r.active }); setShowModal(true); }}
                  className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button 
                  data-testid={`button-toggle-region-${r.id}`}
                  onClick={async () => {
                    await api.put(`/admin/regions/${r.id}`, { active: !r.active });
                    fetchData();
                  }}
                  className={`p-2 rounded-lg transition-colors ${
                    r.active ? 'text-slate-400 hover:text-red-600 hover:bg-red-50' : 'text-emerald-600 bg-emerald-50'
                  }`}
                >
                  <Power className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          );
        })}
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
                {editingRegion 
                  ? (lang === 'en' ? 'Edit Region' : 'تعديل منطقة') 
                  : (lang === 'en' ? 'New Region' : 'منطقة جديدة')}
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
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {lang === 'en' ? 'Sector' : 'القطاع'}
                </label>
                <select
                  data-testid="select-sector"
                  required
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={formData.sectorId}
                  onChange={e => setFormData({ ...formData, sectorId: e.target.value })}
                >
                  <option value="">{lang === 'en' ? 'Select Sector...' : 'اختر القطاع...'}</option>
                  {sectors.map(s => (
                    <option key={s.id} value={s.id}>{lang === 'en' && s.nameEn ? s.nameEn : s.nameAr}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  data-testid="button-submit"
                  type="submit"
                  className="flex-1 bg-indigo-600 text-white py-2 rounded-xl font-bold hover:bg-indigo-700 transition-colors"
                >
                  {editingRegion 
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
