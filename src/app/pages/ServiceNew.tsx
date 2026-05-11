import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { usePermissions } from '../lib/permissions';
import { Button } from '../components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { ServiceTicketForm } from '../components/service/ServiceTicketForm';

export default function ServiceNew() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { can } = usePermissions();
  const initialEquipmentId = searchParams.get('equipmentId') || undefined;
  const mode = searchParams.get('mode') || '';
  const isSalesPdi = mode === 'sales_pdi';

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
        initialEquipmentId={initialEquipmentId}
        lockEquipment={Boolean(initialEquipmentId)}
        initialReason={isSalesPdi ? 'PDI перед продажей' : undefined}
        initialDescription={isSalesPdi ? 'Предпродажная проверка и подготовка техники к продаже.' : undefined}
        scenarioTitle={isSalesPdi ? 'PDI перед продажей' : undefined}
        scenarioDescription={isSalesPdi ? 'Проверка состояния, фотофиксация и замечания перед продажей.' : undefined}
        submitLabel={isSalesPdi ? 'Создать PDI' : undefined}
        onCancel={() => navigate('/service')}
        onCreated={(ticket) => navigate(`/service/${ticket.id}`)}
      />
    </div>
  );
}
