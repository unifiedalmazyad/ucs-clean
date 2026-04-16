import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { Shield, RefreshCw, Copy, Eye, EyeOff, Pencil, PencilOff, ChevronDown, ChevronUp } from 'lucide-react';

const ROLE_META: Record<string, { nameAr: string; color: string; description: string }> = {
  ADMIN:       { nameAr: 'مسؤول النظام', color: 'bg-red-100 text-red-700 border-red-200',       description: 'كامل الصلاحيات' },
  MANAGER:     { nameAr: 'مدير',          color: 'bg-purple-100 text-purple-700 border-purple-200', description: 'إدارة وإشراف' },
  OPERATOR:    { nameAr: 'منفذ',          color: 'bg-blue-100 text-blue-700 border-blue-200',     description: 'تنفيذ الأعمال' },
  COORDINATOR: { nameAr: 'منسق',          color: 'bg-indigo-100 text-indigo-700 border-indigo-200', description: 'تنسيق العمليات' },
  GIS:         { nameAr: 'جي آي إس',      color: 'bg-green-100 text-green-700 border-green-200',  description: 'بيانات جغرافية' },
  FINANCE:     { nameAr: 'مالي',          color: 'bg-yellow-100 text-yellow-700 border-yellow-200', description: 'البيانات المالية' },
  ASSISTANT:   { nameAr: 'مساعد',         color: 'bg-orange-100 text-orange-700 border-orange-200', description: 'وصول محدود' },
  VIEWER:      { nameAr: 'مشاهد',         color: 'bg-slate-100 text-slate-600 border-slate-200',  description: 'قراءة فقط' },
};

const ALL_ROLES = Object.keys(ROLE_META);

