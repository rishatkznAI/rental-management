import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ExternalLink,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  LogIn,
  Mail,
  TowerControl,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { traceAuth } from '../lib/authDebug';

const DEMO_URL = String(import.meta.env.VITE_DEMO_URL || '').trim();
const LOGIN_QUOTE = {
  text: 'Не ждите идеального момента. Возьмите момент и сделайте его идеальным.',
  author: '— Зои Сэйрс',
};

function getLoginErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'Неизвестная ошибка входа. Попробуйте ещё раз.';

  const message = error.message || '';
  const normalized = message.toLowerCase();

  if (
    normalized.includes('failed to fetch') ||
    normalized.includes('network') ||
    normalized.includes('load failed') ||
    normalized.includes('fetch')
  ) {
    return 'Сервер авторизации недоступен. Проверьте подключение и попробуйте ещё раз.';
  }

  if (
    normalized.includes('отключ') ||
    normalized.includes('заблок') ||
    normalized.includes('inactive') ||
    normalized.includes('disabled')
  ) {
    return 'Пользователь отключён. Обратитесь к администратору.';
  }

  if (normalized.includes('невер') || normalized.includes('unauthorized') || normalized.includes('401')) {
    return 'Неверный логин или пароль.';
  }

  return message || 'Неизвестная ошибка входа. Попробуйте ещё раз.';
}

