import ar from './ar';
import en from './en';

export type Lang = 'ar' | 'en';

type Translations = typeof ar;
export type TranslationKey = keyof Translations;

const dictionaries: Record<Lang, Translations> = { ar, en };

export function getLang(): Lang {
  return (localStorage.getItem('lang') as Lang) || 'ar';
}

export function setLang(lang: Lang) {
  localStorage.setItem('lang', lang);
  document.documentElement.dir  = lang === 'ar' ? 'rtl' : 'ltr';
  document.documentElement.lang = lang;
}

export function t(key: TranslationKey, lang?: Lang): string {
  const l = lang ?? getLang();
  return dictionaries[l][key] ?? dictionaries['ar'][key] ?? key;
}

/** Pick the right label from a catalog column object based on current language */
export function getColLabel(col: { labelAr: string; labelEn?: string | null }, lang?: Lang): string {
  const l = lang ?? getLang();
  if (l === 'en' && col.labelEn) return col.labelEn;
  return col.labelAr;
}

// Apply on initial load
setLang(getLang());
