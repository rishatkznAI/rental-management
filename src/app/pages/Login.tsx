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
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { traceAuth } from '../lib/authDebug';
import { getDailyQuote } from '../lib/dailyQuote';
import { LiftLogo } from '../components/layout/LiftLogo';
import { APP_BRAND_NAME } from '../lib/appBrand';

const DEMO_URL = String(import.meta.env.VITE_DEMO_URL || '').trim();

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
  const dailyQuote = React.useMemo(() => getDailyQuote(), []);

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
    <main className="min-h-screen w-screen overflow-x-hidden bg-background text-foreground">
      <h1 className="sr-only">Страница авторизации {APP_BRAND_NAME}</h1>

      <div className="grid min-h-screen w-full bg-background lg:grid-cols-2">
        <section className="relative flex min-h-[220px] overflow-hidden bg-[linear-gradient(135deg,#060807_0%,#0f1a12_58%,#172216_100%)] px-6 py-6 sm:px-8 lg:min-h-screen lg:justify-end lg:px-12 lg:py-10 xl:px-20">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(183,242,58,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(183,242,58,0.035)_1px,transparent_1px)] bg-[size:40px_40px]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-[linear-gradient(0deg,rgba(183,242,58,0.075),transparent)]"
          />

          <div className="relative z-10 flex w-full max-w-[560px] flex-col justify-between">
            <div className="flex items-center gap-3 lg:ml-auto lg:w-full lg:max-w-[360px]">
              <LiftLogo className="h-9 w-9 rounded-[9px]" />
              <div>
                <div className="app-shell-title text-[15px] font-extrabold leading-5 text-[#f2f7ef]">{APP_BRAND_NAME}</div>
                <div className="text-[11px] leading-4 text-primary/75">Система управления арендой</div>
              </div>
            </div>

            <div className="my-8 max-w-[360px] lg:my-0 lg:ml-auto lg:flex lg:flex-1 lg:items-center">
              <div>
                <div className="mb-5 flex items-center gap-3">
                  <div className="h-0.5 w-7 rounded-full bg-primary" />
                  <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-primary">Цитата дня</p>
                </div>
                <blockquote className="text-[21px] font-medium leading-[1.42] tracking-normal text-[#f2f7ef] sm:text-[23px]">
                  {dailyQuote.text}
                </blockquote>
                {dailyQuote.author && (
                  <p className="mt-4 text-[11px] font-medium uppercase tracking-[0.1em] text-primary/65">
                    - {dailyQuote.author}
                  </p>
                )}
              </div>
            </div>

            <p className="text-[10px] tracking-[0.03em] text-primary/45 lg:ml-auto lg:w-full lg:max-w-[360px]">
              © 2026 {APP_BRAND_NAME}. Все права защищены.
            </p>
          </div>
        </section>

        <section className="flex w-full items-center justify-center border-t border-border bg-background px-6 py-10 sm:px-8 lg:justify-start lg:border-l lg:border-t-0 lg:px-0 lg:py-12">
          <div className="w-full max-w-[420px] rounded-2xl border border-border bg-card/72 p-5 shadow-[0_32px_90px_-62px_rgba(0,0,0,0.86)] backdrop-blur-xl sm:p-6 lg:ml-[72px]">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">Авторизация</p>
            <h2 className="app-shell-title text-[22px] font-extrabold leading-7 tracking-normal text-foreground">Добро пожаловать</h2>
            <p className="mt-1 mb-8 text-[13px] leading-5 text-muted-foreground">Войдите, чтобы продолжить работу</p>

            <form onSubmit={handleSubmit} className="space-y-[18px]" noValidate>
              <div>
                <label htmlFor="login" className="mb-2 block text-[11px] font-medium tracking-[0.03em] text-muted-foreground">
                  Логин
                </label>
                <div className="relative">
                  <Mail
                    className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-muted-foreground"
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
                    className="h-11 w-full rounded-xl border border-border bg-input-background py-[11px] pl-9 pr-3 text-[13px] text-foreground outline-none transition placeholder:text-muted-foreground hover:border-primary/35 focus:border-primary focus:ring-2 focus:ring-ring/50"
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
                  <label htmlFor="password" className="block text-[11px] font-medium tracking-[0.03em] text-muted-foreground">
                    Пароль
                  </label>
                </div>
                <div className="relative">
                  <LockKeyhole
                    className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-muted-foreground"
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
                    className="h-11 w-full rounded-xl border border-border bg-input-background py-[11px] pl-9 pr-11 text-[13px] text-foreground outline-none transition placeholder:text-muted-foreground hover:border-primary/35 focus:border-primary focus:ring-2 focus:ring-ring/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

              <label className="flex w-fit cursor-pointer items-center gap-2 py-1 text-[12px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border bg-input-background accent-[--color-primary] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <span>Запомнить меня</span>
              </label>

              {error && (
                <div
                  id="auth-error"
                  role="alert"
                  className="flex gap-2 rounded-xl border border-danger/30 bg-[color:var(--danger-soft)] px-3 py-2.5 text-[12px] leading-5 text-danger-foreground"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-[14px] font-semibold text-primary-foreground shadow-[0_18px_44px_-30px_rgba(183,242,58,0.72)] transition hover:bg-[color:var(--primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <LogIn className="h-4 w-4" aria-hidden="true" />
                )}
                {loading ? 'Входим...' : 'Войти в систему'}
              </button>
            </form>

            <p className="mt-5 text-center text-[11px] leading-5 text-muted-foreground">
              Проблемы со входом?{' '}
              <span className="text-foreground/70">Обратитесь в поддержку</span>
            </p>

            {DEMO_URL && (
              <div className="mt-5 border-t border-border pt-5 text-center">
                <a
                  href={DEMO_URL}
                  className="inline-flex items-center justify-center gap-2 text-[12px] font-medium text-primary transition hover:text-[color:var(--primary-hover)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
