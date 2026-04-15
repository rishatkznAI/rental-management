function countEquipmentByInventory(equipmentList) {
  const counts = new Map();
  (equipmentList || []).forEach(item => {
    const inventoryNumber = item?.inventoryNumber;
    if (!inventoryNumber) return;
    counts.set(inventoryNumber, (counts.get(inventoryNumber) || 0) + 1);
  });
  return counts;
}

function isUniqueInventoryNumber(inventoryNumber, equipmentList) {
  if (!inventoryNumber) return false;
  const counts = countEquipmentByInventory(equipmentList);
  return (counts.get(inventoryNumber) || 0) === 1;
}

function findEquipmentForRentalPayload(payload, equipmentList) {
  const equipmentId = payload?.equipmentId;
  const inventoryNumber = payload?.equipmentInv || payload?.inventoryNumber;

  if (equipmentId) {
    const byId = (equipmentList || []).find(item => item.id === equipmentId);
    if (byId) return byId;
  }
  if (!inventoryNumber) return null;
  if (!isUniqueInventoryNumber(inventoryNumber, equipmentList)) return null;
  return (equipmentList || []).find(item => item.inventoryNumber === inventoryNumber) || null;
}

function equipmentMatchesServiceTicket(ticket, equipment, equipmentList) {
  if (!ticket || !equipment) return false;
  if (ticket.equipmentId && ticket.equipmentId === equipment.id) return true;
  if (ticket.serialNumber && equipment.serialNumber && ticket.serialNumber === equipment.serialNumber) return true;
  return Boolean(
    ticket.inventoryNumber &&
    equipment.inventoryNumber &&
    isUniqueInventoryNumber(ticket.inventoryNumber, equipmentList) &&
    ticket.inventoryNumber === equipment.inventoryNumber
  );
}

module.exports = {
  countEquipmentByInventory,
  isUniqueInventoryNumber,
  findEquipmentForRentalPayload,
  equipmentMatchesServiceTicket,
};
