import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, ChevronDown } from 'lucide-react';
import type { Equipment } from '../../types';
import { cn } from './utils';

// ─── helpers ────────────────────────────────────────────────────────────────

/** Единый читаемый label для единицы техники */
export function eqLabel(eq: Equipment): string {
  const sn = eq.serialNumber ? `SN ${eq.serialNumber}` : 'SN не указан';
  return `${eq.manufacturer} ${eq.model} · INV ${eq.inventoryNumber} · ${sn}`;
}

function matchesSearch(eq: Equipment, q: string): boolean {
  if (!q.trim()) return true;
  const lower = q.toLowerCase();
  return (
    eq.manufacturer.toLowerCase().includes(lower) ||
    eq.model.toLowerCase().includes(lower) ||
    eq.inventoryNumber.toLowerCase().includes(lower) ||
    (eq.serialNumber?.toLowerCase().includes(lower) ?? false)
  );
}

// ─── types ───────────────────────────────────────────────────────────────────

export interface EquipmentGroup {
  label: string;
  items: Equipment[];
}

export interface EquipmentComboboxProps {
  equipment: Equipment[];
  value: string;
  /** Какое поле использовать как value */
  valueKey?: 'id' | 'inventoryNumber';
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /**
   * Если передать группы, список будет разбит на секции
   * (например «Доступна» / «Занята» в модалке аренды).
   * Каждая группа — это equipment + заголовок.
   * Поиск работает по каждой группе независимо.
   */
  groups?: EquipmentGroup[];
  /** Показывать не более N вариантов при пустом запросе */
  initialLimit?: number;
}

// ─── component ───────────────────────────────────────────────────────────────

