function text(value) {
  return String(value ?? '').trim();
}

const RENTAL_ID_FIELDS = [
  'id',
  'rentalId',
  'sourceRentalId',
  'originalRentalId',
  'contractId',
  'contractNumber',
  'number',
  'ganttRentalId',
  'externalId',
];

function hasRentalId(rentalsById, id) {
  const normalized = text(id);
  return normalized && rentalsById.has(normalized);
}

function resolveFromGantt(ganttRental, rentalsById) {
  if (!ganttRental) return null;
  for (const candidate of [ganttRental.rentalId, ganttRental.sourceRentalId, ganttRental.originalRentalId]) {
    const id = text(candidate);
    if (hasRentalId(rentalsById, id)) return id;
  }
  return null;
}

export function resolveRentalNavigationId(rentalLike, rentals = [], ganttRentals = []) {
  return resolveRentalByAnyId(rentalLike, rentals, ganttRentals).canonicalId || null;
}

function addRentalCandidate(candidates, rental, source) {
  const id = text(rental?.id);
  if (!id) return;
  const current = candidates.get(id);
  if (current) {
    current.sources.push(source);
    return;
  }
  candidates.set(id, { rental, sources: [source] });
}

function primarySource(sources = []) {
  if (sources.includes('rentals.id')) return 'rentals.id';
  if (sources.includes('rentals.rentalId')) return 'rentals.rentalId';
  const ganttLink = sources.find(source => source.startsWith('gantt_rentals.'));
  if (ganttLink) return 'gantt_rentals.linkedRentalId';
  return sources[0] || 'legacy';
}

function valuesForLookup(value) {
  if (value && typeof value === 'object') {
    return RENTAL_ID_FIELDS
      .flatMap(field => {
        if (field === 'ganttRentalId') {
          return [value[field], value.linkedGanttRentalId, value.__linkedGanttRentalId, value.__ganttRentalId];
        }
        return [value[field]];
      })
      .map(text)
      .filter(Boolean);
  }
  const normalized = text(value);
  return normalized ? [normalized] : [];
}

function unique(values) {
  return Array.from(new Set(values.map(text).filter(Boolean)));
}

export function resolveRentalByAnyId(value, rentals = [], ganttRentals = []) {
  const requestedIds = unique(valuesForLookup(value));
  const safeRentals = Array.isArray(rentals) ? rentals : [];
  const safeGanttRentals = Array.isArray(ganttRentals) ? ganttRentals : [];
  const candidates = new Map();
  const diagnostics = {
    requestedIds,
    searchedCollections: ['rentals', 'gantt_rentals'],
    foundGanttRecord: null,
    linkedRentalIds: [],
    candidateIds: [],
    candidateSources: {},
    warnings: [],
  };

  if (requestedIds.length === 0) {
    return {
      ok: false,
      status: 'not_found',
      rental: null,
      canonicalId: '',
      source: '',
      ganttRental: null,
      warnings: diagnostics.warnings,
      diagnostics,
      message: 'Аренда не найдена по пустому идентификатору.',
    };
  }

  const rentalsById = new Map(
    safeRentals
      .map(rental => [text(rental?.id), rental])
      .filter(([id]) => Boolean(id)),
  );
  const ganttById = new Map(
    safeGanttRentals
      .map(ganttRental => [text(ganttRental?.id), ganttRental])
      .filter(([id]) => Boolean(id)),
  );

  requestedIds.forEach(requestedId => {
    safeRentals.forEach(rental => {
      const matchedField = RENTAL_ID_FIELDS.find(field => text(rental?.[field]) === requestedId);
      if (matchedField) addRentalCandidate(candidates, rental, `rentals.${matchedField}`);
    });

    const ganttRental = ganttById.get(requestedId);
    if (ganttRental) {
      diagnostics.foundGanttRecord = ganttRental;
      const linkedIds = unique([ganttRental.rentalId, ganttRental.sourceRentalId, ganttRental.originalRentalId]);
      diagnostics.linkedRentalIds.push(...linkedIds);
      linkedIds.forEach(linkedId => {
        if (hasRentalId(rentalsById, linkedId)) {
          addRentalCandidate(candidates, rentalsById.get(linkedId), `gantt_rentals.${requestedId}`);
        }
      });
    }

    safeGanttRentals.forEach(gantt => {
      const matchedGanttField = ['rentalId', 'sourceRentalId', 'originalRentalId', 'contractId', 'contractNumber', 'number', 'ganttRentalId', 'externalId']
        .find(field => text(gantt?.[field]) === requestedId);
      if (!matchedGanttField) return;
      if (!diagnostics.foundGanttRecord && text(gantt.id) === requestedId) {
        diagnostics.foundGanttRecord = gantt;
      }
      const linkedIds = unique([gantt.rentalId, gantt.sourceRentalId, gantt.originalRentalId]);
      diagnostics.linkedRentalIds.push(...linkedIds);
      linkedIds.forEach(linkedId => {
        if (hasRentalId(rentalsById, linkedId)) {
          addRentalCandidate(candidates, rentalsById.get(linkedId), `gantt_rentals.${matchedGanttField}`);
        }
      });
    });
  });

  diagnostics.linkedRentalIds = unique(diagnostics.linkedRentalIds);
  diagnostics.candidateIds = Array.from(candidates.keys());
  diagnostics.candidateSources = Object.fromEntries(
    Array.from(candidates.entries()).map(([id, candidate]) => [id, candidate.sources]),
  );
  if (diagnostics.foundGanttRecord && diagnostics.linkedRentalIds.length === 0) {
    diagnostics.warnings.push('gantt_rentals record has no rentalId/sourceRentalId/originalRentalId link.');
  }
  if (diagnostics.linkedRentalIds.length > 0 && candidates.size === 0) {
    diagnostics.warnings.push('gantt_rentals record links to rentals ids that are missing.');
  }

  if (candidates.size === 1) {
    const [canonicalId, candidate] = Array.from(candidates.entries())[0];
    return {
      ok: true,
      status: 'found',
      rental: candidate.rental,
      canonicalId,
      source: primarySource(candidate.sources),
      ganttRental: diagnostics.foundGanttRecord,
      warnings: diagnostics.warnings,
      diagnostics,
      message: '',
    };
  }

  if (candidates.size > 1) {
    return {
      ok: false,
      status: 'conflict',
      rental: null,
      canonicalId: '',
      source: '',
      ganttRental: diagnostics.foundGanttRecord,
      warnings: diagnostics.warnings,
      diagnostics,
      message: 'Найдено несколько связанных записей аренды. Нужна проверка связей.',
    };
  }

  return {
    ok: false,
    status: 'not_found',
    rental: null,
    canonicalId: '',
    source: '',
    ganttRental: diagnostics.foundGanttRecord,
    warnings: diagnostics.warnings,
    diagnostics,
    message: 'Аренда не найдена по переданному идентификатору.',
  };
}
