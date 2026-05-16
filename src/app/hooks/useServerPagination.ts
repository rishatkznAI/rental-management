import * as React from 'react';

export type SortDir = 'asc' | 'desc';

export type ServerPaginationState<Filters extends Record<string, unknown> = Record<string, unknown>> = {
  page: number;
  pageSize: number;
  search: string;
  debouncedSearch: string;
  filters: Filters;
  sortBy: string;
  sortDir: SortDir;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  setSearch: (search: string) => void;
  setFilters: (filters: Partial<Filters>) => void;
  setSort: (sortBy: string, sortDir?: SortDir) => void;
  reset: () => void;
};

type Options<Filters extends Record<string, unknown>> = {
  initialPageSize?: number;
  initialSortBy?: string;
  initialSortDir?: SortDir;
  initialFilters?: Filters;
  debounceMs?: number;
  storageKey?: string;
};

function readStoredPageSize(storageKey?: string, fallback = 25) {
  if (!storageKey || typeof window === 'undefined') return fallback;
  const parsed = Number(window.localStorage.getItem(`${storageKey}:pageSize`));
  return [10, 25, 50, 100].includes(parsed) ? parsed : fallback;
}

export function useServerPagination<Filters extends Record<string, unknown> = Record<string, unknown>>(
  options: Options<Filters> = {},
): ServerPaginationState<Filters> {
  const {
    initialPageSize = 25,
    initialSortBy = 'createdAt',
    initialSortDir = 'desc',
    initialFilters = {} as Filters,
    debounceMs = 400,
    storageKey,
  } = options;
  const [page, setPageState] = React.useState(1);
  const [pageSize, setPageSizeState] = React.useState(() => readStoredPageSize(storageKey, initialPageSize));
  const [search, setSearchState] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const [filters, setFiltersState] = React.useState<Filters>(initialFilters);
  const [sortBy, setSortBy] = React.useState(initialSortBy);
  const [sortDir, setSortDir] = React.useState<SortDir>(initialSortDir);

  React.useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, debounceMs);
    return () => window.clearTimeout(handle);
  }, [debounceMs, search]);

  const setPage = React.useCallback((nextPage: number) => {
    setPageState(Math.max(1, Number(nextPage) || 1));
  }, []);

  const setPageSize = React.useCallback((nextPageSize: number) => {
    const normalized = [10, 25, 50, 100].includes(nextPageSize) ? nextPageSize : 25;
    setPageSizeState(normalized);
    setPageState(1);
    if (storageKey && typeof window !== 'undefined') {
      window.localStorage.setItem(`${storageKey}:pageSize`, String(normalized));
    }
  }, [storageKey]);

  const setSearch = React.useCallback((nextSearch: string) => {
    setSearchState(nextSearch);
    setPageState(1);
  }, []);

  const setFilters = React.useCallback((nextFilters: Partial<Filters>) => {
    setFiltersState((current) => ({ ...current, ...nextFilters }));
    setPageState(1);
  }, []);

  const setSort = React.useCallback((nextSortBy: string, nextSortDir?: SortDir) => {
    setSortBy(nextSortBy);
    setSortDir((current) => nextSortDir || (nextSortBy === sortBy && current === 'asc' ? 'desc' : 'asc'));
    setPageState(1);
  }, [sortBy]);

  const reset = React.useCallback(() => {
    setPageState(1);
    setSearchState('');
    setDebouncedSearch('');
    setFiltersState(initialFilters);
    setSortBy(initialSortBy);
    setSortDir(initialSortDir);
  }, [initialFilters, initialSortBy, initialSortDir]);

  return {
    page,
    pageSize,
    search,
    debouncedSearch,
    filters,
    sortBy,
    sortDir,
    setPage,
    setPageSize,
    setSearch,
    setFilters,
    setSort,
    reset,
  };
}
