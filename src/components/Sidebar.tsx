import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ClipboardList, Settings, LogOut,
  ChevronRight, ChevronLeft, Menu, X, Users, Map,
  Layers, Columns, ShieldCheck, Sliders,
  FileSpreadsheet, ArrowUpDown, Activity, PieChart, Plug, Download, ScrollText, BookMarked,
  Moon, Sun, FileText,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useLang } from '../contexts/LangContext';
import { useTheme } from '../contexts/ThemeContext';
import type { TranslationKey } from '../i18n';

function setFavicon(url: string) {
  let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = url || '';
}

export default function Sidebar() {
  const [isOpen, setIsOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );
  const [sidebarLogoUrl, setSidebarLogoUrl] = useState('');
  const navigate = useNavigate();
  const { t, lang, toggleLang, isRtl } = useLang();
  const { theme, toggleTheme } = useTheme();
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  // Load sidebar logo from report-header (accessible to all authenticated users)
  useEffect(() => {
    api.get('/admin/report-header').then(res => {
      const url = res.data?.sidebarLogoUrl ?? '';
      setSidebarLogoUrl(url);
      setFavicon(url);
    }).catch(() => {});
  }, []);

  // Live update when admin uploads/removes sidebar logo from SystemSettings
  useEffect(() => {
    const handler = (e: Event) => {
      const url = (e as CustomEvent<{ url: string }>).detail.url;
      setSidebarLogoUrl(url);
      setFavicon(url);
    };
    window.addEventListener('sidebar-logo-changed', handler);
    return () => window.removeEventListener('sidebar-logo-changed', handler);
  }, []);

  // Close sidebar on mobile when screen becomes desktop
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) setIsOpen(true);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const menuItems: { path: string; labelKey: TranslationKey; icon: React.ElementType }[] = [
    { path: '/dashboard',             labelKey: 'nav.dashboard',   icon: LayoutDashboard },
    { path: '/work-orders',           labelKey: 'nav.work_orders', icon: ClipboardList },
    { path: '/reports',               labelKey: 'nav.reports',     icon: FileSpreadsheet },
    { path: '/reports/center',        labelKey: 'nav.reportCenter',icon: BookMarked },
    { path: '/reports/periodic-kpis', labelKey: 'nav.periodic',    icon: Activity },
  ];

  if (user.canViewExecutiveDashboard || user.role === 'ADMIN') {
    menuItems.splice(1, 0, { path: '/dashboard/executive', labelKey: 'nav.executive', icon: PieChart });
  }

  if (user.canViewContracts || user.role === 'ADMIN') {
    menuItems.push({ path: '/contracts', labelKey: 'nav.contracts', icon: FileText });
  }

  if (user.role === 'ADMIN') {
    menuItems.push({ path: '/admin/users',   labelKey: 'nav.users',        icon: Users });
    menuItems.push({ path: '/admin/regions', labelKey: 'nav.regions',      icon: Map });
    menuItems.push({ path: '/admin/sectors', labelKey: 'nav.sectors',      icon: Layers });
    menuItems.push({ path: '/admin/columns', labelKey: 'nav.columns',      icon: Columns });
    menuItems.push({ path: '/admin/roles',   labelKey: 'nav.roles',        icon: ShieldCheck });
    menuItems.push({ path: '/admin/stages',  labelKey: 'nav.stages',       icon: Settings });
    menuItems.push({ path: '/admin/kpis',            labelKey: 'nav.kpi_settings',  icon: Settings });
    menuItems.push({ path: '/admin/integrations',    labelKey: 'nav.integrations',  icon: Plug });
    menuItems.push({ path: '/import-export',         labelKey: 'nav.import_export', icon: ArrowUpDown });
    menuItems.push({ path: '/export-center',         labelKey: 'nav.export_center', icon: Download });
    menuItems.push({ path: '/audit-log',             labelKey: 'nav.audit_log',     icon: ScrollText });
    menuItems.push({ path: '/admin/system-settings', labelKey: 'nav.system_settings', icon: Sliders });
  }

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  const handleNavClick = () => {
    if (window.innerWidth < 1024) setIsOpen(false);
  };

  const collapseIcon = isRtl ? ChevronRight : ChevronLeft;
  const expandIcon   = isRtl ? ChevronLeft  : ChevronRight;
  const CollapseIcon = collapseIcon;
  const ExpandIcon   = expandIcon;

  return (
    <>
      {/* Mobile Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        data-testid="button-mobile-menu"
        className="fixed top-3 right-3 z-50 p-2.5 bg-white rounded-xl shadow-md border border-slate-200 lg:hidden"
      >
        {isOpen ? <X className="w-5 h-5 text-slate-700" /> : <Menu className="w-5 h-5 text-slate-700" />}
      </button>

      {/* Backdrop (mobile only) */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-30 bg-black/30 lg:hidden"
            onClick={() => setIsOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {isOpen && (
          <motion.aside
            initial={{ x: isRtl ? '100%' : '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: isRtl ? '100%' : '-100%' }}
            transition={{ type: 'spring', damping: 20, stiffness: 100 }}
            className={`fixed inset-y-0 z-40 w-64 bg-white shadow-xl lg:relative lg:shadow-none flex flex-col
              ${isRtl ? 'right-0 border-l border-slate-200' : 'left-0 border-r border-slate-200'}`}
          >
            <div className="flex flex-col h-full">
              {/* Logo / Header */}
              <div className="p-5 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  {sidebarLogoUrl ? (
                    <img
                      src={sidebarLogoUrl}
                      alt="logo"
                      className="h-9 max-w-[120px] object-contain flex-shrink-0"
                    />
                  ) : (
                    <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center text-white font-bold text-xl flex-shrink-0">
                      {lang === 'ar' ? 'ع' : 'U'}
                    </div>
                  )}
                  <div className="min-w-0">
                    <h2 className="font-bold text-slate-800 leading-tight truncate text-sm">{t('app.title')}</h2>
                    <p className="text-xs text-slate-500 truncate">{t('app.subtitle')}</p>
                  </div>
                </div>
              </div>

              {/* Navigation */}
              <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
                {menuItems.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    onClick={handleNavClick}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200
                      ${isActive
                        ? 'bg-indigo-50 text-indigo-600 font-semibold'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                      }`
                    }
                  >
                    <item.icon className="w-5 h-5 flex-shrink-0" />
                    <span className="truncate text-sm">{t(item.labelKey)}</span>
                  </NavLink>
                ))}
              </nav>

              {/* Footer */}
              <div className="p-3 border-t border-slate-100 space-y-0.5">
                {/* User info */}
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center text-slate-600 font-semibold text-sm flex-shrink-0">
                    {(user.fullName || user.username)?.[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{user.fullName || user.username}</p>
                    <p className="text-xs text-slate-500 truncate">{user.role}</p>
                  </div>
                </div>

                {/* Language toggle */}
                <button
                  onClick={toggleLang}
                  data-testid="button-lang-toggle"
                  className="flex items-center gap-3 w-full px-4 py-2.5 text-slate-600 hover:bg-slate-50 rounded-xl transition-colors"
                  title={lang === 'ar' ? 'Switch to English' : 'التبديل للعربية'}
                >
                  <span className="w-5 h-5 flex-shrink-0 text-center text-sm font-bold text-indigo-600">
                    {lang === 'ar' ? 'EN' : 'ع'}
                  </span>
                  <span className="text-sm">{lang === 'ar' ? 'English' : 'العربية'}</span>
                </button>

                {/* Dark mode toggle */}
                <button
                  onClick={toggleTheme}
                  data-testid="button-theme-toggle"
                  className="flex items-center gap-3 w-full px-4 py-2.5 text-slate-600 hover:bg-slate-50 rounded-xl transition-colors"
                  title={theme === 'dark' ? 'الوضع النهاري' : 'الوضع الليلي'}
                >
                  {theme === 'dark'
                    ? <Sun className="w-5 h-5 flex-shrink-0 text-amber-500" />
                    : <Moon className="w-5 h-5 flex-shrink-0 text-slate-500" />
                  }
                  <span className="text-sm">{theme === 'dark' ? 'الوضع النهاري' : 'الوضع الليلي'}</span>
                </button>

                {/* Logout */}
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-3 w-full px-4 py-2.5 text-red-600 hover:bg-red-50 rounded-xl transition-colors"
                >
                  <LogOut className="w-5 h-5 flex-shrink-0" />
                  <span className="text-sm">{t('nav.logout')}</span>
                </button>
              </div>
            </div>

            {/* Desktop collapse button */}
            <button
              onClick={() => setIsOpen(false)}
              className={`absolute top-1/2 p-1 bg-white border border-slate-200 rounded-full shadow-sm hidden lg:block
                ${isRtl ? '-left-3' : '-right-3'}`}
            >
              <CollapseIcon className="w-4 h-4 text-slate-400" />
            </button>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Desktop expand button when closed */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className={`fixed top-1/2 z-40 p-1 bg-white border border-slate-200 shadow-sm hidden lg:block
            ${isRtl ? 'right-0 rounded-l-lg' : 'left-0 rounded-r-lg'}`}
        >
          <ExpandIcon className="w-5 h-5 text-slate-400" />
        </button>
      )}
    </>
  );
}
