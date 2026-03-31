import React from 'react';
import { useNavigate, useParams } from 'react-router';
import { Button } from '../components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { ArrowLeft, Edit, FileText, Clock, User, Wrench } from 'lucide-react';
import { formatDate } from '../lib/utils';
import { mockServiceRequests } from '../mock-data';

export default function ServiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const request = mockServiceRequests.find(r => r.id === id);

  if (!request) {
    return (
      <div className="space-y-6 p-8">
        <div className="text-center py-12">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Заявка не найдена</h2>
          <Button className="mt-4" onClick={() => navigate('/service')}>
            Вернуться к списку
          </Button>
        </div>
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'default' }> = {
      new: { label: 'Новый', variant: 'default' },
      in_progress: { label: 'В работе', variant: 'info' },
      waiting_parts: { label: 'Ожидание запчастей', variant: 'warning' },
      ready: { label: 'Готово', variant: 'success' },
      closed: { label: 'Закрыто', variant: 'default' }
    };
    const statusInfo = statusMap[status] || { label: status, variant: 'default' as const };
    return <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>;
  };

  const getPriorityBadge = (priority: string) => {
    const priorityMap: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'default' }> = {
      low: { label: 'Низкий', variant: 'default' },
      medium: { label: 'Средний', variant: 'info' },
      high: { label: 'Высокий', variant: 'warning' },
      critical: { label: 'Критический', variant: 'danger' }
    };
    const priorityInfo = priorityMap[priority] || { label: priority, variant: 'default' as const };
    return <Badge variant={priorityInfo.variant}>{priorityInfo.label}</Badge>;
  };

  return (
    <div className="space-y-6 p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="secondary" onClick={() => navigate('/service')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Заявка {request.id}</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{request.equipment}</p>
          </div>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary">
            <Edit className="h-4 w-4" />
            Редактировать
          </Button>
          <Button variant="secondary">
            <FileText className="h-4 w-4" />
            Акт выполненных работ
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Info */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Основная информация</CardTitle>
              <CardDescription>Детали сервисной заявки</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Статус</p>
                  <div className="mt-1">{getStatusBadge(request.status)}</div>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Приоритет</p>
                  <div className="mt-1">{getPriorityBadge(request.priority)}</div>
                </div>
              </div>

              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">Техника</p>
                <p className="mt-1 font-medium text-gray-900 dark:text-white">{request.equipment}</p>
              </div>

              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">Клиент</p>
                <p className="mt-1 font-medium text-gray-900 dark:text-white">{request.client}</p>
              </div>

              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">Описание проблемы</p>
                <p className="mt-1 text-gray-900 dark:text-white">{request.issue}</p>
              </div>

              <div className="grid grid-cols-2 gap-4 border-t border-gray-200 dark:border-gray-700 pt-4">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Дата создания</p>
                  <p className="mt-1 font-medium text-gray-900 dark:text-white">{formatDate(request.createdDate)}</p>
                </div>
                {request.plannedDate && (
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Планируемая дата</p>
                    <p className="mt-1 font-medium text-gray-900 dark:text-white">{formatDate(request.plannedDate)}</p>
                  </div>
                )}
              </div>

              {request.completedDate && (
                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400">Дата завершения</p>
                  <p className="mt-1 font-medium text-gray-900 dark:text-white">{formatDate(request.completedDate)}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Work Details */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wrench className="h-5 w-5" />
                Выполненные работы
              </CardTitle>
            </CardHeader>
            <CardContent>
              {request.status === 'new' ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">Работы ещё не начаты</p>
              ) : (
                <div className="space-y-3">
                  <div className="border-l-2 border-blue-500 pl-4 py-2">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">Диагностика</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Выполнена первичная диагностика</p>
                  </div>
                  {request.status !== 'in_progress' && (
                    <div className="border-l-2 border-blue-500 pl-4 py-2">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">Замена компонентов</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Заменены неисправные детали</p>
                    </div>
                  )}
                  {request.status === 'ready' || request.status === 'closed' && (
                    <div className="border-l-2 border-green-500 pl-4 py-2">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">Тестирование</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Техника проверена и готова к работе</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Side Info */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Исполнитель
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Назначен</p>
                <p className="mt-1 font-medium text-gray-900 dark:text-white">
                  {request.assignedTo || 'Не назначен'}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Время выполнения
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Затрачено времени</p>
                <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
                  {request.status === 'new' ? '0ч' : request.status === 'closed' ? '8ч' : '4ч'}
                </p>
              </div>
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">Стоимость работ</p>
                <p className="mt-1 text-xl font-bold text-gray-900 dark:text-white">
                  {request.status === 'new' ? '—' : '25 000 ₽'}
                </p>
              </div>
            </CardContent>
          </Card>

          {request.priority === 'critical' || request.priority === 'high' ? (
            <Card className="border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
              <CardHeader>
                <CardTitle className="text-red-900 dark:text-red-200">Внимание!</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-red-700 dark:text-red-300">
                  Заявка имеет высокий приоритет. Требуется срочное выполнение.
                </p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
