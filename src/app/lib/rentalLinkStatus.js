function text(value) {
  return String(value ?? '').trim();
}

export function getGanttRentalSourceId(ganttRental) {
  return text(ganttRental?.rentalId || ganttRental?.sourceRentalId || ganttRental?.originalRentalId);
}

export function documentBelongsToRental(doc, rentalIds) {
  const ids = new Set((rentalIds || []).map(text).filter(Boolean));
  if (ids.size === 0) return false;
  return ids.has(text(doc?.rentalId)) || ids.has(text(doc?.rental));
}

export function classifyRentalLinkStatus({
  ganttRental,
  classicRental,
  equipment,
  relatedDocuments = [],
  duplicateGanttCount = 1,
  candidateCount = 0,
} = {}) {
  const sourceRentalId = getGanttRentalSourceId(ganttRental);
  const hasContract = Boolean(
    classicRental?.contractId ||
    relatedDocuments.some(doc => (doc?.documentType || doc?.type) === 'contract'),
  );

  if (duplicateGanttCount > 1 && classicRental) {
    return {
      status: 'duplicate_gantt',
      label: 'Дубль планировщика',
      isBroken: true,
      isContractMissing: !hasContract,
      repairAllowed: false,
      confidence: 'medium',
      details: 'Несколько строк gantt_rentals ссылаются на одну аренду.',
    };
  }

  if (!classicRental) {
    if (sourceRentalId) {
      return {
        status: 'missing_rental',
        label: 'Связь повреждена',
        isBroken: true,
        isContractMissing: !hasContract,
        repairAllowed: false,
        confidence: 'low',
        details: `gantt_rentals ссылается на rentals/${sourceRentalId}, но такая аренда не найдена.`,
      };
    }
    return {
      status: 'orphan_gantt',
      label: candidateCount > 1 ? 'Несколько кандидатов' : 'Запись планировщика без аренды',
      isBroken: true,
      isContractMissing: !hasContract,
      repairAllowed: candidateCount === 1,
      confidence: candidateCount === 1 ? 'high' : 'low',
      details: 'Есть строка gantt_rentals без rentalId/sourceRentalId/originalRentalId.',
    };
  }

  if (!equipment) {
    return {
      status: 'missing_equipment',
      label: 'Техника не найдена',
      isBroken: true,
      isContractMissing: !hasContract,
      repairAllowed: false,
      confidence: 'medium',
      details: 'Аренда найдена, но техника не разрешилась по equipmentId, inventoryNumber или serialNumber.',
    };
  }

  if (!sourceRentalId && classicRental) {
    return {
      status: 'legacy_match',
      label: 'Связь по старым полям',
      isBroken: false,
      isContractMissing: !hasContract,
      repairAllowed: true,
      confidence: 'high',
      details: 'Аренда и техника найдены по legacy-полям, но gantt_rentals нужно нормализовать.',
    };
  }

  if (!hasContract) {
    return {
      status: 'missing_contract',
      label: 'Договор не привязан',
      isBroken: false,
      isContractMissing: true,
      repairAllowed: false,
      confidence: 'high',
      details: 'Связь аренды и техники корректна, но договор/документ договора не привязан.',
    };
  }

  return {
    status: 'ok',
    label: 'Связь корректна',
    isBroken: false,
    isContractMissing: false,
    repairAllowed: false,
    confidence: 'high',
    details: 'Основная аренда, строка планировщика и техника найдены.',
  };
}
