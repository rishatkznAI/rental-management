const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 25;
const ALLOWED_PAGE_SIZES = [10, 25, 50, 100];
const MAX_PAGE_SIZE = 100;

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizePageSize(value) {
  const parsed = toPositiveInteger(value, DEFAULT_PAGE_SIZE);
  if (ALLOWED_PAGE_SIZES.includes(parsed)) return parsed;
  return Math.min(parsed, MAX_PAGE_SIZE);
}

function normalizePaginationParams(query = {}) {
  const page = toPositiveInteger(query.page, DEFAULT_PAGE);
  const pageSize = normalizePageSize(query.pageSize);
  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
    limit: pageSize,
  };
}

function normalizeSortParams(query = {}, allowedSortFields = {}, fallback = {}) {
  const requestedSortBy = String(query.sortBy || '').trim();
  const defaultSortBy = fallback.sortBy || Object.keys(allowedSortFields)[0] || '';
  const sortBy = requestedSortBy && allowedSortFields[requestedSortBy] ? requestedSortBy : defaultSortBy;
  const requestedSortDir = String(query.sortDir || '').toLowerCase();
  const fallbackSortDir = fallback.sortDir === 'desc' ? 'desc' : 'asc';
  const sortDir = requestedSortDir === 'asc' || requestedSortDir === 'desc' ? requestedSortDir : fallbackSortDir;
  return { sortBy, sortDir };
}

function compareValues(left, right, direction = 'asc') {
  const multiplier = direction === 'desc' ? -1 : 1;
  if (left == null && right == null) return 0;
  if (left == null) return -1 * multiplier;
  if (right == null) return 1 * multiplier;
  if (typeof left === 'number' && typeof right === 'number') {
    return (left - right) * multiplier;
  }
  return String(left).localeCompare(String(right), 'ru', { numeric: true, sensitivity: 'base' }) * multiplier;
}

function sortItems(items, sort, allowedSortFields = {}) {
  if (!sort?.sortBy || !allowedSortFields[sort.sortBy]) return [...items];
  const getter = allowedSortFields[sort.sortBy];
  return [...items].sort((left, right) => compareValues(getter(left), getter(right), sort.sortDir));
}

function buildPaginationMeta(total, page, pageSize) {
  const safeTotal = Math.max(0, Number(total) || 0);
  const totalPages = safeTotal === 0 ? 0 : Math.ceil(safeTotal / pageSize);
  return {
    page,
    pageSize,
    total: safeTotal,
    totalPages,
    hasNextPage: totalPages > 0 && page < totalPages,
    hasPrevPage: page > 1 && totalPages > 0,
  };
}

function paginateItems(items, params) {
  const source = Array.isArray(items) ? items : [];
  const pageItems = source.slice(params.offset, params.offset + params.pageSize);
  return {
    items: pageItems,
    pagination: buildPaginationMeta(source.length, params.page, params.pageSize),
  };
}

function buildPaginatedResponse(items, query = {}, options = {}) {
  const params = normalizePaginationParams(query);
  const sort = normalizeSortParams(query, options.sortFields || {}, options.defaultSort || {});
  const sortedItems = sortItems(items, sort, options.sortFields || {});
  const response = paginateItems(sortedItems, params);
  if (options.summary) response.summary = options.summary;
  return response;
}

function wantsPaginatedResponse(query = {}) {
  return String(query.paginated || '').toLowerCase() === 'true';
}

function normalizeSearch(value) {
  return String(value || '').trim().toLowerCase();
}

function itemMatchesSearch(item, search, fields = []) {
  const query = normalizeSearch(search);
  if (!query) return true;
  return fields.some(field => normalizeSearch(typeof field === 'function' ? field(item) : item?.[field]).includes(query));
}

module.exports = {
  ALLOWED_PAGE_SIZES,
  MAX_PAGE_SIZE,
  buildPaginatedResponse,
  buildPaginationMeta,
  itemMatchesSearch,
  normalizePaginationParams,
  normalizeSearch,
  normalizeSortParams,
  paginateItems,
  sortItems,
  wantsPaginatedResponse,
};
