import React, { useState, useCallback } from 'react';
import { useNavigate, useParams, Link } from 'react-router';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import {
  ArrowLeft, Edit, FileText, TrendingUp, Clock, Phone, Mail,
  Building2, MapPin, User, CreditCard, CheckCircle, XCircle,
  AlertTriangle, Plus, Save, X,
} from 'lucide-react';
import { formatDate, formatCurrency } from '../lib/utils';
import {
  loadClients, saveClients,
  loadRentals,
  loadDocuments,
} from '../mock-data';
import type { Client, ClientStatus } from '../types';

// ─── helpers ───────────────────────────────────────────────────────────────────

type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'default';

const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  active: 'Активен',
  inactive: 'Неактивен',
  blocked: 'Заблокирован',
};

function clientStatusVariant(s?: ClientStatus): BadgeVariant {
  if (s === 'active') return 'success';
  if (s === 'blocked') return 'error';
  return 'default';
}

function debtVariant(debt: number): BadgeVariant {
  if (debt === 0) return 'success';
  if (debt <= 50000) return 'warning';
  return 'error';
}

function debtLabel(debt: number) {
  if (debt === 0) return 'Нет задолженности';
  if (debt <= 50000) return 'Есть задолженность';
  return 'Высокая задолженность';
}

function Divider() {
  return <hr className="border-gray-100 dark:border-gray-800" />;
}