export default function Login() {
  const [loginValue, setLoginValue] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);
  const [rememberMe, setRememberMe] = React.useState(true);

  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginValue.trim() || !password) {
      setError('Заполните все поля');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await login(loginValue, password);
      traceAuth('first route after login', {
        from: '/login',
        to: '/',
      });
      navigate('/', { replace: true });
    } catch (err) {
      traceAuth('login failure displayed', {
        message: err instanceof Error ? err.message : 'unknown',
      });
      setError(getLoginErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen w-screen overflow-x-hidden bg-[#0e0e0e] text-[#f0f0f0]">
      <h1 className="sr-only">Страница авторизации Скайтех</h1>

      <div className="grid min-h-screen w-full bg-[#0e0e0e] lg:grid-cols-2">
        <section className="relative flex min-h-[220px] overflow-hidden bg-[#0b1120] px-6 py-6 sm:px-8 lg:min-h-screen lg:justify-end lg:px-12 lg:py-10 xl:px-20">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(200,241,53,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(200,241,53,0.03)_1px,transparent_1px)] bg-[size:40px_40px]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-24 -left-20 h-[400px] w-[400px] rounded-full bg-[radial-gradient(circle,rgba(200,241,53,0.07)_0%,transparent_70%)]"
          />

          <div className="relative z-10 flex w-full max-w-[560px] flex-col justify-between">
            <div className="flex items-center gap-3 lg:ml-auto lg:w-full lg:max-w-[360px]">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-[#c8f135] text-[#0b1120] shadow-lg shadow-[#c8f135]/10">
                <TowerControl className="h-[18px] w-[18px]" aria-hidden="true" strokeWidth={2.2} />
              </div>
              <div>
                <div className="text-[15px] font-medium leading-5 text-[#f0f0f0]">Скайтех</div>
                <div className="text-[11px] leading-4 text-[#5e7534]">Система управления арендой</div>
              </div>
            </div>

            <div className="my-8 max-w-[360px] lg:my-0 lg:ml-auto lg:flex lg:flex-1 lg:items-center">
              <div>
                <div className="mb-5 flex items-center gap-3">
                  <div className="h-0.5 w-7 rounded-full bg-[#c8f135]" />
                  <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-[#c8f135]">Цитата дня</p>
                </div>
                <blockquote className="text-[21px] font-medium leading-[1.42] tracking-normal text-[#f0f0f0] sm:text-[23px]">
                  {LOGIN_QUOTE.text}
                </blockquote>
                <p className="mt-4 text-[11px] font-medium uppercase tracking-[0.1em] text-[#5e7534]">
                  {LOGIN_QUOTE.author}
                </p>
              </div>
            </div>

            <p className="text-[10px] tracking-[0.03em] text-[#405524] lg:ml-auto lg:w-full lg:max-w-[360px]">
              © 2026 Скайтех. Все права защищены.
            </p>
          </div>
        </section>

        <section className="flex w-full items-center justify-center border-t border-[#161616] bg-[#0e0e0e] px-6 py-10 sm:px-8 lg:border-l lg:border-t-0 lg:px-12 lg:py-12 xl:px-20">
          <div className="w-full max-w-[420px]">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.1em] text-[#555]">Авторизация</p>
            <h2 className="text-[22px] font-medium leading-7 tracking-normal text-[#f0f0f0]">Добро пожаловать</h2>
            <p className="mt-1 mb-8 text-[13px] leading-5 text-[#666]">Войдите, чтобы продолжить работу</p>

            <form onSubmit={handleSubmit} className="space-y-[18px]" noValidate>
              <div>
                <label htmlFor="login" className="mb-2 block text-[11px] font-medium tracking-[0.03em] text-[#777]">
                  Логин
                </label>
                <div className="relative">
                  <Mail
                    className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-[#3a3a3a]"
                    aria-hidden="true"
                  />
                  <input
                    id="login"
                    name="login"
                    type="text"
                    placeholder="email или логин"
                    autoComplete="username"
                    value={loginValue}
                    onChange={(e) => {
                      setLoginValue(e.target.value);
                      if (error) setError('');
                    }}
                    aria-invalid={Boolean(error && !loginValue.trim())}
                    aria-describedby={error ? 'login-error' : undefined}
                    className="h-11 w-full rounded-lg border border-[#222] bg-[#141414] py-[11px] pl-9 pr-3 text-[13px] text-[#f0f0f0] outline-none transition placeholder:text-[#3a3a3a] hover:border-[#2c2c2c] focus:border-[#c8f135] focus:bg-[#111] focus:ring-2 focus:ring-[#c8f135]/20"
                  />
                </div>
                {error && !loginValue.trim() && (
                  <p id="login-error" className="mt-2 text-xs text-[#e26060]">
                    Введите логин
                  </p>
                )}
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label htmlFor="password" className="block text-[11px] font-medium tracking-[0.03em] text-[#777]">
                    Пароль
                  </label>
                </div>
                <div className="relative">
                  <LockKeyhole
                    className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-[#3a3a3a]"
                    aria-hidden="true"
                  />
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (error) setError('');
                    }}
                    aria-invalid={Boolean(error && !password)}
                    aria-describedby={error ? 'auth-error' : undefined}
                    className="h-11 w-full rounded-lg border border-[#222] bg-[#141414] py-[11px] pl-9 pr-11 text-[13px] text-[#f0f0f0] outline-none transition placeholder:text-[#3a3a3a] hover:border-[#2c2c2c] focus:border-[#c8f135] focus:bg-[#111] focus:ring-2 focus:ring-[#c8f135]/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-[#4a4a4a] transition hover:bg-[#1e1e1e] hover:text-[#aaaaaa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8f135]/60"
                    aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? (
                      <EyeOff className="h-[15px] w-[15px]" aria-hidden="true" />
                    ) : (
                      <Eye className="h-[15px] w-[15px]" aria-hidden="true" />
                    )}
                  </button>
                </div>
                {error && !password && (
                  <p className="mt-2 text-xs text-[#e26060]">Введите пароль</p>
                )}
              </div>

              <label className="flex w-fit cursor-pointer items-center gap-2 py-1 text-[12px] text-[#666]">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-[#333] bg-[#141414] accent-[#c8f135] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8f135]/60"
                />
                <span>Запомнить меня</span>
              </label>

              {error && (
                <div
                  id="auth-error"
                  role="alert"
                  className="flex gap-2 rounded-lg border border-[#3b1d1d] bg-[#1a1010] px-3 py-2.5 text-[12px] leading-5 text-[#e26060]"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#c8f135] px-4 text-[14px] font-semibold text-[#0b1120] transition hover:bg-[#b5d92d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8f135] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0e0e0e] disabled:cursor-not-allowed disabled:bg-[#5e7534] disabled:text-[#151b0b]"
              >
                {loading ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <LogIn className="h-4 w-4" aria-hidden="true" />
                )}
                {loading ? 'Входим...' : 'Войти в систему'}
              </button>
            </form>

            <p className="mt-5 text-center text-[11px] leading-5 text-[#555]">
              Проблемы со входом?{' '}
              <span className="text-[#777]">Обратитесь в поддержку</span>
            </p>

            {DEMO_URL && (
              <div className="mt-5 border-t border-[#1a1a1a] pt-5 text-center">
                <a
                  href={DEMO_URL}
                  className="inline-flex items-center justify-center gap-2 text-[12px] font-medium text-[#c8f135] transition hover:text-[#d7ff50] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8f135]/60"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Открыть демо-режим
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
