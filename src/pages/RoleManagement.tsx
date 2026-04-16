import { useState, useEffect, useCallback, type ReactNode } from 'react';
import api from '../services/api';
import { useLang } from '../contexts/LangContext';
import {
  Shield, Plus, Trash2, Users, Settings, Lock, ChevronLeft,
  Eye, EyeOff, Pencil, PencilOff, Check, X, UserPlus, Search,
  Building2, MapPin, Globe, ToggleLeft, ToggleRight, AlertCircle,
  CheckCircle2, XCircle, RefreshCw
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────
interface RoleDef {
  id: string;
  roleKey: string;
  nameAr: string;
  nameEn?: string;
  scopeType: 'ALL' | 'OWN_SECTOR' | 'OWN_REGION';
  canCreateOrder: boolean;
  canDeleteOrder: boolean;
  canEditExecution: boolean;
  canViewExcavationPermits: boolean;
  canEditExcavationPermits: boolean;
  canDeleteExcavationPermits: boolean;
  canViewExecutiveDashboard: boolean;
  canViewExecKpiCards: boolean;
  canViewFinKpiCards:  boolean;
  canViewPeriodicReport: boolean;
  isSystem: boolean;
  active: boolean;
  sortOrder: number;
  userCount?: number;
}

interface ColDef { id: string; columnKey: string; labelAr: string; labelEn?: string; groupKey: string; sortOrder: number; }
interface GroupDef { id: string; key: string; nameAr: string; nameEn?: string; }
interface PermDef { role: string; columnKey: string; canRead: boolean; canWrite: boolean; }
interface UserRow { id: string; username: string; fullName?: string; email?: string; role: string; active: boolean; }

// ─── Helpers ──────────────────────────────────────────────────────────────────
const SCOPE_LABELS: Record<string, { labelAr: string; labelEn: string; icon: ReactNode; color: string }> = {
  ALL:        { labelAr: 'كل القطاعات', labelEn: 'All Sectors', icon: <Globe size={14} />, color: 'text-blue-600 bg-blue-50 border-blue-200' },
  OWN_SECTOR: { labelAr: 'قطاعه فقط',   labelEn: 'Own Sector',   icon: <Building2 size={14} />, color: 'text-purple-600 bg-purple-50 border-purple-200' },
  OWN_REGION: { labelAr: 'منطقته فقط',  labelEn: 'Own Region',  icon: <MapPin size={14} />, color: 'text-green-600 bg-green-50 border-green-200' },
};

function ScopeBadge({ scope }: { scope: string }) {
  const { lang } = useLang();
  const s = SCOPE_LABELS[scope] ?? SCOPE_LABELS.ALL;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border font-medium ${s.color}`}>
      {s.icon}{lang === 'en' ? s.labelEn : s.labelAr}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function RoleManagement() {
  const { lang } = useLang();
  const [roles, setRoles]               = useState<RoleDef[]>([]);
  const [selected, setSelected]         = useState<RoleDef | null>(null);
  const [activeTab, setActiveTab]       = useState<'summary' | 'perms' | 'users'>('summary');
  const [showCreate, setShowCreate]     = useState(false);
  const [loading, setLoading]           = useState(false);

  // permissions tab state
  const [catalog, setCatalog]           = useState<ColDef[]>([]);
  const [groups, setGroups]             = useState<GroupDef[]>([]);
  const [perms, setPerms]               = useState<PermDef[]>([]);
  const [savingPerm, setSavingPerm]     = useState<string>('');

  // users tab state
  const [roleUsers, setRoleUsers]       = useState<UserRow[]>([]);
  const [allUsers, setAllUsers]         = useState<UserRow[]>([]);
  const [userSearch, setUserSearch]     = useState('');
  const [showAddUser, setShowAddUser]   = useState(false);
  const [addingUser, setAddingUser]     = useState<string>('');

  // summary tab edit state
  const [editing, setEditing]           = useState(false);
  const [editForm, setEditForm]         = useState<Partial<RoleDef>>({});

  // delete state
  const [confirmDelete, setConfirmDelete] = useState(false);

  // sync state
  const [syncing, setSyncing]           = useState(false);

  // notification
  const [toast, setToast]               = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const handleSyncColumns = async () => {
    setSyncing(true);
    try {
      await api.post('/admin/columns/sync?table=work_orders');
      showToast(lang === 'en' ? 'Column permissions synced successfully' : 'تمت مزامنة صلاحيات الأعمدة بنجاح');
      if (selected) await selectRole(selected);
    } catch { showToast(lang === 'en' ? 'Sync failed' : 'فشلت المزامنة', false); }
    finally { setSyncing(false); }
  };

  const fetchRoles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/roles');
      setRoles(res.data);
    } catch { /* noop */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchRoles(); }, [fetchRoles]);

  const selectRole = async (role: RoleDef) => {
    setSelected(role);
    setActiveTab('summary');
    setEditing(false);
    setEditForm({});
    setConfirmDelete(false);
    setShowAddUser(false);
    // load permissions & column catalog — independent, load with allSettled
    const [catRes, permRes, groupRes, usersRes] = await Promise.allSettled([
      api.get('/admin/columns'),
      api.get('/admin/permissions/roles'),
      api.get('/admin/column-groups'),
      api.get(`/admin/roles/${role.roleKey}/users`),
    ]);
    if (catRes.status === 'fulfilled') setCatalog(catRes.value.data);
    if (permRes.status === 'fulfilled') setPerms(permRes.value.data);
    if (groupRes.status === 'fulfilled') setGroups(groupRes.value.data);
    if (usersRes.status === 'fulfilled') setRoleUsers(usersRes.value.data);
  };

  const loadAllUsers = async () => {
    const res = await api.get('/admin/users');
    setAllUsers(res.data);
    setShowAddUser(true);
  };

  const getPerm = (columnKey: string) =>
    perms.find(p => p.role === selected?.roleKey && p.columnKey === columnKey);

  const togglePerm = async (columnKey: string, type: 'read' | 'write') => {
    if (!selected) return;
    const key = `${columnKey}-${type}`;
    setSavingPerm(key);
    const existing = getPerm(columnKey);
    const newRead  = type === 'read'  ? !existing?.canRead  : (existing?.canRead ?? false);
    const newWrite = type === 'write' ? !existing?.canWrite : (existing?.canWrite ?? false);
    try {
      // Always use PUT with upsert — handles both new and existing permissions
      await api.put('/admin/permissions/roles', {
        role: selected.roleKey, columnKey,
        canRead: newRead, canWrite: newWrite,
      });
      if (existing) {
        setPerms(prev => prev.map(p =>
          p.role === selected.roleKey && p.columnKey === columnKey
            ? { ...p, canRead: newRead, canWrite: newWrite } : p
        ));
      } else {
        setPerms(prev => [...prev, {
          role: selected.roleKey, columnKey,
          canRead: newRead, canWrite: newWrite,
        }]);
      }
    } catch { showToast(lang === 'en' ? 'Failed to save permission' : 'فشل حفظ الصلاحية', false); }
    finally { setSavingPerm(''); }
  };

  const saveEdit = async () => {
    if (!selected) return;
    try {
      await api.put(`/admin/roles/${selected.roleKey}`, editForm);
      showToast(lang === 'en' ? 'Saved successfully' : 'تم الحفظ');
      setEditing(false);
      await fetchRoles();
      setSelected(prev => prev ? { ...prev, ...editForm } : prev);
    } catch (err: any) {
      showToast(err?.response?.data?.error ?? (lang === 'en' ? 'Failed to save' : 'فشل الحفظ'), false);
    }
  };

  const deleteRole = async () => {
    if (!selected) return;
    try {
      await api.delete(`/admin/roles/${selected.roleKey}`);
      showToast(lang === 'en' ? 'Role deleted' : 'تم حذف الدور');
      setSelected(null);
      await fetchRoles();
    } catch (err: any) {
      showToast(err?.response?.data?.error ?? (lang === 'en' ? 'Failed to delete' : 'فشل الحذف'), false);
    }
    setConfirmDelete(false);
  };

  const assignUser = async (userId: string) => {
    if (!selected) return;
    setAddingUser(userId);
    try {
      await api.put(`/admin/roles/${selected.roleKey}/users/${userId}`, {});
      showToast(lang === 'en' ? 'User added' : 'تم إضافة المستخدم');
      const res = await api.get(`/admin/roles/${selected.roleKey}/users`);
      setRoleUsers(res.data);
      setShowAddUser(false);
      await fetchRoles();
    } catch { showToast(lang === 'en' ? 'Failed to add user' : 'فشل إضافة المستخدم', false); }
    finally { setAddingUser(''); }
  };

  const removeUser = async (userId: string) => {
    if (!selected) return;
    try {
      await api.delete(`/admin/roles/${selected.roleKey}/users/${userId}`);
      showToast(lang === 'en' ? 'User removed' : 'تم إزالة المستخدم');
      setRoleUsers(prev => prev.filter(u => u.id !== userId));
      await fetchRoles();
    } catch { showToast(lang === 'en' ? 'Failed to remove user' : 'فشل إزالة المستخدم', false); }
  };

  const groupedCatalog = groups.map(g => ({
    group: g,
    cols: catalog.filter(c => c.groupKey === g.key),
  })).filter(g => g.cols.length > 0);

  const usersNotInRole = allUsers.filter(
    u => !roleUsers.some(ru => ru.id === u.id) && u.role !== selected?.roleKey
  ).filter(u =>
    !userSearch || u.fullName?.includes(userSearch) || u.username.includes(userSearch)
  );

  return (
    <div className="h-full flex flex-col md:flex-row overflow-hidden" dir={lang === 'en' ? 'ltr' : 'rtl'}>

      {/* ── Toast ── */}
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium
          ${toast.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {toast.ok ? <CheckCircle2 size={16}/> : <XCircle size={16}/>}
          {toast.msg}
        </div>
      )}

      {/* ── LEFT: Roles List ── */}
      <div className={`w-full md:w-56 md:max-h-full max-h-48 bg-white flex flex-col shrink-0 border-b md:border-b-0 ${lang === 'en' ? 'md:border-r' : 'md:border-l'} border-gray-100`}>
        <div className="p-3 border-b border-gray-100 flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            {lang === 'en' ? 'Roles' : 'الأدوار'}
          </span>
          <button
            data-testid="button-add-role"
            onClick={() => setShowCreate(true)}
            className="w-6 h-6 rounded-md bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 transition-colors"
          >
            <Plus size={13}/>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {loading ? (
            <div className="p-4 text-center text-xs text-gray-400">
              {lang === 'en' ? 'Loading...' : 'جاري التحميل...'}
            </div>
          ) : roles.map(role => (
            <button
              key={role.roleKey}
              data-testid={`role-item-${role.roleKey}`}
              onClick={() => selectRole(role)}
              className={`w-full ${lang === 'en' ? 'text-left' : 'text-right'} px-3 py-2.5 flex items-center justify-between transition-colors
                ${selected?.roleKey === role.roleKey
                  ? 'bg-blue-50 text-blue-700 border-l-2 border-blue-600'
                  : 'text-gray-700 hover:bg-gray-50'
                }`}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {lang === 'en' && role.nameEn ? role.nameEn : role.nameAr}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {role.isSystem 
                    ? (lang === 'en' ? '• System' : '• نظام') 
                    : (lang === 'en' ? '• Custom' : '• مخصص')}
                </div>
              </div>
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium
                ${role.userCount ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-400'}`}>
                {role.userCount ?? 0}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── RIGHT: Detail Panel ── */}
      {selected ? (
        <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">

          {/* Header */}
          <div className="bg-white border-b border-gray-100 px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center
                  ${selected.isSystem ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                  <Shield size={20}/>
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">
                    {lang === 'en' && selected.nameEn ? selected.nameEn : selected.nameAr}
                  </h2>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-gray-400 font-mono">{selected.roleKey}</span>
                    <ScopeBadge scope={selected.scopeType} />
                    {!selected.active && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">
                        {lang === 'en' ? 'Inactive' : 'معطل'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!selected.isSystem && !confirmDelete && (
                  <button
                    data-testid="button-delete-role"
                    onClick={() => setConfirmDelete(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                  >
                    <Trash2 size={13}/> {lang === 'en' ? 'Delete Role' : 'حذف الدور'}
                  </button>
                )}
                {confirmDelete && (
                  <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
                    <span className="text-xs text-red-700">
                      {lang === 'en' ? 'Confirm delete?' : 'تأكيد الحذف؟'}
                    </span>
                    <button onClick={deleteRole} className="text-xs px-2 py-0.5 bg-red-600 text-white rounded-md hover:bg-red-700">
                      {lang === 'en' ? 'Yes' : 'نعم'}
                    </button>
                    <button onClick={() => setConfirmDelete(false)} className="text-xs px-2 py-0.5 bg-white text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50">
                      {lang === 'en' ? 'No' : 'لا'}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mt-4">
              {([
                { key: 'summary', labelAr: 'الخلاصة', labelEn: 'Summary', icon: <Settings size={14}/> },
                { key: 'perms',   labelAr: 'الصلاحيات', labelEn: 'Permissions', icon: <Lock size={14}/> },
                { key: 'users',   labelAr: `المستخدمون (${selected.userCount ?? 0})`, labelEn: `Users (${selected.userCount ?? 0})`, icon: <Users size={14}/> },
              ] as const).map(tab => (
                <button
                  key={tab.key}
                  data-testid={`tab-${tab.key}`}
                  onClick={() => { setActiveTab(tab.key); setShowAddUser(false); }}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors
                    ${activeTab === tab.key
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                    }`}
                >
                  {tab.icon}{lang === 'en' ? tab.labelEn : tab.labelAr}
                </button>
              ))}
            </div>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto p-6">

            {/* ── Summary Tab ── */}
            {activeTab === 'summary' && (
              <div className="max-w-2xl space-y-5">
                <div className="bg-white rounded-xl border border-gray-100 p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-gray-800">
                      {lang === 'en' ? 'Role Information' : 'معلومات الدور'}
                    </h3>
                    {!editing ? (
                      <button data-testid="button-edit-role" onClick={() => { setEditing(true); setEditForm({ nameAr: selected.nameAr, nameEn: selected.nameEn, scopeType: selected.scopeType, active: selected.active, canCreateOrder: selected.canCreateOrder, canDeleteOrder: selected.canDeleteOrder, canEditExecution: selected.canEditExecution, canViewExcavationPermits: selected.canViewExcavationPermits, canEditExcavationPermits: selected.canEditExcavationPermits, canDeleteExcavationPermits: selected.canDeleteExcavationPermits, canViewExecutiveDashboard: selected.canViewExecutiveDashboard, canViewExecKpiCards: selected.canViewExecKpiCards !== false, canViewFinKpiCards: selected.canViewFinKpiCards !== false, canViewPeriodicReport: selected.canViewPeriodicReport ?? false, canManageTargets: selected.canManageTargets ?? false }); }}
                        className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 px-3 py-1.5 border border-blue-200 rounded-lg hover:bg-blue-50">
                        <Pencil size={13}/> {lang === 'en' ? 'Edit' : 'تعديل'}
                      </button>
                    ) : (
                      <div className="flex gap-2">
                        <button onClick={saveEdit} className="flex items-center gap-1 text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                          <Check size={13}/> {lang === 'en' ? 'Save' : 'حفظ'}
                        </button>
                        <button onClick={() => setEditing(false)} className="flex items-center gap-1 text-xs px-3 py-1.5 border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50">
                          <X size={13}/> {lang === 'en' ? 'Cancel' : 'إلغاء'}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">
                        {lang === 'en' ? 'Arabic Role Name' : 'اسم الدور بالعربية'}
                      </label>
                      {editing ? (
                        <input data-testid="input-role-name-ar" value={editForm.nameAr ?? ''} onChange={e => setEditForm(p => ({ ...p, nameAr: e.target.value }))}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"/>
                      ) : <p className="text-sm font-medium text-gray-800">{selected.nameAr}</p>}
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">
                        {lang === 'en' ? 'English Role Name' : 'اسم الدور بالإنجليزية'}
                      </label>
                      {editing ? (
                        <input data-testid="input-role-name-en" value={editForm.nameEn ?? ''} onChange={e => setEditForm(p => ({ ...p, nameEn: e.target.value }))}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" dir="ltr"/>
                      ) : <p className="text-sm font-medium text-gray-800">{selected.nameEn ?? '—'}</p>}
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">
                        {lang === 'en' ? 'Scope Type' : 'نوع النطاق'}
                      </label>
                      {editing ? (
                        <select data-testid="select-scope-type" value={editForm.scopeType ?? 'ALL'} onChange={e => setEditForm(p => ({ ...p, scopeType: e.target.value as any }))}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
                          <option value="ALL">{lang === 'en' ? 'All Sectors' : 'كل القطاعات'}</option>
                          <option value="OWN_SECTOR">{lang === 'en' ? 'Own Sector' : 'قطاعه فقط'}</option>
                          <option value="OWN_REGION">{lang === 'en' ? 'Own Region' : 'منطقته فقط'}</option>
                        </select>
                      ) : <ScopeBadge scope={selected.scopeType} />}
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">
                        {lang === 'en' ? 'Role Status' : 'حالة الدور'}
                      </label>
                      {editing ? (
                        <select data-testid="select-role-active" value={editForm.active ? 'true' : 'false'} onChange={e => setEditForm(p => ({ ...p, active: e.target.value === 'true' }))}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
                          <option value="true">{lang === 'en' ? 'Active' : 'فعّال'}</option>
                          <option value="false">{lang === 'en' ? 'Inactive' : 'معطل'}</option>
                        </select>
                      ) : (
                        <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${selected.active ? 'text-green-700' : 'text-gray-500'}`}>
                          {selected.active ? <CheckCircle2 size={15}/> : <XCircle size={15}/>}
                          {selected.active ? (lang === 'en' ? 'Active' : 'فعّال') : (lang === 'en' ? 'Inactive' : 'معطل')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Permissions Summary */}
                <div className="bg-white rounded-xl border border-gray-100 p-5">
                  <h3 className="font-semibold text-gray-800 mb-4">
                    {lang === 'en' ? 'Role Options' : 'خيارات الدور'}
                  </h3>
                  <div className="space-y-3">
                    {[
                      { key: 'canCreateOrder',    labelAr: 'إنشاء أمر عمل', labelEn: 'Create Work Order',        descAr: 'يمكنه إنشاء أوامر عمل جديدة', descEn: 'Can create new work orders' },
                      { key: 'canDeleteOrder',    labelAr: 'يحذف أمر عمل', labelEn: 'Delete Work Order',         descAr: 'يمكنه حذف أوامر العمل', descEn: 'Can delete work orders' },
                      { key: 'canEditExecution',  labelAr: 'تعديل تنفيذ', labelEn: 'Edit Execution',           descAr: 'يمكنه تعديل بيانات التنفيذ', descEn: 'Can edit execution data' },
                      { key: 'canViewExecutiveDashboard', labelAr: 'لوحة الإدارة التنفيذية', labelEn: 'Executive Dashboard', descAr: 'يمكنه عرض لوحة الإدارة التنفيذية المتقدمة', descEn: 'Can view the advanced executive dashboard' },
                      { key: 'canViewExecKpiCards', labelAr: 'بطاقات الجانب التنفيذي', labelEn: 'Executive KPI Cards', descAr: 'يعرض بطاقات الجانب التنفيذي في صفحة أوامر العمل', descEn: 'Show Executive KPI cards in Work Orders page' },
                      { key: 'canViewFinKpiCards',  labelAr: 'بطاقات الجانب المالي',   labelEn: 'Financial KPI Cards',  descAr: 'يعرض بطاقات الجانب المالي في صفحة أوامر العمل',   descEn: 'Show Financial KPI cards in Work Orders page' },
                      { key: 'canViewPeriodicReport', labelAr: 'تقرير الأداء الدوري', labelEn: 'Periodic KPI Report', descAr: 'يمكنه الوصول إلى صفحة تقرير الأداء الدوري', descEn: 'Can access the Periodic KPI Report page' },
                      { key: 'canManageTargets', labelAr: 'تعيين المستهدفات السنوية', labelEn: 'Manage Annual Targets', descAr: 'يمكنه تعديل المستهدفات السنوية التنفيذية والمالية في لوحة الإدارة التنفيذية', descEn: 'Can set and edit annual executive & financial targets in the executive dashboard' },
                    ].map(opt => {
                      const val = editing ? (editForm as any)[opt.key] ?? (selected as any)[opt.key] : (selected as any)[opt.key];
                      return (
                        <div key={opt.key} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 border border-gray-100">
                          <div>
                            <p className="text-sm font-medium text-gray-800">
                              {lang === 'en' ? opt.labelEn : opt.labelAr}
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {lang === 'en' ? opt.descEn : opt.descAr}
                            </p>
                          </div>
                          <button
                            data-testid={`toggle-${opt.key}`}
                            disabled={!editing}
                            onClick={() => editing && setEditForm(p => ({ ...p, [opt.key]: !val }))}
                            className={`transition-colors ${!editing ? 'opacity-60 cursor-default' : 'cursor-pointer'}`}
                          >
                            {val
                              ? <ToggleRight size={28} className="text-blue-600"/>
                              : <ToggleLeft size={28} className="text-gray-300"/>
                            }
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* تصاريح الحفر */}
                <div className="bg-white rounded-xl border border-gray-100 p-5">
                  <h3 className="font-semibold text-gray-800 mb-4">
                    <span className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 4v5M15 4v5"/>
                      </svg>
                      {lang === 'en' ? 'Excavation Permits' : 'تصاريح الحفر'}
                    </span>
                  </h3>
                  <div className="space-y-3">
                    {[
                      { key: 'canViewExcavationPermits',   labelAr: 'عرض تصاريح الحفر', labelEn: 'View Permits',      descAr: 'يمكنه رؤية قسم تصاريح الحفر', descEn: 'Can view excavation permits section' },
                      { key: 'canEditExcavationPermits',   labelAr: 'إضافة / تمديد تصريح', labelEn: 'Add / Extend Permit',   descAr: 'يمكنه إضافة وتعديل وتمديد التصاريح', descEn: 'Can add, edit and extend permits' },
                      { key: 'canDeleteExcavationPermits', labelAr: 'حذف تصريح', labelEn: 'Delete Permit',              descAr: 'يمكنه حذف تصاريح الحفر', descEn: 'Can delete excavation permits' },
                    ].map(opt => {
                      const val = editing ? (editForm as any)[opt.key] ?? (selected as any)[opt.key] : (selected as any)[opt.key];
                      return (
                        <div key={opt.key} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 border border-gray-100">
                          <div>
                            <p className="text-sm font-medium text-gray-800">
                              {lang === 'en' ? opt.labelEn : opt.labelAr}
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {lang === 'en' ? opt.descEn : opt.descAr}
                            </p>
                          </div>
                          <button
                            data-testid={`toggle-${opt.key}`}
                            disabled={!editing}
                            onClick={() => editing && setEditForm(p => ({ ...p, [opt.key]: !val }))}
                            className={`transition-colors ${!editing ? 'opacity-60 cursor-default' : 'cursor-pointer'}`}
                          >
                            {val
                              ? <ToggleRight size={28} className="text-blue-600"/>
                              : <ToggleLeft size={28} className="text-gray-300"/>
                            }
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* يشوف القطاع/المنطقة */}
                <div className="bg-white rounded-xl border border-gray-100 p-5">
                  <h3 className="font-semibold text-gray-800 mb-3">
                    {lang === 'en' ? 'Scope Mode' : 'وضع النطاق'}
                  </h3>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { v: 'ALL',        labelAr: 'كل القطاعات', labelEn: 'All Sectors', icon: <Globe size={18}/>,     color: 'border-blue-300 bg-blue-50 text-blue-700' },
                      { v: 'OWN_SECTOR', labelAr: 'قطاعه فقط',   labelEn: 'Own Sector',   icon: <Building2 size={18}/>, color: 'border-purple-300 bg-purple-50 text-purple-700' },
                      { v: 'OWN_REGION', labelAr: 'منطقته فقط',  labelEn: 'Own Region',  icon: <MapPin size={18}/>,    color: 'border-green-300 bg-green-50 text-green-700' },
                    ].map(opt => {
                      const curr = editing ? editForm.scopeType ?? selected.scopeType : selected.scopeType;
                      const active = curr === opt.v;
                      return (
                        <button
                          key={opt.v}
                          data-testid={`scope-${opt.v}`}
                          disabled={!editing}
                          onClick={() => editing && setEditForm(p => ({ ...p, scopeType: opt.v as any }))}
                          className={`flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all text-sm font-medium
                            ${active ? opt.color : 'border-gray-100 bg-white text-gray-500'}
                            ${editing ? 'cursor-pointer hover:shadow-sm' : 'cursor-default'}`}
                        >
                          {opt.icon}
                          {lang === 'en' ? opt.labelEn : opt.labelAr}
                          {active && <Check size={14}/>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ── Permissions Tab ── */}
            {activeTab === 'perms' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-xs text-amber-800 flex items-start gap-2 flex-1">
                    <AlertCircle size={14} className="mt-0.5 shrink-0"/>
                    <span>
                      {lang === 'en' 
                        ? 'Changes are saved immediately when clicking the eye or pencil icon' 
                        : 'التعديلات تُحفظ فوراً عند الضغط على أيقونة العين أو القلم'}
                    </span>
                  </div>
                  <button
                    data-testid="btn-sync-columns"
                    onClick={handleSyncColumns}
                    disabled={syncing}
                    className="flex items-center gap-2 px-3 py-2 text-xs bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                    {syncing ? (lang === 'en' ? 'Syncing...' : 'جاري المزامنة...') : (lang === 'en' ? 'Sync Columns' : 'مزامنة الأعمدة')}
                  </button>
                </div>
                {groupedCatalog.map(({ group, cols }) => (
                  <div key={group.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                    <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                      <Lock size={14} className="text-gray-400"/>
                      <span className="font-semibold text-sm text-gray-700">
                        {lang === 'en' && group.nameEn ? group.nameEn : group.nameAr}
                      </span>
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-gray-500 border-b border-gray-50">
                          <th className={`text-right px-4 py-2 font-medium ${lang === 'en' ? 'text-left' : 'text-right'}`}>
                            {lang === 'en' ? 'Field' : 'الحقل'}
                          </th>
                          <th className="text-center px-4 py-2 font-medium w-20">
                            {lang === 'en' ? 'Read' : 'قراءة'}
                          </th>
                          <th className="text-center px-4 py-2 font-medium w-20">
                            {lang === 'en' ? 'Write' : 'كتابة'}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {cols.map((col, i) => {
                          const perm = getPerm(col.columnKey);
                          const isSaving = savingPerm.startsWith(col.columnKey);
                          return (
                            <tr key={col.columnKey} className={`border-b border-gray-50 last:border-0 transition-colors
                              ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}>
                              <td className={`px-4 py-2.5 text-gray-700 ${lang === 'en' ? 'text-left' : 'text-right'}`}>
                                {lang === 'en' && col.labelEn ? col.labelEn : col.labelAr}
                              </td>
                              <td className="px-4 py-2.5 text-center">
                                <button
                                  data-testid={`perm-read-${col.columnKey}`}
                                  disabled={isSaving}
                                  onClick={() => togglePerm(col.columnKey, 'read')}
                                  className="inline-flex items-center justify-center w-8 h-8 rounded-lg transition-all hover:scale-105"
                                >
                                  {isSaving && savingPerm === `${col.columnKey}-read`
                                    ? <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"/>
                                    : perm?.canRead
                                      ? <Eye size={16} className="text-blue-600"/>
                                      : <EyeOff size={16} className="text-gray-300"/>
                                  }
                                </button>
                              </td>
                              <td className="px-4 py-2.5 text-center">
                                <button
                                  data-testid={`perm-write-${col.columnKey}`}
                                  disabled={isSaving}
                                  onClick={() => togglePerm(col.columnKey, 'write')}
                                  className="inline-flex items-center justify-center w-8 h-8 rounded-lg transition-all hover:scale-105"
                                >
                                  {isSaving && savingPerm === `${col.columnKey}-write`
                                    ? <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"/>
                                    : perm?.canWrite
                                      ? <Pencil size={16} className="text-green-600"/>
                                      : <PencilOff size={16} className="text-gray-300"/>
                                  }
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}

            {/* ── Users Tab ── */}
            {activeTab === 'users' && (
              <div className="max-w-2xl space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-gray-800">
                    {lang === 'en' ? 'Current Users' : 'المستخدمون الحاليون'}
                  </h3>
                  <button
                    data-testid="button-add-user"
                    onClick={loadAllUsers}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    <UserPlus size={13}/> {lang === 'en' ? 'Add User' : 'إضافة مستخدم'}
                  </button>
                </div>

                {/* Role users list */}
                <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                  {roleUsers.length === 0 ? (
                    <div className="py-10 text-center text-sm text-gray-400">
                      {lang === 'en' ? 'No users in this role' : 'لا يوجد مستخدمون في هذا الدور'}
                    </div>
                  ) : roleUsers.map(u => (
                    <div key={u.id} className="flex items-center justify-between px-4 py-3 border-b border-gray-50 last:border-0">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold text-sm">
                          {(u.fullName ?? u.username)[0]?.toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-800">{u.fullName ?? u.username}</p>
                          <p className="text-xs text-gray-400">{u.username}</p>
                        </div>
                      </div>
                      <button
                        data-testid={`button-remove-user-${u.id}`}
                        onClick={() => removeUser(u.id)}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <X size={14}/>
                      </button>
                    </div>
                  ))}
                </div>

                {/* Add User Panel */}
                {showAddUser && (
                  <div className="bg-white rounded-xl border border-blue-100 overflow-hidden shadow-sm">
                    <div className="px-4 py-3 bg-blue-50 border-b border-blue-100 flex items-center gap-2">
                      <UserPlus size={14} className="text-blue-600"/>
                      <span className="text-sm font-semibold text-blue-800">
                        {lang === 'en' ? 'Select user to add' : 'اختر مستخدماً لإضافته'}
                      </span>
                      <button onClick={() => setShowAddUser(false)} className={`${lang === 'en' ? 'ml-auto' : 'mr-auto'} text-blue-400 hover:text-blue-700`}>
                        <X size={15}/>
                      </button>
                    </div>
                    <div className="p-3">
                      <div className="relative mb-3">
                        <Search size={14} className={`absolute ${lang === 'en' ? 'left-3' : 'right-3'} top-1/2 -translate-y-1/2 text-gray-400`}/>
                        <input
                          data-testid="input-user-search"
                          placeholder={lang === 'en' ? 'Search...' : 'بحث...'}
                          value={userSearch}
                          onChange={e => setUserSearch(e.target.value)}
                          className={`w-full border border-gray-200 rounded-lg ${lang === 'en' ? 'pl-9 pr-3' : 'pr-9 pl-3'} py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300`}
                        />
                      </div>
                      <div className="max-h-52 overflow-y-auto space-y-1">
                        {usersNotInRole.map(u => (
                          <button
                            key={u.id}
                            data-testid={`button-assign-user-${u.id}`}
                            onClick={() => assignUser(u.id)}
                            disabled={addingUser === u.id}
                            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 ${lang === 'en' ? 'text-left' : 'text-right'} transition-colors`}
                          >
                            <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 text-xs font-semibold shrink-0">
                              {(u.fullName ?? u.username)[0]?.toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-800 truncate">{u.fullName ?? u.username}</p>
                              <p className="text-xs text-gray-400 truncate">{u.role}</p>
                            </div>
                            {addingUser === u.id
                              ? <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"/>
                              : <Plus size={14} className="text-blue-600 shrink-0"/>
                            }
                          </button>
                        ))}
                        {usersNotInRole.length === 0 && (
                          <p className="text-center text-sm text-gray-400 py-4">
                            {lang === 'en' ? 'No users available' : 'لا يوجد مستخدمون متاحون'}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-center space-y-3">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto">
              <Shield size={28} className="text-gray-400"/>
            </div>
            <p className="text-sm text-gray-500">
              {lang === 'en' ? 'Select a role from the list to view details' : 'اختر دوراً من القائمة لعرض تفاصيله'}
            </p>
            <button
              data-testid="button-create-first-role"
              onClick={() => setShowCreate(true)}
              className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 mx-auto"
            >
              <Plus size={13}/> {lang === 'en' ? 'Or create a new role' : 'أو أنشئ دوراً جديداً'}
            </button>
          </div>
        </div>
      )}

      {/* ── Create Role Modal ── */}
      {showCreate && <CreateRoleModal onClose={() => setShowCreate(false)} onCreated={async role => {
        setShowCreate(false);
        await fetchRoles();
        await selectRole({ ...role, userCount: 0 });
      }}/>}
    </div>
  );
}

// ─── Create Role Modal ────────────────────────────────────────────────────────
function CreateRoleModal({ onClose, onCreated }: { onClose: () => void; onCreated: (r: RoleDef) => void }) {
  const { lang } = useLang();
  const [form, setForm] = useState({
    nameAr: '', nameEn: '', roleKey: '',
    scopeType: 'OWN_REGION' as 'ALL' | 'OWN_SECTOR' | 'OWN_REGION',
    canCreateOrder: false, canDeleteOrder: false, canEditExecution: true,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const autoKey = (name: string) => name.toUpperCase()
    .replace(/[\u0600-\u06FF]/g, '')
    .trim().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '') || '';

  const handleNameAr = (v: string) => {
    setForm(p => ({ ...p, nameAr: v, roleKey: p.roleKey || autoKey(p.nameEn) }));
  };

  const submit = async () => {
    setError('');
    if (!form.nameAr || !form.roleKey) { 
      setError(lang === 'en' ? 'Arabic name and role key are required' : 'الاسم العربي والمفتاح مطلوبان'); 
      return; 
    }
    setLoading(true);
    try {
      const res = await api.post('/admin/roles', form);
      onCreated(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? (lang === 'en' ? 'Failed to create role' : 'فشل إنشاء الدور'));
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" dir={lang === 'en' ? 'ltr' : 'rtl'}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <Plus size={16} className="text-blue-600"/> {lang === 'en' ? 'Create New Role' : 'إنشاء دور جديد'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18}/></button>
        </div>
        <div className="p-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-200">
              <AlertCircle size={14}/>{error}
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              {lang === 'en' ? 'Arabic Role Name *' : 'اسم الدور بالعربية *'}
            </label>
            <input data-testid="input-new-role-name-ar" value={form.nameAr} onChange={e => handleNameAr(e.target.value)}
              placeholder={lang === 'en' ? 'e.g. Region Manager' : 'مثال: مدير منطقة'}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                {lang === 'en' ? 'English Name' : 'الاسم بالإنجليزية'}
              </label>
              <input data-testid="input-new-role-name-en" value={form.nameEn} onChange={e => setForm(p => ({ ...p, nameEn: e.target.value, roleKey: p.roleKey || autoKey(e.target.value) }))}
                placeholder="Region Manager"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" dir="ltr"/>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                {lang === 'en' ? 'Role Key *' : 'مفتاح الدور *'}
              </label>
              <input data-testid="input-new-role-key" value={form.roleKey} onChange={e => setForm(p => ({ ...p, roleKey: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') }))}
                placeholder="REGION_MGR"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 font-mono" dir="ltr"/>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              {lang === 'en' ? 'Scope Type' : 'نوع النطاق'}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { v: 'ALL', labelAr: 'كل القطاعات', labelEn: 'All Sectors', icon: <Globe size={16}/> },
                { v: 'OWN_SECTOR', labelAr: 'قطاعه فقط', labelEn: 'Own Sector', icon: <Building2 size={16}/> },
                { v: 'OWN_REGION', labelAr: 'منطقته فقط', labelEn: 'Own Region', icon: <MapPin size={16}/> },
              ].map(o => (
                <button key={o.v} data-testid={`new-scope-${o.v}`} type="button"
                  onClick={() => setForm(p => ({ ...p, scopeType: o.v as any }))}
                  className={`flex flex-col items-center gap-1 p-2 rounded-lg border-2 text-xs font-medium transition-all
                    ${form.scopeType === o.v ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-100 text-gray-500 hover:border-gray-200'}`}>
                  {o.icon}{lang === 'en' ? o.labelEn : o.labelAr}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">
              {lang === 'en' ? 'Basic Permissions' : 'الصلاحيات الأساسية'}
            </label>
            {[
              { key: 'canCreateOrder', labelAr: 'إنشاء أمر عمل', labelEn: 'Create Work Order' },
              { key: 'canDeleteOrder', labelAr: 'حذف أمر عمل', labelEn: 'Delete Work Order' },
              { key: 'canEditExecution', labelAr: 'تعديل التنفيذ', labelEn: 'Edit Execution' },
            ].map(o => (
              <label key={o.key} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" data-testid={`check-${o.key}`} checked={(form as any)[o.key]}
                  onChange={e => setForm(p => ({ ...p, [o.key]: e.target.checked }))}
                  className="w-4 h-4 accent-blue-600"/>
                <span className="text-sm text-gray-700">{lang === 'en' ? o.labelEn : o.labelAr}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
            {lang === 'en' ? 'Cancel' : 'إلغاء'}
          </button>
          <button data-testid="button-create-role-submit" onClick={submit} disabled={loading}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 flex items-center gap-1.5">
            {loading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/> : <Check size={14}/>}
            {lang === 'en' ? 'Create Role' : 'إنشاء الدور'}
          </button>
        </div>
      </div>
    </div>
  );
}
