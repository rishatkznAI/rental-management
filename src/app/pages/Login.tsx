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
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mb-5 rounded-2xl border border-[--color-primary]/15 bg-[--color-primary]/5 p-4 text-left">
            <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-[--color-primary]/12 text-[--color-primary]">
              <Quote className="h-4 w-4" />
            </div>
            <p className="text-sm font-medium leading-6 text-gray-900">
              {quote.text}
            </p>
            <p className="mt-2 text-xs uppercase tracking-[0.16em] text-gray-500">
              {quote.author}
            </p>
          </div>
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[--color-primary]">
            <Truck className="h-8 w-8 text-white" />
          </div>
          <CardTitle className="text-2xl">Система управления арендой</CardTitle>
          <CardDescription>Введите данные для входа в систему</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              type="email"
              label="Email"
              placeholder="example@company.ru"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={error && !email ? 'Введите email' : undefined}
            />
            <Input
              type="password"
              label="Пароль"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={error && !password ? 'Введите пароль' : undefined}
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" className="w-full" size="lg" disabled={loading}>
              {loading ? 'Вход...' : 'Войти'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
