import React from 'react';
import type { Client, Counterparty } from '../../types';
import { ClientCombobox } from './ClientCombobox';

export interface CustomerCounterpartySelection {
  counterparty: Counterparty;
  client: Client | null;
  counterpartyId: string;
  clientId: string;
  label: string;
}

interface CustomerCounterpartyComboboxProps {
  counterparties: Counterparty[];
  clients: Client[];
  counterpartyId?: string;
  clientId?: string;
  value: string;
  onChange: (value: string) => void;
  onSelect: (selection: CustomerCounterpartySelection | null) => void;
  placeholder?: string;
  inputId?: string;
  ariaLabelledBy?: string;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
}

function optionId(counterpartyId: string) {
  return `customer-counterparty:${counterpartyId}`;
}

export function CustomerCounterpartyCombobox({
  counterparties,
  clients,
  counterpartyId,
  clientId,
  value,
  onChange,
  onSelect,
  placeholder = 'Введите название, ИНН, контакт или телефон…',
  ...accessibility
}: CustomerCounterpartyComboboxProps) {
  const clientsByCounterparty = React.useMemo(() => {
    const result = new Map<string, Client>();
    for (const client of clients) {
      const id = String(client.counterpartyId || '').trim();
      if (id && !result.has(id)) result.set(id, client);
    }
    return result;
  }, [clients]);
  const clientsById = React.useMemo(
    () => new Map(clients.map(client => [client.id, client])),
    [clients],
  );
  const selectionByOptionId = React.useMemo(() => {
    const result = new Map<string, CustomerCounterpartySelection>();
    for (const counterparty of counterparties) {
      const client = clientsByCounterparty.get(counterparty.id) || null;
      const label = String(counterparty.shortName || counterparty.legalName || '').trim() || 'Контрагент без названия';
      result.set(optionId(counterparty.id), {
        counterparty,
        client,
        counterpartyId: counterparty.id,
        clientId: client?.id || '',
        label,
      });
    }
    return result;
  }, [clientsByCounterparty, counterparties]);
  const options = React.useMemo(() => [...selectionByOptionId.entries()].map(([id, selection]) => ({
    id,
    counterpartyId: selection.counterpartyId,
    company: selection.label,
    inn: selection.counterparty.inn || '',
    contact: [selection.client?.contact, `ID ${selection.counterpartyId}`].filter(Boolean).join(' · '),
    phone: selection.counterparty.phone || selection.client?.phone || '',
    email: selection.counterparty.email || selection.client?.email || '',
    paymentTerms: selection.client?.paymentTerms || '',
    creditLimit: selection.client?.creditLimit || 0,
    debt: selection.client?.debt || 0,
    totalRentals: selection.client?.totalRentals || 0,
  } satisfies Client)), [selectionByOptionId]);
  const resolvedCounterpartyId = counterpartyId
    || clientsById.get(String(clientId || ''))?.counterpartyId
    || '';

  return (
    <ClientCombobox
      clients={options}
      value={value}
      valueId={resolvedCounterpartyId ? optionId(resolvedCounterpartyId) : undefined}
      onChange={onChange}
      onClientSelect={option => onSelect(option ? selectionByOptionId.get(option.id) || null : null)}
      placeholder={placeholder}
      {...accessibility}
    />
  );
}
