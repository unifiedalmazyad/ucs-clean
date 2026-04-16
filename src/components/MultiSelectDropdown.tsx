import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, X } from 'lucide-react';

interface Option {
  value: string;
  labelAr: string;
  labelEn: string;
}

interface Props {
  options: Option[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  placeholderEn?: string;
  lang?: 'ar' | 'en';
  className?: string;
  'data-testid'?: string;
}

export default function MultiSelectDropdown({
  options, selected, onChange, placeholder = 'الكل', placeholderEn = 'All', lang = 'ar', className = '', 'data-testid': testId,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggle = (val: string) => {
    if (selected.includes(val)) onChange(selected.filter(v => v !== val));
    else onChange([...selected, val]);
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
  };

  const label = selected.length === 0
    ? (lang === 'en' ? placeholderEn : placeholder)
    : selected.length === 1
      ? (options.find(o => o.value === selected[0])?.[lang === 'en' ? 'labelEn' : 'labelAr'] ?? selected[0])
      : `${selected.length} ${lang === 'en' ? 'selected' : 'محدد'}`;

  const active = selected.length > 0;

  return (
    <div ref={ref} className={`relative ${className}`} data-testid={testId}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 h-9 text-sm px-3 rounded-lg border bg-white outline-none transition-colors min-w-[120px] max-w-[180px] truncate
          ${active
            ? 'border-indigo-400 text-indigo-700 bg-indigo-50 font-medium'
            : 'border-slate-200 text-slate-600'
          } focus:ring-2 focus:ring-indigo-300`}
      >
        <span className="flex-1 text-start truncate">{label}</span>
        {active && (
          <span onClick={clear} className="shrink-0 hover:text-red-500 transition-colors" title={lang === 'en' ? 'Clear' : 'مسح'}>
            <X className="w-3.5 h-3.5" />
          </span>
        )}
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className={`absolute z-50 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg min-w-[160px] py-1.5 overflow-hidden
          ${lang === 'ar' ? 'right-0' : 'left-0'}`}>
          {options.map(opt => {
            const checked = selected.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggle(opt.value)}
                className={`flex items-center gap-2.5 w-full px-3 py-2 text-sm text-start transition-colors
                  ${checked ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-50'}`}
                data-testid={`option-${testId}-${opt.value}`}
              >
                <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors
                  ${checked ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300'}`}>
                  {checked && <Check className="w-2.5 h-2.5 text-white" />}
                </div>
                {lang === 'en' ? opt.labelEn : opt.labelAr}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
