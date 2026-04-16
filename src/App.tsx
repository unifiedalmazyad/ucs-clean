import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { LangProvider, useLang } from './contexts/LangContext';
import { ThemeProvider } from './contexts/ThemeContext';
import Sidebar from './components/Sidebar';
import api from './services/api';
import Login from './pages/Login';
import WorkOrders from './pages/WorkOrders';
import EditWorkOrder from './pages/EditWorkOrder';
import RoleManagement from './pages/RoleManagement';
import AdminStages from './pages/AdminStages';
import AdminKpis from './pages/AdminKpis';
import AdminUsers from './pages/AdminUsers';
import AdminRegions from './pages/AdminRegions';
import AdminSectors from './pages/AdminSectors';
import AdminColumns from './pages/AdminColumns';
import Dashboard from './pages/Dashboard';
import DashboardExecutive from './pages/DashboardExecutive';
import Reports from './pages/Reports';
import ReportCenter from './pages/ReportCenter';
import ImportExport from './pages/ImportExport';
import PeriodicKpiReport from './pages/PeriodicKpiReport';
import Integrations from './pages/Integrations';
import ExportCenter from './pages/ExportCenter';
import AuditLog from './pages/AuditLog';
import SystemSettings from './pages/SystemSettings';

const Layout = ({ children }: { children: React.ReactNode }) => {
  const token = localStorage.getItem('token');
  const { isRtl } = useLang();

  // Refresh user permissions from server on every app load
  // This ensures role changes are immediately visible without re-login
  useEffect(() => {
    if (!token) return;
    api.get('/auth/me').then(res => {
      const fresh = res.data;
      const stored = JSON.parse(localStorage.getItem('user') || '{}');
      localStorage.setItem('user', JSON.stringify({ ...stored, ...fresh }));
    }).catch(() => {});
  }, [token]);

  if (!token) return <Navigate to="/login" />;

  return (
    <div
      className="flex h-screen bg-slate-50 overflow-hidden"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <Sidebar />
      <main className="flex-1 overflow-y-auto pt-12 lg:pt-0">
        {children}
      </main>
    </div>
  );
};

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login"                   element={<Login />} />
      <Route path="/dashboard"               element={<Layout><Dashboard /></Layout>} />
      <Route path="/dashboard/executive"     element={<Layout><DashboardExecutive /></Layout>} />
      <Route path="/work-orders"             element={<Layout><WorkOrders /></Layout>} />
      <Route path="/work-orders/:id/edit"    element={<Layout><EditWorkOrder /></Layout>} />
      <Route path="/admin"                   element={<Navigate to="/admin/columns" replace />} />
      <Route path="/admin/roles"             element={<Layout><RoleManagement /></Layout>} />
      <Route path="/admin/column-permissions" element={<Navigate to="/admin/roles" />} />
      <Route path="/admin/stages"            element={<Layout><AdminStages /></Layout>} />
      <Route path="/admin/kpis"              element={<Layout><AdminKpis /></Layout>} />
      <Route path="/admin/users"             element={<Layout><AdminUsers /></Layout>} />
      <Route path="/admin/regions"           element={<Layout><AdminRegions /></Layout>} />
      <Route path="/admin/sectors"           element={<Layout><AdminSectors /></Layout>} />
      <Route path="/admin/column-groups"     element={<Navigate to="/admin/columns?tab=groups" />} />
      <Route path="/admin/columns"           element={<Layout><AdminColumns /></Layout>} />
      <Route path="/reports"                 element={<Layout><Reports /></Layout>} />
      <Route path="/reports/center"          element={<Layout><ReportCenter /></Layout>} />
      <Route path="/reports/periodic-kpis"   element={<Layout><PeriodicKpiReport /></Layout>} />
      <Route path="/admin/integrations"      element={<Layout><Integrations /></Layout>} />
      <Route path="/import-export"           element={<Layout><ImportExport /></Layout>} />
      <Route path="/export-center"          element={<Layout><ExportCenter /></Layout>} />
      <Route path="/audit-log"              element={<Layout><AuditLog /></Layout>} />
      <Route path="/admin/system-settings"  element={<Layout><SystemSettings /></Layout>} />
      <Route path="/"                        element={<Navigate to="/dashboard" />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <LangProvider>
          <AppRoutes />
        </LangProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