function Field({ label, value, mono, className }: { label: string; value?: string | null; mono?: boolean; className?: string }) {
  if (!value) return null;
  return (
    <div className={className}>
      <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-0.5">{label}</p>
      <p className={`text-sm font-medium text-gray-900 dark:text-white ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  );
}

const PAYMENT_TERMS_OPTIONS = [
  { value: 'Постоплата 14 дней', label: 'Постоплата 14 дней' },
  { value: 'Постоплата 30 дней', label: 'Постоплата 30 дней' },
  { value: 'Предоплата 100%', label: 'Предоплата 100%' },
  { value: 'Предоплата 50%', label: 'Предоплата 50%' },
  { value: 'Без предоплаты', label: 'Без предоплаты' },
];

const RENTAL_STATUS_LABELS: Record<string, { label: string; variant: BadgeVariant }> = {
  new: { label: 'Новая', variant: 'default' },
  confirmed: { label: 'Подтверждена', variant: 'info' },
  delivery: { label: 'Доставка', variant: 'warning' },
  active: { label: 'Активная', variant: 'success' },
  return_planned: { label: 'Возврат', variant: 'warning' },
  closed: { label: 'Закрыта', variant: 'default' },
};

// ─── main component ────────────────────────────────────────────────────────────

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // Load from localStorage (NOT from static mock array)
  const [client, setClient] = useState<Client | null>(() => {
    const all = loadClients();
    return all.find(c => c.id === id) ?? null;
  });

  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<Partial<Client>>({});

  // Related data (also from localStorage)
  const allRentals = loadRentals();
  const clientRentals = allRentals.filter(r => client && r.client === client.company);
  const activeRentals = clientRentals.filter(r => r.status === 'active');

  const allDocs = loadDocuments();
  const clientDocs = allDocs.filter(d => client && d.client === client.company);

  // Persist changes
  const persist = useCallback((updated: Client) => {
    setClient(updated);
    const all = loadClients();
    saveClients(all.map(c => (c.id === updated.id ? updated : c)));
  }, []);

  const startEdit = () => {
    if (!client) return;
    setEditData({ ...client });
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditData({});
  };

  const saveEdit = () => {
    if (!client) return;
    persist({ ...client, ...editData });
    setEditing(false);
    setEditData({});
  };

  // ── "not found" screen ────────────────────────────────────────────────────

  if (!client) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-24 gap-4 text-center">
        <XCircle className="h-12 w-12 text-gray-300" />
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Клиент не найден</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Возможно, запись была удалена или ID указан некорректно.
        </p>
        <Button onClick={() => navigate('/clients')}>Вернуться к списку</Button>
      </div>
    );
  }

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <Button variant="secondary" onClick={() => navigate('/clients')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{client.company}</h1>
              {client.status && (
                <Badge variant={clientStatusVariant(client.status)}>
                  {CLIENT_STATUS_LABELS[client.status]}
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">ИНН: {client.inn}</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {!editing ? (
            <>
              <Button variant="secondary" onClick={startEdit}>
                <Edit className="h-4 w-4" />
                Редактировать
              </Button>
              <Link to={`/rentals/new?client=${encodeURIComponent(client.company)}`}>
                <Button>
                  <Plus className="h-4 w-4" />
                  Новая аренда
                </Button>
              </Link>
            </>
          ) : (
            <>
              <Button onClick={saveEdit}>
                <Save className="h-4 w-4" />
                Сохранить
              </Button>
              <Button variant="secondary" onClick={cancelEdit}>
                <X className="h-4 w-4" />
                Отмена
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── Left (2/3) ─────────────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-6">

          {/* Main info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="h-4 w-4" />
                Основная информация
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {editing ? (
                <div className="space-y-4">
                  <Input label="Наименование компании" value={editData.company ?? ''} onChange={e => setEditData({ ...editData, company: e.target.value })} />
                  <div className="grid grid-cols-2 gap-4">
                    <Input label="ИНН" value={editData.inn ?? ''} onChange={e => setEditData({ ...editData, inn: e.target.value })} />
                    <Input label="Email" type="email" value={editData.email ?? ''} onChange={e => setEditData({ ...editData, email: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">Адрес</label>
                    <textarea
                      className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-[--color-primary] focus:outline-none focus:ring-1 focus:ring-[--color-primary]"
                      rows={2}
                      value={editData.address ?? ''}
                      onChange={e => setEditData({ ...editData, address: e.target.value })}
                      placeholder="Юридический / фактический адрес"
                    />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <Field label="Компания" value={client.company} className="col-span-2" />
                  <Field label="ИНН" value={client.inn} mono />
                  <Field label="Email" value={client.email} />
                  {client.address && (
                    <div className="flex items-start gap-1.5 col-span-2">
                      <MapPin className="h-4 w-4 text-gray-400 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Адрес</p>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{client.address}</p>
                      </div>
                    </div>
                  )}
                  {client.createdAt && <Field label="Клиент с" value={formatDate(client.createdAt)} />}
                  {client.createdBy && <Field label="Кто создал" value={client.createdBy} />}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Contact */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <User className="h-4 w-4" />
                Контакт
              </CardTitle>
            </CardHeader>
            <CardContent>
              {editing ? (
                <div className="space-y-4">
                  <Input label="Контактное лицо" value={editData.contact ?? ''} onChange={e => setEditData({ ...editData, contact: e.target.value })} />
                  <Input label="Телефон" value={editData.phone ?? ''} onChange={e => setEditData({ ...editData, phone: e.target.value })} />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Контактное лицо</p>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{client.contact}</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <Phone className="h-4 w-4 text-gray-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Телефон</p>
                      <a href={`tel:${client.phone}`} className="text-sm font-medium text-[--color-primary] hover:underline">
                        {client.phone}
                      </a>
                    </div>
                  </div>
                  {client.email && (
                    <div className="flex items-start gap-2">
                      <Mail className="h-4 w-4 text-gray-400 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Email</p>
                        <a href={`mailto:${client.email}`} className="text-sm font-medium text-[--color-primary] hover:underline">
                          {client.email}
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Commercial */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CreditCard className="h-4 w-4" />
                Коммерческие условия
              </CardTitle>
            </CardHeader>
            <CardContent>
              {editing ? (
                <div className="space-y-4">
                  <Select
                    label="Условия оплаты"
                    value={editData.paymentTerms ?? ''}
                    onValueChange={v => setEditData({ ...editData, paymentTerms: v })}
                    options={PAYMENT_TERMS_OPTIONS}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <Input
                      label="Кредитный лимит (₽)"
                      type="number"
                      value={String(editData.creditLimit ?? 0)}
                      onChange={e => setEditData({ ...editData, creditLimit: Number(e.target.value) })}
                    />
                    <Input
                      label="Задолженность (₽)"
                      type="number"
                      value={String(editData.debt ?? 0)}
                      onChange={e => setEditData({ ...editData, debt: Number(e.target.value) })}
                    />
                  </div>
                  <Input
                    label="Ответственный менеджер"
                    value={editData.manager ?? ''}
                    onChange={e => setEditData({ ...editData, manager: e.target.value })}
                  />
                  <div>
                    <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">Примечания</label>
                    <textarea
                      className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-[--color-primary] focus:outline-none focus:ring-1 focus:ring-[--color-primary]"
                      rows={2}
                      value={editData.notes ?? ''}
                      onChange={e => setEditData({ ...editData, notes: e.target.value })}
                      placeholder="Примечания..."
                    />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <Field label="Условия оплаты" value={client.paymentTerms} />
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Кредитный лимит</p>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{formatCurrency(client.creditLimit)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Задолженность</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{formatCurrency(client.debt)}</p>
                      <Badge variant={debtVariant(client.debt)}>{debtLabel(client.debt)}</Badge>
                    </div>
                  </div>
                  {client.manager && <Field label="Менеджер" value={client.manager} />}
                  {client.notes && (
                    <div className="col-span-3">
                      <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Примечания</p>
                      <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{client.notes}</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Rentals */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-4 w-4" />
                История аренд
                {clientRentals.length > 0 && (
                  <span className="ml-auto text-xs font-normal text-gray-500">{clientRentals.length} аренд</span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {clientRentals.length === 0 ? (
                <p className="text-sm text-gray-400 italic">Аренд не найдено</p>
              ) : (
                <div className="space-y-3">
                  {clientRentals.map((rental) => {
                    const rs = RENTAL_STATUS_LABELS[rental.status] ?? { label: rental.status, variant: 'default' as BadgeVariant };
                    return (
                      <div
                        key={rental.id}
                        className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:border-blue-400 cursor-pointer transition-colors"
                        onClick={() => navigate(`/rentals/${rental.id}`)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="font-medium text-gray-900 dark:text-white text-sm">{rental.id}</p>
                              <Badge variant={rs.variant}>{rs.label}</Badge>
                            </div>
                            <p className="text-xs text-gray-500 truncate">{rental.equipment.join(', ')}</p>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {formatDate(rental.startDate)} — {formatDate(rental.plannedReturnDate)}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-semibold text-sm text-gray-900 dark:text-white">{formatCurrency(rental.price)}</p>
                            <p className="text-xs text-gray-500">{rental.rate}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Documents */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                Документы
                {clientDocs.length > 0 && (
                  <span className="ml-auto text-xs font-normal text-gray-500">{clientDocs.length}</span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {clientDocs.length === 0 ? (
                <p className="text-sm text-gray-400 italic">Документов не найдено</p>
              ) : (
                <div className="space-y-2">
                  {clientDocs.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800 last:border-0">
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{doc.number}</p>
                        <p className="text-xs text-gray-400">{doc.type} · {formatDate(doc.date)}</p>
                      </div>
                      <Badge variant={doc.status === 'signed' ? 'success' : doc.status === 'sent' ? 'info' : 'default'}>
                        {doc.status === 'signed' ? 'Подписан' : doc.status === 'sent' ? 'Отправлен' : 'Черновик'}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Right (1/3) ─────────────────────────────────────────────────── */}
        <div className="space-y-6">

          {/* Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-4 w-4" />
                Статистика
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Всего аренд</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {clientRentals.length || client.totalRentals}
                </p>
              </div>
              <Divider />
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Активных аренд</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{activeRentals.length}</p>
              </div>
              {client.debt > 0 && (
                <>
                  <Divider />
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Задолженность</p>
                    <p className="text-xl font-bold text-red-600">{formatCurrency(client.debt)}</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Activity */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-4 w-4" />
                Активность
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field
                label="Последняя аренда"
                value={client.lastRentalDate ? formatDate(client.lastRentalDate) : '—'}
              />
              {client.createdAt && (
                <>
                  <Divider />
                  <Field label="Клиент с" value={formatDate(client.createdAt)} />
                </>
              )}
            </CardContent>
          </Card>

          {/* Debt alert */}
          {client.debt > 50000 && (
            <Card className="border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="h-4 w-4 text-red-600" />
                  <p className="text-sm font-semibold text-red-800 dark:text-red-200">Высокая задолженность</p>
                </div>
                <p className="text-xs text-red-600 dark:text-red-300">
                  Задолженность {formatCurrency(client.debt)} превышает допустимый порог. Рекомендуется связаться с клиентом.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Active rentals quick view */}
          {activeRentals.length > 0 && (
            <Card className="border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/10">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="h-4 w-4 text-blue-600" />
                  <p className="text-sm font-semibold text-blue-800 dark:text-blue-200">
                    {activeRentals.length} активных {activeRentals.length === 1 ? 'аренда' : 'аренды'}
                  </p>
                </div>
                {activeRentals.slice(0, 2).map(r => (
                  <p key={r.id} className="text-xs text-blue-600 cursor-pointer hover:underline" onClick={() => navigate(`/rentals/${r.id}`)}>
                    {r.id} · {r.equipment[0]}
                  </p>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
