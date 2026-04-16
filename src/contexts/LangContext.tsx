import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { getLang, setLang, t as translate, TranslationKey, Lang } from '../i18n';

interface LangCtx {
  lang: Lang;
  toggleLang: () => void;
  t: (key: TranslationKey) => string;
  isRtl: boolean;
}

const LangContext = createContext<LangCtx>({
  lang: 'ar',
  toggleLang: () => {},
  t: (k) => k,
  isRtl: true,
});

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getLang);

  useEffect(() => {
    setLang(lang);
  }, [lang]);

  const toggleLang = () => {
    setLangState(l => {
      const next: Lang = l === 'ar' ? 'en' : 'ar';
      setLang(next);
      return next;
    });
  };

  const tFn = (key: TranslationKey) => translate(key, lang);

  return (
    <LangContext.Provider value={{ lang, toggleLang, t: tFn, isRtl: lang === 'ar' }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  return useContext(LangContext);
}
