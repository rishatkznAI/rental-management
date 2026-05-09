function isPdiServiceTicket(ticket) {
  const type = String(ticket?.type || '').trim().toLowerCase();
  const scenario = String(ticket?.scenario || '').trim().toLowerCase();
  const source = String(ticket?.source || '').trim().toLowerCase();
  return type === 'pdi'
    || scenario === 'pdi'
    || ticket?.saleMode === true
    || Boolean(ticket?.pdiData)
    || (source === 'sales' && String(ticket?.reason || '').toLowerCase().includes('pdi'));
}

function isRegularServiceTicket(ticket) {
  return !isPdiServiceTicket(ticket);
}

module.exports = {
  isPdiServiceTicket,
  isRegularServiceTicket,
};
