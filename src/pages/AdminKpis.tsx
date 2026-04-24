import { useLang } from '../contexts/LangContext';
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { motion, AnimatePresence } from 'motion/react';
import {
  Target, Plus, X, AlertTriangle, BarChart2, LayoutDashboard, ClipboardList,
  Settings2, Save, RefreshCw, Trash2,
} from 'lucide-react';


type Scope = 'ORDER' | 'REPORT' | 'DASHBOARD' | 'PERIODIC';

const SCOPES: { key: Scope; labelAr: string; labelEn: string; descAr: string; descEn: string; icon: React.ReactNode }[] = [
  { 
    key: 'ORDER',     
    labelAr: 'مؤشرات أمر العمل',          
    labelEn: 'Work Order KPIs',
    descAr: 'تُحسب لكل أمر عمل على حدة وتظهر في صفحة تفاصيله',              
    descEn: 'Calculated per work order and shown in details page',
    icon: <ClipboardList className="w-4 h-4" /> 
  },
  { 
    key: 'REPORT',    
    labelAr: 'المؤشرات الإجمالية',         
    labelEn: 'Summary KPIs',
    descAr: 'مؤشرات تجميعية للمديرين تظهر في صفحة تقارير الأداء',           
    descEn: 'Aggregate metrics for managers shown in reports page',
    icon: <BarChart2 className="w-4 h-4" /> 
  },
  { 
    key: 'DASHBOARD', 
    labelAr: 'بطاقات لوحة التحكم',         
    labelEn: 'Dashboard Cards',
    descAr: 'تتحكم في بطاقات المنتظم/تنبيه/متأخر/منجز/ملغي في رأس الصفحة', 
    descEn: 'Controls On Track/Warning/Overdue/Done/Cancelled cards',
    icon: <LayoutDashboard className="w-4 h-4" /> 
  },
  { 
    key: 'PERIODIC',  
    labelAr: 'تقرير الأداء الدوري',        
    labelEn: 'Periodic Report',
    descAr: 'إعدادات مؤشرات الأداء الدوري (أسبوعي/شهري) — مستقلة تماماً',   
    descEn: 'Periodic performance settings (weekly/monthly) - fully independent',
    icon: <Settings2 className="w-4 h-4" /> 
  },
];

const SCOPE_STYLES: Record<Scope, { tab: string; badge: string; addBtn: string; sectionBg: string }> = {
  ORDER:     { tab: 'border-indigo-600 text-indigo-700',  badge: 'bg-indigo-100 text-indigo-700',   addBtn: 'bg-indigo-600 hover:bg-indigo-700',  sectionBg: 'bg-indigo-50 border-indigo-100'  },
  REPORT:    { tab: 'border-violet-600 text-violet-700',  badge: 'bg-violet-100 text-violet-700',   addBtn: 'bg-violet-600 hover:bg-violet-700',  sectionBg: 'bg-violet-50 border-violet-100'  },
  DASHBOARD: { tab: 'border-emerald-600 text-emerald-700',badge: 'bg-emerald-100 text-emerald-700', addBtn: 'bg-emerald-600 hover:bg-emerald-700', sectionBg: 'bg-emerald-50 border-emerald-100' },
  PERIODIC:  { tab: 'border-amber-600 text-amber-700',    badge: 'bg-amber-100 text-amber-700',     addBtn: 'bg-amber-600 hover:bg-amber-700',    sectionBg: 'bg-amber-50 border-amber-100'    },
};

interface ProjectTypeSla {
  value: string;
  labelAr: string;
  enabled: boolean;
  slaDays: number;
}

const EMPTY_TEMPLATE = { nameAr: '', category: 'EXEC' };
const EMPTY_RULE_BASE = { startMode: 'COLUMN_DATE', startColumnKey: '', startStageId: '', endMode: 'COLUMN_DATE', endColumnKey: '', calcMode: 'DATES' };

