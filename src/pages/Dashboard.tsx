import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { motion } from 'motion/react';
import { LayoutDashboard, Users, ClipboardList, TrendingUp, DollarSign, AlertTriangle } from 'lucide-react';
import { useLang } from '../contexts/LangContext';
import type { TranslationKey } from '../i18n';

export default function Dashboard() {
  const { t, lang } = useLang();
  const [stats, setStats] = useState<any>({
    total: 0,
    byStatus: {},
    finance: { totalValue: 0 },
    kpis: { overdue: 0, warn: 0, ok: 0 }
  });
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [ordersRes, kpiRes] = await Promise.all([
          api.get('/work-orders'),
          api.get('/kpis/summary/all')
        ]);
        const orders = ordersRes.data;
        const byStatus = orders.reduce((acc: any, curr: any) => {
          acc[curr.status] = (acc[curr.status] || 0) + 1;
          return acc;
        }, {});
        const totalValue = orders.reduce((acc: number, curr: any) => {
          return acc + (Number(curr.estimatedValue ?? curr.estimated_value) || 0);
        }, 0);
        setStats({ total: orders.length, byStatus, finance: { totalValue }, kpis: kpiRes.data });
      } catch (err) {
        console.error(err);
      }
    };
    fetchStats();
  }, []);

  const totalValueFormatted = stats.finance.totalValue.toLocaleString('en-US');

  const kpis: { labelKey: TranslationKey; value: any; icon: React.ElementType; color: string; bg: string }[] = [
    { labelKey: 'dashboard.total_wo',     value: stats.total,                        icon: ClipboardList, color: 'text-blue-600',    bg: 'bg-blue-50' },
    { labelKey: 'dashboard.overdue_kpis', value: stats.kpis.overdue,                 icon: AlertTriangle, color: 'text-red-600',     bg: 'bg-red-50' },
    { labelKey: 'dashboard.at_risk_kpis', value: stats.kpis.warn,                    icon: TrendingUp,    color: 'text-amber-600',   bg: 'bg-amber-50' },
    { labelKey: 'dashboard.completed',    value: stats.byStatus['COMPLETED'] || 0,   icon: Users,         color: 'text-emerald-600', bg: 'bg-emerald-50' },
  ];

  if (user.role === 'ADMIN' || user.role === 'FINANCE') {
    kpis.push({
      labelKey: 'dashboard.total_value' as const,
      value: `${totalValueFormatted} ${t('dashboard.sar')}`,
      icon: DollarSign,
      color: 'text-indigo-600',
      bg: 'bg-indigo-50',
    });
  }

  return (
    <div className="p-4 md:p-8" dir={lang === 'en' ? 'ltr' : 'rtl'}>
      <header className="mb-6 md:mb-8">
        <h1 className="text-xl md:text-2xl font-bold text-slate-900 flex items-center gap-3">
          <LayoutDashboard className="w-7 h-7 md:w-8 md:h-8 text-indigo-600" />
          {t('dashboard.title')}
        </h1>
        <p className="text-slate-500 text-sm mt-1">
          {lang === 'en' ? `Welcome, ${user.fullname || user.username}` : `مرحباً، ${user.fullname || user.username}`}
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mb-6 md:mb-8">
        {kpis.map((kpi, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-white p-4 md:p-6 rounded-2xl border border-slate-200"
            style={{ boxShadow: 'var(--shadow-card)' }}
          >
            <div className="flex items-center justify-between mb-4">
              <div className={`p-3 rounded-xl ${kpi.bg}`}>
                <kpi.icon className={`w-6 h-6 ${kpi.color}`} />
              </div>
            </div>
            <div className="text-2xl font-bold text-slate-900">{kpi.value}</div>
            <div className="text-sm text-slate-500 mt-1">{t(kpi.labelKey)}</div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-6 rounded-2xl border border-slate-200" style={{ boxShadow: 'var(--shadow-card)' }}>
          <h3 className="font-bold text-slate-800 mb-4">{t('dashboard.status_dist')}</h3>
          <div className="space-y-4">
            {Object.entries(stats.byStatus).map(([status, count]: any) => (
              <div key={status} className="flex items-center justify-between gap-4">
                <span className="text-slate-600 text-sm whitespace-nowrap">
                  {lang === 'en' 
                    ? (status === 'COMPLETED' ? 'Completed' : 
                       status === 'CANCELLED' ? 'Cancelled' : 
                       status === 'IN_PROGRESS' ? 'In Progress' : 
                       status === 'PENDING' ? 'Pending' : 
                       status === 'ON_HOLD' ? 'On Hold' : status)
                    : (status === 'COMPLETED' ? 'منجز' : 
                       status === 'CANCELLED' ? 'ملغي' : 
                       status === 'IN_PROGRESS' ? 'قيد التنفيذ' : 
                       status === 'PENDING' ? 'قيد الانتظار' : 
                       status === 'ON_HOLD' ? 'معلق' : status)
                  }
                </span>
                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 rounded-full"
                    style={{ width: `${(count / stats.total) * 100}%` }}
                  />
                </div>
                <span className="font-bold text-slate-900 text-sm">{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
