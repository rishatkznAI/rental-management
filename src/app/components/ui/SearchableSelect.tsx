import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search, X } from 'lucide-react';
import { cn } from './utils';

export interface SearchableSelectOption {
  value: string;
  label: string;
  keywords?: string[];
  meta?: string;
}

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyText?: string;
  className?: string;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Начните вводить...',
  emptyText = 'Ничего не найдено',
  className,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(-1);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const mouseSelectedValueRef = useRef<string | null>(null);
  const canUseDom = typeof window !== 'undefined' && typeof document !== 'undefined';

  const selected = useMemo(() => options.find(option => option.value === value), [options, value]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return options;
    return options.filter(option => {
      const haystack = [option.label, option.meta, ...(option.keywords ?? [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalized);
    });
  }, [options, query]);

  useEffect(() => {
    if (!canUseDom) return;

    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !containerRef.current?.contains(target) &&
        !dropdownRef.current?.contains(target)
      ) {
        setOpen(false);
        setQuery('');
        setHighlighted(-1);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [canUseDom]);

  useEffect(() => {
    if (!open) {
      setDropdownStyle(null);
      return;
    }
    if (!canUseDom) return;

    const updateDropdownPosition = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportGap = 12;
      const availableBelow = Math.max(160, window.innerHeight - rect.bottom - viewportGap);
      setDropdownStyle({
        position: 'fixed',
        left: rect.left,
        top: rect.bottom + 4,
        width: rect.width,
        maxHeight: Math.min(288, availableBelow),
        zIndex: 1000,
      });
    };

    updateDropdownPosition();
    window.addEventListener('resize', updateDropdownPosition);
    window.addEventListener('scroll', updateDropdownPosition, true);
    return () => {
      window.removeEventListener('resize', updateDropdownPosition);
      window.removeEventListener('scroll', updateDropdownPosition, true);
    };
  }, [canUseDom, open]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (highlighted < 0 || !dropdownRef.current) return;
    const nodes = dropdownRef.current.querySelectorAll<HTMLButtonElement>('[data-select-option]');
    nodes[highlighted]?.scrollIntoView({ block: 'nearest' });
  }, [highlighted]);

  useEffect(() => {
    setHighlighted(-1);
  }, [query]);

  const selectValue = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
    setQuery('');
    setHighlighted(-1);
  };

  return (
    <div ref={containerRef} className={cn('relative w-full', className)}>
      <div
        className={cn(
          'flex h-10 w-full cursor-text items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm',
          'dark:border-gray-600 dark:bg-gray-700 dark:text-white',
          open ? 'border-[--color-primary] ring-1 ring-[--color-primary]' : 'hover:border-gray-400 dark:hover:border-gray-500',
        )}
        onClick={() => setOpen(true)}
      >
        <Search className="h-3.5 w-3.5 shrink-0 text-gray-400" />
        {open ? (
          <input
            ref={inputRef}
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-gray-400"
            value={query}
            placeholder={selected?.label || placeholder}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setHighlighted(index => Math.min(index + 1, filtered.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setHighlighted(index => Math.max(index - 1, 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                if (highlighted >= 0 && filtered[highlighted]) {
                  selectValue(filtered[highlighted].value);
                }
              } else if (event.key === 'Escape') {
                setOpen(false);
                setQuery('');
              }
            }}
          />
        ) : (
          <span className={cn('min-w-0 flex-1 truncate', !selected && 'text-gray-400')}>
            {selected?.label || placeholder}
          </span>
        )}
        {value ? (
          <button
            type="button"
            className="rounded p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            onMouseDown={event => {
              event.preventDefault();
              onChange('');
              setQuery('');
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400" />
        )}
      </div>

      {open && dropdownStyle && canUseDom && createPortal(
        <div
          ref={dropdownRef}
          style={dropdownStyle}
          className="overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800"
        >
          {filtered.length === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-gray-400">{emptyText}</p>
          ) : (
            <div className="py-1">
              {filtered.map((option, index) => (
                <button
                  key={option.value}
                  type="button"
                  data-select-option
                  className={cn(
                    'flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm transition-colors',
                    highlighted === index
                      ? 'bg-[--color-primary]/10 text-[--color-primary]'
                      : 'text-gray-900 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-700/60',
                  )}
                  onMouseEnter={() => setHighlighted(index)}
                  onMouseDown={event => {
                    event.preventDefault();
                    mouseSelectedValueRef.current = option.value;
                    selectValue(option.value);
                  }}
                  onClick={event => {
                    event.preventDefault();
                    if (mouseSelectedValueRef.current === option.value) {
                      mouseSelectedValueRef.current = null;
                      return;
                    }
                    selectValue(option.value);
                  }}
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{option.label}</div>
                    {option.meta && <div className="truncate text-xs text-gray-500 dark:text-gray-400">{option.meta}</div>}
                  </div>
                  {option.value === value && <span className="text-xs">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
