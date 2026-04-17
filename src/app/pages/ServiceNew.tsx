import React, { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { usePermissions } from '../lib/permissions';
import { Button } from '../components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { ServiceTicketForm } from '../components/service/ServiceTicketForm';

export default function ServiceNew() {
  const navigate = useNavigate();
  const { can } = usePermissions();

  useEffect(() => {
    if (!can('create', 'service')) navigate('/service', { replace: true });
  }, []);

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="secondary" onClick={() => navigate('/service')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl text-gray-900 dark:text-white">Новая заявка в сервис</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Создание заявки на обслуживание техники</p>
        </div>
      </div>
      <ServiceTicketForm
        onCancel={() => navigate('/service')}
        onCreated={(ticket) => navigate(`/service/${ticket.id}`)}
      />
    </div>
  );
}
