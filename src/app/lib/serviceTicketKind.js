export function isPdiServiceTicket(ticket) {
  const type = String(ticket?.type || '').trim().toLowerCase();
  const scenario = String(ticket?.scenario || '').trim().toLowerCase();
  const source = String(ticket?.source || '').trim().toLowerCase();
  return type === 'pdi'
    || scenario === 'pdi'
    || ticket?.saleMode === true
    || Boolean(ticket?.pdiData)
    || (source === 'sales' && String(ticket?.reason || '').toLowerCase().includes('pdi'));
}

export function isRegularServiceTicket(ticket) {
  return !isPdiServiceTicket(ticket);
}

function normalizedServiceStatus(ticket) {
  const status = String(ticket?.status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (status === 'done' || status === 'complete' || status === 'completed' || status === 'finished') {
    return 'closed';
  }
  return status || 'new';
}

export function isArchivedServiceTicket(ticket) {
  return isRegularServiceTicket(ticket) && normalizedServiceStatus(ticket) === 'closed';
}

export function isActiveServiceTicket(ticket) {
  return isRegularServiceTicket(ticket) && !isArchivedServiceTicket(ticket);
}