export function EquipmentCombobox({
  equipment,
  value,
  valueKey = 'id',
  onChange,
  placeholder = 'Введите модель, INV или серийный номер…',
  className,
  groups,
  initialLimit = 10,
}: EquipmentComboboxProps) {
  const [open, setOpen]               = useState(false);
  const [query, setQuery]             = useState('');
  const [highlighted, setHighlighted] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef     = useRef<HTMLInputElement>(null);
  const dropdownRef  = useRef<HTMLDivElement>(null);

  // ── selected item ──────────────────────────────────────────────────────────
  const selectedEq = useMemo(
    () => equipment.find(e => (valueKey === 'id' ? e.id : e.inventoryNumber) === value),
    [equipment, value, valueKey],
  );

  // ── filtered flat list (when no groups) ───────────────────────────────────
  const filteredFlat = useMemo(() => {
    if (groups) return [];
    if (!query.trim()) return equipment.slice(0, initialLimit);
    return equipment.filter(eq => matchesSearch(eq, query));
  }, [equipment, query, groups, initialLimit]);

  // ── filtered groups ────────────────────────────────────────────────────────
  const filteredGroups = useMemo(() => {
    if (!groups) return null;
    return groups
      .map(g => ({
        label: g.label,
        items: query.trim()
          ? g.items.filter(eq => matchesSearch(eq, query))
          : g.items.slice(0, initialLimit),
      }))
      .filter(g => g.items.length > 0);
  }, [groups, query, initialLimit]);

  // ── all flat items for keyboard nav ───────────────────────────────────────
  const allItems: Equipment[] = useMemo(
    () => filteredGroups ? filteredGroups.flatMap(g => g.items) : filteredFlat,
    [filteredFlat, filteredGroups],
  );

  // ── click outside → close ─────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
        setHighlighted(-1);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── select item ───────────────────────────────────────────────────────────
  const handleSelect = useCallback(
    (eq: Equipment) => {
      onChange(valueKey === 'id' ? eq.id : eq.inventoryNumber);
      setOpen(false);
      setQuery('');
      setHighlighted(-1);
    },
    [onChange, valueKey],
  );

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setQuery('');
    setHighlighted(-1);
  };

  // ── keyboard navigation ───────────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) { setOpen(true); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted(h => Math.min(h + 1, allItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlighted >= 0 && allItems[highlighted]) handleSelect(allItems[highlighted]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
      setHighlighted(-1);
    }
  };

  // ── scroll highlighted into view ─────────────────────────────────────────
  useEffect(() => {
    if (highlighted < 0 || !dropdownRef.current) return;
    const items = dropdownRef.current.querySelectorAll<HTMLLIElement>('[data-eq-item]');
    items[highlighted]?.scrollIntoView({ block: 'nearest' });
  }, [highlighted]);

  // ── reset highlight on query change ──────────────────────────────────────
  useEffect(() => { setHighlighted(-1); }, [query]);

  // ── render single item ────────────────────────────────────────────────────
  const renderItem = (eq: Equipment, flatIdx: number) => {
    const isHL  = highlighted === flatIdx;
    const isSel = (valueKey === 'id' ? eq.id : eq.inventoryNumber) === value;
    return (
      <li
        key={valueKey === 'id' ? eq.id : eq.inventoryNumber}
        data-eq-item
        onMouseDown={() => handleSelect(eq)}
        onMouseEnter={() => setHighlighted(flatIdx)}
        className={cn(
          'flex cursor-pointer select-none items-baseline gap-1.5 px-3 py-2 text-sm transition-colors',
          isHL
            ? 'bg-[--color-primary]/10 text-[--color-primary]'
            : 'text-gray-900 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-700/60',
        )}
      >
        <span className="w-4 shrink-0 text-[--color-primary]">{isSel ? '✓' : ''}</span>
        <span className="min-w-0 truncate">{eqLabel(eq)}</span>
      </li>
    );
  };

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div ref={containerRef} className={cn('relative w-full', className)}>
      {/* ── trigger field ── */}
      <div
        className={cn(
          'flex h-10 w-full cursor-text items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 text-sm',
          'dark:border-gray-600 dark:bg-gray-700',
          open
            ? 'border-[--color-primary] ring-1 ring-[--color-primary]'
            : 'hover:border-gray-400 dark:hover:border-gray-500',
        )}
        onClick={() => {
          setOpen(true);
          inputRef.current?.focus();
        }}
      >
        <Search className="h-3.5 w-3.5 shrink-0 text-gray-400" />

        {open ? (
          <input
            ref={inputRef}
            autoFocus
            className="min-w-0 flex-1 bg-transparent text-gray-900 outline-none placeholder:text-gray-400 dark:text-white"
            placeholder={selectedEq ? eqLabel(selectedEq) : placeholder}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        ) : (
          <span className={cn('min-w-0 flex-1 truncate', !selectedEq && 'text-gray-400')}>
            {selectedEq ? eqLabel(selectedEq) : placeholder}
          </span>
        )}

        {value ? (
          <button
            type="button"
            onMouseDown={handleClear}
            className="shrink-0 rounded p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            tabIndex={-1}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400" />
        )}
      </div>

      {/* ── dropdown ── */}
      {open && (
        <div
          ref={dropdownRef}
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800"
        >
          {allItems.length === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-gray-400">
              {query.trim() ? 'Ничего не найдено' : 'Нет доступной техники'}
            </p>
          ) : filteredGroups ? (
            /* grouped mode */
            (() => {
              let flatIdx = 0;
              return filteredGroups.map(group => (
                <div key={group.label}>
                  <div className="sticky top-0 bg-gray-50 px-3 py-1 text-xs font-medium text-gray-500 dark:bg-gray-750 dark:bg-gray-700/80 dark:text-gray-400">
                    {group.label}
                  </div>
                  <ul>
                    {group.items.map(eq => {
                      const idx = flatIdx++;
                      return renderItem(eq, idx);
                    })}
                  </ul>
                </div>
              ));
            })()
          ) : (
            /* flat mode */
            <>
              <ul>
                {filteredFlat.map((eq, idx) => renderItem(eq, idx))}
              </ul>
              {!query.trim() && equipment.length > initialLimit && (
                <p className="border-t border-gray-100 px-3 py-1.5 text-center text-xs text-gray-400 dark:border-gray-700">
                  Показаны первые {initialLimit} из {equipment.length} — введите текст для поиска
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
