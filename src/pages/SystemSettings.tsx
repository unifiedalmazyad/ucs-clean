import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLang } from '../contexts/LangContext';
import api from '../services/api';
import { Settings, Upload, CheckCircle, AlertCircle, Loader2, Image, X, FileSpreadsheet, FileText } from 'lucide-react';

const DEFAULT_W = 150;
const MIN_W     = 40;
const MAX_W     = 320;

interface WidthControlProps {
  label:     string;
  icon:      React.ReactNode;
  value:     number;
  testId:    string;
  onChange:  (v: number) => void;
}

function WidthControl({ label, icon, value, testId, onChange }: WidthControlProps) {
  const [numStr, setNumStr] = useState(String(value));
  useEffect(() => { setNumStr(String(value)); }, [value]);

  const commit = () => {
    const v = parseInt(numStr, 10);
    onChange(isNaN(v) ? DEFAULT_W : v);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {icon}
          <span className="text-xs font-medium text-slate-500">{label}</span>
        </div>
        <input
          type="number"
          min={MIN_W}
          max={MAX_W}
          value={numStr}
          onChange={e => setNumStr(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
          data-testid={testId}
          className="w-16 text-center border border-slate-200 rounded-lg py-1 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
      </div>
      <input
        type="range"
        min={MIN_W}
        max={MAX_W}
        step={5}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        data-testid={`${testId}-slider`}
        className="w-full accent-indigo-600"
      />
      <div className="flex justify-between text-xs text-slate-400">
        <span>{MIN_W}</span>
        <span>{MAX_W}</span>
      </div>
    </div>
  );
}

interface LogoCardProps {
  side:         'right' | 'left';
  label:        string;
  url:          string;
  widthExcel:   number;
  widthPdf:     number;
  uploading:    boolean;
  inputRef:     React.RefObject<HTMLInputElement>;
  lang:         'ar' | 'en';
  onUpload:     (side: 'right' | 'left', file: File) => void;
  onRemove:     (side: 'right' | 'left') => void;
  onWidthExcel: (side: 'right' | 'left', w: number) => void;
  onWidthPdf:   (side: 'right' | 'left', w: number) => void;
}

function LogoCard({ side, label, url, widthExcel, widthPdf, uploading, inputRef, lang, onUpload, onRemove, onWidthExcel, onWidthPdf }: LogoCardProps) {
  const isAr = lang === 'ar';
  const previewW = widthPdf;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 flex flex-col gap-4">

      <div className="flex items-center gap-2">
        <Image className="w-4 h-4 text-indigo-500" />
        <span className="font-semibold text-slate-700 text-sm">{label}</span>
      </div>

      {/* Live preview — uses PDF width */}
      <div
        className="border border-slate-200 rounded-xl bg-slate-50 flex items-center justify-center overflow-hidden transition-all"
        style={{ minHeight: 80, height: Math.max(80, previewW + 16) }}
        data-testid={`preview-logo-${side}`}
      >
        {url ? (
          <img
            src={url}
            alt={label}
            style={{ width: previewW, maxHeight: previewW, objectFit: 'contain' }}
            data-testid={`img-logo-${side}`}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-slate-300">
            <Image className="w-8 h-8" />
            <span className="text-xs">{isAr ? 'لا يوجد شعار' : 'No logo'}</span>
          </div>
        )}
      </div>

      {/* Width controls — separate for Excel and PDF */}
      <div className="space-y-4 pt-1 border-t border-slate-100">
        <WidthControl
          label={isAr ? 'عرض في Excel (بكسل)' : 'Excel width (px)'}
          icon={<FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />}
          value={widthExcel}
          testId={`input-logo-width-excel-${side}`}
          onChange={w => onWidthExcel(side, w)}
        />
        <WidthControl
          label={isAr ? 'عرض في PDF (بكسل)' : 'PDF width (px)'}
          icon={<FileText className="w-3.5 h-3.5 text-red-400" />}
          value={widthPdf}
          testId={`input-logo-width-pdf-${side}`}
          onChange={w => onWidthPdf(side, w)}
        />
      </div>

      {url && (
        <button
          onClick={() => onRemove(side)}
          data-testid={`btn-remove-logo-${side}`}
          className="flex items-center justify-center gap-1.5 w-full py-2 px-4 text-sm text-red-500 border border-red-100 bg-red-50 rounded-xl hover:bg-red-100 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          {isAr ? 'حذف الشعار' : 'Remove logo'}
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/svg+xml,image/webp"
        className="hidden"
        data-testid={`input-logo-${side}`}
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) onUpload(side, file);
          e.target.value = '';
        }}
      />

      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        data-testid={`btn-upload-logo-${side}`}
        className="flex items-center justify-center gap-2 w-full py-2.5 px-4 text-sm font-medium bg-indigo-50 text-indigo-600 border border-indigo-100 rounded-xl hover:bg-indigo-100 transition-colors disabled:opacity-60"
      >
        {uploading
          ? <><Loader2 className="w-4 h-4 animate-spin" />{isAr ? 'جاري الرفع...' : 'Uploading...'}</>
          : <><Upload className="w-4 h-4" />{isAr ? 'رفع شعار' : 'Upload logo'}</>
        }
      </button>

      <p className="text-xs text-slate-400 text-center">
        {isAr ? 'PNG, JPG, SVG, WEBP — بحد أقصى 5 ميجابايت' : 'PNG, JPG, SVG, WEBP — max 5 MB'}
      </p>
    </div>
  );
}

