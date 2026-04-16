import { useState, useEffect } from 'react';
import { useLang } from '../contexts/LangContext';
import api from '../services/api';
import { Plug, CheckCircle2, XCircle, AlertCircle, RefreshCw, Settings, ChevronDown, ChevronUp, Wifi, WifiOff, Clock } from 'lucide-react';

const INTEGRATION_META: Record<string, { nameAr: string; nameEn: string; descAr: string; descEn: string; color: string; bg: string }> = {
  n8n:    { nameAr: 'n8n Automation', nameEn: 'n8n Automation', descAr: 'ربط سير العمل التلقائي عبر n8n', descEn: 'Connect automated workflows via n8n', color: '#EA4B71', bg: '#FFF0F4' },
  jisr:   { nameAr: 'Jisr HR',        nameEn: 'Jisr HR',        descAr: 'تكامل نظام إدارة الموارد البشرية جسر', descEn: 'Human Resources management via Jisr', color: '#2563EB', bg: '#EFF6FF' },
  odoo:   { nameAr: 'Odoo ERP',       nameEn: 'Odoo ERP',       descAr: 'تكامل مع نظام أودو لتخطيط موارد المؤسسة', descEn: 'Enterprise Resource Planning via Odoo', color: '#7C3AED', bg: '#F5F3FF' },
  custom: { nameAr: 'Custom API',     nameEn: 'Custom API',     descAr: 'واجهة برمجية مخصصة لأي نظام خارجي', descEn: 'Custom API for any external system', color: '#059669', bg: '#ECFDF5' },
};

const AUTH_TYPES = [
  { value: 'api_key',      labelAr: 'مفتاح API',        labelEn: 'API Key' },
  { value: 'basic',        labelAr: 'مستخدم/كلمة مرور', labelEn: 'Basic Auth' },
  { value: 'oauth2',       labelAr: 'OAuth 2.0',         labelEn: 'OAuth 2.0' },
  { value: 'odoo_jsonrpc', labelAr: 'Odoo JSON-RPC',     labelEn: 'Odoo JSON-RPC' },
];

const SYNC_MODES = [
  { value: 'manual',  labelAr: 'يدوي',   labelEn: 'Manual' },
  { value: 'pull',    labelAr: 'سحب',    labelEn: 'Pull' },
  { value: 'webhook', labelAr: 'ويب هوك', labelEn: 'Webhook' },
];

function formatSyncDate(val: string | null | undefined, lang: string): string {
  if (!val) return lang === 'en' ? 'Never' : 'لم تتم بعد';
  const d = new Date(val);
  const day = d.getDate().toString().padStart(2, '0');
  const mon = (d.getMonth() + 1).toString().padStart(2, '0');
  const yr = d.getFullYear();
  const hr = d.getHours().toString().padStart(2, '0');
  const mn = d.getMinutes().toString().padStart(2, '0');
  return `${day}/${mon}/${yr} ${hr}:${mn}`;
}

function StatusBadge({ status, lang }: { status: string; lang: string }) {
  if (status === 'success') {
    return (
      <span data-testid="status-badge-success" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
        <CheckCircle2 className="w-3 h-3" />
        {lang === 'en' ? 'Connected' : 'متصل'}
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span data-testid="status-badge-failed" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
        <XCircle className="w-3 h-3" />
        {lang === 'en' ? 'Failed' : 'فشل'}
      </span>
    );
  }
  return (
    <span data-testid="status-badge-never" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-500">
      <AlertCircle className="w-3 h-3" />
      {lang === 'en' ? 'Not tested' : 'لم يُختبر'}
    </span>
  );
}

