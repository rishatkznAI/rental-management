import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Quote, Truck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getRandomMotivationalQuote } from '../lib/motivationalQuotes';

export default function Login() {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const quote = React.useMemo(() => getRandomMotivationalQuote(), []);

  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Заполните все поля');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка входа. Проверьте данные.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8 dark:bg-slate-950">
      <div className="w-full max-w-md space-y-5">
        <section className="rounded-2xl border border-gray-200 bg-white/85 p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/72">
          <div className="flex gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[--color-primary]/10 text-[--color-primary] dark:bg-[--color-primary]/15">
              <Quote className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-6 text-gray-900 dark:text-slate-100">
                {quote.text}
              </p>
              <p className="mt-3 text-xs uppercase tracking-[0.18em] text-gray-500 dark:text-slate-400">
                {quote.author}
              </p>
            </div>
          </div>
        </section>

        <Card className="w-full overflow-hidden border-gray-200 shadow-xl shadow-slate-950/5 dark:border-slate-800 dark:bg-slate-900/72 dark:shadow-black/20">
          <CardHeader className="border-b border-gray-100 px-6 pb-6 pt-8 text-center dark:border-slate-800">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[--color-primary] shadow-lg shadow-[--color-primary]/20">
              <Truck className="h-8 w-8 text-white" />
            </div>
            <CardTitle className="text-2xl font-semibold">Система управления арендой</CardTitle>
            <CardDescription className="mt-2 text-base">Введите данные для входа в систему</CardDescription>
          </CardHeader>
          <CardContent className="px-6 py-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                type="email"
                label="Email"
                placeholder="example@company.ru"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={error && !email ? 'Введите email' : undefined}
                className="h-12 rounded-xl text-base"
              />
              <Input
                type="password"
                label="Пароль"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={error && !password ? 'Введите пароль' : undefined}
                className="h-12 rounded-xl text-base"
              />
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button type="submit" className="h-12 w-full rounded-xl text-base" size="lg" disabled={loading}>
                {loading ? 'Вход...' : 'Войти'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