// ─────────────────────────────────────────────────────────────────────────────
// DashboardKpiConfig — specialized admin UI for the DASHBOARD scope
// ─────────────────────────────────────────────────────────────────────────────
function DashboardKpiConfig({
  templates, rules, catalog, stages, projectTypeOptions, onRefresh,
}: {
  templates: any[]; rules: any[]; catalog: any[]; stages: any[];
  projectTypeOptions: any[]; onRefresh: () => void;
}) {
  const { lang } = useLang();
  const [saving, setSaving] = useState<string | null>(null); // rule id being saved
  const [creating, setCreating] = useState(false);
  // Draft state: pending changes per rule before explicit save
  const [drafts, setDrafts] = useState<Record<string, any>>({});

  const setDraft = (ruleId: string, field: string, value: any) => {
    setDrafts(prev => ({ ...prev, [ruleId]: { ...(prev[ruleId] ?? {}), [field]: value } }));
  };
  const getDraft = (rule: any, field: string) => drafts[rule.id]?.[field] !== undefined ? drafts[rule.id][field] : rule[field];
  const hasDraft = (ruleId: string) => !!(drafts[ruleId] && Object.keys(drafts[ruleId]).length > 0);

  const execTemplate = templates.find(t => t.displayScope === 'DASHBOARD' && t.category === 'EXEC');
  const finTemplate  = templates.find(t => t.displayScope === 'DASHBOARD' && t.category === 'FIN');
  const execRules    = execTemplate ? rules.filter(r => r.templateId === execTemplate.id) : [];
  const finRules     = finTemplate  ? rules.filter(r => r.templateId === finTemplate.id)  : [];

  const dateColumns  = catalog.filter(c => ['date', 'timestamp', 'timestamp with time zone'].includes(c.dataType));

  // Auto-create default DASHBOARD templates + seed SLA rules for all project types
  const seedDefaults = async () => {
    setCreating(true);
    try {
      // Default EXEC SLAs per project type
      const EXEC_SLA_DEFAULTS: Record<string, number> = {
        'low_effort':     15,
        'medium_effort':  35,
        'meter_install':   1,
        'replacement':    80,
        'reinforcement':  90,
        'connection':    105,
      };

      // Create EXEC template
      let execTplId = execTemplate?.id;
      if (!execTplId) {
        const r = await api.post('/admin/kpi-templates', {
          nameAr: 'المؤشر التنفيذي', 
          nameEn: 'Executive Indicator',
          category: 'EXEC',
          defaultSlaDays: 30, seq: 1, active: true, displayScope: 'DASHBOARD',
        });
        execTplId = r.data.id;
      }

      // Create EXEC rules per project type (if not already exist)
      for (const pt of projectTypeOptions) {
        const exists = execRules.find(r => r.workTypeFilter === pt.value);
        if (!exists && execTplId) {
          const sla = EXEC_SLA_DEFAULTS[pt.value] ?? 30;
          await api.post('/admin/kpi-rules', {
            templateId: execTplId, category: 'EXEC',
            startColumnKey: catalog.find(c => c.dataType === 'date')?.columnKey ?? '',
            endMode: 'COLUMN_DATE', calcMode: 'DATES',
            workTypeFilter: pt.value, slaDaysOverride: sla,
            warnThresholdDays: 5, active: true, showOnDashboard: true,
          });
        }
      }

      // Create FIN template
      let finTplId = finTemplate?.id;
      if (!finTplId) {
        const r = await api.post('/admin/kpi-templates', {
          nameAr: 'المؤشر المالي', 
          nameEn: 'Financial Indicator',
          category: 'FIN',
          defaultSlaDays: 20, seq: 2, active: true, displayScope: 'DASHBOARD',
        });
        finTplId = r.data.id;
      }

      // Create single FIN rule (if not exist)
      if (finRules.length === 0 && finTplId) {
        await api.post('/admin/kpi-rules', {
          templateId: finTplId, category: 'FIN',
          startColumnKey: catalog.find(c => c.dataType === 'date')?.columnKey ?? '',
          endMode: 'COLUMN_DATE', calcMode: 'DATES',
          workTypeFilter: null, slaDaysOverride: 20,
          warnThresholdDays: 3, active: true, showOnDashboard: true,
        });
      }

      onRefresh();
    } catch (err: any) {
      alert((lang === 'en' ? 'Failed to create settings: ' : 'فشل إنشاء الإعدادات: ') + (err?.response?.data?.error || err.message));
    } finally {
      setCreating(false);
    }
  };

  const updateRule = async (id: string, data: any) => {
    setSaving(id);
    try {
      await api.put(`/admin/kpi-rules/${id}`, data);
      // Clear draft for this rule after successful save
      setDrafts(prev => { const next = { ...prev }; delete next[id]; return next; });
      onRefresh();
    } catch {
      alert(lang === 'en' ? 'Update failed' : 'فشل التحديث');
    } finally {
      setSaving(null);
    }
  };

  const saveRuleDraft = (ruleId: string) => {
    if (drafts[ruleId]) updateRule(ruleId, drafts[ruleId]);
  };

  const addExecRule = async (projectTypeValue: string) => {
    if (!execTemplate) { alert(lang === 'en' ? 'Create default settings first' : 'أنشئ الإعدادات الافتراضية أولاً'); return; }
    setSaving('new-' + projectTypeValue);
    try {
      await api.post('/admin/kpi-rules', {
        templateId: execTemplate.id, category: 'EXEC',
        startColumnKey: dateColumns[0]?.columnKey ?? '',
        endMode: 'COLUMN_DATE', calcMode: 'DATES',
        workTypeFilter: projectTypeValue, slaDaysOverride: 30,
        warnThresholdDays: 5, active: true, showOnDashboard: true,
      });
      onRefresh();
    } catch (err: any) {
      alert((lang === 'en' ? 'Failed to add: ' : 'فشل الإضافة: ') + (err?.response?.data?.error || err.message));
    } finally {
      setSaving(null);
    }
  };

  // ─── No dashboard config yet ───────────────────────────────────────────────
  if (!execTemplate && !finTemplate) {
    return (
      <div className={`text-center py-16 bg-white rounded-2xl border border-dashed border-emerald-200 ${lang === 'en' ? 'ltr' : 'rtl'}`}>
        <LayoutDashboard className="w-12 h-12 text-emerald-300 mx-auto mb-3" />
        <h3 className="text-lg font-bold text-slate-700 mb-1">
          {lang === 'en' ? 'Dashboard settings not configured yet' : 'لم يتم تكوين إعدادات لوحة التحكم بعد'}
        </h3>
        <p className="text-sm text-slate-500 mb-6 max-w-sm mx-auto">
          {lang === 'en' 
            ? 'Click the button below to create default settings based on defined project types. You can modify durations after creation.'
            : 'اضغط الزر أدناه لإنشاء الإعدادات الافتراضية بناءً على أنواع المشاريع المعرّفة. يمكنك تعديل المدد الزمنية بعد الإنشاء.'}
        </p>
        <button
          onClick={seedDefaults}
          disabled={creating}
          className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-xl font-medium flex items-center gap-2 mx-auto transition-colors disabled:opacity-50"
        >
          {creating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {creating 
            ? (lang === 'en' ? 'Creating...' : 'جاري الإنشاء...') 
            : (lang === 'en' ? 'Create Default Settings' : 'إنشاء الإعدادات الافتراضية')}
        </button>
      </div>
    );
  }

  const ruleRow = (rule: any, projectTypeLabel?: string, showType = true) => {
    const endMode    = getDraft(rule, 'endMode');
    const endModeStage = endMode === 'STAGE';
    const isSaving   = saving === rule.id;
    const dirty      = hasDraft(rule.id);
    return (
      <tr key={rule.id} className={`border-b border-slate-100 last:border-0 transition-colors ${dirty ? 'bg-amber-50/60' : 'hover:bg-slate-50/50'}`}>
        {showType && (
          <td className="px-4 py-3 text-sm font-medium text-slate-700">
            {projectTypeLabel ?? 'جميع الأنواع'}
          </td>
        )}
        {/* SLA */}
        <td className="px-4 py-3">
          <input
            type="number" min="1"
            value={getDraft(rule, 'slaDaysOverride') ?? ''}
            placeholder="—"
            onChange={e => setDraft(rule.id, 'slaDaysOverride', e.target.value ? parseInt(e.target.value) : null)}
            className="w-20 px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-center bg-white focus:ring-1 focus:ring-emerald-400 outline-none"
          />
        </td>
        {/* Warn threshold days */}
        <td className="px-4 py-3">
          <input
            type="number" min="0"
            value={getDraft(rule, 'warnThresholdDays') ?? ''}
            placeholder="—"
            onChange={e => setDraft(rule.id, 'warnThresholdDays', e.target.value ? parseInt(e.target.value) : null)}
            className="w-20 px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-center bg-white focus:ring-1 focus:ring-amber-400 outline-none"
          />
        </td>
        {/* Start column */}
        <td className="px-4 py-3">
          <select
            value={getDraft(rule, 'startColumnKey') || ''}
            onChange={e => setDraft(rule.id, 'startColumnKey', e.target.value)}
            className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm min-w-[140px] focus:ring-1 focus:ring-emerald-400 outline-none"
          >
            <option value="">{lang === 'en' ? 'Select column...' : 'اختر العمود...'}</option>
            {dateColumns.map(c => <option key={c.columnKey} value={c.columnKey}>{lang === 'en' && c.labelEn ? c.labelEn : c.labelAr}</option>)}
          </select>
        </td>
        {/* End mode */}
        <td className="px-4 py-3">
          <select
            value={endMode || 'COLUMN_DATE'}
            onChange={e => setDraft(rule.id, 'endMode', e.target.value)}
            className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-emerald-400 outline-none"
          >
            <option value="COLUMN_DATE">{lang === 'en' ? 'Date Column' : 'عمود تاريخ'}</option>
            <option value="STAGE">{lang === 'en' ? 'Stage' : 'إجراء / مرحلة'}</option>
          </select>
        </td>
        {/* End column or stage */}
        <td className="px-4 py-3">
          {endModeStage ? (
            <select
              value={getDraft(rule, 'endStageId') || ''}
              onChange={e => setDraft(rule.id, 'endStageId', e.target.value || null)}
              className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm min-w-[140px] focus:ring-1 focus:ring-emerald-400 outline-none"
            >
              <option value="">{lang === 'en' ? 'Select stage...' : 'اختر الإجراء...'}</option>
              {stages.map(s => <option key={s.id} value={s.id}>{lang === 'en' && s.nameEn ? s.nameEn : s.nameAr}</option>)}
            </select>
          ) : (
            <select
              value={getDraft(rule, 'endColumnKey') || ''}
              onChange={e => setDraft(rule.id, 'endColumnKey', e.target.value || null)}
              className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm min-w-[140px] focus:ring-1 focus:ring-emerald-400 outline-none"
            >
              <option value="">{lang === 'en' ? 'Today (Continuous)' : 'اليوم (مستمر)'}</option>
              {dateColumns.map(c => <option key={c.columnKey} value={c.columnKey}>{lang === 'en' && c.labelEn ? c.labelEn : c.labelAr}</option>)}
            </select>
          )}
        </td>
        {/* Active */}
        <td className="px-4 py-3 text-center">
          <input
            type="checkbox" checked={getDraft(rule, 'active') ?? true}
            onChange={e => setDraft(rule.id, 'active', e.target.checked)}
            className="w-4 h-4 rounded accent-emerald-600"
          />
        </td>
        {/* Save button — only visible when there are pending changes */}
        <td className="px-3 py-3 text-center">
          {isSaving ? (
            <RefreshCw className="w-3.5 h-3.5 text-emerald-500 animate-spin mx-auto" />
          ) : dirty ? (
            <button
              onClick={() => saveRuleDraft(rule.id)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-3 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap"
            >
              {lang === 'en' ? 'Save' : 'حفظ'}
            </button>
          ) : (
            <span className="text-slate-300 text-xs">—</span>
          )}
        </td>
      </tr>
    );
  };

  const tableHeader = (showType = true) => (
    <tr className="border-b border-slate-200 bg-slate-50">
      {showType && <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">{lang === 'en' ? 'Project Type' : 'نوعية المشروع'}</th>}
      <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">{lang === 'en' ? 'SLA (Days)' : 'SLA (يوم)'}</th>
      <th className="px-4 py-2.5 text-right text-xs font-medium text-amber-600">{lang === 'en' ? 'Warning Before (Days)' : 'تنبيه قبل (يوم)'}</th>
      <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">{lang === 'en' ? 'Start Calculation' : 'بداية الحساب'}</th>
      <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">{lang === 'en' ? 'End Method' : 'طريقة النهاية'}</th>
      <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">{lang === 'en' ? 'End Calculation' : 'نهاية الحساب'}</th>
      <th className="px-4 py-2.5 text-center text-xs font-medium text-slate-500">{lang === 'en' ? 'Active' : 'نشط'}</th>
      <th className="px-3 py-2.5 text-center text-xs font-medium text-slate-400"></th>
    </tr>
  );

  return (
    <div className="space-y-6">
      {/* ── EXEC section ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="bg-indigo-50 px-6 py-4 border-b border-indigo-100 flex justify-between items-center">
          <div>
            <h2 className="font-bold text-indigo-800">{lang === 'en' ? 'Executive Side' : 'الجانب التنفيذي'}</h2>
            <p className="text-xs text-indigo-600 mt-0.5">{lang === 'en' ? 'Different SLA duration for each project type' : 'مدة SLA مختلفة لكل نوعية مشروع'}</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>{tableHeader()}</thead>
            <tbody>
              {projectTypeOptions.map((pt: any) => {
                const existingRule = execRules.find(r => r.workTypeFilter === pt.value);
                if (existingRule) {
                  return ruleRow(existingRule, lang === 'en' && pt.labelEn ? pt.labelEn : pt.labelAr);
                }
                return (
                  <tr key={pt.value} className="border-b border-slate-100 last:border-0 bg-slate-50/30">
                    <td className="px-4 py-3 text-sm text-slate-500">{lang === 'en' && pt.labelEn ? pt.labelEn : pt.labelAr}</td>
                    <td colSpan={6} className="px-4 py-3">
                      <button
                        onClick={() => addExecRule(pt.value)}
                        disabled={saving === 'new-' + pt.value}
                        className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1 transition-colors"
                      >
                        {saving === 'new-' + pt.value
                          ? <><RefreshCw className="w-3 h-3 animate-spin" /> {lang === 'en' ? 'Adding...' : 'جاري الإضافة...'}</>
                          : <><Plus className="w-3 h-3" /> {lang === 'en' ? 'Add indicator for this type' : 'إضافة مؤشر لهذه النوعية'}</>
                        }
                      </button>
                    </td>
                  </tr>
                );
              })}

              {projectTypeOptions.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-400">
                    {lang === 'en' ? 'No project types defined - add them from column settings' : 'لا توجد أنواع مشاريع معرّفة — أضفها من إعدادات الأعمدة'}
                  </td>
                </tr>
              )}

              {/* Global/fallback EXEC rule (no workTypeFilter) */}
              {execRules.filter(r => !r.workTypeFilter).map(r => ruleRow(r, lang === 'en' ? 'All Types (Default)' : 'جميع الأنواع (افتراضي)'))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── FIN section ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="bg-violet-50 px-6 py-4 border-b border-violet-100 flex justify-between items-center">
          <div>
            <h2 className="font-bold text-violet-800">{lang === 'en' ? 'Financial Side' : 'الجانب المالي'}</h2>
            <p className="text-xs text-violet-600 mt-0.5">
              {lang === 'en' 
                ? 'Financial track starts after execution is complete - Default SLA 20 days' 
                : 'المسار المالي يبدأ بعد اكتمال التنفيذ — SLA الافتراضي 20 يوم'}
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>{tableHeader(false)}</thead>
            <tbody>
              {finRules.map(r => ruleRow(r, undefined, false))}
              {finRules.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-400">
                    <AlertTriangle className="w-4 h-4 inline ml-1 text-amber-400" />
                    {lang === 'en' ? 'No financial indicator defined yet - ' : 'لم يتم تعريف مؤشر مالي بعد — '}
                    <button
                      onClick={async () => {
                        if (!finTemplate) return;
                        await api.post('/admin/kpi-rules', {
                          templateId: finTemplate.id, category: 'FIN',
                          startColumnKey: dateColumns[0]?.columnKey ?? '',
                          endMode: 'COLUMN_DATE', calcMode: 'DATES',
                          workTypeFilter: null, slaDaysOverride: 20,
                          warnThresholdDays: 3, active: true, showOnDashboard: true,
                        });
                        onRefresh();
                      }}
                      className="text-violet-600 hover:underline"
                    >
                      {lang === 'en' ? 'Add Financial Indicator' : 'إضافة المؤشر المالي'}
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-3 bg-violet-50/50 border-t border-violet-100">
          <p className="text-xs text-slate-500">
            {lang === 'en' 
              ? '⚠️ Financial track is not an independent project type - but a subsequent stage for the same work order after execution ends. Define a start column representing the execution end approval date.'
              : '⚠️ المسار المالي ليس نوع مشروع مستقل — بل مرحلة لاحقة لنفس أمر العمل بعد انتهاء التنفيذ. حدّد عمود بداية يمثّل تاريخ اعتماد نهاية التنفيذ.'}
          </p>
        </div>
      </div>

      {/* ── Priority legend ── */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl px-5 py-4">
        <h3 className="text-xs font-semibold text-slate-500 mb-3">{lang === 'en' ? 'Status Priority Order (Higher comes first)' : 'ترتيب أولوية الحالات (الأعلى يسبق)'}</h3>
        <div className="flex flex-wrap gap-3 text-xs">
          {[
            { 
              labelAr: '⛔ ملغي',   
              labelEn: '⛔ Cancelled',
              color: 'bg-slate-100 text-slate-700', 
              noteAr: 'الإجراء الحالي معلّم كملغي',
              noteEn: 'Current stage marked as cancelled'
            },
            { 
              labelAr: '✅ منجز',   
              labelEn: '✅ Done',
              color: 'bg-emerald-100 text-emerald-700', 
              noteAr: 'تحقّق شرط النهاية',
              noteEn: 'End condition met'
            },
            { 
              labelAr: '🔴 متأخر',  
              labelEn: '🔴 Overdue',
              color: 'bg-red-100 text-red-700', 
              noteAr: 'تجاوز مدة SLA',
              noteEn: 'Exceeded SLA duration'
            },
            { 
              labelAr: '🟡 تنبيه',  
              labelEn: '🟡 Warning',
              color: 'bg-amber-100 text-amber-700', 
              noteAr: 'داخل نطاق "تنبيه قبل"',
              noteEn: 'Within "Warning Before" range'
            },
            { 
              labelAr: '🟢 منتظم', 
              labelEn: '🟢 On Track',
              color: 'bg-green-100 text-green-700', 
              noteAr: 'ضمن المدة الطبيعية',
              noteEn: 'Within normal duration'
            },
          ].map(s => (
            <div key={lang === 'en' ? s.labelEn : s.labelAr} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${s.color}`}>
              <span className="font-semibold">{lang === 'en' ? s.labelEn : s.labelAr}</span>
              <span className="text-opacity-70">— {lang === 'en' ? s.noteEn : s.noteAr}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PeriodicMetricsAdmin — Manage DATE_DIFF and NUMERIC_AGG metrics inline
// ─────────────────────────────────────────────────────────────────────────────

interface PeriodicMetric {
  id: string; code: string; nameAr: string; nameEn?: string; isEnabled: boolean;
  metricType: 'DATE_DIFF' | 'NUMERIC_AGG';
  startMode: string; startColumnKey: string | null; startStageId: string | null;
  endMode: string; endColumnKey: string | null; endStageId: string | null;
  aggFunction: string | null; valueColumnKey: string | null;
  thresholdDays: number | null; useExecSla: boolean;
  excludedProjectTypes: string[];
  orderIndex: number;
}

function PeriodicMetricsAdmin() {
  const { lang } = useLang();
  const [metrics, setMetrics] = useState<PeriodicMetric[]>([]);
  const [dateColumns, setDateColumns] = useState<any[]>([]);
  const [numericColumns, setNumericColumns] = useState<any[]>([]);
  const [allStages, setAllStages] = useState<any[]>([]);
  const [projectTypes, setProjectTypes] = useState<{ value: string; labelAr: string; labelEn?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, Partial<PeriodicMetric>>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newM, setNewM] = useState<Partial<PeriodicMetric>>({ metricType: 'DATE_DIFF', startMode: 'COLUMN_DATE', endMode: 'COLUMN_DATE', isEnabled: true, excludedProjectTypes: [] });

  const parseMetrics = (raw: any[]): PeriodicMetric[] =>
    raw.map(m => ({
      ...m,
      excludedProjectTypes: (() => { try { return JSON.parse(m.excludedProjectTypes || '[]'); } catch { return []; } })(),
    }));

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [mRes, cfgRes] = await Promise.all([api.get('/reports/periodic-kpis/metrics'), api.get('/reports/periodic-kpis/config')]);
      setMetrics(parseMetrics(mRes.data ?? []));
      setDateColumns(cfgRes.data?.dateColumns ?? []);
      setNumericColumns(cfgRes.data?.numericColumns ?? []);
      setAllStages(cfgRes.data?.stages ?? []);
      setProjectTypes(cfgRes.data?.projectTypes ?? []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); }, []);

  const patch = (id: string, p: Partial<PeriodicMetric>) => setEdits(prev => ({ ...prev, [id]: { ...prev[id], ...p } }));

  const save = async (m: PeriodicMetric) => {
    const e = { ...m, ...edits[m.id] };
    setSaving(m.id);
    try {
      await api.put(`/reports/periodic-kpis/metrics/${m.id}`, e);
      setSaved(m.id); setTimeout(() => setSaved(null), 2000);
      await fetchAll();
    } catch { alert(lang === 'en' ? 'Save failed' : 'فشل الحفظ'); } finally { setSaving(null); }
  };

  const del = async (id: string, nameAr: string) => {
    if (!confirm(lang === 'en' ? `Delete metric "${nameAr}"?` : `حذف المقياس "${nameAr}"؟`)) return;
    setDeleting(id);
    try { await api.delete(`/reports/periodic-kpis/metrics/${id}`); await fetchAll(); }
    catch { alert(lang === 'en' ? 'Delete failed' : 'فشل الحذف'); } finally { setDeleting(null); }
  };

  const addMetric = async () => {
    if (!newM.code?.trim() || !newM.nameAr?.trim()) return alert(lang === 'en' ? 'Code and name are required' : 'الرمز والاسم مطلوبان');
    try { await api.post('/reports/periodic-kpis/metrics', newM); setShowAdd(false); setNewM({ metricType: 'DATE_DIFF', startMode: 'COLUMN_DATE', endMode: 'COLUMN_DATE', isEnabled: true }); await fetchAll(); }
    catch { alert(lang === 'en' ? 'Add failed' : 'فشل الإضافة'); }
  };

  const reorder = async (m: PeriodicMetric, direction: 'up' | 'down') => {
    const sorted = [...metrics].sort((a, b) => a.orderIndex - b.orderIndex);
    const idx = sorted.findIndex(x => x.id === m.id);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    // Rebuild sequential orderIndex after swap
    const newSorted = [...sorted];
    [newSorted[idx], newSorted[swapIdx]] = [newSorted[swapIdx], newSorted[idx]];
    try {
      await Promise.all(newSorted.map((metric, i) => {
        const base = { ...metric, ...edits[metric.id] };
        return api.put(`/reports/periodic-kpis/metrics/${metric.id}`, { ...base, orderIndex: i });
      }));
      await fetchAll();
    } catch { alert(lang === 'en' ? 'Reorder failed' : 'فشل إعادة الترتيب'); }
  };

  if (loading) return <div className="flex items-center justify-center h-40 text-slate-400 gap-2"><RefreshCw className="w-5 h-5 animate-spin" /> {lang === 'en' ? 'Loading...' : 'جاري التحميل...'}</div>;

  const execStages = allStages.filter((s: any) => s.category !== 'FIN');

  return (
    <div className="space-y-4" dir={lang === 'en' ? 'ltr' : 'rtl'}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-slate-800 text-base">{lang === 'en' ? 'Periodic Metrics' : 'المقاييس الدورية'}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{lang === 'en' ? 'Manage "Date Difference" and "Numeric Aggregation" metrics shown in the performance averages section.' : 'إدارة مقاييس "فرق التواريخ" و"التجميع الرقمي" التي تظهر في قسم متوسطات الأداء.'}</p>
        </div>
        <button onClick={() => setShowAdd(v => !v)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-amber-100 text-amber-700 hover:bg-amber-200 rounded-lg transition-colors">
          <Plus className="w-3.5 h-3.5" /> {lang === 'en' ? 'Add Metric' : 'إضافة مقياس'}
        </button>
      </div>

      {showAdd && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-amber-800">{lang === 'en' ? 'New Metric' : 'مقياس جديد'}</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div><label className="block text-xs text-slate-500 mb-1">{lang === 'en' ? 'Metric Code *' : 'رمز المقياس *'}</label>
              <input className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-amber-400" placeholder="METRIC_CODE" value={newM.code ?? ''} onChange={e => setNewM(v => ({ ...v, code: e.target.value.toUpperCase() }))} /></div>
            <div><label className="block text-xs text-slate-500 mb-1">{lang === 'en' ? 'Name (Arabic) *' : 'الاسم (عربي) *'}</label>
              <input className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-amber-400" placeholder="اسم المقياس" value={newM.nameAr ?? ''} onChange={e => setNewM(v => ({ ...v, nameAr: e.target.value }))} /></div>
            <div><label className="block text-xs text-slate-500 mb-1">{lang === 'en' ? 'Metric Type' : 'نوع المقياس'}</label>
              <select className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-amber-400" value={newM.metricType ?? 'DATE_DIFF'} onChange={e => setNewM(v => ({ ...v, metricType: e.target.value as any }))}>
                <option value="DATE_DIFF">{lang === 'en' ? 'Date Diff' : 'فرق تواريخ (DATE_DIFF)'}</option>
                <option value="NUMERIC_AGG">{lang === 'en' ? 'Numeric Agg' : 'تجميع رقمي (NUMERIC_AGG)'}</option>
              </select></div>
          </div>
          {newM.metricType === 'NUMERIC_AGG' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div><label className="block text-xs text-slate-500 mb-1">{lang === 'en' ? 'Agg Function' : 'دالة التجميع'}</label>
                <select className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white outline-none" value={newM.aggFunction ?? 'SUM'} onChange={e => setNewM(v => ({ ...v, aggFunction: e.target.value }))}>
                  <option value="SUM">{lang === 'en' ? 'SUM' : 'مجموع (SUM)'}</option><option value="AVG">{lang === 'en' ? 'AVG' : 'متوسط (AVG)'}</option>
                  <option value="MIN">{lang === 'en' ? 'MIN' : 'أدنى (MIN)'}</option><option value="MAX">{lang === 'en' ? 'MAX' : 'أعلى (MAX)'}</option>
                </select></div>
              <div><label className="block text-xs text-slate-500 mb-1">{lang === 'en' ? 'Numeric Column' : 'العمود الرقمي'}</label>
                <select className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white outline-none" value={newM.valueColumnKey ?? ''} onChange={e => setNewM(v => ({ ...v, valueColumnKey: e.target.value }))}>
                  <option value="">— {lang === 'en' ? 'Select' : 'اختر'} —</option>
                  {numericColumns.map((c: any) => <option key={c.columnKey} value={c.columnKey}>{lang === 'en' && c.labelEn ? c.labelEn : c.labelAr}</option>)}
                  <option value="length">{lang === 'en' ? 'Length (m)' : 'الطول (م)'}</option>
                  <option value="estimated_value">{lang === 'en' ? 'Estimated Value' : 'القيمة التقديرية'}</option>
                  <option value="actual_invoice_value">{lang === 'en' ? 'Actual Value (Historical)' : 'القيمة الفعلية (تاريخي)'}</option>
                  <option value="collected_amount">{lang === 'en' ? 'Collected' : 'المحصّل'}</option>
                  <option value="remaining_amount">{lang === 'en' ? 'Remaining' : 'المتبقى'}</option>
                </select></div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ModeSelector modeLabel={lang === 'en' ? 'Start Type' : 'نوع البداية'} mode={newM.startMode ?? 'COLUMN_DATE'} onMode={v => setNewM(p => ({ ...p, startMode: v, startColumnKey: null, startStageId: null }))}
                colLabel={lang === 'en' ? 'Start Column' : 'عمود البداية'} colKey={newM.startColumnKey ?? ''} onColKey={v => setNewM(p => ({ ...p, startColumnKey: v }))}
                stageLabel={lang === 'en' ? 'Start Stage' : 'إجراء البداية'} stageId={newM.startStageId ?? ''} onStageId={v => setNewM(p => ({ ...p, startStageId: v }))}
                dateColumns={dateColumns} filteredStages={execStages} />
              <ModeSelector modeLabel={lang === 'en' ? 'End Type' : 'نوع النهاية'} mode={newM.endMode ?? 'COLUMN_DATE'} onMode={v => setNewM(p => ({ ...p, endMode: v, endColumnKey: null, endStageId: null }))}
                colLabel={lang === 'en' ? 'End Column' : 'عمود النهاية'} colKey={newM.endColumnKey ?? ''} onColKey={v => setNewM(p => ({ ...p, endColumnKey: v }))}
                stageLabel={lang === 'en' ? 'End Stage' : 'إجراء النهاية'} stageId={newM.endStageId ?? ''} onStageId={v => setNewM(p => ({ ...p, endStageId: v }))}
                dateColumns={dateColumns} filteredStages={execStages} />
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div><label className="block text-xs text-slate-500 mb-1">{lang === 'en' ? 'Threshold' : 'العتبة'}</label>
              <input type="number" className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white outline-none" placeholder={lang === 'en' ? '— No threshold —' : '— بدون عتبة —'} value={newM.thresholdDays ?? ''} onChange={e => setNewM(v => ({ ...v, thresholdDays: e.target.value ? Number(e.target.value) : null }))} /></div>
            <div><label className="block text-xs text-slate-500 mb-1">{lang === 'en' ? 'English Name' : 'الاسم (إنجليزي)'}</label>
              <input className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-amber-400" placeholder="English Name" value={newM.nameEn ?? ''} onChange={e => setNewM(v => ({ ...v, nameEn: e.target.value }))} dir="ltr" /></div>
          </div>
          {projectTypes.length > 0 && (
            <div>
              <label className="block text-xs text-slate-500 mb-2">{lang === 'en' ? 'Hide in these project types:' : 'إخفاء في أنواع المشاريع التالية:'}</label>
              <div className="flex flex-wrap gap-2">
                {projectTypes.map((pt: any) => {
                  const excluded = (newM.excludedProjectTypes ?? []) as string[];
                  const isExcluded = excluded.includes(pt.value);
                  return (
                    <label key={pt.value} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs cursor-pointer transition-colors ${isExcluded ? 'bg-red-50 border-red-200 text-red-700' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                      <input type="checkbox" className="accent-red-500 w-3 h-3" checked={isExcluded}
                        onChange={() => setNewM(v => ({ ...v, excludedProjectTypes: isExcluded ? excluded.filter(x => x !== pt.value) : [...excluded, pt.value] }))} />
                      {lang === 'en' && pt.labelEn ? pt.labelEn : pt.labelAr}
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button onClick={addMetric} className="px-4 py-1.5 text-xs font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors">{lang === 'en' ? 'Add' : 'إضافة'}</button>
            <button onClick={() => setShowAdd(false)} className="px-4 py-1.5 text-xs font-medium bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors">{lang === 'en' ? 'Cancel' : 'إلغاء'}</button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {metrics.length === 0 && <div className="text-center py-8 text-slate-400 text-sm">{lang === 'en' ? 'No metrics. Add one above.' : 'لا توجد مقاييس. أضف مقياساً أعلاه.'}</div>}
        {[...metrics].sort((a, b) => a.orderIndex - b.orderIndex).map((m, idx, arr) => {
          const e = { ...m, ...edits[m.id] };
          const isSaving = saving === m.id, isSaved = saved === m.id, isDel = deleting === m.id;
          return (
            <div key={m.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  {/* Order buttons */}
                  <div className="flex flex-col gap-0.5">
                    <button onClick={() => reorder(m, 'up')} disabled={idx === 0} className="p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-20 disabled:cursor-not-allowed transition-colors" title={lang === 'en' ? 'Move up' : 'تحريك لأعلى'}>
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 15l-6-6-6 6"/></svg>
                    </button>
                    <button onClick={() => reorder(m, 'down')} disabled={idx === arr.length - 1} className="p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-20 disabled:cursor-not-allowed transition-colors" title={lang === 'en' ? 'Move down' : 'تحريك لأسفل'}>
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6"/></svg>
                    </button>
                  </div>
                  <span className="w-5 h-5 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 text-xs font-bold shrink-0">{idx + 1}</span>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input type="checkbox" className="sr-only peer" checked={!!e.isEnabled} onChange={ev => patch(m.id, { isEnabled: ev.target.checked })} />
                    <div className="w-9 h-5 bg-slate-200 rounded-full peer peer-checked:bg-amber-500 transition-colors" />
                    <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all peer-checked:translate-x-4" />
                  </label>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-slate-800">{lang === 'en' && e.nameEn ? e.nameEn : e.nameAr}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-mono font-bold ${e.metricType === 'NUMERIC_AGG' ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'}`}>{e.metricType}</span>
                      {e.metricType === 'NUMERIC_AGG' && e.aggFunction && <span className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{e.aggFunction}</span>}
                      {e.useExecSla && <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-medium">{lang === 'en' ? 'SLA-based' : 'يتبع SLA'}</span>}
                    </div>
                    <p className="text-xs text-slate-400 font-mono">{m.code}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => save(m)} disabled={isSaving} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${isSaved ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'} disabled:opacity-50`}>
                    {isSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    {isSaved ? (lang === 'en' ? 'Done' : 'تم') : (lang === 'en' ? 'Save' : 'حفظ')}
                  </button>
                  <button onClick={() => del(m.id, m.nameAr)} disabled={isDel} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="px-4 pb-4 border-t border-slate-100 pt-3 space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div><label className="block text-xs text-slate-500 mb-1">{lang === 'en' ? 'Arabic Name' : 'الاسم (عربي)'}</label>
                    <input className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-amber-400" value={e.nameAr} onChange={ev => patch(m.id, { nameAr: ev.target.value })} /></div>
                  <div><label className="block text-xs text-slate-500 mb-1">{lang === 'en' ? 'English Name' : 'الاسم (إنجليزي)'}</label>
                    <input className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-amber-400" value={e.nameEn || ''} onChange={ev => patch(m.id, { nameEn: ev.target.value })} dir="ltr" /></div>
                  <div><label className="block text-xs text-slate-500 mb-1">{lang === 'en' ? 'Metric Type' : 'نوع المقياس'}</label>
                    <select className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white outline-none" value={e.metricType} onChange={ev => patch(m.id, { metricType: ev.target.value as any, aggFunction: null, valueColumnKey: null })}>
                      <option value="DATE_DIFF">{lang === 'en' ? 'Date Diff' : 'فرق تواريخ'}</option>
                      <option value="NUMERIC_AGG">{lang === 'en' ? 'Numeric Agg' : 'تجميع رقمي'}</option>
                    </select></div>
                  <div><label className="block text-xs text-slate-500 mb-1">{lang === 'en' ? 'Threshold (days)' : 'العتبة (أيام)'}</label>
                    <input type="number" className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white outline-none" placeholder={lang === 'en' ? '— No threshold —' : '— بلا عتبة —'} value={e.thresholdDays ?? ''} onChange={ev => patch(m.id, { thresholdDays: ev.target.value ? Number(ev.target.value) : null })} /></div>
                  {e.metricType === 'DATE_DIFF' && (
                    <div className="col-span-2 sm:col-span-2 flex items-start gap-2 pt-1">
                      <input type="checkbox" id={`use-exec-sla-${m.id}`} className="mt-1 accent-indigo-600 w-4 h-4 cursor-pointer" checked={!!e.useExecSla} onChange={ev => patch(m.id, { useExecSla: ev.target.checked })} />
                      <label htmlFor={`use-exec-sla-${m.id}`} className="text-xs text-slate-600 cursor-pointer leading-snug">
                        <span className="font-semibold text-indigo-700">{lang === 'en' ? 'Follow project-type SLA' : 'يتبع SLA نوع المشروع'}</span>
                        <span className="block text-slate-400 mt-0.5">{lang === 'en' ? 'Threshold = SLA of the project type (overrides fixed threshold above)' : 'العتبة = SLA نوع المشروع تلقائياً (يتجاوز العتبة الثابتة)'}</span>
                      </label>
                    </div>
                  )}
                </div>

                {projectTypes.length > 0 && (
                  <div className="pt-1">
                    <label className="block text-xs text-slate-500 mb-2">{lang === 'en' ? 'Hide metric in these project types:' : 'إخفاء المقياس من أنواع المشاريع التالية:'}</label>
                    <div className="flex flex-wrap gap-2">
                      {projectTypes.map((pt: any) => {
                        const excluded = (e.excludedProjectTypes ?? []) as string[];
                        const isExcluded = excluded.includes(pt.value);
                        return (
                          <label key={pt.value} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs cursor-pointer transition-colors ${isExcluded ? 'bg-red-50 border-red-200 text-red-700' : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                            <input
                              type="checkbox"
                              className="accent-red-500 w-3 h-3"
                              checked={isExcluded}
                              onChange={() => {
                                const current = (e.excludedProjectTypes ?? []) as string[];
                                patch(m.id, { excludedProjectTypes: isExcluded ? current.filter(v => v !== pt.value) : [...current, pt.value] });
                              }}
                            />
                            {lang === 'en' && pt.labelEn ? pt.labelEn : pt.labelAr}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {e.metricType === 'NUMERIC_AGG' ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="block text-xs text-slate-500 mb-1">{lang === 'en' ? 'Agg Function' : 'دالة التجميع'}</label>
                      <select className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white outline-none" value={e.aggFunction ?? 'SUM'} onChange={ev => patch(m.id, { aggFunction: ev.target.value })}>
                        <option value="SUM">{lang === 'en' ? 'SUM' : 'مجموع (SUM)'}</option><option value="AVG">{lang === 'en' ? 'AVG' : 'متوسط (AVG)'}</option>
                        <option value="MIN">{lang === 'en' ? 'MIN' : 'أدنى (MIN)'}</option><option value="MAX">{lang === 'en' ? 'MAX' : 'أعلى (MAX)'}</option>
                      </select></div>
                    <div><label className="block text-xs text-slate-500 mb-1">{lang === 'en' ? 'Numeric Column' : 'العمود الرقمي'}</label>
                      <select className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white outline-none" value={e.valueColumnKey ?? ''} onChange={ev => patch(m.id, { valueColumnKey: ev.target.value })}>
                        <option value="">— {lang === 'en' ? 'Select' : 'اختر'} —</option>
                        {numericColumns.map((c: any) => <option key={c.columnKey} value={c.columnKey}>{lang === 'en' && c.labelEn ? c.labelEn : c.labelAr}</option>)}
                        <option value="length">{lang === 'en' ? 'Length (m)' : 'الطول (م)'}</option>
                        <option value="estimated_value">{lang === 'en' ? 'Estimated Value' : 'القيمة التقديرية'}</option>
                        <option value="actual_invoice_value">{lang === 'en' ? 'Actual Value (Historical)' : 'القيمة الفعلية (تاريخي)'}</option>
                        <option value="collected_amount">{lang === 'en' ? 'Collected' : 'المحصّل'}</option>
                        <option value="remaining_amount">{lang === 'en' ? 'Remaining' : 'المتبقى'}</option>
                      </select></div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <ModeSelector modeLabel={lang === 'en' ? 'Start Type' : 'نوع البداية'} mode={e.startMode ?? 'COLUMN_DATE'} onMode={v => patch(m.id, { startMode: v, startColumnKey: null, startStageId: null })}
                      colLabel={lang === 'en' ? 'Start Column' : 'عمود البداية'} colKey={e.startColumnKey ?? ''} onColKey={v => patch(m.id, { startColumnKey: v })}
                      stageLabel={lang === 'en' ? 'Start Stage' : 'إجراء البداية'} stageId={e.startStageId ?? ''} onStageId={v => patch(m.id, { startStageId: v })}
                      dateColumns={dateColumns} filteredStages={execStages} />
                    <ModeSelector modeLabel={lang === 'en' ? 'End Type' : 'نوع النهاية'} mode={e.endMode ?? 'COLUMN_DATE'} onMode={v => patch(m.id, { endMode: v, endColumnKey: null, endStageId: null })}
                      colLabel={lang === 'en' ? 'End Column' : 'عمود النهاية'} colKey={e.endColumnKey ?? ''} onColKey={v => patch(m.id, { endColumnKey: v })}
                      stageLabel={lang === 'en' ? 'End Stage' : 'إجراء النهاية'} stageId={e.endStageId ?? ''} onStageId={v => patch(m.id, { endStageId: v })}
                      dateColumns={dateColumns} filteredStages={execStages} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PeriodicTabSection — wrapper with sub-tabs for PERIODIC scope
// ─────────────────────────────────────────────────────────────────────────────

function PeriodicTabSection() {
  const { lang } = useLang();
  const [subTab, setSubTab] = useState<'rules' | 'metrics'>('rules');
  const tabs = [
    { 
      key: 'rules'   as const, 
      label: lang === 'en' ? 'SLA & Execution Rules' : 'قواعد SLA والتنفيذ', 
      desc: lang === 'en' ? 'SLA duration and financial path per project type' : 'مدة SLA والمسار المالي لكل نوع مشروع' 
    },
    { 
      key: 'metrics' as const, 
      label: lang === 'en' ? 'Periodic Metrics' : 'المقاييس الدورية',   
      desc: lang === 'en' ? 'Date difference and numeric aggregation metrics' : 'مقاييس فرق التواريخ والتجميع الرقمي' 
    },
  ];
  return (
    <div className="space-y-6" dir={lang === 'en' ? 'ltr' : 'rtl'}>
      {/* Sub-tab navigation */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-1 flex gap-1">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setSubTab(t.key)}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${subTab === t.key ? 'bg-white text-amber-800 shadow-sm border border-amber-200' : 'text-amber-700 hover:bg-amber-100'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="text-xs text-slate-500 -mt-4 px-1">{tabs.find(t => t.key === subTab)?.desc}</div>

      {subTab === 'rules'   && <PeriodicKpiConfig />}
      {subTab === 'metrics' && <PeriodicMetricsAdmin />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PeriodicKpiConfig — Periodic Performance Report Settings (fully independent)
// ─────────────────────────────────────────────────────────────────────────────

interface PeriodicExecRule {
  id: string | null;
  projectTypeValue: string;
  projectTypeLabelAr: string;
  isEnabled: boolean;
  slaDays: number;
  warningDays: number;
  startMode: string;
  startColumnKey: string | null;
  startStageId: string | null;
  endMode: string;
  endColumnKey: string | null;
  endStageId: string | null;
  __configured?: boolean;
}

interface PeriodicFinRule {
  id: string;
  isEnabled: boolean;
  slaDays: number;
  warningDays: number;
  startMode: string;
  startColumnKey: string | null;
  startStageId: string | null;
  endMode: string;
  endColumnKey: string | null;
  endStageId: string | null;
}

function ModeSelector({
  modeLabel, mode, onMode,
  colLabel, colKey, onColKey,
  stageLabel, stageId, onStageId,
  dateColumns, filteredStages,
}: {
  modeLabel: string; mode: string; onMode: (v: string) => void;
  colLabel: string; colKey: string; onColKey: (v: string) => void;
  stageLabel: string; stageId: string; onStageId: (v: string) => void;
  dateColumns: any[]; filteredStages: any[];
}) {
  const { lang } = useLang();
  return (
    <div className="space-y-2">
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">{modeLabel}</label>
        <select value={mode} onChange={e => onMode(e.target.value)}
          className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400">
          <option value="COLUMN_DATE">{lang === 'en' ? 'Date from table' : 'تاريخ من الجدول'}</option>
          <option value="STAGE_EVENT">{lang === 'en' ? 'Stage (Phase)' : 'إجراء (مرحلة)'}</option>
        </select>
      </div>
      {mode === 'COLUMN_DATE' ? (
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">{colLabel}</label>
          <select value={colKey || ''} onChange={e => onColKey(e.target.value)}
            className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400">
            <option value="">— {lang === 'en' ? 'Select Column' : 'اختر العمود'} —</option>
            {dateColumns.map(c => <option key={c.columnKey} value={c.columnKey}>{lang === 'en' && c.labelEn ? c.labelEn : c.labelAr}</option>)}
          </select>
        </div>
      ) : (
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">{stageLabel}</label>
          <select value={stageId || ''} onChange={e => onStageId(e.target.value)}
            className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-amber-400">
            <option value="">— {lang === 'en' ? 'Select Stage' : 'اختر الإجراء'} —</option>
            {filteredStages.map(s => <option key={s.id} value={s.id}>{lang === 'en' && s.nameEn ? s.nameEn : s.nameAr}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

function PeriodicKpiConfig() {
  const { lang } = useLang();
  // ── Data (fetched internally — no props needed) ──────────────────────────
  const [dateColumns,  setDateColumns]  = useState<any[]>([]);
  const [allStages,    setAllStages]    = useState<any[]>([]);

  const [execRules, setExecRules] = useState<PeriodicExecRule[]>([]);
  const [finRule,   setFinRule]   = useState<PeriodicFinRule | null>(null);
  const [loading,   setLoading]   = useState(true);

  const [editExec,   setEditExec]   = useState<Record<string, Partial<PeriodicExecRule>>>({});
  const [editFin,    setEditFin]    = useState<Partial<PeriodicFinRule>>({});
  const [savingExec, setSavingExec] = useState<string | null>(null);
  const [initingPt,  setInitingPt]  = useState<string | null>(null);
  const [savingFin,  setSavingFin]  = useState(false);
  const [savedExec,  setSavedExec]  = useState<string | null>(null);
  const [savedFin,   setSavedFin]   = useState(false);

  const execStages = allStages.filter(s => s.category === 'EXEC');
  const finStages  = allStages.filter(s => s.category === 'FIN');

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [optsRes, er, fr] = await Promise.all([
        api.get('/admin/periodic-kpi/options'),
        api.get('/admin/periodic-kpi/execution-rules'),
        api.get('/admin/periodic-kpi/financial-rule'),
      ]);
      setDateColumns(optsRes.data.dateColumns ?? []);
      setAllStages(optsRes.data.stages ?? []);
      setExecRules(er.data);
      setFinRule(fr.data);

      const initExec: Record<string, Partial<PeriodicExecRule>> = {};
      for (const r of er.data) {
        if (r.id) initExec[r.id] = { ...r };
      }
      setEditExec(initExec);
      setEditFin({ ...fr.data });
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); }, []);

  // ── Validation helper ────────────────────────────────────────────────────
  const validateExecRule = (e: Partial<PeriodicExecRule>): string | null => {
    if (!e.isEnabled) return null;
    if (e.startMode === 'COLUMN_DATE' && !e.startColumnKey) return lang === 'en' ? 'Select start column or change start type' : 'حدد عمود البداية أو غيّر نوع البداية';
    if (e.startMode === 'STAGE_EVENT' && !e.startStageId) return lang === 'en' ? 'Select start stage' : 'حدد إجراء البداية';
    if (e.endMode === 'COLUMN_DATE' && !e.endColumnKey) return lang === 'en' ? 'Select end column or change end type' : 'حدد عمود النهاية أو غيّر نوع النهاية';
    if (e.endMode === 'STAGE_EVENT' && !e.endStageId) return lang === 'en' ? 'Select end stage' : 'حدد إجراء النهاية';
    return null;
  };

  // ── Actions ──────────────────────────────────────────────────────────────
  const initializeRule = async (pt: { projectTypeValue: string; projectTypeLabelAr: string; projectTypeLabelEn?: string }) => {
    setInitingPt(pt.projectTypeValue);
    try {
      await api.post('/admin/periodic-kpi/execution-rules', {
        projectTypeValue: pt.projectTypeValue,
        projectTypeLabelAr: pt.projectTypeLabelAr,
        projectTypeLabelEn: pt.projectTypeLabelEn,
      });
      await fetchAll();
    } catch (err: any) {
      if (err?.response?.status === 409) await fetchAll();
      else alert(lang === 'en' ? 'Initialization failed' : 'فشل التهيئة');
    } finally { setInitingPt(null); }
  };

  const saveExecRule = async (id: string) => {
    const e = editExec[id];
    const validationErr = validateExecRule(e);
    if (validationErr) { alert(validationErr); return; }
    setSavingExec(id);
    try {
      await api.put(`/admin/periodic-kpi/execution-rules/${id}`, e);
      setSavedExec(id);
      setTimeout(() => setSavedExec(null), 2000);
      await fetchAll();
    } catch { alert(lang === 'en' ? 'Save failed' : 'فشل الحفظ'); }
    finally { setSavingExec(null); }
  };

  const saveFinRule = async () => {
    if (!finRule) return;
    setSavingFin(true);
    try {
      await api.put(`/admin/periodic-kpi/financial-rule/${finRule.id}`, editFin);
      setSavedFin(true);
      setTimeout(() => setSavedFin(false), 2000);
      await fetchAll();
    } catch { alert(lang === 'en' ? 'Save failed' : 'فشل الحفظ'); }
    finally { setSavingFin(false); }
  };

  const patchExec = (id: string, patch: Partial<PeriodicExecRule>) =>
    setEditExec(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  if (loading) return (
    <div className="flex items-center justify-center h-48 text-slate-400 gap-2">
      <RefreshCw className="w-5 h-5 animate-spin" />{lang === 'en' ? 'en' : 'جاري التحميل...'}</div>
  );

  const numInputCls = "w-20 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-sm text-center outline-none focus:ring-2 focus:ring-amber-400";

  const SectionBadge = ({ label, color = 'amber' }: { label: string; color?: string }) => {
    const labels: Record<string, { ar: string; en: string }> = {
      'EXECUTION': { ar: 'المسار التنفيذي', en: 'EXECUTION' },
      'FINANCIAL': { ar: 'المسار المالي', en: 'FINANCIAL' }
    };
    const l = labels[label] || { ar: label, en: label };
    return (
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium bg-${color}-100 text-${color}-700`}>
        {lang === 'en' ? l.en : l.ar}
      </span>
    );
  };

  // Split rules into configured and unconfigured
  const configuredRules   = execRules.filter(r => r.__configured && r.id);
  const unconfiguredTypes = execRules.filter(r => !r.__configured);

  return (
    <div className="space-y-8" dir={lang === 'en' ? 'ltr' : 'rtl'}>
      {/* ── Info banner ──────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-3 flex items-start gap-3 text-sm text-amber-800">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
        <p>
          {lang === 'en' 
            ? 'These settings are fully independent from work order indicators and dashboard cards. The project types list is auto-updated from system settings.'
            : 'هذه الإعدادات مستقلة تماماً عن مؤشرات أمر العمل وبطاقات لوحة التحكم. قائمة أنواع المشاريع تُحدَّث تلقائياً من إعدادات النظام.'}
        </p>
      </div>

      {/* ── Section A: Execution Rules ──────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="bg-indigo-50 border-b border-indigo-100 px-6 py-4 flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-base font-bold text-slate-800">{lang === 'en' ? 'A) Execution Track' : 'أ) المسار التنفيذي'}</h2>
              <SectionBadge label="EXECUTION" />
              <span className="text-xs text-slate-400">{configuredRules.length} {lang === 'en' ? 'configured' : 'مُهيَّأ'} / {execRules.length} {lang === 'en' ? 'total' : 'إجمالي'}</span>
            </div>
            <p className="text-xs text-slate-500">{lang === 'en' ? 'SLA duration and start/end definition per project type — auto-updated when a new type is added.' : 'مدة SLA وتعريف البداية/النهاية لكل نوع مشروع — يُحدَّث تلقائياً عند إضافة نوع جديد.'}</p>
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {/* Configured rules — full edit UI */}
          {configuredRules.map(rule => {
            const e = editExec[rule.id!] ?? rule;
            const isSaving  = savingExec === rule.id;
            const isSaved   = savedExec  === rule.id;
            const warnMsg   = validateExecRule(e);
            return (
              <div key={rule.id} data-testid={`periodic-exec-rule-${rule.projectTypeValue}`}
                className="px-6 py-4">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input type="checkbox" className="sr-only peer"
                        checked={!!e.isEnabled}
                        onChange={ev => patchExec(rule.id!, { isEnabled: ev.target.checked })} />
                      <div className="w-9 h-5 bg-slate-200 rounded-full peer peer-checked:bg-amber-500 transition-colors" />
                      <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all peer-checked:translate-x-4" />
                    </label>
                    <span className={`font-semibold text-sm ${e.isEnabled ? 'text-slate-800' : 'text-slate-400'}`}>
                      {lang === 'en' && rule.projectTypeLabelEn ? rule.projectTypeLabelEn : rule.projectTypeLabelAr}
                    </span>
                    {!e.isEnabled && <span className="text-xs bg-slate-100 text-slate-400 px-2 py-0.5 rounded">{lang === 'en' ? 'Disabled' : 'معطّل'}</span>}
                  </div>
                  <button
                    data-testid={`button-save-exec-${rule.projectTypeValue}`}
                    onClick={() => saveExecRule(rule.id!)}
                    disabled={isSaving}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      isSaved ? 'bg-emerald-100 text-emerald-700'
                              : warnMsg ? 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100'
                              : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                    } disabled:opacity-50`}
                  >
                    {isSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    {isSaved ? (lang === 'en' ? 'Saved' : 'تم الحفظ') : (lang === 'en' ? 'Save' : 'حفظ')}
                  </button>
                </div>

                {/* Validation warning */}
                {warnMsg && e.isEnabled && (
                  <div className="mb-3 flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {warnMsg}
                  </div>
                )}

                <div className={`space-y-3 ${e.isEnabled ? '' : 'opacity-50 pointer-events-none'}`}>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">{lang === 'en' ? 'SLA Duration (Days)' : 'مدة SLA (أيام)'}</label>
                      <input type="number" min="0" value={e.slaDays ?? 30}
                        onChange={ev => patchExec(rule.id!, { slaDays: Number(ev.target.value) })}
                        className={numInputCls} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">{lang === 'en' ? 'Warning Days' : 'أيام التنبيه'}</label>
                      <input type="number" min="0" value={e.warningDays ?? 5}
                        onChange={ev => patchExec(rule.id!, { warningDays: Number(ev.target.value) })}
                        className={numInputCls} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <ModeSelector
                      modeLabel={lang === 'en' ? 'Start Calculation Type *' : 'نوع بداية الحساب *'}
                      mode={e.startMode ?? 'COLUMN_DATE'}
                      onMode={v => patchExec(rule.id!, { startMode: v, startColumnKey: null, startStageId: null })}
                      colLabel={lang === 'en' ? 'Start Column *' : 'عمود البداية *'}
                      colKey={e.startColumnKey ?? ''}
                      onColKey={v => patchExec(rule.id!, { startColumnKey: v })}
                      stageLabel={lang === 'en' ? 'Start Stage (EXEC) *' : 'إجراء البداية (EXEC) *'}
                      stageId={e.startStageId ?? ''}
                      onStageId={v => patchExec(rule.id!, { startStageId: v })}
                      dateColumns={dateColumns}
                      filteredStages={execStages}
                    />
                    <ModeSelector
                      modeLabel={lang === 'en' ? 'End Calculation Type *' : 'نوع نهاية الحساب *'}
                      mode={e.endMode ?? 'COLUMN_DATE'}
                      onMode={v => patchExec(rule.id!, { endMode: v, endColumnKey: null, endStageId: null })}
                      colLabel={lang === 'en' ? 'End Column *' : 'عمود النهاية *'}
                      colKey={e.endColumnKey ?? ''}
                      onColKey={v => patchExec(rule.id!, { endColumnKey: v })}
                      stageLabel={lang === 'en' ? 'End Stage (EXEC) *' : 'إجراء النهاية (EXEC) *'}
                      stageId={e.endStageId ?? ''}
                      onStageId={v => patchExec(rule.id!, { endStageId: v })}
                      dateColumns={dateColumns}
                      filteredStages={execStages}
                    />
                  </div>
                </div>
              </div>
            );
          })}

          {/* Unconfigured project types — show with "تهيئة" button */}
          {unconfiguredTypes.length > 0 && (
            <div className="px-6 py-4 bg-slate-50">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-semibold text-slate-500">{lang === 'en' ? 'Unconfigured Project Types' : 'أنواع مشاريع غير مهيأة'}</span>
                <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">{unconfiguredTypes.length}</span>
              </div>
              <div className="space-y-2">
                {unconfiguredTypes.map(pt => (
                  <div key={pt.projectTypeValue}
                    data-testid={`periodic-unconfigured-${pt.projectTypeValue}`}
                    className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-slate-300" />
                      <span className="text-sm text-slate-600">{lang === 'en' && pt.projectTypeLabelEn ? pt.projectTypeLabelEn : pt.projectTypeLabelAr}</span>
                      <span className="text-xs text-slate-400">— {lang === 'en' ? 'Not configured' : 'لا توجد إعدادات'}</span>
                    </div>
                    <button
                      data-testid={`button-init-${pt.projectTypeValue}`}
                      onClick={() => initializeRule(pt)}
                      disabled={initingPt === pt.projectTypeValue}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {initingPt === pt.projectTypeValue
                        ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        : <Plus className="w-3.5 h-3.5" />}
                      {lang === 'en' ? 'Initialize' : 'تهيئة'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {execRules.length === 0 && (
            <div className="px-6 py-10 text-center text-slate-400 text-sm">
              {lang === 'en' ? 'No project types defined in the system. Add project types from column settings first.' : 'لا توجد أنواع مشاريع في النظام. أضف أنواع مشاريع من إعدادات الأعمدة أولاً.'}
            </div>
          )}
        </div>
      </div>

      {/* ── Section B: Financial Rule ───────────────────────────────────── */}
      {editFin && finRule && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-emerald-50 border-b border-emerald-100 px-6 py-4 flex items-start justify-between flex-wrap gap-2">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-base font-bold text-slate-800">{lang === 'en' ? 'B) Financial Path' : 'ب) المسار المالي'}</h2>
                <SectionBadge label="FINANCIAL" color="emerald" />
              </div>
              <p className="text-xs text-slate-500">
                {lang === 'en' ? (
                  <>
                    Not an independent project type — a subsequent path that starts after execution is complete for the same work order.<br />
                    <strong className="text-slate-600">Financial Start</strong> = Approved Execution End (based on each project type setting above).<br />
                    <strong className="text-slate-600">Financial End</strong> = A financial column or stage you define below.
                  </>
                ) : (
                  <>
                    ليس نوع مشروع مستقل — مسار لاحق يبدأ بعد اكتمال التنفيذ لنفس أمر العمل.<br />
                    <strong className="text-slate-600">بداية المالي</strong> = نهاية التنفيذي المعتمدة (حسب إعداد كل نوع مشروع أعلاه).<br />
                    <strong className="text-slate-600">نهاية المالي</strong> = عمود أو إجراء مالي تحدده أدناه.
                  </>
                )}
              </p>
            </div>
            <button
              data-testid="button-save-financial-rule"
              onClick={saveFinRule}
              disabled={savingFin}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                savedFin ? 'bg-emerald-100 text-emerald-700' : 'bg-emerald-600 hover:bg-emerald-700 text-white'
              } disabled:opacity-50`}
            >
              {savingFin ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {savedFin ? (lang === 'en' ? 'Saved' : 'تم الحفظ') : (lang === 'en' ? 'Save' : 'حفظ')}
            </button>
          </div>
          <div className="px-6 py-5 space-y-4">
            <div className="flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input type="checkbox" className="sr-only peer"
                  checked={!!editFin.isEnabled}
                  onChange={ev => setEditFin(p => ({ ...p, isEnabled: ev.target.checked }))} />
                <div className="w-9 h-5 bg-slate-200 rounded-full peer peer-checked:bg-emerald-500 transition-colors" />
                <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all peer-checked:translate-x-4" />
              </label>
              <span className="text-sm font-medium text-slate-700">{lang === 'en' ? 'Enable financial path in report' : 'تفعيل المسار المالي في التقرير'}</span>
            </div>

            <div className={`space-y-4 ${editFin.isEnabled ? '' : 'opacity-50 pointer-events-none'}`}>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">{lang === 'en' ? 'SLA Duration (Days)' : 'مدة SLA (أيام)'}</label>
                  <input type="number" min="0" value={editFin.slaDays ?? 20}
                    onChange={ev => setEditFin(p => ({ ...p, slaDays: Number(ev.target.value) }))}
                    className={numInputCls} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">{lang === 'en' ? 'Warning Days' : 'أيام التنبيه'}</label>
                  <input type="number" min="0" value={editFin.warningDays ?? 3}
                    onChange={ev => setEditFin(p => ({ ...p, warningDays: Number(ev.target.value) }))}
                    className={numInputCls} />
                </div>
              </div>

              {/* بداية المالي — fixed as "نهاية التنفيذي" with optional override */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 px-4 py-3 text-sm text-emerald-800">
                <span className="font-semibold">{lang === 'en' ? 'Financial Calculation Start' : 'بداية الحساب المالي'}</span> = {lang === 'en' ? 'Execution end date for each work order (defined above per project type)' : 'تاريخ نهاية التنفيذي لكل أمر عمل (مُحدَّد أعلاه لكل نوع مشروع)'}
              </div>

              {/* نهاية المالي */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-start-2">
                  <ModeSelector
                    modeLabel={lang === 'en' ? 'Financial End Type *' : 'نوع نهاية الحساب المالي *'}
                    mode={editFin.endMode ?? 'COLUMN_DATE'}
                    onMode={v => setEditFin(p => ({ ...p, endMode: v, endColumnKey: null, endStageId: null }))}
                    colLabel={lang === 'en' ? 'Financial End Column' : 'عمود النهاية المالية'}
                    colKey={editFin.endColumnKey ?? ''}
                    onColKey={v => setEditFin(p => ({ ...p, endColumnKey: v }))}
                    stageLabel={lang === 'en' ? 'Financial End Stage (FIN)' : 'إجراء النهاية المالية (FIN)'}
                    stageId={editFin.endStageId ?? ''}
                    onStageId={v => setEditFin(p => ({ ...p, endStageId: v }))}
                    dateColumns={dateColumns}
                    filteredStages={finStages}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main AdminKpis component
// ─────────────────────────────────────────────────────────────────────────────
export default function AdminKpis() {
  const { lang, t } = useLang();
  const [searchParams, setSearchParams] = useSearchParams();
  const scope = (searchParams.get('scope') as Scope) || 'ORDER';

  const [templates, setTemplates]           = useState<any[]>([]);
  const [rules, setRules]                   = useState<any[]>([]);
  const [catalog, setCatalog]               = useState<any[]>([]);
  const [stages, setStages]                 = useState<any[]>([]);
  const [sectors, setSectors]               = useState<any[]>([]);
  const [projectTypeOptions, setProjectTypeOptions] = useState<any[]>([]);
  const [loading, setLoading]               = useState(true);
  const [showModal, setShowModal]           = useState(false);
  const [saving, setSaving]                 = useState(false);
  const [orderRuleDrafts, setOrderRuleDrafts] = useState<Record<string, any>>({});

  const [newTemplate, setNewTemplate]       = useState({ ...EMPTY_TEMPLATE });
  const [newRuleBase, setNewRuleBase]       = useState({ ...EMPTY_RULE_BASE });
  const [projectTypeSlas, setProjectTypeSlas] = useState<ProjectTypeSla[]>([]);
  const [globalFallbackSla, setGlobalFallbackSla]         = useState<number>(0);
  const [globalFallbackEnabled, setGlobalFallbackEnabled] = useState<boolean>(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [tempRes, ruleRes, catRes, stageRes, sectorRes, ptRes] = await Promise.all([
        api.get('/admin/kpi-templates'),
        api.get('/admin/kpi-rules'),
        api.get('/admin/columns'),
        api.get('/admin/stages'),
        api.get('/admin/sectors'),
        api.get('/admin/column-options/project_type'),
      ]);
      setTemplates(tempRes.data);
      setRules(ruleRes.data);
      setCatalog(catRes.data);
      setStages(stageRes.data);
      setSectors(sectorRes.data);
      setProjectTypeOptions(ptRes.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const openModal = () => {
    setNewTemplate({ ...EMPTY_TEMPLATE });
    setNewRuleBase({ ...EMPTY_RULE_BASE });
    setGlobalFallbackSla(0);
    setGlobalFallbackEnabled(true);
    setProjectTypeSlas(
      projectTypeOptions.map(opt => ({ value: opt.value, labelAr: opt.labelAr, enabled: false, slaDays: 30 }))
    );
    setShowModal(true);
  };

  const handleUpdateRule = (id: string, data: any) => {
    setOrderRuleDrafts(prev => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...data } }));
  };

  const saveOrderRule = async (id: string) => {
    const draft = orderRuleDrafts[id];
    if (!draft) return;
    try {
      await api.put(`/admin/kpi-rules/${id}`, draft);
      setOrderRuleDrafts(prev => { const n = { ...prev }; delete n[id]; return n; });
      fetchData();
    } catch { alert(lang === 'en' ? 'Update failed' : 'فشل التحديث'); }
  };

  const handleUpdateTemplate = async (id: string, data: any) => {
    try { await api.put(`/admin/kpi-templates/${id}`, data); fetchData(); }
    catch { alert(lang === 'en' ? 'Update failed' : 'فشل التحديث'); }
  };

  const handleDeleteTemplate = async (id: string, name: string) => {
    if (!confirm(lang === 'en' ? `Delete indicator "${name}" and all its rules?` : `هل تريد حذف مؤشر "${name}" وجميع قواعده؟`)) return;
    try { await api.delete(`/admin/kpi-templates/${id}`); fetchData(); }
    catch { alert(lang === 'en' ? 'Delete failed' : 'فشل الحذف'); }
  };

  const handleDeleteRule = async (id: string) => {
    if (!confirm(lang === 'en' ? 'Delete this rule?' : 'هل تريد حذف هذه القاعدة؟')) return;
    try { await api.delete(`/admin/kpi-rules/${id}`); fetchData(); }
    catch { alert(lang === 'en' ? 'Delete failed' : 'فشل الحذف'); }
  };

  const handleAddKpi = async () => {
    if (!newTemplate.nameAr.trim()) { alert(lang === 'en' ? 'Indicator name is required' : 'اسم المؤشر مطلوب'); return; }
    if (newRuleBase.startMode === 'COLUMN_DATE' && !newRuleBase.startColumnKey) { alert(lang === 'en' ? 'Start column is required' : 'عمود البداية مطلوب'); return; }
    if (newRuleBase.startMode === 'STAGE' && !newRuleBase.startStageId) { alert(lang === 'en' ? 'Start stage is required' : 'إجراء البداية مطلوب'); return; }

    const enabledTypes = projectTypeSlas.filter(p => p.enabled);
    if (!globalFallbackEnabled && enabledTypes.length === 0) {
      alert(lang === 'en' ? 'Must enable "All Types" or select at least one project type' : 'يجب تفعيل "جميع الأنواع" أو اختيار نوعية مشروع واحدة على الأقل');
      return;
    }
    setSaving(true);
    try {
      const tplRes = await api.post('/admin/kpi-templates', {
        nameAr: newTemplate.nameAr, category: newTemplate.category,
        defaultSlaDays: globalFallbackEnabled ? globalFallbackSla : 0,
        seq: templates.filter(t => (t.displayScope || 'ORDER') === scope).length + 1,
        active: true, displayScope: scope,
      });
      const tplId = tplRes.data.id;
      const ruleBase = {
        templateId: tplId, category: newTemplate.category,
        startMode: newRuleBase.startMode,
        startColumnKey: newRuleBase.startMode === 'COLUMN_DATE' ? newRuleBase.startColumnKey : null,
        startStageId: newRuleBase.startMode === 'STAGE' ? newRuleBase.startStageId : null,
        endMode: newRuleBase.endMode,
        endColumnKey: newRuleBase.endMode === 'COLUMN_DATE' ? (newRuleBase.endColumnKey || null) : null,
        endStageId: newRuleBase.endMode === 'STAGE' ? (newRuleBase.endColumnKey || null) : null,
        calcMode: newRuleBase.calcMode, active: true,
        showOnDashboard: scope === 'DASHBOARD',
        alertEnabled: true, warnThresholdPercent: 80,
      };
      if (globalFallbackEnabled) {
        await api.post('/admin/kpi-rules', { ...ruleBase, workTypeFilter: null, slaDaysOverride: globalFallbackSla || null });
      }
      for (const pt of enabledTypes) {
        await api.post('/admin/kpi-rules', { ...ruleBase, workTypeFilter: pt.value, slaDaysOverride: pt.slaDays });
      }
      setShowModal(false);
      await fetchData();
    } catch (err: any) {
      alert((lang === 'en' ? 'Save failed: ' : 'فشل الحفظ: ') + (err?.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  };

  const dateColumns    = catalog.filter(c => ['date', 'timestamp', 'timestamp with time zone'].includes(c.dataType));
  const numericColumns = catalog.filter(c => ['number', 'numeric', 'currency'].includes(c.dataType));

  const getDashboardTemplates = () =>
    templates.filter(t => rules.some(r => r.templateId === t.id && r.showOnDashboard));

  const scopedTemplates = scope === 'DASHBOARD'
    ? getDashboardTemplates()
    : templates.filter(t => (t.displayScope || 'ORDER') === scope);

  const getTabCount = (s: Scope) => {
    if (s === 'DASHBOARD') return templates.filter(t => t.displayScope === 'DASHBOARD').length;
    if (s === 'PERIODIC')  return 0;
    return templates.filter(t => (t.displayScope || 'ORDER') === s).length;
  };

  const st = SCOPE_STYLES[scope];
  const scopeMeta = SCOPES.find(s => s.key === scope)!;

  return (
    <div className="p-8" dir={lang === 'en' ? 'ltr' : 'rtl'}>
      {/* Header */}
      <header className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
            <Target className="w-7 h-7 text-indigo-600" />
            {lang === 'en' ? 'KPI Settings' : 'إعدادات المؤشرات (KPIs)'}
          </h1>
          <p className="text-slate-500 mt-0.5 text-sm">
            {lang === 'en' && scopeMeta.descEn ? scopeMeta.descEn : scopeMeta.descAr}
          </p>
        </div>
        {scope !== 'DASHBOARD' && scope !== 'PERIODIC' && (
          <button
            onClick={openModal}
            className={`${st.addBtn} text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors font-medium text-sm`}
          >
            <Plus className="w-4 h-4" />
            {lang === 'en' ? 'Add Indicator' : 'إضافة مؤشر'}
          </button>
        )}
      </header>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 mb-6 gap-1 overflow-x-auto no-scrollbar">
        {SCOPES.map(s => (
          <button
            key={s.key}
            onClick={() => setSearchParams({ scope: s.key })}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-all -mb-px whitespace-nowrap
              ${scope === s.key
                ? `${SCOPE_STYLES[s.key].tab} border-b-2`
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}`}
          >
            {s.icon}
            {lang === 'en' ? s.labelEn : s.labelAr}
            {getTabCount(s.key) > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${scope === s.key ? SCOPE_STYLES[s.key].badge : 'bg-slate-100 text-slate-500'}`}>
                {getTabCount(s.key)}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Scope banner */}
      {scope !== 'DASHBOARD' && scope !== 'PERIODIC' && (
        <div className={`rounded-xl border ${st.sectionBg} px-4 py-3 mb-6 flex items-start gap-3`}>
          <div className="mt-0.5 text-slate-500">{scopeMeta.icon}</div>
          <p className="text-sm text-slate-600">
            {scope === 'ORDER' && (
              lang === 'en'
                ? <>These indicators are calculated for each work order individually and appear in the <strong>"Indicators"</strong> tab at the bottom of the work order details page.</>
                : <>هذه المؤشرات تُحسب لكل أمر عمل بشكل منفرد وتظهر في تبويب <strong>"المؤشرات"</strong> أسفل صفحة تفاصيل أمر العمل.</>
            )}
            {scope === 'REPORT' && (
              lang === 'en'
                ? <>These indicators are aggregate, collecting data from all work orders and are used in the <strong>Reports page</strong> for managers.</>
                : <>هذه المؤشرات إجمالية تجمع بيانات جميع أوامر العمل وتستخدم في <strong>صفحة التقارير</strong> للمديرين.</>
            )}
          </p>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="text-center py-20 text-slate-400">{lang === 'en' ? 'Loading...' : 'جاري التحميل...'}</div>
      ) : scope === 'DASHBOARD' ? (
        <DashboardKpiConfig
          templates={templates} rules={rules} catalog={catalog}
          stages={stages} projectTypeOptions={projectTypeOptions}
          onRefresh={fetchData}
        />
      ) : scope === 'PERIODIC' ? (
        <PeriodicTabSection />
      ) : (
        <div className="space-y-6">
          {scopedTemplates.map(template => {
            const templateRules = rules.filter(r => r.templateId === template.id);
            return (
              <div key={template.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex justify-between items-center flex-wrap gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="font-bold text-slate-800">{lang === 'en' && template.nameEn ? template.nameEn : template.nameAr}</h2>
                    <span className="text-xs text-slate-500 bg-white px-2 py-0.5 rounded border">SLA: {template.defaultSlaDays} {lang === 'en' ? 'Days' : 'يوم'}</span>
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${template.category === 'FIN' ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700'}`}>
                      {template.category === 'FIN' ? (lang === 'en' ? 'Financial' : 'مالي') : (lang === 'en' ? 'Executive' : 'تنفيذي')}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 cursor-pointer text-xs text-slate-500">
                      <input type="checkbox" checked={template.active} onChange={e => handleUpdateTemplate(template.id, { active: e.target.checked })} className="w-3.5 h-3.5 rounded accent-indigo-600" />
                      {lang === 'en' ? 'Active' : 'نشط'}
                    </label>
                    <button onClick={() => handleDeleteTemplate(template.id, template.nameAr)} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title={lang === 'en' ? 'Delete' : 'حذف المؤشر'}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  {templateRules.length > 0 ? (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100">
                          <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">{lang === 'en' ? 'Project Type' : 'نوعية المشروع'}</th>
                          <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">{lang === 'en' ? 'SLA (Days)' : 'SLA (يوم)'}</th>
                          <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">{lang === 'en' ? 'Calc Mode' : 'طريقة الحساب'}</th>
                          <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">{lang === 'en' ? 'Start Type' : 'نوع البداية'}</th>
                          <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">{lang === 'en' ? 'Start' : 'بداية'}</th>
                          <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">{lang === 'en' ? 'End Type' : 'نوع النهاية'}</th>
                          <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">{lang === 'en' ? 'End' : 'نهاية'}</th>
                          <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">{lang === 'en' ? 'Sector' : 'فلترة القطاع'}</th>
                          <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">{lang === 'en' ? 'Status' : 'الحالة'}</th>
                          <th className="px-4 py-2.5 text-center text-xs font-medium text-slate-500 w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {templateRules.map(rule => {
                          const effectiveRule = { ...rule, ...(orderRuleDrafts[rule.id] ?? {}) };
                          const isDirty = !!orderRuleDrafts[rule.id];
                          return (
                          <tr key={rule.id} className={isDirty ? 'bg-amber-50 border-amber-200' : 'hover:bg-slate-50/50'}>
                            <td className="px-4 py-3">
                              <select value={effectiveRule.workTypeFilter || ''} onChange={e => handleUpdateRule(rule.id, { workTypeFilter: e.target.value || null })} className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm min-w-[120px]">
                                <option value="">{lang === 'en' ? 'All Types' : 'جميع الأنواع'}</option>
                                {projectTypeOptions.map((opt: any) => <option key={opt.value} value={opt.value}>{lang === 'en' && opt.labelEn ? opt.labelEn : opt.labelAr}</option>)}
                              </select>
                            </td>
                            <td className="px-4 py-3">
                              <input type="number" min="0" value={effectiveRule.slaDaysOverride ?? ''} placeholder={String(template.defaultSlaDays)} onChange={e => handleUpdateRule(rule.id, { slaDaysOverride: e.target.value ? parseInt(e.target.value) : null })} className="w-20 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-center" />
                            </td>
                            <td className="px-4 py-3">
                              <select value={effectiveRule.calcMode} onChange={e => handleUpdateRule(rule.id, { calcMode: e.target.value })} className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm">
                                <option value="DATES">{lang === 'en' ? 'Days Diff' : 'فرق الأيام'}</option>
                                <option value="RATIO">{lang === 'en' ? 'Percentage' : 'نسبة مئوية'}</option>
                                <option value="DIFF">{lang === 'en' ? 'Financial Diff' : 'فرق مالي'}</option>
                              </select>
                            </td>
                            <td className="px-4 py-3">
                              {effectiveRule.calcMode === 'DATES' ? (
                                <select value={effectiveRule.startMode || 'COLUMN_DATE'} onChange={e => handleUpdateRule(rule.id, { startMode: e.target.value, startColumnKey: null, startStageId: null })} className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm">
                                  <option value="COLUMN_DATE">{lang === 'en' ? 'Specific Date' : 'تاريخ محدد'}</option>
                                  <option value="STAGE">{lang === 'en' ? 'Stage' : 'إجراء'}</option>
                                </select>
                              ) : <span className="text-xs text-slate-400">—</span>}
                            </td>
                            <td className="px-4 py-3">
                              {(effectiveRule.startMode === 'STAGE' && effectiveRule.calcMode === 'DATES') ? (
                                <select value={effectiveRule.startStageId || ''} onChange={e => handleUpdateRule(rule.id, { startStageId: e.target.value || null })} className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm min-w-[130px]">
                                  <option value="">{lang === 'en' ? 'Select stage...' : 'اختر الإجراء...'}</option>
                                  {stages.map(s => <option key={s.id} value={s.id}>{lang === 'en' && s.nameEn ? s.nameEn : s.nameAr}</option>)}
                                </select>
                              ) : (
                                <select value={effectiveRule.startColumnKey || ''} onChange={e => handleUpdateRule(rule.id, { startColumnKey: e.target.value })} className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm min-w-[130px]">
                                  <option value="">{lang === 'en' ? 'Select...' : 'اختر...'}</option>
                                  {(effectiveRule.calcMode === 'DATES' ? dateColumns : numericColumns).map(c => <option key={c.columnKey} value={c.columnKey}>{lang === 'en' && c.labelEn ? c.labelEn : c.labelAr}</option>)}
                                </select>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {effectiveRule.calcMode === 'DATES' ? (
                                <select value={effectiveRule.endMode || 'COLUMN_DATE'} onChange={e => handleUpdateRule(rule.id, { endMode: e.target.value, endColumnKey: null, endStageId: null })} className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm">
                                  <option value="COLUMN_DATE">{lang === 'en' ? 'Specific Date' : 'تاريخ محدد'}</option>
                                  <option value="STAGE">{lang === 'en' ? 'Stage' : 'إجراء'}</option>
                                </select>
                              ) : <span className="text-xs text-slate-400">—</span>}
                            </td>
                            <td className="px-4 py-3">
                              {effectiveRule.endMode === 'COLUMN_DATE' ? (
                                <select value={effectiveRule.endColumnKey || ''} onChange={e => handleUpdateRule(rule.id, { endColumnKey: e.target.value })} className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm min-w-[130px]">
                                  {effectiveRule.calcMode === 'DATES' && <option value="">{lang === 'en' ? 'Today' : 'اليوم'}</option>}
                                  {(effectiveRule.calcMode === 'DATES' ? dateColumns : numericColumns).map(c => <option key={c.columnKey} value={c.columnKey}>{lang === 'en' && c.labelEn ? c.labelEn : c.labelAr}</option>)}
                                </select>
                              ) : (
                                <select value={effectiveRule.endStageId || ''} onChange={e => handleUpdateRule(rule.id, { endStageId: e.target.value })} className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm min-w-[130px]">
                                  <option value="">{lang === 'en' ? 'Select stage...' : 'اختر الإجراء...'}</option>
                                  {stages.map(s => <option key={s.id} value={s.id}>{lang === 'en' && s.nameEn ? s.nameEn : s.nameAr}</option>)}
                                </select>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <select value={effectiveRule.sectorIdFilter || ''} onChange={e => handleUpdateRule(rule.id, { sectorIdFilter: e.target.value || null })} className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm min-w-[100px]">
                                <option value="">{lang === 'en' ? 'All' : 'الكل'}</option>
                                {sectors.map(s => <option key={s.id} value={s.id}>{lang === 'en' && s.nameEn ? s.nameEn : s.nameAr}</option>)}
                              </select>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-col gap-1.5">
                                <label className="flex items-center gap-1.5 cursor-pointer text-xs text-slate-600 whitespace-nowrap">
                                  <input type="checkbox" checked={effectiveRule.active} onChange={e => handleUpdateRule(rule.id, { active: e.target.checked })} className="w-3.5 h-3.5 rounded accent-indigo-600" />
                                  {lang === 'en' ? 'Active' : 'نشط'}
                                </label>
                                <label className="flex items-center gap-1.5 cursor-pointer text-xs text-slate-600 whitespace-nowrap">
                                  <input type="checkbox" checked={effectiveRule.alertEnabled} onChange={e => handleUpdateRule(rule.id, { alertEnabled: e.target.checked })} className="w-3.5 h-3.5 rounded accent-amber-500" />
                                  {lang === 'en' ? 'Warning' : 'تنبيه'}
                                </label>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <div className="flex flex-col items-center gap-1">
                                {isDirty && (
                                  <button onClick={() => saveOrderRule(rule.id)} className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-medium transition-colors whitespace-nowrap">
                                    {lang === 'en' ? 'Save' : 'حفظ'}
                                  </button>
                                )}
                                <button onClick={() => handleDeleteRule(rule.id)} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title={lang === 'en' ? 'Delete rule' : 'حذف القاعدة'}>
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div className="text-center py-6 text-slate-400 text-sm flex items-center justify-center gap-2">
                      <AlertTriangle className="w-4 h-4" />
                      لا توجد قواعد حساب لهذا المؤشر
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {scopedTemplates.length === 0 && (
            <div className="text-center py-20 text-slate-400">
              <div className="text-4xl mb-3 opacity-30">{scope === 'ORDER' ? '📋' : '📊'}</div>
              <p className="font-medium">{lang === 'en' ? 'No indicators in this section' : 'لا توجد مؤشرات في هذا القسم'}</p>
              <p className="text-sm mt-1">{lang === 'en' ? 'Click "Add Indicator" to create the first indicator' : 'اضغط "إضافة مؤشر" لإنشاء أول مؤشر'}</p>
            </div>
          )}
        </div>
      )}

      {/* Add Modal (ORDER / REPORT scopes only) */}
      <AnimatePresence>
        {showModal && scope !== 'DASHBOARD' && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={e => e.target === e.currentTarget && setShowModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between p-6 border-b border-slate-200">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">{lang === 'en' ? 'Add New KPI Indicator' : 'إضافة مؤشر أداء جديد'}</h2>
                  <p className="text-xs text-slate-500 mt-0.5">{lang === 'en' ? 'Scope: ' : 'القسم: '} <span className="font-semibold">{lang === 'en' && scopeMeta.labelEn ? scopeMeta.labelEn : scopeMeta.labelAr}</span></p>
                </div>
                <button onClick={() => setShowModal(false)} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>

              <div className="p-6 space-y-5">
                <div className="bg-slate-50 rounded-xl p-4 space-y-4">
                  <h3 className="font-semibold text-slate-700 text-sm">{lang === 'en' ? 'Indicator Details' : 'بيانات المؤشر'}</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2 space-y-1">
                      <label className="text-sm font-medium text-slate-600">{lang === 'en' ? 'Indicator Name *' : 'اسم المؤشر *'}</label>
                      <input type="text" placeholder={lang === 'en' ? 'e.g., Coordination Duration' : 'مثال: مدة التنسيق'} value={newTemplate.nameAr} onChange={e => setNewTemplate({ ...newTemplate, nameAr: e.target.value })} className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-slate-600">{lang === 'en' ? 'Category' : 'الفئة'}</label>
                      <select value={newTemplate.category} onChange={e => setNewTemplate({ ...newTemplate, category: e.target.value })} className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none">
                        <option value="EXEC">{lang === 'en' ? 'Executive' : 'تنفيذي'}</option>
                        <option value="FIN">{lang === 'en' ? 'Financial' : 'مالي'}</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-50 rounded-xl p-4 space-y-4">
                  <h3 className="font-semibold text-slate-700 text-sm">{lang === 'en' ? 'Calculation Rule' : 'قاعدة الحساب'}</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-slate-600">{lang === 'en' ? 'Calculation Method' : 'طريقة الحساب'}</label>
                      <select value={newRuleBase.calcMode} onChange={e => setNewRuleBase({ ...newRuleBase, calcMode: e.target.value, startColumnKey: '', endColumnKey: '' })} className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none">
                        <option value="DATES">{lang === 'en' ? 'Days Difference' : 'فرق الأيام'}</option>
                        <option value="RATIO">{lang === 'en' ? 'Percentage' : 'نسبة مئوية'}</option>
                        <option value="DIFF">{lang === 'en' ? 'Financial Difference' : 'فرق مالي'}</option>
                      </select>
                    </div>
                    {newRuleBase.calcMode === 'DATES' && (
                      <div className="space-y-1">
                        <label className="text-sm font-medium text-slate-600">{lang === 'en' ? 'Start Type' : 'نوع البداية'}</label>
                        <select value={newRuleBase.startMode} onChange={e => setNewRuleBase({ ...newRuleBase, startMode: e.target.value, startColumnKey: '', startStageId: '' })} className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none">
                          <option value="COLUMN_DATE">{lang === 'en' ? 'Specific Date' : 'تاريخ محدد'}</option>
                          <option value="STAGE">{lang === 'en' ? 'Stage' : 'إجراء'}</option>
                        </select>
                      </div>
                    )}
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-slate-600">{newRuleBase.calcMode === 'DATES' ? (newRuleBase.startMode === 'STAGE' ? (lang === 'en' ? 'Start Stage *' : 'إجراء البداية *') : (lang === 'en' ? 'Start Date *' : 'تاريخ البداية *')) : (lang === 'en' ? 'First Value *' : 'القيمة الأولى *')}</label>
                      {(newRuleBase.calcMode === 'DATES' && newRuleBase.startMode === 'STAGE') ? (
                        <select value={newRuleBase.startStageId} onChange={e => setNewRuleBase({ ...newRuleBase, startStageId: e.target.value })} className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none">
                          <option value="">{lang === 'en' ? 'Select Stage...' : 'اختر الإجراء...'}</option>
                          {stages.map(s => <option key={s.id} value={s.id}>{lang === 'en' && s.nameEn ? s.nameEn : s.nameAr}</option>)}
                        </select>
                      ) : (
                        <select value={newRuleBase.startColumnKey} onChange={e => setNewRuleBase({ ...newRuleBase, startColumnKey: e.target.value })} className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none">
                          <option value="">{lang === 'en' ? 'Select Column...' : 'اختر العمود...'}</option>
                          {(newRuleBase.calcMode === 'DATES' ? (dateColumns.length ? dateColumns : catalog) : (numericColumns.length ? numericColumns : catalog)).map(c => (
                            <option key={c.columnKey} value={c.columnKey}>{lang === 'en' && c.labelEn ? c.labelEn : c.labelAr}</option>
                          ))}
                        </select>
                      )}
                    </div>
                    {newRuleBase.calcMode === 'DATES' && (
                      <div className="space-y-1">
                        <label className="text-sm font-medium text-slate-600">{lang === 'en' ? 'End Type' : 'نوع النهاية'}</label>
                        <select value={newRuleBase.endMode} onChange={e => setNewRuleBase({ ...newRuleBase, endMode: e.target.value, endColumnKey: '' })} className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none">
                          <option value="COLUMN_DATE">{lang === 'en' ? 'Specific Date / Today' : 'تاريخ محدد / اليوم'}</option>
                          <option value="STAGE">{lang === 'en' ? 'Stage' : 'إجراء'}</option>
                        </select>
                      </div>
                    )}
                    {(newRuleBase.calcMode !== 'DATES' || newRuleBase.endMode === 'COLUMN_DATE') && (
                      <div className="space-y-1">
                        <label className="text-sm font-medium text-slate-600">{newRuleBase.calcMode === 'DATES' ? (lang === 'en' ? 'End Date' : 'تاريخ النهاية') : (lang === 'en' ? 'Second Value' : 'القيمة الثانية')}</label>
                        <select value={newRuleBase.endColumnKey} onChange={e => setNewRuleBase({ ...newRuleBase, endColumnKey: e.target.value })} className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none">
                          <option value="">{lang === 'en' ? 'Today (Continuous)' : 'اليوم (مستمر)'}</option>
                          {(newRuleBase.calcMode === 'DATES' ? (dateColumns.length ? dateColumns : catalog) : (numericColumns.length ? numericColumns : catalog)).map(c => (
                            <option key={c.columnKey} value={c.columnKey}>{lang === 'en' && c.labelEn ? c.labelEn : c.labelAr}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    {(newRuleBase.calcMode === 'DATES' && newRuleBase.endMode === 'STAGE') && (
                      <div className="space-y-1">
                        <label className="text-sm font-medium text-slate-600">{lang === 'en' ? 'End Stage' : 'إجراء النهاية'}</label>
                        <select value={newRuleBase.endColumnKey} onChange={e => setNewRuleBase({ ...newRuleBase, endColumnKey: e.target.value })} className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none">
                          <option value="">{lang === 'en' ? 'Select Stage...' : 'اختر الإجراء...'}</option>
                          {stages.map(s => <option key={s.id} value={s.id}>{lang === 'en' && s.nameEn ? s.nameEn : s.nameAr}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 space-y-3">
                  <h3 className="font-semibold text-slate-700 text-sm flex items-center gap-2">
                    <span className="text-amber-600">⏱</span>
                    مدة SLA حسب نوعية المشروع
                  </h3>
                  <p className="text-xs text-slate-500">فعّل الأنواع التي تريد تحديد مدة خاصة لها</p>
                  <div className="space-y-2">
                    <div className={`flex items-center gap-3 p-3 rounded-lg border ${globalFallbackEnabled ? 'bg-white border-amber-200' : 'bg-slate-50 border-slate-200 opacity-60'}`}>
                      <input type="checkbox" checked={globalFallbackEnabled} onChange={e => setGlobalFallbackEnabled(e.target.checked)} className="w-4 h-4 rounded accent-amber-500 flex-shrink-0" />
                      <span className="text-sm font-medium text-slate-700 flex-1">{lang === 'en' ? 'All Types (Default)' : 'جميع الأنواع (افتراضي)'}</span>
                      <div className="flex items-center gap-2">
                        <input type="number" min="0" disabled={!globalFallbackEnabled} value={globalFallbackSla} onChange={e => setGlobalFallbackSla(Number(e.target.value))} className="w-20 px-2 py-1 border border-slate-200 rounded-lg text-sm text-center bg-white disabled:bg-slate-100" />
                        <span className="text-xs text-slate-500">{lang === 'en' ? 'Days' : 'يوم'}</span>
                      </div>
                    </div>
                    {projectTypeSlas.map((pt, idx) => (
                      <div key={pt.value} className={`flex items-center gap-3 p-3 rounded-lg border ${pt.enabled ? 'bg-white border-indigo-200' : 'bg-slate-50 border-slate-200'}`}>
                        <input type="checkbox" checked={pt.enabled} onChange={e => setProjectTypeSlas(prev => prev.map((p, i) => i === idx ? { ...p, enabled: e.target.checked } : p))} className="w-4 h-4 rounded accent-indigo-600 flex-shrink-0" />
                        <span className={`text-sm flex-1 ${pt.enabled ? 'text-slate-800 font-medium' : 'text-slate-500'}`}>{lang === 'en' && pt.labelEn ? pt.labelEn : pt.labelAr}</span>
                        <div className="flex items-center gap-2">
                          <input type="number" min="0" disabled={!pt.enabled} value={pt.slaDays} onChange={e => setProjectTypeSlas(prev => prev.map((p, i) => i === idx ? { ...p, slaDays: Number(e.target.value) } : p))} className="w-20 px-2 py-1 border border-slate-200 rounded-lg text-sm text-center bg-white disabled:bg-slate-100" />
                          <span className="text-xs text-slate-500">{lang === 'en' ? 'Days' : 'يوم'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex gap-3 p-6 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
                <button onClick={() => setShowModal(false)} className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-white transition-colors font-medium">{lang === 'en' ? 'Cancel' : 'إلغاء'}</button>
                <button onClick={handleAddKpi} disabled={saving} className={`flex-1 px-4 py-2 ${st.addBtn} text-white rounded-lg transition-colors font-medium disabled:opacity-50`}>
                  {saving ? (lang === 'en' ? 'Saving...' : 'جاري الحفظ...') : (lang === 'en' ? 'Add Indicator' : 'إضافة المؤشر')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
