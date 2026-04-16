import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { motion } from 'motion/react';
import { Users, UserPlus, Key, Power, Edit2, Search, ShieldCheck } from 'lucide-react';
import { useLang } from '../contexts/LangContext';

interface RoleDef {
  roleKey: string;
  nameAr: string;
  nameEn?: string;
  scopeType: string;
  active: boolean;
  isSystem: boolean;
}

const ROLE_BADGE_COLOR = (role: string) => {
  const map: Record<string, string> = {
    ADMIN:          'bg-red-100 text-red-700',
    MANAGER:        'bg-purple-100 text-purple-700',
    OPERATOR:       'bg-blue-100 text-blue-700',
    COORDINATOR:    'bg-indigo-100 text-indigo-700',
    GIS:            'bg-green-100 text-green-700',
    FINANCE:        'bg-yellow-100 text-yellow-700',
    ASSISTANT:      'bg-orange-100 text-orange-700',
    VIEWER:         'bg-slate-100 text-slate-600',
    SECTOR_MANAGER: 'bg-violet-100 text-violet-700',
    REGION_MANAGER: 'bg-teal-100 text-teal-700',
  };
  return map[role] ?? 'bg-gray-100 text-gray-600';
};

export default function AdminUsers() {
  const { lang } = useLang();
  const [users, setUsers]       = useState<any[]>([]);
  const [regions, setRegions]   = useState<any[]>([]);
  const [sectors, setSectors]   = useState<any[]>([]);
  const [roles, setRoles]       = useState<RoleDef[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [showModal, setShowModal]   = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [formData, setFormData] = useState({
    username: '', password: '', fullName: '',
    role: 'OPERATOR', regionId: '', sectorId: '',
    employeeId: '', phoneNumber: '', email: '',
  });

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      const [uRes, rRes, sRes, rolesRes] = await Promise.all([
        api.get('/admin/users'),
        api.get('/admin/regions'),
        api.get('/admin/sectors'),
        api.get('/admin/roles'),
      ]);
      setUsers(uRes.data);
      setRegions(rRes.data);
      setSectors(sRes.data);
      setRoles(rolesRes.data.filter((r: RoleDef) => r.active));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const getRoleLabel = (roleKey: string) => {
    const def = roles.find(r => r.roleKey === roleKey);
    return def ? (lang === 'en' && def.nameEn ? def.nameEn : def.nameAr) : roleKey;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingUser) {
        await api.put(`/admin/users/${editingUser.id}`, formData);
      } else {
        await api.post('/admin/users', formData);
      }
      setShowModal(false);
      setEditingUser(null);
      setFormData({ username: '', password: '', fullName: '', role: 'OPERATOR', regionId: '', sectorId: '', employeeId: '', phoneNumber: '', email: '' });
      fetchData();
    } catch (err) {
      alert(lang === 'en' ? 'An error occurred while saving' : 'حدث خطأ أثناء الحفظ');
    }
  };

  const handleToggleActive = async (id: string) => {
    if (!confirm(lang === 'en' ? 'Are you sure you want to change user status?' : 'هل أنت متأكد من تغيير حالة المستخدم؟')) return;
    try {
      await api.post(`/admin/users/${id}/toggle-active`);
      fetchData();
    } catch { alert(lang === 'en' ? 'Failed to toggle status' : 'فشل تغيير الحالة'); }
  };

  const handleResetPassword = async (id: string) => {
    const newPass = prompt(lang === 'en' ? 'Enter new password:' : 'أدخل كلمة المرور الجديدة:');
    if (!newPass) return;
    try {
      await api.post(`/admin/users/${id}/reset-password`, { password: newPass });
      alert(lang === 'en' ? 'Password reset successfully' : 'تم تغيير كلمة المرور بنجاح');
    } catch { alert(lang === 'en' ? 'Failed to reset password' : 'فشل تغيير كلمة المرور'); }
  };

  const openEdit = (u: any) => {
    setEditingUser(u);
    setFormData({
      username: u.username,
      password: '',
      fullName: u.fullName ?? '',
      role: u.role,
      regionId: u.regionId ?? '',
      sectorId: u.sectorId ?? '',
      employeeId: u.employeeId ?? '',
      phoneNumber: u.phoneNumber ?? '',
      email: u.email ?? '',
    });
    setShowModal(true);
  };

  const filteredUsers = users.filter(u => {
    const q = search.toLowerCase();
    return (
      u.username.toLowerCase().includes(q) ||
      (u.fullName && u.fullName.toLowerCase().includes(q)) ||
      (u.email && u.email.toLowerCase().includes(q)) ||
      (u.employeeId && u.employeeId.toLowerCase().includes(q))
    );
  });

  return (
    <div className="p-4 md:p-8" dir={lang === 'en' ? 'ltr' : 'rtl'}>
      <header className="flex justify-between items-center mb-6 md:mb-8 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Users className="w-8 h-8 text-indigo-600" />
            {lang === 'en' ? 'User Management' : 'إدارة المستخدمين'}
          </h1>
          <p className="text-slate-500">
            {lang === 'en' ? 'Add and edit users and their permissions' : 'إضافة وتعديل المستخدمين وصلاحياتهم'}
          </p>
        </div>
        <button
          data-testid="button-new-user"
          onClick={() => { setEditingUser(null); setFormData({ username: '', password: '', fullName: '', role: roles[0]?.roleKey ?? 'OPERATOR', regionId: '', sectorId: '', employeeId: '', phoneNumber: '', email: '' }); setShowModal(true); }}
          className="bg-indigo-600 text-white px-4 py-2 rounded-xl flex items-center gap-2 hover:bg-indigo-700 transition-colors"
        >
          <UserPlus className="w-5 h-5" />
          {lang === 'en' ? 'New User' : 'مستخدم جديد'}
        </button>
      </header>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100 bg-slate-50/50">
          <div className="relative max-w-md">
            <Search className={`absolute ${lang === 'en' ? 'left-3' : 'right-3'} top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5`} />
            <input
              data-testid="input-user-search"
              type="text"
              placeholder={lang === 'en' ? 'Search for a user...' : 'بحث عن مستخدم...'}
              className={`w-full ${lang === 'en' ? 'pl-10 pr-4' : 'pr-10 pl-4'} py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500`}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <div className="py-16 text-center text-slate-400">{lang === 'en' ? 'Loading...' : 'جاري التحميل...'}</div>
        ) : (
          <div className="overflow-x-auto">
          <table className={`w-full ${lang === 'en' ? 'text-left' : 'text-right'}`} style={{ minWidth: '600px' }}>
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="px-6 py-4 text-sm font-bold text-slate-600">{lang === 'en' ? 'User' : 'المستخدم'}</th>
                <th className="px-6 py-4 text-sm font-bold text-slate-600">{lang === 'en' ? 'Role' : 'الدور'}</th>
                <th className="px-6 py-4 text-sm font-bold text-slate-600">{lang === 'en' ? 'Region' : 'المنطقة'}</th>
                <th className="px-6 py-4 text-sm font-bold text-slate-600">{lang === 'en' ? 'Sector' : 'القطاع'}</th>
                <th className="px-6 py-4 text-sm font-bold text-slate-600">{lang === 'en' ? 'Status' : 'الحالة'}</th>
                <th className="px-6 py-4 text-sm font-bold text-slate-600">{lang === 'en' ? 'Actions' : 'الإجراءات'}</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map(u => (
                <tr key={u.id} data-testid={`row-user-${u.id}`} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="font-medium text-slate-900">{u.fullName || u.username}</div>
                    <div className="text-xs text-slate-500">{u.username}</div>
                    {u.employeeId && <div className="text-xs text-indigo-500 font-medium mt-0.5"># {u.employeeId}</div>}
                    {u.email && <div className="text-xs text-slate-400 mt-0.5">{u.email}</div>}
                    {u.phoneNumber && <div className="text-xs text-slate-400">{u.phoneNumber}</div>}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-lg text-xs font-bold ${ROLE_BADGE_COLOR(u.role)}`}>
                      {getRoleLabel(u.role)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    {regions.find(r => r.id === u.regionId)?.[lang === 'en' ? 'nameEn' : 'nameAr'] || '—'}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    {sectors.find(s => s.id === u.sectorId)?.[lang === 'en' ? 'nameEn' : 'nameAr'] || '—'}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-lg text-xs font-bold ${u.active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                      {u.active ? (lang === 'en' ? 'Active' : 'نشط') : (lang === 'en' ? 'Inactive' : 'معطل')}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <button
                        data-testid={`button-edit-user-${u.id}`}
                        onClick={() => openEdit(u)}
                        className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                        title={lang === 'en' ? 'Edit' : 'تعديل'}
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        data-testid={`button-reset-password-${u.id}`}
                        onClick={() => handleResetPassword(u.id)}
                        className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                        title={lang === 'en' ? 'Reset Password' : 'إعادة تعيين كلمة المرور'}
                      >
                        <Key className="w-4 h-4" />
                      </button>
                      <button
                        data-testid={`button-toggle-active-${u.id}`}
                        onClick={() => handleToggleActive(u.id)}
                        className={`p-2 rounded-lg transition-colors ${u.active ? 'text-slate-400 hover:text-red-600 hover:bg-red-50' : 'text-emerald-600 bg-emerald-50'}`}
                        title={u.active ? (lang === 'en' ? 'Deactivate' : 'تعطيل') : (lang === 'en' ? 'Activate' : 'تفعيل')}
                      >
                        <Power className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredUsers.length === 0 && (
                <tr><td colSpan={6} className="py-12 text-center text-slate-400">{lang === 'en' ? 'No users found' : 'لا يوجد مستخدمون'}</td></tr>
              )}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* ── Modal ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden"
          >
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-xl font-bold text-slate-900">
                {editingUser 
                  ? (lang === 'en' ? 'Edit User' : 'تعديل مستخدم') 
                  : (lang === 'en' ? 'New User' : 'مستخدم جديد')}
              </h2>
              {editingUser && (
                <div className="flex items-center gap-1.5 text-xs">
                  <ShieldCheck size={13} className="text-slate-400"/>
                  <span className={`px-2 py-0.5 rounded-full font-medium ${ROLE_BADGE_COLOR(editingUser.role)}`}>
                    {getRoleLabel(editingUser.role)}
                  </span>
                </div>
              )}
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{lang === 'en' ? 'Username' : 'اسم المستخدم'}</label>
                <input
                  data-testid="input-username"
                  required
                  type="text"
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={formData.username}
                  onChange={e => setFormData({ ...formData, username: e.target.value })}
                />
              </div>
              {!editingUser && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">{lang === 'en' ? 'Password' : 'كلمة المرور'}</label>
                  <input
                    data-testid="input-password"
                    required
                    type="password"
                    className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={formData.password}
                    onChange={e => setFormData({ ...formData, password: e.target.value })}
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{lang === 'en' ? 'Full Name' : 'الاسم الكامل'}</label>
                <input
                  data-testid="input-fullname"
                  type="text"
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={formData.fullName}
                  onChange={e => setFormData({ ...formData, fullName: e.target.value })}
                />
              </div>

              {/* Contact & identity fields */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {lang === 'en' ? 'Employee ID' : 'الرقم الوظيفي'}
                  </label>
                  <input
                    data-testid="input-employee-id"
                    type="text"
                    className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={formData.employeeId}
                    onChange={e => setFormData({ ...formData, employeeId: e.target.value })}
                    placeholder={lang === 'en' ? 'e.g. 12345' : 'مثال: 12345'}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {lang === 'en' ? 'Mobile Number' : 'رقم الجوال'}
                  </label>
                  <input
                    data-testid="input-phone-number"
                    type="tel"
                    className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={formData.phoneNumber}
                    onChange={e => setFormData({ ...formData, phoneNumber: e.target.value })}
                    placeholder="05XXXXXXXX"
                    dir="ltr"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {lang === 'en' ? 'Email' : 'البريد الإلكتروني'}
                </label>
                <input
                  data-testid="input-email"
                  type="email"
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={formData.email}
                  onChange={e => setFormData({ ...formData, email: e.target.value })}
                  placeholder={lang === 'en' ? 'user@example.com' : 'user@example.com'}
                  dir="ltr"
                />
              </div>

              {/* ── Dynamic Role Dropdown ── */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{lang === 'en' ? 'Role' : 'الدور'}</label>
                <select
                  data-testid="select-role"
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={formData.role}
                  onChange={e => setFormData({ ...formData, role: e.target.value })}
                >
                  {roles.map(r => (
                    <option key={r.roleKey} value={r.roleKey}>
                      {lang === 'en' && r.nameEn ? r.nameEn : r.nameAr} ({r.roleKey})
                    </option>
                  ))}
                </select>
                {/* Scope hint for selected role */}
                {(() => {
                  const sel = roles.find(r => r.roleKey === formData.role);
                  if (!sel) return null;
                  const scopeLabel = sel.scopeType === 'ALL' 
                    ? (lang === 'en' ? 'Sees all sectors' : 'يشوف كل القطاعات') 
                    : sel.scopeType === 'OWN_SECTOR' 
                      ? (lang === 'en' ? 'Sees own sector only' : 'يشوف قطاعه فقط') 
                      : (lang === 'en' ? 'Sees own region only' : 'يشوف منطقته فقط');
                  return <p className="text-xs text-slate-500 mt-1">{lang === 'en' ? 'Scope Type' : 'نوع النطاق'}: {scopeLabel}</p>;
                })()}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">{lang === 'en' ? 'Sector' : 'القطاع'}</label>
                  <select
                    data-testid="select-sector"
                    className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={formData.sectorId}
                    onChange={e => setFormData({ ...formData, sectorId: e.target.value, regionId: '' })}
                  >
                    <option value="">{lang === 'en' ? 'All Sectors' : 'جميع القطاعات'}</option>
                    {sectors.map(s => <option key={s.id} value={s.id}>{lang === 'en' && s.nameEn ? s.nameEn : s.nameAr}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">{lang === 'en' ? 'Region' : 'المنطقة'}</label>
                  <select
                    data-testid="select-region"
                    className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={formData.regionId}
                    onChange={e => setFormData({ ...formData, regionId: e.target.value })}
                  >
                    <option value="">{lang === 'en' ? 'All Regions' : 'جميع المناطق'}</option>
                    {regions
                      .filter(r => !formData.sectorId || r.sectorId === formData.sectorId)
                      .map(r => <option key={r.id} value={r.id}>{lang === 'en' && r.nameEn ? r.nameEn : r.nameAr}</option>)
                    }
                  </select>
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  data-testid="button-save-user"
                  type="submit"
                  className="flex-1 bg-indigo-600 text-white py-2 rounded-xl font-bold hover:bg-indigo-700 transition-colors"
                >
                  {editingUser ? (lang === 'en' ? 'Update' : 'تحديث') : (lang === 'en' ? 'Create' : 'إنشاء')}
                </button>
                <button
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
