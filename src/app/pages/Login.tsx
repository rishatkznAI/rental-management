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
import './Login.css';

const DEMO_URL = String(import.meta.env.VITE_DEMO_URL || '').trim();
const LOGIN_INTRO_STORAGE_KEY = 'rentcore:login-intro-seen';

function shouldPlayLoginIntro() {
  if (typeof window === 'undefined') return false;

  try {
    return window.sessionStorage.getItem(LOGIN_INTRO_STORAGE_KEY) !== 'true';
  } catch {
    return true;
  }
}

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
  const [playIntro] = React.useState(shouldPlayLoginIntro);

  const { login } = useAuth();
  const navigate = useNavigate();
  const dailyQuote = React.useMemo(() => getDailyQuote(), []);

  React.useEffect(() => {
    if (!playIntro) return;

    try {
      window.sessionStorage.setItem(LOGIN_INTRO_STORAGE_KEY, 'true');
    } catch {
      // The intro remains cosmetic when session storage is unavailable.
    }
  }, [playIntro]);

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
    <main
      className="rentcore-login-screen min-h-[100dvh] w-full overflow-x-hidden text-foreground"
      data-intro={playIntro ? 'true' : 'false'}
    >
      <h1 className="sr-only">Страница авторизации {APP_BRAND_NAME}</h1>

      <div className="rentcore-login-split grid min-h-[100dvh] w-full lg:grid-cols-2">
        <section className="rentcore-login-brand relative flex min-h-[220px] overflow-hidden px-6 py-6 sm:min-h-[280px] sm:px-8 lg:min-h-[100dvh] lg:justify-end lg:px-12 lg:py-10 xl:px-20">
          <div aria-hidden="true" className="rentcore-login-ambient pointer-events-none absolute inset-0" />
          <div aria-hidden="true" className="rentcore-login-grid pointer-events-none absolute inset-0" />
          <div aria-hidden="true" className="rentcore-login-divider pointer-events-none absolute right-0 top-0 hidden h-full w-px lg:block" />

          <div className="relative z-10 flex w-full max-w-[560px] flex-col lg:max-w-[480px]">
            <div className="rentcore-login-brand-main flex flex-1 items-center py-4 sm:py-8 lg:py-12">
              <div>
                <div className="rentcore-login-brand-lockup flex items-center gap-4 sm:gap-5">
                  <div className="rentcore-login-brand-mark shrink-0">
                    <LiftLogo className="h-14 w-14 rounded-lg sm:h-16 sm:w-16" />
                  </div>
                  <div className="min-w-0">
                    <div className="rentcore-login-brand-name app-shell-title truncate text-[32px] font-semibold leading-none tracking-[-0.035em] text-[#f4f7fb] sm:text-[42px]">
                      {APP_BRAND_NAME}
                    </div>
                    <div className="rentcore-login-brand-subtitle mt-2 text-[12px] leading-5 tracking-[0.025em] text-[#8f9cac] sm:text-[13px]">
                      Система управления арендой
                    </div>
                  </div>
                </div>

                <div className="rentcore-login-brand-rule mt-7 h-px w-14 bg-primary/70 sm:mt-9" />
                <p className="rentcore-login-brand-note mt-3 text-[10px] font-medium uppercase tracking-[0.17em] text-[#697789]">
                  Rental operations platform
                </p>
              </div>
            </div>

            <div className="rentcore-login-brand-meta hidden sm:block">
              <figure className="max-w-[390px] border-l border-white/10 pl-4">
                <blockquote className="text-[13px] font-normal leading-5 text-[#8f9cac]">
                  {dailyQuote.text}
                </blockquote>
                {dailyQuote.author && (
                  <figcaption className="mt-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[#697789]">
                    — {dailyQuote.author}
                  </figcaption>
                )}
              </figure>
            </div>

            <p className="rentcore-login-copyright mt-5 text-[10px] tracking-[0.03em] text-[#5f6b79]">
              © 2026 {APP_BRAND_NAME}. Все права защищены.
            </p>
          </div>
        </section>

        <section className="rentcore-login-auth-zone flex w-full items-center justify-center px-5 py-9 sm:px-8 sm:py-12 lg:min-h-[100dvh] lg:px-12 xl:px-20">
          <div className="rentcore-login-auth-panel w-full max-w-[420px] rounded-lg border p-5 sm:p-7">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary-content">Авторизация</p>
            <h2 className="app-shell-title text-[23px] font-semibold leading-7 tracking-[-0.02em] text-foreground">Добро пожаловать</h2>
            <p className="mb-8 mt-1.5 text-[13px] leading-5 text-muted-foreground">Войдите, чтобы продолжить работу</p>

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
                    className="rentcore-login-input h-11 w-full rounded-lg border py-[11px] pl-9 pr-3 text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
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
                    className="rentcore-login-input h-11 w-full rounded-lg border py-[11px] pl-9 pr-11 text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="rentcore-login-visibility absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                  className="rentcore-login-checkbox h-3.5 w-3.5 rounded border-border accent-[--color-primary] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <span>Запомнить меня</span>
              </label>

              {error && (
                <div
                  id="auth-error"
                  role="alert"
                  className="rentcore-login-error flex gap-2 rounded-lg border px-3 py-2.5 text-[12px] leading-5 text-danger-foreground"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="rentcore-login-submit inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg px-4 text-[14px] font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
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
              <div className="mt-5 border-t border-white/[0.07] pt-5 text-center">
                <a
                  href={DEMO_URL}
                  className="inline-flex items-center justify-center gap-2 text-[12px] font-medium text-primary-content transition hover:text-[color:var(--primary-hover)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