export default function Integrations() {
  const { lang } = useLang();
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const [notices, setNotices] = useState<Record<string, { type: 'success' | 'error'; msg: string }>>({});

  const user = JSON.parse(localStorage.getItem('user') || '{}');

  const showNotice = (id: string, type: 'success' | 'error', msg: string) => {
    setNotices(p => ({ ...p, [id]: { type, msg } }));
    setTimeout(() => setNotices(p => { const n = { ...p }; delete n[id]; return n; }), 5000);
  };

  const fetchAll = async () => {
    setLoading(true);
    try {
      const res = await api.get('/integrations');
      setIntegrations(res.data);
      const f: Record<string, any> = {};
      for (const row of res.data) {
        f[row.id] = {
          name:        row.name        || '',
          enabled:     row.enabled     ?? false,
          baseUrl:     row.baseUrl     || '',
          authType:    row.authType    || 'api_key',
          syncMode:    row.syncMode    || 'manual',
          apiKey:      row.apiKey      || '',
          username:    row.username    || '',
          password:    row.password    || '',
          clientId:    row.clientId    || '',
          clientSecret: row.clientSecret || '',
          accessToken: row.accessToken || '',
          refreshToken: row.refreshToken || '',
          webhookSecret: row.webhookSecret || '',
        };
      }
      setForms(f);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const handleSave = async (id: string) => {
    setSaving(p => ({ ...p, [id]: true }));
    try {
      await api.put(`/integrations/${id}`, forms[id]);
      await fetchAll();
      showNotice(id, 'success', lang === 'en' ? 'Saved successfully' : 'تم الحفظ بنجاح');
    } catch {
      showNotice(id, 'error', lang === 'en' ? 'Save failed' : 'فشل الحفظ');
    } finally {
      setSaving(p => ({ ...p, [id]: false }));
    }
  };

  const handleTest = async (id: string) => {
    setTesting(p => ({ ...p, [id]: true }));
    try {
      const res = await api.post(`/integrations/${id}/test`);
      const result = res.data;
      await fetchAll();
      const latStr = result.latencyMs ? ` (${result.latencyMs}ms)` : '';
      if (result.success) {
        showNotice(id, 'success', `${lang === 'en' ? 'Connection OK' : 'الاتصال ناجح'}${latStr}: ${result.message}`);
      } else {
        showNotice(id, 'error', `${lang === 'en' ? 'Connection failed' : 'فشل الاتصال'}: ${result.message}`);
      }
    } catch (e: any) {
      showNotice(id, 'error', lang === 'en' ? 'Test request failed' : 'فشل طلب الاختبار');
    } finally {
      setTesting(p => ({ ...p, [id]: false }));
    }
  };

  const handleSync = async (id: string) => {
    setSyncing(p => ({ ...p, [id]: true }));
    try {
      const res = await api.post(`/integrations/${id}/sync`);
      const result = res.data;
      await fetchAll();
      if (result.success) {
        showNotice(id, 'success', `${lang === 'en' ? 'Sync completed' : 'تم المزامنة'}: ${result.message}`);
      } else {
        showNotice(id, 'error', `${lang === 'en' ? 'Sync failed' : 'فشلت المزامنة'}: ${result.message}`);
      }
    } catch {
      showNotice(id, 'error', lang === 'en' ? 'Sync request failed' : 'فشل طلب المزامنة');
    } finally {
      setSyncing(p => ({ ...p, [id]: false }));
    }
  };

  const updateField = (id: string, field: string, value: any) => {
    setForms(p => ({ ...p, [id]: { ...p[id], [field]: value } }));
  };

  if (user.role !== 'ADMIN') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 text-center max-w-sm">
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-slate-800 mb-2">{lang === 'en' ? 'Admin Only' : 'للمدير فقط'}</h2>
          <p className="text-slate-500 text-sm">{lang === 'en' ? 'You do not have permission to view this page.' : 'لا تملك صلاحية الوصول لهذه الصفحة.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-[#1E3A5F] flex items-center justify-center">
            <Plug className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 data-testid="text-page-title" className="text-xl font-bold text-[#1E3A5F]">
              {lang === 'en' ? 'Integrations' : 'التكاملات'}
            </h1>
            <p className="text-sm text-slate-500">
              {lang === 'en' ? 'Configure external system connections' : 'إعداد الاتصالات مع الأنظمة الخارجية'}
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-white rounded-2xl border border-slate-200 p-5 animate-pulse h-28" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {integrations.map(row => {
            const meta = INTEGRATION_META[row.code] || { nameAr: row.name, nameEn: row.name, descAr: '', descEn: '', color: '#1E3A5F', bg: '#EFF6FF' };
            const isExpanded = expandedId === row.id;
            const form = forms[row.id] || {};
            const notice = notices[row.id];
            const isSaving = saving[row.id];
            const isTesting = testing[row.id];
            const isSyncing = syncing[row.id];
            const authType = form.authType || 'api_key';

            return (
              <div
                key={row.id}
                data-testid={`card-integration-${row.code}`}
                className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
              >
                {/* Card Header */}
                <div
                  className="flex items-center gap-4 p-5 cursor-pointer hover:bg-slate-50 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : row.id)}
                  data-testid={`button-expand-${row.code}`}
                >
                  {/* Icon */}
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 text-xl font-black"
                    style={{ background: meta.bg, color: meta.color }}
                  >
                    {row.code === 'n8n'    && <span className="font-black text-xs">n8n</span>}
                    {row.code === 'jisr'   && <span className="font-black text-xs">JS</span>}
                    {row.code === 'odoo'   && <span className="font-black text-xs">OD</span>}
                    {row.code === 'custom' && <Settings className="w-5 h-5" />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-800 text-sm">{lang === 'en' ? meta.nameEn : meta.nameAr}</span>
                      {row.enabled
                        ? <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full"><Wifi className="w-3 h-3" />{lang === 'en' ? 'Enabled' : 'مفعّل'}</span>
                        : <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-full"><WifiOff className="w-3 h-3" />{lang === 'en' ? 'Disabled' : 'معطّل'}</span>
                      }
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5 truncate">{lang === 'en' ? meta.descEn : meta.descAr}</p>
                    <div className="flex items-center gap-3 mt-1.5">
                      <StatusBadge status={row.lastStatus || 'never_run'} lang={lang} />
                      <span className="text-[10px] text-slate-400 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatSyncDate(row.lastSyncAt, lang)}
                      </span>
                    </div>
                  </div>

                  <div className="text-slate-400">
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                </div>

                {/* Expanded Config Form */}
                {isExpanded && (
                  <div className="border-t border-slate-100 p-5 space-y-4 bg-slate-50">

                    {/* Notice */}
                    {notice && (
                      <div data-testid={`notice-${row.code}`} className={`flex items-start gap-2 px-3 py-2 rounded-xl text-sm font-semibold ${notice.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                        {notice.type === 'success' ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <XCircle className="w-4 h-4 mt-0.5 shrink-0" />}
                        <span>{notice.msg}</span>
                      </div>
                    )}

                    {/* Last Error */}
                    {row.lastError && row.lastStatus === 'failed' && (
                      <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2 text-xs text-red-600">
                        <span className="font-bold">{lang === 'en' ? 'Last error: ' : 'آخر خطأ: '}</span>{row.lastError}
                      </div>
                    )}

                    {/* Enabled toggle */}
                    <div className="flex items-center justify-between bg-white rounded-xl border border-slate-200 px-4 py-3">
                      <span className="text-sm font-semibold text-slate-700">{lang === 'en' ? 'Enable Integration' : 'تفعيل التكامل'}</span>
                      <button
                        data-testid={`toggle-enabled-${row.code}`}
                        onClick={() => updateField(row.id, 'enabled', !form.enabled)}
                        className={`relative w-11 h-6 rounded-full transition-colors ${form.enabled ? 'bg-emerald-500' : 'bg-slate-300'}`}
                        type="button"
                      >
                        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${form.enabled ? 'left-5' : 'left-0.5'}`} />
                      </button>
                    </div>

                    {/* Base URL */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">{lang === 'en' ? 'Base URL' : 'رابط الخادم'}</label>
                      <input
                        data-testid={`input-baseurl-${row.code}`}
                        type="url"
                        value={form.baseUrl}
                        onChange={e => updateField(row.id, 'baseUrl', e.target.value)}
                        placeholder="https://your-server.example.com"
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#1E3A5F] bg-white"
                      />
                    </div>

                    {/* Auth Type */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">{lang === 'en' ? 'Auth Type' : 'نوع المصادقة'}</label>
                        <select
                          data-testid={`select-authtype-${row.code}`}
                          value={form.authType}
                          onChange={e => updateField(row.id, 'authType', e.target.value)}
                          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#1E3A5F] bg-white"
                        >
                          {AUTH_TYPES.map(a => (
                            <option key={a.value} value={a.value}>{lang === 'en' ? a.labelEn : a.labelAr}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">{lang === 'en' ? 'Sync Mode' : 'وضع المزامنة'}</label>
                        <select
                          data-testid={`select-syncmode-${row.code}`}
                          value={form.syncMode}
                          onChange={e => updateField(row.id, 'syncMode', e.target.value)}
                          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#1E3A5F] bg-white"
                        >
                          {SYNC_MODES.map(s => (
                            <option key={s.value} value={s.value}>{lang === 'en' ? s.labelEn : s.labelAr}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Conditional auth fields */}
                    {(authType === 'api_key') && (
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">{lang === 'en' ? 'API Key' : 'مفتاح API'}</label>
                        <input
                          data-testid={`input-apikey-${row.code}`}
                          type="password"
                          value={form.apiKey}
                          onChange={e => updateField(row.id, 'apiKey', e.target.value)}
                          placeholder={lang === 'en' ? 'Enter API key' : 'أدخل مفتاح API'}
                          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#1E3A5F] bg-white font-mono"
                        />
                      </div>
                    )}

                    {(authType === 'basic' || authType === 'odoo_jsonrpc') && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1">{lang === 'en' ? 'Username' : 'اسم المستخدم'}</label>
                          <input
                            data-testid={`input-username-${row.code}`}
                            type="text"
                            value={form.username}
                            onChange={e => updateField(row.id, 'username', e.target.value)}
                            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#1E3A5F] bg-white"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1">{lang === 'en' ? 'Password' : 'كلمة المرور'}</label>
                          <input
                            data-testid={`input-password-${row.code}`}
                            type="password"
                            value={form.password}
                            onChange={e => updateField(row.id, 'password', e.target.value)}
                            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#1E3A5F] bg-white"
                          />
                        </div>
                      </div>
                    )}

                    {(authType === 'oauth2') && (
                      <>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-1">{lang === 'en' ? 'Client ID' : 'Client ID'}</label>
                            <input
                              data-testid={`input-clientid-${row.code}`}
                              type="text"
                              value={form.clientId}
                              onChange={e => updateField(row.id, 'clientId', e.target.value)}
                              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#1E3A5F] bg-white"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-1">{lang === 'en' ? 'Client Secret' : 'Client Secret'}</label>
                            <input
                              data-testid={`input-clientsecret-${row.code}`}
                              type="password"
                              value={form.clientSecret}
                              onChange={e => updateField(row.id, 'clientSecret', e.target.value)}
                              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-[#1E3A5F] bg-white"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1">{lang === 'en' ? 'Access Token' : 'رمز الوصول'}</label>
                          <input
                            data-testid={`input-accesstoken-${row.code}`}
                            type="password"
                            value={form.accessToken}
                            onChange={e => updateField(row.id, 'accessToken', e.target.value)}
                            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-[#1E3A5F] bg-white"
                          />
                        </div>
                      </>
                    )}

                    {/* Webhook Secret (for webhook sync mode) */}
                    {form.syncMode === 'webhook' && (
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">{lang === 'en' ? 'Webhook Secret' : 'رمز Webhook'}</label>
                        <input
                          data-testid={`input-webhooksecret-${row.code}`}
                          type="password"
                          value={form.webhookSecret}
                          onChange={e => updateField(row.id, 'webhookSecret', e.target.value)}
                          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-[#1E3A5F] bg-white"
                        />
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex flex-wrap gap-2 pt-2">
                      <button
                        data-testid={`button-save-${row.code}`}
                        onClick={() => handleSave(row.id)}
                        disabled={isSaving}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-[#1E3A5F] text-white hover:bg-[#16304f] disabled:opacity-60 transition-colors"
                      >
                        {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
                        {lang === 'en' ? 'Save' : 'حفظ'}
                      </button>

                      <button
                        data-testid={`button-test-${row.code}`}
                        onClick={() => handleTest(row.id)}
                        disabled={isTesting}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-60 transition-colors"
                      >
                        {isTesting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
                        {lang === 'en' ? 'Test Connection' : 'اختبار الاتصال'}
                      </button>

                      {form.syncMode !== 'webhook' && (
                        <button
                          data-testid={`button-sync-${row.code}`}
                          onClick={() => handleSync(row.id)}
                          disabled={isSyncing}
                          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                        >
                          {isSyncing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                          {lang === 'en' ? 'Run Sync' : 'تشغيل المزامنة'}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