interface SettingsState {
  logo_right_url:         string;
  logo_left_url:          string;
  logo_right_width_excel: number;
  logo_left_width_excel:  number;
  logo_right_width_pdf:   number;
  logo_left_width_pdf:    number;
}

export default function SystemSettings() {
  const { lang } = useLang();
  const isRtl = lang === 'ar';

  const [settings, setSettings]     = useState<SettingsState>({
    logo_right_url:         '',
    logo_left_url:          '',
    logo_right_width_excel: DEFAULT_W,
    logo_left_width_excel:  DEFAULT_W,
    logo_right_width_pdf:   DEFAULT_W,
    logo_left_width_pdf:    DEFAULT_W,
  });
  const [loading, setLoading]       = useState(true);
  const [uploadingR, setUploadingR] = useState(false);
  const [uploadingL, setUploadingL] = useState(false);
  const [toast, setToast]           = useState<{ msg: string; ok: boolean } | null>(null);

  const rightInputRef = useRef<HTMLInputElement>(null);
  const leftInputRef  = useRef<HTMLInputElement>(null);
  const saveTimers    = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/admin/system-settings');
        const d   = res.data as Record<string, string>;
        setSettings({
          logo_right_url:         d.logo_right_url          ?? '',
          logo_left_url:          d.logo_left_url           ?? '',
          logo_right_width_excel: d.logo_right_width_excel  ? Number(d.logo_right_width_excel) : DEFAULT_W,
          logo_left_width_excel:  d.logo_left_width_excel   ? Number(d.logo_left_width_excel)  : DEFAULT_W,
          logo_right_width_pdf:   d.logo_right_width_pdf    ? Number(d.logo_right_width_pdf)   : DEFAULT_W,
          logo_left_width_pdf:    d.logo_left_width_pdf     ? Number(d.logo_left_width_pdf)    : DEFAULT_W,
        });
      } catch {
        showToast(lang === 'ar' ? 'فشل تحميل الإعدادات' : 'Failed to load settings', false);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const saveKey = useCallback((key: string, value: string) => {
    clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(async () => {
      try {
        await api.put(`/admin/system-settings/${key}`, { value });
      } catch {
        showToast(lang === 'ar' ? 'فشل حفظ الإعداد' : 'Failed to save setting', false);
      }
    }, 600);
  }, [lang]);

  const handleLogoUpload = async (side: 'right' | 'left', file: File) => {
    const setUploading = side === 'right' ? setUploadingR : setUploadingL;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('logo', file);
      const res = await api.post(`/admin/upload-logo?side=${side}`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setSettings(s => ({ ...s, [`logo_${side}_url`]: res.data.url }));
      showToast(lang === 'ar' ? 'تم رفع الشعار بنجاح' : 'Logo uploaded successfully');
    } catch (err: any) {
      const msg = err?.response?.data?.error || (lang === 'ar' ? 'فشل رفع الشعار' : 'Upload failed');
      showToast(msg, false);
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveLogo = async (side: 'right' | 'left') => {
    try {
      await api.put(`/admin/system-settings/logo_${side}_url`, { value: '' });
      setSettings(s => ({ ...s, [`logo_${side}_url`]: '' }));
      showToast(lang === 'ar' ? 'تم حذف الشعار' : 'Logo removed');
    } catch {
      showToast(lang === 'ar' ? 'فشل الحذف' : 'Remove failed', false);
    }
  };

  const handleWidthChange = useCallback((
    side: 'right' | 'left',
    format: 'excel' | 'pdf',
    raw: number,
  ) => {
    const w   = Math.max(MIN_W, Math.min(MAX_W, isNaN(raw) ? DEFAULT_W : raw));
    const key = `logo_${side}_width_${format}` as keyof SettingsState;
    setSettings(s => ({ ...s, [key]: w }));
    saveKey(String(key), String(w));
  }, [saveKey]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 gap-3">
        <Loader2 className="w-6 h-6 animate-spin" />
        <span className="text-sm">{lang === 'ar' ? 'جاري التحميل...' : 'Loading...'}</span>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8" dir={isRtl ? 'rtl' : 'ltr'}>

      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-5 py-3 rounded-xl shadow-lg text-sm font-medium
          ${toast.ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-red-50 border border-red-200 text-red-700'}`}
          data-testid="toast-system-settings"
        >
          {toast.ok ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
          {toast.msg}
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
          <Settings className="w-5 h-5 text-indigo-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-800">
            {lang === 'ar' ? 'إعدادات النظام' : 'System Settings'}
          </h1>
          <p className="text-sm text-slate-500">
            {lang === 'ar' ? 'الشعارات التي تظهر في رأس التقارير' : 'Logos shown in the report header'}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="font-semibold text-slate-700 flex items-center gap-2">
          <Image className="w-4 h-4 text-indigo-500" />
          {lang === 'ar' ? 'شعارات التقارير' : 'Report Logos'}
        </h2>
        <p className="text-sm text-slate-500">
          {lang === 'ar'
            ? 'حدّد العرض لكل شعار بشكل منفصل في Excel وPDF — المعاينة تعكس مقاس PDF.'
            : 'Set width separately for Excel and PDF — preview reflects the PDF size.'}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <LogoCard
            side="right"
            label={lang === 'ar' ? 'الشعار الأيمن' : 'Right Logo'}
            url={settings.logo_right_url}
            widthExcel={settings.logo_right_width_excel}
            widthPdf={settings.logo_right_width_pdf}
            uploading={uploadingR}
            inputRef={rightInputRef}
            lang={lang}
            onUpload={handleLogoUpload}
            onRemove={handleRemoveLogo}
            onWidthExcel={(side, w) => handleWidthChange(side, 'excel', w)}
            onWidthPdf={(side, w)   => handleWidthChange(side, 'pdf',   w)}
          />
          <LogoCard
            side="left"
            label={lang === 'ar' ? 'الشعار الأيسر' : 'Left Logo'}
            url={settings.logo_left_url}
            widthExcel={settings.logo_left_width_excel}
            widthPdf={settings.logo_left_width_pdf}
            uploading={uploadingL}
            inputRef={leftInputRef}
            lang={lang}
            onUpload={handleLogoUpload}
            onRemove={handleRemoveLogo}
            onWidthExcel={(side, w) => handleWidthChange(side, 'excel', w)}
            onWidthPdf={(side, w)   => handleWidthChange(side, 'pdf',   w)}
          />
        </div>
      </div>

      {/* Combined header preview — uses PDF widths */}
      {(settings.logo_right_url || settings.logo_left_url) && (
        <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
          <p className="text-xs text-indigo-600 font-medium mb-3 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" />
            {lang === 'ar' ? 'معاينة رأس التقرير (مقاسات PDF)' : 'Report Header Preview (PDF sizes)'}
          </p>
          <div
            className="bg-white rounded-lg border border-indigo-100 px-6 py-4 flex items-center justify-between gap-4"
            dir="ltr"
            style={{ minHeight: 80 }}
            data-testid="preview-report-header"
          >
            <div style={{ flexShrink: 0 }}>
              {settings.logo_left_url
                ? <img src={settings.logo_left_url} alt="left" style={{ width: settings.logo_left_width_pdf, maxHeight: settings.logo_left_width_pdf, objectFit: 'contain' }} />
                : <div style={{ width: settings.logo_left_width_pdf, height: Math.min(settings.logo_left_width_pdf, 60) }} className="bg-slate-100 rounded" />
              }
            </div>
            <div className="flex-1 text-center space-y-1" dir={isRtl ? 'rtl' : 'ltr'}>
              <p className="text-xs text-slate-500">{lang === 'ar' ? 'المنطقة: ...' : 'Region: ...'}</p>
              <p className="text-xs text-slate-400">{lang === 'ar' ? 'مصدر التقرير: ...' : 'Report By: ...'}</p>
              <p className="text-xs text-slate-400">{lang === 'ar' ? 'التاريخ: ...' : 'Date: ...'}</p>
            </div>
            <div style={{ flexShrink: 0 }}>
              {settings.logo_right_url
                ? <img src={settings.logo_right_url} alt="right" style={{ width: settings.logo_right_width_pdf, maxHeight: settings.logo_right_width_pdf, objectFit: 'contain' }} />
                : <div style={{ width: settings.logo_right_width_pdf, height: Math.min(settings.logo_right_width_pdf, 60) }} className="bg-slate-100 rounded" />
              }
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