export default function AdminPermissions() {
  const [catalog, setCatalog]         = useState<any[]>([]);
  const [permissions, setPermissions] = useState<any[]>([]);
  const [groups, setGroups]           = useState<any[]>([]);
  const [syncing, setSyncing]         = useState(false);
  const [selectedRole, setSelectedRole] = useState<string>('OPERATOR');
  const [copyFromRole, setCopyFromRole] = useState<string>('');
  const [copying, setCopying]         = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [saving, setSaving]           = useState<string>('');

  const fetchData = async () => {
    try {
      const [catRes, permRes, groupRes] = await Promise.all([
        api.get('/admin/columns'),
        api.get('/admin/permissions/roles'),
        api.get('/admin/column-groups'),
      ]);
      setCatalog(catRes.data);
      setPermissions(permRes.data);
      setGroups(groupRes.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const getPerm = (columnKey: string) =>
    permissions.find(p => p.role === selectedRole && p.columnKey === columnKey);

  const toggle = async (columnKey: string, type: 'read' | 'write') => {
    const existing = getPerm(columnKey);
    const canRead  = type === 'read'  ? !(existing?.canRead ?? false) : (existing?.canRead ?? false);
    const canWrite = type === 'write' ? !(existing?.canWrite ?? false) : (existing?.canWrite ?? false);
    setSaving(columnKey + type);
    try {
      await api.put('/admin/permissions/roles', { role: selectedRole, columnKey, canRead, canWrite });
      await fetchData();
    } catch { alert('فشل التحديث'); }
    finally { setSaving(''); }
  };

  const setGroupAll = async (groupKey: string, type: 'read' | 'write', value: boolean) => {
    const cols = catalog.filter(c => c.groupKey === groupKey);
    await Promise.all(cols.map(col => {
      const existing = getPerm(col.columnKey);
      const canRead  = type === 'read'  ? value : (existing?.canRead ?? false);
      const canWrite = type === 'write' ? value : (existing?.canWrite ?? false);
      return api.put('/admin/permissions/roles', { role: selectedRole, columnKey: col.columnKey, canRead, canWrite });
    }));
    await fetchData();
  };

  const handleCopyFrom = async () => {
    if (!copyFromRole || copyFromRole === selectedRole) return;
    if (!confirm(`هل تريد نسخ صلاحيات "${ROLE_META[copyFromRole]?.nameAr}" إلى "${ROLE_META[selectedRole]?.nameAr}"؟ سيتم الكتابة على الصلاحيات الحالية.`)) return;
    setCopying(true);
    try {
      const sourcePems = permissions.filter(p => p.role === copyFromRole);
      await Promise.all(sourcePems.map(p =>
        api.put('/admin/permissions/roles', {
          role: selectedRole,
          columnKey: p.columnKey,
          canRead: p.canRead,
          canWrite: p.canWrite,
        })
      ));
      await fetchData();
      setCopyFromRole('');
    } catch { alert('فشل النسخ'); }
    finally { setCopying(false); }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await api.post('/admin/columns/sync?table=work_orders');
      await fetchData();
    } catch { alert('فشلت المزامنة'); }
    finally { setSyncing(false); }
  };

  const toggleGroup = (key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const rolePerm = (role: string, columnKey: string) =>
    permissions.find(p => p.role === role && p.columnKey === columnKey);

  const roleReadCount  = (role: string) => permissions.filter(p => p.role === role && p.canRead).length;
  const roleWriteCount = (role: string) => permissions.filter(p => p.role === role && p.canWrite).length;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
            <Shield className="w-7 h-7 text-indigo-600" />
            صلاحيات الأدوار
          </h1>
          <p className="text-slate-500 mt-1 text-sm">حدد ما يستطيع كل دور رؤيته وتعديله في النظام</p>
        </div>
        <button
          data-testid="btn-sync-columns"
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'جاري المزامنة...' : 'مزامنة الأعمدة'}
        </button>
      </div>

      {/* Role Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {ALL_ROLES.map(role => {
          const meta    = ROLE_META[role];
          const active  = selectedRole === role;
          const reads   = roleReadCount(role);
          const writes  = roleWriteCount(role);
          return (
            <button
              key={role}
              onClick={() => setSelectedRole(role)}
              className={`text-right p-4 rounded-xl border-2 transition-all ${
                active
                  ? 'border-indigo-500 bg-indigo-50 shadow-md'
                  : 'border-slate-200 bg-white hover:border-indigo-300 hover:shadow-sm'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${meta.color}`}>
                  {role}
                </span>
                {active && <div className="w-2 h-2 bg-indigo-500 rounded-full" />}
              </div>
              <div className="font-bold text-slate-900 text-sm">{meta.nameAr}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">{meta.description}</div>
              <div className="flex gap-3 mt-2 text-[10px] text-slate-400">
                <span className="flex items-center gap-1"><Eye className="w-3 h-3" /> {reads}</span>
                <span className="flex items-center gap-1"><Pencil className="w-3 h-3" /> {writes}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected Role Header */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-4 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={`text-sm font-bold px-3 py-1 rounded-full border ${ROLE_META[selectedRole]?.color}`}>
            {ROLE_META[selectedRole]?.nameAr}
          </span>
          <span className="text-sm text-slate-500">
            {roleReadCount(selectedRole)} حقل للقراءة · {roleWriteCount(selectedRole)} حقل للكتابة
          </span>
        </div>
        {selectedRole !== 'ADMIN' && (
          <div className="flex items-center gap-2">
            <Copy className="w-4 h-4 text-slate-400" />
            <span className="text-sm text-slate-500">نسخ من:</span>
            <select
              value={copyFromRole}
              onChange={e => setCopyFromRole(e.target.value)}
              className="text-sm px-3 py-1.5 border border-slate-200 rounded-lg bg-slate-50 outline-none"
            >
              <option value="">اختر دوراً...</option>
              {ALL_ROLES.filter(r => r !== selectedRole).map(r => (
                <option key={r} value={r}>{ROLE_META[r]?.nameAr}</option>
              ))}
            </select>
            <button
              onClick={handleCopyFrom}
              disabled={!copyFromRole || copying}
              className="text-sm px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors"
            >
              {copying ? 'جاري النسخ...' : 'نسخ'}
            </button>
          </div>
        )}
      </div>

      {/* Column Groups */}
      <div className="space-y-3">
        {groups.map(group => {
          const cols      = catalog.filter(c => c.groupKey === group.key);
          const collapsed = collapsedGroups.has(group.key);
          if (cols.length === 0) return null;
          const groupReads  = cols.filter(c => getPerm(c.columnKey)?.canRead).length;
          const groupWrites = cols.filter(c => getPerm(c.columnKey)?.canWrite).length;

          return (
            <div key={group.key} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              {/* Group Header */}
              <div className="flex items-center justify-between px-5 py-3 bg-slate-50 border-b border-slate-200">
                <button
                  onClick={() => toggleGroup(group.key)}
                  className="flex items-center gap-2 font-semibold text-slate-800 hover:text-indigo-600 transition-colors"
                >
                  {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                  {group.nameAr}
                  <span className="text-xs font-normal text-slate-400">({cols.length} حقل)</span>
                </button>
                {selectedRole !== 'ADMIN' && !collapsed && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-400">{groupReads} قراءة · {groupWrites} كتابة</span>
                    <button onClick={() => setGroupAll(group.key, 'read', true)}  className="px-2 py-1 bg-emerald-50 text-emerald-600 rounded hover:bg-emerald-100 transition-colors flex items-center gap-1"><Eye className="w-3 h-3" /> تفعيل الكل</button>
                    <button onClick={() => setGroupAll(group.key, 'read', false)} className="px-2 py-1 bg-red-50 text-red-500 rounded hover:bg-red-100 transition-colors flex items-center gap-1"><EyeOff className="w-3 h-3" /> إيقاف القراءة</button>
                    <button onClick={() => setGroupAll(group.key, 'write', true)}  className="px-2 py-1 bg-indigo-50 text-indigo-600 rounded hover:bg-indigo-100 transition-colors flex items-center gap-1"><Pencil className="w-3 h-3" /> تفعيل الكتابة</button>
                    <button onClick={() => setGroupAll(group.key, 'write', false)} className="px-2 py-1 bg-slate-100 text-slate-500 rounded hover:bg-slate-200 transition-colors flex items-center gap-1"><PencilOff className="w-3 h-3" /> إيقاف الكتابة</button>
                  </div>
                )}
              </div>

              {/* Columns */}
              {!collapsed && (
                <div className="divide-y divide-slate-100">
                  {cols.map(col => {
                    const perm     = getPerm(col.columnKey);
                    const canRead  = selectedRole === 'ADMIN' ? true : (perm?.canRead ?? false);
                    const canWrite = selectedRole === 'ADMIN' ? true : (perm?.canWrite ?? false);
                    const isAdmin  = selectedRole === 'ADMIN';
                    const isSaving = saving === col.columnKey + 'read' || saving === col.columnKey + 'write';

                    return (
                      <div key={col.columnKey} className={`flex items-center justify-between px-5 py-3 transition-colors ${isSaving ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
                        <div>
                          <span className="text-sm font-medium text-slate-900">{col.labelAr}</span>
                          <span className="text-xs text-slate-400 mr-2 font-mono">{col.columnKey}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          {/* Read Toggle */}
                          <label className="flex items-center gap-2 cursor-pointer select-none">
                            <span className="text-xs text-slate-500">قراءة</span>
                            <button
                              disabled={isAdmin || isSaving}
                              onClick={() => toggle(col.columnKey, 'read')}
                              className={`relative w-10 h-5 rounded-full transition-colors ${
                                canRead ? 'bg-emerald-500' : 'bg-slate-200'
                              } disabled:cursor-not-allowed`}
                            >
                              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${
                                canRead ? 'right-0.5' : 'left-0.5'
                              }`} />
                            </button>
                          </label>
                          {/* Write Toggle */}
                          <label className="flex items-center gap-2 cursor-pointer select-none">
                            <span className="text-xs text-slate-500">كتابة</span>
                            <button
                              disabled={isAdmin || isSaving}
                              onClick={() => toggle(col.columnKey, 'write')}
                              className={`relative w-10 h-5 rounded-full transition-colors ${
                                canWrite ? 'bg-indigo-500' : 'bg-slate-200'
                              } disabled:cursor-not-allowed`}
                            >
                              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${
                                canWrite ? 'right-0.5' : 'left-0.5'
                              }`} />
                            </button>
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
