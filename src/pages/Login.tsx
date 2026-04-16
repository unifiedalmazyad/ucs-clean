import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { motion } from 'motion/react';
import { Lock, User } from 'lucide-react';
import { useLang } from '../contexts/LangContext';

export default function Login() {
  const { t, lang, toggleLang, isRtl } = useLang();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.post('/auth/login', { username, password });
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('user', JSON.stringify(res.data.user));
      navigate('/work-orders');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Login failed');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Language toggle */}
      <button
        onClick={toggleLang}
        className="fixed top-4 left-4 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm font-semibold text-indigo-600 hover:bg-indigo-50 transition-colors shadow-sm"
        data-testid="button-lang-toggle-login"
      >
        {lang === 'ar' ? 'EN' : 'ع'}
      </button>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-white rounded-2xl p-8 border border-slate-200"
        style={{ boxShadow: 'var(--shadow-card)' }}
      >
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center text-white font-bold text-2xl mx-auto mb-4">
            {lang === 'ar' ? 'ع' : 'U'}
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-1">{t('app.title')}</h1>
          <p className="text-slate-500 text-sm">{t('auth.subtitle')}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm border border-red-100">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              {t('auth.username')}
            </label>
            <div className="relative">
              <User className={`absolute top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5 ${isRtl ? 'right-3' : 'left-3'}`} />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={`w-full py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none
                  ${isRtl ? 'pr-10 pl-4' : 'pl-10 pr-4'}`}
                placeholder={t('auth.username_placeholder')}
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              {t('auth.password')}
            </label>
            <div className="relative">
              <Lock className={`absolute top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5 ${isRtl ? 'right-3' : 'left-3'}`} />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`w-full py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none
                  ${isRtl ? 'pr-10 pl-4' : 'pl-10 pr-4'}`}
                placeholder={t('auth.password_placeholder')}
                required
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-xl shadow-md transition-colors"
          >
            {t('auth.login')}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
