export const DEFAULT_RENTAL_LIST_PAGE_SIZE = 25;
export const RENTAL_LIST_PAGE_SIZE_OPTIONS = [25, 50, 100];

export function normalizeRentalListPageSize(value) {
  const numeric = Number(value);
  return RENTAL_LIST_PAGE_SIZE_OPTIONS.includes(numeric)
    ? numeric
    : DEFAULT_RENTAL_LIST_PAGE_SIZE;
}

export function getRentalListPageState(items, currentPage = 1, pageSize = DEFAULT_RENTAL_LIST_PAGE_SIZE) {
  const sourceItems = Array.isArray(items) ? items : [];
  const normalizedPageSize = normalizeRentalListPageSize(pageSize);
  const total = sourceItems.length;
  const maxPage = Math.max(1, Math.ceil(total / normalizedPageSize));
  const requestedPage = Math.trunc(Number(currentPage)) || 1;
  const normalizedPage = Math.min(Math.max(1, requestedPage), maxPage);
  const startOffset = total === 0 ? 0 : (normalizedPage - 1) * normalizedPageSize;
  const endOffset = Math.min(startOffset + normalizedPageSize, total);
  const startIndex = total === 0 ? 0 : startOffset + 1;
  const endIndex = total === 0 ? 0 : endOffset;

  return {
    pageItems: sourceItems.slice(startOffset, endOffset),
    currentPage: normalizedPage,
    pageSize: normalizedPageSize,
    maxPage,
    total,
    startIndex,
    endIndex,
    hasPreviousPage: normalizedPage > 1,
    hasNextPage: normalizedPage < maxPage,
    rangeLabel: total === 0 ? 'Ничего не найдено' : `Показано ${startIndex}–${endIndex} из ${total}`,
  };
}
