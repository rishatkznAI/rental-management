import type { ServiceTicket } from '../types';

export const SERVICE_SCENARIO_LABELS = {
  repair: 'Ремонт',
  to: 'ТО',
  chto: 'ЧТО',
  pto: 'ПТО',
} as const;

export const SERVICE_SCENARIO_REASON_DEFAULTS = {
  repair: '',
  to: 'ТО',
  chto: 'ЧТО',
  pto: 'ПТО',
} as const;

export const SERVICE_SCENARIO_DESCRIPTION_HINTS = {
  repair: 'Опишите неисправность или проблему, с которой обратились в сервис.',
  to: 'Опишите, какое ТО выполнено и какие операции были проведены.',
  chto: 'Опишите, какие работы по ЧТО были выполнены.',
  pto: 'Опишите, какие работы по ПТО были выполнены.',
} as const;

export function inferServiceKind(ticket: Pick<ServiceTicket, 'serviceKind' | 'reason'>) {
  if (ticket.serviceKind) return ticket.serviceKind;

  const reason = String(ticket.reason || '').trim().toLowerCase();
  if (reason === 'то') return 'to';
  if (reason === 'что') return 'chto';
  if (reason === 'пто') return 'pto';
  return 'repair';
}

export function getServiceScenarioLabel(kind: Pick<ServiceTicket, 'serviceKind' | 'reason'> | ServiceTicket['serviceKind']) {
  if (typeof kind === 'string') return SERVICE_SCENARIO_LABELS[kind];
  return SERVICE_SCENARIO_LABELS[inferServiceKind(kind)];
}

export function isRepairScenario(ticket: Pick<ServiceTicket, 'serviceKind' | 'reason'>) {
  return inferServiceKind(ticket) === 'repair';
}
